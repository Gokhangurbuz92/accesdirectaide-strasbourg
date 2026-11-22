/**
 * G8 (19/11/2026) — sensitive steps of Mon Parcours on REAL PostgreSQL, THROUGH THE REAL API ENTRY (api/index.js), LAB profile (every module open, so the
 * delegate view can be exercised). Proven:
 *   - « excluded » (default): a step, a record, a need, an organisation name or a note revealing health / disability / addiction / residence / justice is
 *     refused (422) and NOTHING is stored (no row, no history line, note unchanged) — `sensitiveConsent: true` does not override it;
 *   - « consent » (ADA_PARCOURS_SENSITIVE_STEPS=consent): refused (409) without the consent, stored with it, the consent recorded on the step and exported;
 *     a request cannot forge the marker; a later sensitive note on that step needs no new consent, on another step it does;
 *   - the delegate's read-only view never contains a sensitive step (consented, or revealing it by its title, need or record), in any mode;
 *   - the plan import (HDS-bound, open here) never copies a sensitive step.
 * Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
// G14: these are proofs of the FORMER Mon Parcours contract (free titles, records, plan data, consent, import, delegate read): reachable only in the
// test suites (api/lib/parcours-limited.js legacyContractAllowed). The limited contract has its own proof: tests/integration/g14-parcours-limited-db.test.js
process.env.ADA_PARCOURS_LEGACY_CONTRACT = 'test-only';
process.env.ADA_PARCOURS_NOTES = 'on';   // G14: notes are off by default; this file proves the note path

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
// the plan of a dossier, as the action-plan builder gives it: a dossier carrying `__g8Plan` gets exactly those steps (every other dossier: the real builder)
vi.mock('../../src/lib/actionPlan.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, buildActionPlan: (results) => (results && Array.isArray(results.__g8Plan) ? { steps: results.__g8Plan } : real.buildActionPlan(results)) };
});
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0,
  lpush: async () => 1, ltrim: async () => 'OK', lrange: async () => [] } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const A = { id: `g8s-a-${TS}`, email: `g8s-a-${TS}@example.test` };
const D = { id: `g8s-d-${TS}`, email: `g8s-d-${TS}@example.test` };
const CSRF = `g8scsrf${TS}`;
const GUIDE = { id: `g8s-guide-${TS}`, slug: `g8s-guide-${TS}-slug` };
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_BETA_ACCOUNTS_EXTRA', 'ADA_CAPABILITIES_OPEN', 'ADA_CAPABILITIES_ENFORCE',
  'ADA_PARCOURS_SENSITIVE_STEPS', 'ADA_PARCOURS_NOTES', 'MAILER_PROVIDER', 'MAILER_FROM'];
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G8 — sensitive steps of Mon Parcours (real API entry, real PostgreSQL)', () => {
  let db, api, userAuth;
  const saved = {}; const J = {};
  const call = async (method, url, { as, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http' };
    if (as) Object.assign(h, { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: as.id, email: as.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF });
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const P = (as, body) => call('POST', '/api/citizen/parcours', { as, body });
  const ok = (r) => { expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(300); return r.body; };
  const rows = async (q) => (await db.execute(q)).rows;
  const counts = async () => (await rows(sql`SELECT (SELECT count(*)::int FROM "ParcoursItem" WHERE "userId" = ${A.id}) AS items, (SELECT count(*)::int FROM "ParcoursEvent" WHERE "userId" = ${A.id}) AS events`))[0];
  const refusedNothingStored = async (r, status, code) => {
    const before = J.before;
    expect([r.statusCode, r.body.error], JSON.stringify(r.body)).toEqual([status, code]);
    expect(await counts()).toEqual(before);
  };

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
    setEnv({ MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test', ADA_PARCOURS_NOTES: 'on' });   // G14: notes default off; this file proves them
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; userAuth = await import('../../api/_utils/user-auth.js');
    for (const c of [A, D]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    // a published guide whose title reveals a disability (a catalogue record the person could add from its page)
    await db.execute(sql`INSERT INTO "Guide" (id, slug, titre, statut, categorie, publics, contexte, mots_cles, sources_urls, contenu_json, "updatedAt") VALUES (${GUIDE.id}, ${GUIDE.slug}, 'Allocation aux adultes handicapés : constituer le dossier', 'publie', 'droits', '{}', '{}', '{}', '{}', '{}'::jsonb, NOW())`);
  }, 90000);

  afterAll(async () => {
    try {
      if (!db) return;
      for (const c of [A, D]) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE "ownerCitizenId" = ${A.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "Guide" WHERE id = ${GUIDE.id}`).catch(() => {});
    } finally { setEnv(saved); }
  });

  it('« excluded » (default): every way of writing a sensitive fact is refused and nothing is stored', async () => {
    const list = ok(await call('GET', '/api/citizen/parcours', { as: A }));
    expect(list.sensitiveSteps).toBe('excluded');
    J.ordinary = ok(await P(A, { action: 'add', title: 'Demander l’aide au logement' })).item.id;
    J.before = await counts();
    await refusedNothingStored(await P(A, { action: 'add', title: 'Constituer le dossier MDPH' }), 422, 'SENSITIVE_STEP_EXCLUDED');
    await refusedNothingStored(await P(A, { action: 'add', title: 'Constituer le dossier MDPH', sensitiveConsent: true }), 422, 'SENSITIVE_STEP_EXCLUDED');   // no override
    await refusedNothingStored(await P(A, { action: 'add', title: 'Mon étape', planStep: { need: 'addictions' } }), 422, 'SENSITIVE_STEP_EXCLUDED');
    await refusedNothingStored(await P(A, { action: 'add', records: [{ type: 'guide', id: GUIDE.slug }] }), 422, 'SENSITIVE_STEP_EXCLUDED');
    await refusedNothingStored(await P(A, { action: 'add', title: 'Rendez-vous', planStep: { actor: { kind: 'organisation', name: 'CSAPA de Strasbourg' } } }), 422, 'SENSITIVE_STEP_EXCLUDED');
    await refusedNothingStored(await P(A, { action: 'plan', id: J.ordinary, planStep: { need: 'asile' } }), 422, 'SENSITIVE_STEP_EXCLUDED');
    await refusedNothingStored(await P(A, { action: 'note', id: J.ordinary, note: 'Penser à l’ordonnance du psychiatre' }), 422, 'SENSITIVE_STEP_EXCLUDED');
    const [row] = await rows(sql`SELECT note, "planStep" FROM "ParcoursItem" WHERE id = ${J.ordinary}`);
    expect(row).toEqual({ note: null, planStep: null });
    // an ordinary note and need are still accepted
    expect(ok(await P(A, { action: 'note', id: J.ordinary, note: 'Appeler la CAF lundi' })).item.note).toBe('Appeler la CAF lundi');
    ok(await P(A, { action: 'plan', id: J.ordinary, planStep: { need: 'aides-logement' } }));
  });

  it('« consent »: refused without the person’s consent (nothing stored), kept with it — the consent is recorded, shown, exported, never forged', async () => {
    setEnv({ ADA_PARCOURS_SENSITIVE_STEPS: 'consent' });
    expect(ok(await call('GET', '/api/citizen/parcours', { as: A })).sensitiveSteps).toBe('consent');
    J.before = await counts();
    await refusedNothingStored(await P(A, { action: 'add', title: 'Constituer le dossier MDPH' }), 409, 'SENSITIVE_STEP_CONSENT_REQUIRED');
    await refusedNothingStored(await P(A, { action: 'add', title: 'Constituer le dossier MDPH', sensitiveConsent: 'yes' }), 409, 'SENSITIVE_STEP_CONSENT_REQUIRED');   // only true
    expect((await P(A, { action: 'add', title: 'Mon étape', planStep: { sensitive: { at: new Date().toISOString() } } })).statusCode, 'the marker is the server’s').toBe(400);
    const t0 = Date.now();
    const created = await P(A, { action: 'add', title: 'Constituer le dossier MDPH', sensitiveConsent: true });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
    J.mdph = created.body.item.id;
    const [row] = await rows(sql`SELECT "planStep" FROM "ParcoursItem" WHERE id = ${J.mdph}`);
    expect(Date.parse(row.planStep.sensitive.at)).toBeGreaterThanOrEqual(t0 - 1000);
    expect(Object.keys(row.planStep.sensitive)).toEqual(['at']);   // the consent only: no category of health is stored
    // a record and a need, each with their own consent
    J.guide = (await P(A, { action: 'add', records: [{ type: 'guide', id: GUIDE.slug }], sensitiveConsent: true })).body.item.id;
    J.need = ok(await P(A, { action: 'add', title: 'Mon autre étape', planStep: { need: 'psy' }, sensitiveConsent: true })).item.id;
    // a sensitive note on the consented step needs no new consent; on an ordinary step it does
    expect(ok(await P(A, { action: 'note', id: J.mdph, note: 'Certificat du médecin à joindre' })).item.note).toBe('Certificat du médecin à joindre');
    expect((await P(A, { action: 'note', id: J.ordinary, note: 'RDV au CMP mardi' })).statusCode).toBe(409);
    expect((await rows(sql`SELECT note FROM "ParcoursItem" WHERE id = ${J.ordinary}`))[0].note).toBe('Appeler la CAF lundi');
    ok(await P(A, { action: 'note', id: J.ordinary, note: 'RDV au CMP mardi', sensitiveConsent: true }));
    const list = ok(await call('GET', '/api/citizen/parcours', { as: A }));
    const flag = Object.fromEntries(list.items.map((i) => [i.id, i.sensitive === true]));
    expect(flag).toEqual({ [J.ordinary]: true, [J.mdph]: true, [J.guide]: true, [J.need]: true });
    // a change of the plan data keeps the consent
    ok(await P(A, { action: 'plan', id: J.mdph, planStep: { nextActionKey: 'gather_documents' } }));
    expect((await rows(sql`SELECT "planStep" FROM "ParcoursItem" WHERE id = ${J.mdph}`))[0].planStep).toMatchObject({ sensitive: { at: expect.any(String) }, nextActionKey: 'gather_documents' });
    // art. 15 / 7(1): the export shows the steps and when the consent was given
    const exp = ok(await call('GET', '/api/auth/export-data', { as: A }));
    expect(exp.parcours.find((i) => i.id === J.mdph).planStep.sensitive.at).toBe(row.planStep.sensitive.at);
  });

  it('the delegate never sees a sensitive step — consented, or revealing it by its title, need or record — and never a note', async () => {
    // one step written straight into the database (as before G8): its title alone reveals it
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (${`g8s-legacy-${TS}`}, ${A.id}, 'MANUAL', 'custom', 'Renouveler mon titre de séjour', NOW())`);
    J.plain = ok(await P(A, { action: 'add', title: 'Rassembler les justificatifs' })).item.id;
    const at = new Date(Date.now() + 90 * 864e5);
    const [dg] = await rows(sql`INSERT INTO "CitizenDelegation" (id, "principalUserId", "delegateUserId", "inviteEmail", role, scopes, status, "proofStatus", "expiresAt", "acceptedAt")
      VALUES (${`g8s-del-${TS}`}, ${A.id}, ${D.id}, ${D.email}, 'AIDANT', ARRAY['PARCOURS_READ'], 'ACTIVE', 'NOT_REQUIRED', ${at.toISOString()}, NOW()) RETURNING id`);
    for (const mode of ['consent', undefined]) {
      setEnv({ ADA_PARCOURS_SENSITIVE_STEPS: mode });
      const v = await call('GET', `/api/citizen/delegations?id=${dg.id}&view=parcours`, { as: D });
      expect(v.statusCode, JSON.stringify(v.body)).toBe(200);
      expect(v.body.items.map((i) => i.title).sort(), String(mode)).toEqual(['Rassembler les justificatifs']);
      const text = JSON.stringify(v.body);
      for (const s of ['MDPH', 'handicap', 'séjour', 'CMP', 'CAF', 'médecin', 'psy', 'sensitive', 'note']) expect(text, s).not.toContain(s);
    }
    expect(J.ordinary).toBeTruthy();   // the ordinary step whose NOTE was consented as sensitive is hidden too
  });

  it('ADA_PARCOURS_NOTES=off: no new note (nothing stored), an existing note can still be cleared; GET says so', async () => {
    setEnv({ ADA_PARCOURS_NOTES: 'off', ADA_PARCOURS_SENSITIVE_STEPS: undefined });
    try {
      expect(ok(await call('GET', '/api/citizen/parcours', { as: A })).notes).toBe(false);
      const id = ok(await P(A, { action: 'add', title: 'Préparer le rendez-vous' })).item.id;
      const r = await P(A, { action: 'note', id, note: 'Appeler lundi' });
      expect([r.statusCode, r.body.error]).toEqual([409, 'NOTES_CLOSED']);
      expect((await rows(sql`SELECT note FROM "ParcoursItem" WHERE id = ${id}`))[0].note).toBeNull();
      expect((await rows(sql`SELECT note FROM "ParcoursItem" WHERE id = ${J.mdph}`))[0].note).toBe('Certificat du médecin à joindre');
      expect(ok(await P(A, { action: 'note', id: J.mdph, note: '' })).item.note).toBeNull();
    } finally { setEnv({ ADA_PARCOURS_NOTES: 'on' }); }
    expect(ok(await call('GET', '/api/citizen/parcours', { as: A })).notes).toBe(true);
  });

  it('the plan import (open in LAB) never copies a sensitive step of the plan; the ordinary ones are imported', async () => {
    const plan = [
      { kind: 'verify', who: 'la CAF', itemCodes: ['apl'], title: 'Faire vérifier votre situation pour l’aide au logement auprès de la CAF', detail: 'Ce plan n’est pas une décision.', links: [] },
      { kind: 'verify', who: 'la MDPH', itemCodes: ['aah'], title: 'Faire vérifier votre situation pour l’allocation aux adultes handicapés auprès de la MDPH', detail: 'Ce plan n’est pas une décision.', links: [] },
      { kind: 'accompany', itemCodes: [], title: 'Être accompagné', detail: 'Un professionnel du CSAPA peut vous aider.', links: [] },
    ];
    const [sh] = await rows(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "ownerCitizenId") VALUES (${`g8s-share-${TS}`}, NOW() + interval '30 days', '{}'::jsonb, ${JSON.stringify({ __g8Plan: plan })}::jsonb, 0, ${A.id}) RETURNING id`);
    const r = await P(A, { action: 'import', shareId: sh.id });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect([r.body.added, r.body.skippedSensitive]).toEqual([1, 2]);
    const titles = (await rows(sql`SELECT title FROM "ParcoursItem" WHERE "sourceShareId" = ${sh.id}`)).map((x) => x.title);
    expect(titles).toEqual(['Faire vérifier votre situation pour l’aide au logement auprès de la CAF']);
  });
});
