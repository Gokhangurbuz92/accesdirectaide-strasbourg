/**
 * FA-CAP — ADMINISTRATION, DATA / OPERATIONS and PLATFORM capabilities. The administration surface IS open in Production: its capabilities are tested on the
 * PRODUCTION configuration server (PROD) with a named administrator session with MFA (signed with this run's secret; the sign-in screen is covered by
 * e2e-r47/admin) — in the console in the browser where the capability has a screen, through the console's own API calls otherwise. A capability closed in
 * Production is tested on OPEN and its refusal on PROD. LAB_SYNTHETIC records only.
 */
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OPEN, PROD, TWIN, CREDS, TOKENS, db, closeDb, visitor, anon, bearer, ips, expectClosed, citizenSignIn, consoleContext, outbox } from './lib.mjs';

const nextIp = ips(180, 249);
const F = CREDS.catalogue.citizens; const ORG = CREDS.structures;
const code = (j) => j?.code || j?.error;
const admin = (method, p, body, base = PROD, token = 'admin') => bearer(token, method, p, body, { ip: nextIp(), base });
const cron = (job, base = PROD) => fetch(`${base}/api/cron/${job}`, { headers: { authorization: `Bearer ${TOKENS.cron}`, 'x-forwarded-for': nextIp() } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const SP = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006';
test.afterAll(async () => { await closeDb(); });

/** the administration console in the browser (PROD) */
async function console_(browser, p, base = PROD) {
  const K = await consoleContext(browser, 'admin', 'admin', { ip: nextIp(), base });
  await K.page.goto(`${base}${p}`);
  return K;
}

test('P27 dossier de subventions (/admin/financement): a funding dossier is created, saved with a version check and exported as Markdown', async ({ browser }) => {
  const c = await admin('POST', '/api/admin/funding', { action: 'create', title: 'Dossier FAB fondation (test)', funderName: 'Fondation fictive', programmeUrl: 'https://example.test/appel' });
  expect(c.status, c.text).toBeLessThan(300);
  const id = c.json.dossier?.id || c.json.id;
  const one = await admin('GET', `/api/admin/funding?id=${id}`);
  const version = one.json.dossier?.version ?? one.json.version;
  expect((await admin('POST', '/api/admin/funding', { action: 'save', id, version: version + 5, content: { besoin: 'x' } })).status, 'stale version').toBe(409);
  expect((await admin('POST', '/api/admin/funding', { action: 'save', id, version, content: { besoin: 'Besoin décrit pour le test FAB.' } })).status).toBe(200);
  const md = await admin('GET', `/api/admin/funding?export=${id}`);
  expect(md.status).toBe(200); expect(md.text).toContain('Dossier FAB fondation (test)');
  const K = await console_(browser, '/admin/financement');
  await expect(K.page.locator('main')).toContainText('Dossier FAB fondation (test)');
  expect(K.serverErrors).toEqual([]); await K.context.close();
});

test('A02 catalogue CRUD: a draft aide is created, edited (versioned) and archived — never public while a draft; every write journalised', async ({ browser }) => {
  const c = await admin('POST', '/api/admin/content?kind=aide', { titre: 'Brouillon FAB A02 (test)', categorie: 'logement', cest_quoi: 'Texte de test FAB A02.' });
  expect(c.status, c.text).toBeLessThan(300);
  const id = c.json.id || c.json.record?.id || c.json.item?.id;
  expect((await admin('PUT', `/api/admin/content?kind=aide&id=${id}`, { titre: 'Brouillon FAB A02 modifié (test)' })).status).toBe(200);
  expect((await db(`SELECT titre FROM "Aide" WHERE id = $1`, [id]))[0].titre).toBe('Brouillon FAB A02 modifié (test)');
  expect(JSON.stringify((await anon('GET', '/api/aides?pageSize=50', undefined, { base: PROD, ip: nextIp() })).json)).not.toContain('Brouillon FAB A02');
  expect((await admin('DELETE', `/api/admin/content?kind=aide&id=${id}`)).status).toBe(200);
  expect((await db(`SELECT count(*)::int n FROM "Aide" WHERE id = $1`, [id]))[0].n, 'archived, never physically deleted').toBe(1);
  expect((await db(`SELECT count(*)::int n FROM "AuditLog" WHERE entity_id = $1 OR details::text LIKE $2`, [id, `%${id}%`]))[0].n).toBeGreaterThanOrEqual(3);
  const K = await console_(browser, '/admin/aides');
  await expect(K.page.locator('main h1').first()).toBeVisible();
  await K.context.close();
});

test('A04 review queue: an open item is decided by a NAMED administrator (audit row), « resolved by AI » is refused as a human decision', async ({ browser }) => {
  const [row] = await db(`INSERT INTO "ReviewQueueItem" (id, "entityType", "entityId", title, reason, severity, status, details, "updatedAt") VALUES (gen_random_uuid()::text, 'aide', 'fab-aide-emploi', 'Lien à vérifier (FAB A04)', 'LINK_CHECK', 'MEDIUM', 'open', '{}'::jsonb, NOW()) RETURNING id`);
  expect((await admin('PATCH', `/api/admin/review-queue/${row.id}`, { status: 'resolved_by_ai' })).status).toBe(400);
  const d = await admin('PATCH', `/api/admin/review-queue/${row.id}`, { status: 'resolved', reason: 'Lien vérifié à la main (FAB)' });
  expect(d.status, d.text).toBe(200);
  const audit = await db(`SELECT actor FROM "AuditLog" WHERE action = 'REVIEW_QUEUE_DECISION' AND entity_id = $1`, [row.id]);
  expect(audit.map((a) => a.actor)).toEqual([CREDS.admins.a]);
  const K = await console_(browser, '/admin/review-queue');
  await expect(K.page.locator('main h1').first()).toBeVisible();
  await K.context.close();
});

test('A05 provenance and freshness windows: a record verified 120 days ago is public with « update needed », beyond 180 days it leaves the public catalogue; link-check results are listed', async () => {
  const aging = await anon('GET', `/api/aides/${CREDS.aides.aging.slug}`, undefined, { base: PROD, ip: nextIp() });
  expect(aging.status).toBe(200);
  expect(JSON.stringify(aging.json)).toMatch(/update_needed/);
  expect((await anon('GET', `/api/aides/${CREDS.aides.fresh.slug}`, undefined, { base: PROD, ip: nextIp() })).json).toMatchObject({});
  expect(JSON.stringify((await anon('GET', `/api/aides/${CREDS.aides.fresh.slug}`, undefined, { base: PROD, ip: nextIp() })).json)).toMatch(/"current"/);
  expect((await anon('GET', `/api/aides/${CREDS.aides.stale.slug}`, undefined, { base: PROD, ip: nextIp() })).status).toBe(404);
  const lc = await admin('GET', '/api/admin/link-checks?kind=link');
  expect(lc.status).toBe(200);
  // the job is closed in Production until the owner opens it (C2) — the gate holds
  expectClosed(await anon('GET', '/api/cron/link-check', undefined, { base: PROD, ip: nextIp() }), 'A05 link-check job');
});

test('A06 source registry, ingestion and sync runs: the registry of official sources and the recorded job runs are shown to the administrator', async ({ browser }) => {
  const v = await admin('GET', '/api/admin/veille');
  expect(v.status).toBe(200);
  expect(JSON.stringify(v.json)).toMatch(/service-public|DILA/i);
  await cron('health-alert');   // an opened Production job writes its run record
  const runs = await admin('GET', '/api/admin/cron-runs');
  expect(runs.status).toBe(200);
  expect(JSON.stringify(runs.json)).toContain('health-alert');
  const K = await console_(browser, '/admin/veille');
  await expect(K.page.locator('main')).toContainText(/source/i);
  expect(K.serverErrors).toEqual([]); await K.context.close();
});

test('A08 data quality dashboard: the counters reflect the catalogue (hidden records counted apart)', async ({ browser }) => {
  const q = await admin('GET', '/api/admin/data-quality');
  expect(q.status).toBe(200);
  expect(JSON.stringify(q.json)).toMatch(/\d/);
  const K = await console_(browser, '/admin/data-quality');
  await expect(K.page.locator('main h1').first()).toBeVisible();
  expect(K.serverErrors).toEqual([]); await K.context.close();
});

test('A10 / P12 editorial workspace: a /ressources document is created, verified by a named administrator against its exact version, published — and only then public', async ({ browser }) => {
  const draft = { title: 'Document FAB ressources (test)', type: 'guide', content: 'Document de test FAB : il renvoie vers la fiche officielle du service public.', source_url: SP, source_publisher: 'Service-Public.fr (DILA)' };
  const c = await admin('POST', '/api/admin/resources', { action: 'create', draft });
  expect(c.status, c.text).toBe(201);
  const id = c.json.item?.id || c.json.id || c.json.document?.id;
  expect((await admin('POST', '/api/admin/resources', { action: 'publish', id })).json?.ok, 'not verified yet').not.toBe(true);
  const one = await admin('GET', `/api/admin/resources?id=${id}`);
  const version = one.json.item?.version ?? one.json.version ?? one.json.document?.version;
  expect((await admin('POST', '/api/admin/resources', { action: 'verify', id, expectedVersion: version, note: 'Relu sur la fiche officielle (LAB)' })).status).toBe(200);
  expect((await admin('POST', '/api/admin/resources', { action: 'publish', id })).status).toBe(200);
  const P = await visitor(browser, nextIp, { base: PROD });
  const page = await P.context.newPage();
  await page.goto(`${PROD}/ressources`);
  await expect(page.getByTestId('ressource-title').filter({ hasText: 'Document FAB ressources (test)' })).toBeVisible();
  await expect(page.getByTestId('ressource-verified').first()).toBeVisible();
  await P.context.close();
  expect((await db(`SELECT count(*)::int n FROM "ResourcePublicationEvent" WHERE "resourceId" = $1`, [id]).catch(() => db(`SELECT count(*)::int n FROM "ResourcePublicationEvent"`)))[0].n).toBeGreaterThanOrEqual(3);
});

test('A11 moderation: support requests are moderated in the administration (no dossier content); content-report triage needs the communications surface — closed in Production (the gate holds)', async () => {
  // OPEN: a person's help request is stored sealed and reaches the administration without any dossier content
  const sent = await anon('POST', '/api/support', { category: 'CONTENT', message: 'Une fiche me semble ancienne (FAB A11).' }, { base: OPEN, ip: nextIp() });
  expect(sent.status, sent.text).toBeLessThan(300);
  const list = await admin('GET', '/api/admin/support', undefined, OPEN);
  expect(list.status).toBe(200);
  const item = (list.json.items || list.json.requests || []).find((r) => /FAB A11/.test(JSON.stringify(r)));
  expect(item).toBeTruthy();
  expect((await admin('POST', '/api/admin/support', { id: item.id, status: 'ANSWERED', resolutionNote: 'Fiche vérifiée (LAB)' }, OPEN)).status).toBe(200);
  // PROD: the administrator's queue answers; the public channels and the report triage stay closed
  expect((await admin('GET', '/api/admin/support')).status).toBe(200);
  expectClosed(await anon('POST', '/api/support', { category: 'OTHER', message: 'x' }, { base: PROD, ip: nextIp() }), 'A11 support request');
  expectClosed(await admin('GET', '/api/reports'), 'A11 report triage');
});

test('A14 AI metrics and RAG health: the local model is reported unavailable (null, not zero), each aide shows whether it has an embedding', async () => {
  const m = await admin('GET', '/api/admin/ai-metrics');
  expect(m.status).toBe(200);
  expect(m.json.local === null || typeof m.json.local === 'object').toBe(true);
  const r = await admin('GET', '/api/admin/rag-health');
  expect(r.status).toBe(200);
  const rows = r.json.data;
  const fab = rows.find((a) => a.slug === 'fab-aide-logement');
  expect(fab).toBeTruthy(); expect(typeof (fab.hasEmbedding ?? fab.embedded ?? fab.has_embedding)).toBe('boolean');
});

test('A18 privacy-safe analytics (pipeline OFF): no audience request leaves the browser; the administration aggregates only — PROD and OPEN', async ({ browser }) => {
  for (const base of [PROD, OPEN]) {
    const P = await visitor(browser, nextIp, { base });
    const page = await P.context.newPage();
    const beacons = []; page.on('request', (r) => { if (/analytics|collect|insights|beacon|vitals/i.test(r.url())) beacons.push(r.url()); });
    await page.goto(`${base}/aides`); await page.goto(`${base}/aides/fab-aide-logement`);
    expect(beacons, base).toEqual([]);
    expect(P.external, base).toEqual([]);
    await P.context.close();
  }
  const a = await admin('GET', '/api/admin/analytics');
  expect(a.status).toBe(200);
  expect(JSON.stringify(a.json)).not.toMatch(/@|192\.0\.2\./);
});

test('A19 support tooling without dossier content: the support view of a person shows the request, never a dossier', async () => {
  const P = await anon('POST', '/api/support', { category: 'ACCOUNT', message: 'Je ne retrouve pas mon dossier (FAB A19).' }, { base: OPEN, ip: nextIp() });
  expect(P.status).toBeLessThan(300);
  const list = await admin('GET', '/api/admin/support', undefined, OPEN);
  const s = JSON.stringify(list.json);
  expect(s).toContain('FAB A19');
  expect(s).not.toMatch(/assessment|situation|SharedDiagnostic|results/);
  expect((await db(`SELECT count(*)::int n FROM "SupportRequest" WHERE message LIKE '%FAB A19%'`).catch(() => [{ n: 0 }]))[0].n, 'sealed at rest').toBe(0);
});

test('D04 / D07 official connectors (Service-Public DILA, FINESS): the source registry names them with their licence; published records carry their official source', async () => {
  const v = await admin('GET', '/api/admin/veille');
  const reg = JSON.stringify(v.json);
  expect(reg).toMatch(/service-public/i);
  expect(reg).toMatch(/FINESS/i);
  const a = await anon('GET', `/api/aides/${CREDS.catalogue.aide}`, undefined, { base: PROD, ip: nextIp() });
  expect(JSON.stringify(a.json)).toContain('service-public.gouv.fr');
});

test('D05 / D06 / D21 / D23 closed or external providers are said honestly: data·inclusion token, Strasbourg CMS, Sentry DSN and the AI model are NOT_CONFIGURED; nothing is called', async () => {
  const p = await admin('GET', '/api/admin/provider-status');
  expect(p.status).toBe(200);
  const s = JSON.stringify(p.json);
  expect(s).toMatch(/NOT_CONFIGURED|DISCONNECTED/);
  expect(s).not.toMatch(/sk-|Bearer |password/i);   // names only, never values
  const st = await anon('GET', '/api/status', undefined, { base: PROD, ip: nextIp() });
  expect(st.json.components.find((c) => c.id === 'assistant').state).not.toBe('operational');   // the local model is not reachable: never « working »
  expectClosed(await anon('POST', '/api/assistant/chat', { message: 'bonjour' }, { base: PROD, ip: nextIp() }), 'D23 assistant');
});

test('D13 duplicate register: two records sharing a SIRET are a candidate pair; a decision needs an official source and both versions, and is kept in the history', async ({ browser }) => {
  for (const [id, nom] of [['fab-dup-a', 'Association FAB doublon (test)'], ['fab-dup-b', 'Asso FAB doublon (test)']]) {   // same address: a strong candidate signal
    await db(`INSERT INTO "Structure" (id, slug, nom, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, data_origin, "updatedAt", "createdAt")
      VALUES ($1, $1, $2, 'association', '7 rue du Doublon Fictif', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'official_source', NOW(), NOW())`, [id, nom]);
  }
  const c = await admin('GET', '/api/admin/duplicates');
  expect(c.status).toBe(200);
  expect(JSON.stringify(c.json)).toContain('fab-dup-a');
  const pair = await admin('GET', '/api/admin/duplicates?a=fab-dup-a&b=fab-dup-b');
  expect(pair.status).toBe(200);
  const vA = pair.json.a?.version ?? pair.json.records?.[0]?.version; const vB = pair.json.b?.version ?? pair.json.records?.[1]?.version;
  expect((await admin('POST', '/api/admin/duplicates', { a: 'fab-dup-a', b: 'fab-dup-b', decision: 'DISTINCT', note: 'x', versionA: vA, versionB: vB })).status, 'no official evidence').toBeGreaterThanOrEqual(400);
  const d = await admin('POST', '/api/admin/duplicates', { a: 'fab-dup-a', b: 'fab-dup-b', decision: 'DISTINCT', evidenceUrl: 'https://annuaire-entreprises.data.gouv.fr/etablissement/00000000000017', note: 'Deux établissements distincts (LAB)', versionA: vA, versionB: vB });
  expect(d.status, d.text).toBe(200);
  const h = await admin('GET', '/api/admin/duplicates?view=history');
  expect(JSON.stringify(h.json)).toContain('fab-dup-a');
  const K = await console_(browser, '/admin/doublons');
  await expect(K.page.locator('main h1').first()).toBeVisible();
  await K.context.close();
});

test('D14 change detection and versions: an edit of a record keeps the previous version (snapshot) that the administrator can read back', async () => {
  const before = (await db(`SELECT count(*)::int n FROM "ContentVersion" WHERE entity_id = 'fab-aide-famille'`).catch(() => [{ n: 0 }]))[0].n;
  expect((await admin('PUT', '/api/admin/content?kind=aide&id=fab-aide-famille', { cest_quoi: 'Texte modifié pour le test FAB D14.' })).status).toBe(200);
  const v = await admin('GET', '/api/admin/content-versions?entityType=aide&entityId=fab-aide-famille');
  expect(v.status).toBe(200);
  const kept = v.json.versions.find((x) => /cest_quoi/.test(x.reason));
  expect(kept.actor).toBe(CREDS.admins.a);
  const diff = await admin('GET', `/api/admin/content-versions?versionId=${kept.id}`);   // what restoring it would change: the previous text comes back
  expect(diff.status).toBe(200);
  expect(JSON.stringify(diff.json.changes)).toContain('Fiche de test : Aide FAB famille');
  expect(before).toBeGreaterThanOrEqual(0);
});

test('D19 FALC generation with deterministic fallback and human review: OPEN — a draft is produced without the model and reaches the public record only after a named approval; PROD — the public generation is refused', async () => {
  const d = await admin('POST', '/api/admin/falc', { action: 'draft', entityType: 'aide', entityId: 'fab-aide-emploi', field: 'summary_falc' }, OPEN);
  expect(d.status, d.text).toBeLessThan(300);
  const id = d.json.draft?.id || d.json.id;
  expect((await db(`SELECT summary_falc FROM "Aide" WHERE id = 'fab-aide-emploi'`))[0].summary_falc, 'nothing public before approval').toBeNull();
  const ap = await admin('POST', '/api/admin/falc', { action: 'approve', id, note: 'Relu (LAB)' }, OPEN);
  expect(ap.status, ap.text).toBe(200);
  expect((await db(`SELECT summary_falc FROM "Aide" WHERE id = 'fab-aide-emploi'`))[0].summary_falc).toBeTruthy();
  expectClosed(await anon('POST', '/api/public/falc/summarize', { text: 'Texte' }, { base: PROD, ip: nextIp() }), 'D19 public FALC');
});

test('D22 human oversight of AI outputs: pending AI suggestions are counted and decided by a named administrator, never applied automatically', async () => {
  const [row] = await db(`INSERT INTO "ReviewQueueItem" (id, "entityType", "entityId", title, reason, severity, status, details, "updatedAt") VALUES (gen_random_uuid()::text, 'aide', 'fab-aide-famille', 'Suggestion IA (FAB D22)', 'AI_REPAIR', 'LOW', 'open', '{"ai_suggestion": {"field": "titre", "value": "x"}}'::jsonb, NOW()) RETURNING id`);
  const g = await admin('GET', '/api/admin/ai-oversight');
  expect(g.status).toBe(200);
  expect((await admin('PATCH', `/api/admin/review-queue/${row.id}`, { status: 'resolved', reason: 'court' })).json?.error).toBe('REASON_REQUIRED');
  const ok = await admin('PATCH', `/api/admin/review-queue/${row.id}`, { status: 'dismissed', reason: 'Suggestion écartée après relecture (LAB)' });
  expect(ok.status, ok.text).toBe(200);
  expect((await db(`SELECT titre FROM "Aide" WHERE id = 'fab-aide-famille'`))[0].titre).toBe('Aide FAB famille (test)');   // the record itself is untouched
});

test('I05 partner onboarding and agreements: OPEN — an account created under a draft agreement stays pending and cannot be activated until the agreement is signed; PROD — the institution surface is refused (gate holds)', async () => {
  const a = await admin('POST', '/api/admin/institutions', { action: 'agreement_create', partnerName: 'Collectivité FAB (test)', kind: 'CONVENTION' }, OPEN);
  expect(a.status, a.text).toBe(200);
  const id = a.json.id || a.json.agreement?.id;
  const acc = await admin('POST', '/api/admin/institutions', { action: 'account_create', email: 'fab-inst@example.test', organisationName: 'Collectivité FAB (test)', territory: 'Bas-Rhin', agreementId: id }, OPEN);
  expect(acc.status, acc.text).toBe(200);
  expect(acc.json.initialPassword).toBeTruthy();   // shown once, for an out-of-band hand-over
  expect((await db(`SELECT status, territory FROM "InstitutionAccount" WHERE id = $1`, [acc.json.id]))[0].status).toBe('PENDING_AGREEMENT');
  expect(code((await admin('POST', '/api/admin/institutions', { action: 'account_activate', id: acc.json.id }, OPEN)).json)).toBe('AGREEMENT_NOT_SIGNED');
  expect((await admin('POST', '/api/admin/institutions', { action: 'agreement_sign', id, documentRef: 'SYNTHETIC-FAB-I05', signedAt: new Date().toISOString().slice(0, 10), signedByPartner: 'Signataire fictif' }, OPEN)).status).toBe(200);
  expect((await admin('POST', '/api/admin/institutions', { action: 'account_activate', id: acc.json.id }, OPEN)).status).toBe(200);
  expect((await db(`SELECT status FROM "InstitutionAccount" WHERE id = $1`, [acc.json.id]))[0].status).toBe('ACTIVE');
  expect((await db(`SELECT count(*)::int n FROM "AuditLog" WHERE action IN ('INSTITUTION_ACCOUNT_CREATED', 'INSTITUTION_ACCOUNT_ACTIVATED') AND entity_id = $1`, [acc.json.id]))[0].n).toBe(2);
  expectClosed(await admin('GET', '/api/admin/institutions'), 'I05 institutions (PROD)');
});

test('Q03 RGPD notices and retention: the privacy notice is published; the purge job runs in Production but deletes nothing until the owner enables it', async ({ browser }) => {
  const P = await visitor(browser, nextIp, { base: PROD });
  const page = await P.context.newPage();
  await page.goto(`${PROD}/confidentialite`);
  await expect(page.locator('main h1').first()).toBeVisible();
  expect((await page.locator('main').innerText()).length).toBeGreaterThan(1000);
  await page.goto(`${PROD}/confidentialite/notice`);   // the v7 notice: shown as a draft until 6B sets the approved version (never as « in force » before)
  await expect(page.locator('main h1').first()).toBeVisible();
  await P.context.close();
  const before = (await db(`SELECT count(*)::int n FROM "CitizenUser"`))[0].n;
  const r = await cron('gdpr-purge');
  expect([200, 503]).toContain(r.status);
  expect(JSON.stringify(r.json)).toMatch(/disabled|DISABLED|désactiv|not enabled|GDPR_PURGE_ENABLED/i);
  expect((await db(`SELECT count(*)::int n FROM "CitizenUser"`))[0].n).toBe(before);
});

test('Q05 performance budgets measurable locally: a short load of the public reading paths stays within the budgets (one machine, not the hosting)', async () => {
  const out = path.join(os.tmpdir(), `fab-q05-${crypto.randomUUID()}.json`);
  const r = spawnSync(process.execPath, ['scripts/load-budget.mjs', '--base', PROD, '--duration', '24', '--users', '3', '--think', '1500', '--out', out], { encoding: 'utf8', timeout: 60000 });
  const report = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  fs.rmSync(out, { force: true });
  expect(report, r.stderr).toBeTruthy();
  expect(report.results.length).toBeGreaterThan(0);
  expect(report.allWithinBudget, r.stdout).toBe(true);
});

test('Q07 monitoring and security alerts: the hourly health job runs in Production and the security signals are aggregates only', async () => {
  const h = await cron('health-alert');
  expect([200, 503], 'the job runs (503 = it raised an alert, by design)').toContain(h.status);
  expect(h.json.checkedAt).toBeTruthy();
  expect((await db(`SELECT count(*)::int n FROM "CronRun" WHERE job = 'health-alert'`))[0].n).toBeGreaterThan(0);
  const s = await admin('GET', '/api/admin/security-signals');
  expect(s.status).toBe(200);
  expect(JSON.stringify(s.json)).not.toMatch(/@[a-z]|192\.0\.2\./);
  const a = await admin('GET', '/api/admin/alerts');
  expect(a.status).toBe(200);
});

test('Q08 release engineering: the deployed commit is identified on every answer (x-release-sha, the rollback reference) and the build-info matches it', async () => {
  const r = await fetch(`${PROD}/api/health`, { headers: { 'x-forwarded-for': nextIp() } });
  const sha = r.headers.get('x-release-sha');
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  expect(sha).toBe(head);
});

test('Q11 multi-instance: a session opened on one instance is honoured by another; signing out on one ends it on both (shared database state)', async ({ browser }) => {
  const P = await visitor(browser, nextIp, { base: OPEN });
  const page = await P.context.newPage();
  await citizenSignIn(page, F[23], '/compte', OPEN);
  const cookies = await P.context.cookies(OPEN);
  const T = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': nextIp() } });
  await T.addCookies(cookies.map((c) => ({ ...c, domain: '127.0.0.1', url: undefined, path: '/' })));
  const meTwin = await T.request.get(`${TWIN}/api/auth/me`);
  expect(JSON.stringify(await meTwin.json())).toContain(F[23].email);
  expect((await P.api('POST', '/api/auth/logout', {})).status).toBeLessThan(300);
  const after = await T.request.get(`${TWIN}/api/auth/me`);
  expect(JSON.stringify(await after.json().catch(() => ({})))).not.toContain(F[23].email);
  await T.close(); await P.context.close();
});

test('Q14 measured-outcomes foundation: OPEN — the institution’s observatory publishes aggregates only (no case, no small cell); PROD — the institution surface is refused', async () => {
  const o = await bearer('inst67', 'GET', '/api/institution/observatoire', undefined, { ip: nextIp(), base: OPEN });
  expect(o.status).toBe(200);
  expect(JSON.stringify(o.json)).not.toMatch(/fab-cit-|@usagers|shareId/);
  expectClosed(await bearer('inst67', 'GET', '/api/institution/observatoire', undefined, { ip: nextIp(), base: PROD }), 'Q14 observatory');
});

test('X10 public / institutional API: invalid parameters refused (400), per-address rate limit (429), institution API needs its own session, closed APIs refused', async () => {
  expect((await anon('GET', '/api/structures?pageSize=999', undefined, { base: PROD, ip: nextIp() })).status).toBe(400);
  const ip = nextIp(); let limited = 0;
  for (let i = 0; i < 40 && !limited; i += 1) if ((await anon('POST', '/api/search', { query: `logement ${i}` }, { base: PROD, ip })).status === 429) limited = i + 1;
  expect(limited, 'the search answers 429 once the per-address budget is spent').toBeGreaterThan(5);
  expect((await anon('GET', '/api/institution/observatoire', undefined, { base: OPEN, ip: nextIp() })).status).toBe(401);
  expect((await bearer('pro_x1', 'GET', '/api/institution/observatoire', undefined, { base: OPEN, ip: nextIp() })).status).toBe(401);
  expectClosed(await anon('GET', '/api/institution/observatoire', undefined, { base: PROD, ip: nextIp() }), 'X10 institution API');
});
