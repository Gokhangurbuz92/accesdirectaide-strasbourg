/**
 * G8 (19/11/2026) — Mon Parcours with the smallest legal surface while counsel has not answered (RGPD art. 9 / 10, HDS):
 *   - the « sensitive step » classification (api/lib/parcours-sensitivity.js): needs, words, catalogue categories — and what it must NOT flag;
 *   - the mode switch ADA_PARCOURS_SENSITIVE_STEPS: excluded unless exactly « consent », and « consent » only where the consent can be recorded (0046);
 *   - the consent marker is the server's: never accepted from a request, kept when valid, dropped when not;
 *   - (d)/(e) no administrator, professional, public, statistics or analytics code path reads a Mon Parcours table (static proof over api/, src/, scripts/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

const { SENSITIVE_NEEDS, classifyParcoursStep, normaliseText, parcoursNotesOpen, parcoursSensitiveMode, sensitiveTextCategories } = await import('../../api/lib/parcours-sensitivity.js');
const { PLAN_STEP_INPUT_KEYS, mergePlanStep, readPlanStep, validatePlanStepInput } = await import('../../api/lib/parcours-plan-step.js');
const { sensitiveStepsMode } = await import('../../api/_services/mon-espace.js');
const { USER_PERSONAL_DATA_LINEAGE } = await import('../../api/_services/privacy.js');

describe('G8 — what reveals a sensitive fact', () => {
  it.each([
    ['Constituer le dossier MDPH', 'disability'], ['Demander l’AAH', 'disability'], ['Allocation aux adultes handicapés (AAH)', 'disability'], ['Renouveler la PCH', 'disability'],
    ['Rendez-vous au CMP', 'health'], ['Voir le psychiatre', 'health'], ['Prendre RDV chez le médecin', 'health'], ['Dossier ALD', 'health'], ['Demander une IVG', 'health'],
    ['Arrêt maladie à envoyer', 'health'], ['Inscription en EHPAD', 'health'],
    ['Contacter le CSAPA', 'addiction'], ['Arrêter l’alcool', 'addiction'],
    ['Renouveler mon titre de séjour', 'immigration'], ['Demande d’asile (OFPRA)', 'immigration'], ['Demander l’AME', 'immigration'], ['Recours contre une OQTF', 'immigration'],
    ['RDV avec le SPIP', 'justice'], ['Préparer la sortie de prison', 'justice'],
    ['Audience de curatelle', 'legal_protection'], ['Contacter le mandataire judiciaire', 'legal_protection'],
    ['Association LGBT', 'sexual_life'], ['Porter plainte pour viol', 'sexual_life'],
    ['Appeler le 3919', 'violence'], ['Demander une ordonnance de protection', 'violence'], ['Violences conjugales : hébergement', 'violence'],
  ])('« %s » → %s', (text, category) => {
    expect(sensitiveTextCategories(text)).toContain(category);
    expect(classifyParcoursStep({ texts: [text] }).sensitive).toBe(true);
  });

  it.each([
    'Demander l’aide au logement', 'Appeler la CAF lundi', 'Rassembler les justificatifs', 'Payer moins cher ses transports', 'Déclarer mes revenus aux impôts',
    'Mettre à jour ma Carte Vitale', 'Écrire à l’assurance maladie', 'Demander la complémentaire santé solidaire', 'Sursis à l’expulsion : écrire au bailleur',
    'Régularisation de charges du bailleur', 'Récépissé de ma demande de logement social', 'Inscription à la crèche', 'Chèque énergie', 'Prime d’activité',
    'Rendez-vous France Travail', 'Demande de logement social (HLM)', 'Contester une décision de la CAF', 'Âgé de 60 ans', '', null, 42,
  ])('« %s » reveals nothing', (text) => {
    expect(sensitiveTextCategories(text)).toEqual([]);
  });

  it('the text is normalised (case, accents, punctuation) before matching; a word inside another word does not count', () => {
    expect(normaliseText('  Hôpital — Strasbourg ! ')).toBe('hopital strasbourg');
    expect(sensitiveTextCategories('HÔPITAL')).toEqual(['health']);
    expect(sensitiveTextCategories('violence-conjugale')).toEqual(['violence']);
    expect(sensitiveTextCategories('Prime de Noël')).toEqual([]);           // « ime » inside « prime »
    expect(sensitiveTextCategories('Transport scolaire')).toEqual([]);      // « trans… » is not a listed word
    expect(sensitiveTextCategories('Violence au travail')).toEqual([]);     // « viol » only as a word
  });

  it('every sensitive need is a real subdomain of the taxonomy (no silent drift), and the needs that are not listed stay ordinary', () => {
    const ref = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
    const ids = new Set(ref.domains.flatMap((d) => d.subdomains.map((s) => s.id)));
    for (const id of Object.keys(SENSITIVE_NEEDS)) expect(ids.has(id), id).toBe(true);
    for (const id of ['mdph-droits', 'addictions', 'psy', 'asile', 'titre-sejour', 'pjj-spip', 'mesures', 'lgbtqi', 'violences-conjugales']) expect(classifyParcoursStep({ need: id }).sensitive, id).toBe(true);
    for (const id of ['energie', 'aides-logement', 'logement-social', 'minima-sociaux', 'recherche-emploi', 'impots', 'couverture-sante', 'tarifs-solidaires']) expect(classifyParcoursStep({ need: id }).sensitive, id).toBe(false);
    // every subdomain of the « handicap », « sante-mentale » and « migration » (except language learning) domains is sensitive
    for (const d of ref.domains.filter((x) => ['handicap', 'sante-mentale'].includes(x.id))) for (const s of d.subdomains) expect(SENSITIVE_NEEDS[s.id], s.id).toBeTruthy();
  });

  it('a catalogue category that is itself sensitive makes the step sensitive', () => {
    expect(classifyParcoursStep({ texts: ['Fiche'], recordCategories: ['sante'] })).toEqual({ sensitive: true, categories: ['health'] });
    expect(classifyParcoursStep({ texts: ['Fiche'], recordCategories: ['Handicap'] })).toEqual({ sensitive: true, categories: ['disability'] });
    expect(classifyParcoursStep({ texts: ['Fiche'], recordCategories: ['logement', 'famille', null] }).sensitive).toBe(false);
  });
});

describe('G8 — the mode: excluded unless explicitly « consent », and only where the consent can be recorded', () => {
  it('ADA_PARCOURS_SENSITIVE_STEPS', () => {
    expect(parcoursSensitiveMode({})).toBe('excluded');
    for (const v of ['', 'yes', 'true', '1', 'Consent', 'CONSENT', 'consent,excluded', 'open']) expect(parcoursSensitiveMode({ ADA_PARCOURS_SENSITIVE_STEPS: v }), v).toBe('excluded');
    expect(parcoursSensitiveMode({ ADA_PARCOURS_SENSITIVE_STEPS: 'consent' })).toBe('consent');
    expect(parcoursSensitiveMode({ ADA_PARCOURS_SENSITIVE_STEPS: ' consent ' })).toBe('consent');
  });
  it('without the planStep column (migration 0046) there is nowhere to record the consent: « excluded »', () => {
    expect(sensitiveStepsMode(false, { ADA_PARCOURS_SENSITIVE_STEPS: 'consent' })).toBe('excluded');
    expect(sensitiveStepsMode(true, { ADA_PARCOURS_SENSITIVE_STEPS: 'consent' })).toBe('consent');
    expect(sensitiveStepsMode(true, {})).toBe('excluded');
  });
  it('ADA_PARCOURS_NOTES (G14: OFF by default): the note is open only with exactly « on »', () => {
    expect(parcoursNotesOpen({})).toBe(false);
    for (const v of ['', 'off', 'OFF', 'ON', 'true', '1', 'no']) expect(parcoursNotesOpen({ ADA_PARCOURS_NOTES: v }), v).toBe(false);
    expect(parcoursNotesOpen({ ADA_PARCOURS_NOTES: 'on' })).toBe(true);
    expect(fs.readFileSync('.env.example', 'utf8')).toMatch(/^ADA_PARCOURS_NOTES=$/m);
  });
  it('the variable is documented, closed by default, with its exact format', () => {
    expect(fs.readFileSync('.env.example', 'utf8')).toMatch(/^ADA_PARCOURS_SENSITIVE_STEPS=$/m);
    const manifest = JSON.parse(fs.readFileSync('config/activation-manifest.json', 'utf8'));
    const find = (o) => (o && typeof o === 'object' ? (o.ADA_PARCOURS_SENSITIVE_STEPS || Object.values(o).map(find).find(Boolean)) : null);
    expect(find(manifest)).toMatchObject({ class: 'decision', format: '^(consent)?$' });
  });
});

describe('G8 — the consent marker belongs to the server', () => {
  it('a request can never set it (not an input key: the whole plan data is refused)', () => {
    expect(PLAN_STEP_INPUT_KEYS).not.toContain('sensitive');
    expect(validatePlanStepInput({ sensitive: { at: new Date().toISOString() } })).toMatchObject({ ok: false, field: 'key' });
    expect(validatePlanStepInput({ nextActionKey: 'read_record', sensitive: true })).toMatchObject({ ok: false, field: 'key' });
  });
  it('a valid marker is read back alone or with the rest; garbage is dropped; the former shape of every other step is unchanged', () => {
    const at = '2026-11-19T10:00:00.000Z';
    expect(readPlanStep({ v: 1, sensitive: { at } })).toMatchObject({ sensitive: { at }, need: null });
    expect(readPlanStep({ v: 1, need: 'energie', sensitive: { at } })).toMatchObject({ need: 'energie', sensitive: { at } });
    for (const bad of [true, 'x', { at: 'pas une date' }, { at: 3 }, []]) expect(readPlanStep({ v: 1, sensitive: bad }), JSON.stringify(bad)).toBeNull();
    expect(readPlanStep({ v: 1, need: 'energie' })).not.toHaveProperty('sensitive');
  });
  it('a later change of the plan data keeps the consent (mergePlanStep keeps what it is not told to change)', () => {
    const at = '2026-11-19T10:00:00.000Z';
    expect(mergePlanStep({ v: 1, sensitive: { at } }, { set: { nextActionKey: 'read_record' }, clear: [] })).toEqual({ v: 1, sensitive: { at }, nextActionKey: 'read_record' });
  });
});

// ───────────── (d) / (e): who can read a Mon Parcours table
const ROOTS = ['api', 'src', 'scripts', 'packages', 'middleware.js'];
const walk = (p) => (!fs.existsSync(p) ? [] : fs.statSync(p).isFile() ? [p] : fs.readdirSync(p, { withFileTypes: true }).flatMap((d) => (d.name === 'node_modules' ? [] : walk(path.join(p, d.name)))));
const code = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\w])\/\/[^\n]*/g, '$1');
/** every place allowed to name a Mon Parcours table in code, and why — none of them is an administrator, professional, public, statistics or analytics path */
const ALLOWED = {
  'api/_services/mon-espace.js': 'the person’s own Mon Parcours (citizen session, scoped to the account)',
  'api/_services/delegation.js': 'the read-only view of a delegate the person chose (sensitive steps and notes never included)',
  'api/_services/delegation-actions.js': 'G14-AID: a trusted person asks to change the state of ONE step the person can confirm (owner check; a sensitive step is refused as unknown)',
  'api/_services/legal-protection.js': 'G14-R3G: the court-appointed representative whose decision an administrator verified, on a covered part only (sensitive steps and notes never included; every view logged for the person)',
  'api/_services/privacy.js': 'the person’s own export (art. 15/20) and the erasure engine',
  'api/_services/export-account-sections.js': 'the person’s own export: the reminder ledger',
  'api/_services/citizen-inbox.js': 'the person’s own notifications: id and due date only',
  'api/_handlers/cron/parcours-reminder.js': 'the deadline reminder job: due date and the account’s address, never a title (closed during the beta)',
  'api/_utils/schema-features.js': 'does the database have the planStep column (information_schema)',
  'api/_handlers/cron/gdpr-purge.js': 'G14: the retention step of closed steps (deletes, never reads content; à approuver)',
  'src/db/schema.ts': 'the schema',
  'scripts/acceptance/r40-web-push-real.mjs': 'LAB acceptance script on a synthetic row',
};

describe('G8 — (d)/(e) no administrator, professional, public, statistics or analytics path reads Mon Parcours', () => {
  const files = ROOTS.flatMap(walk).filter((f) => /\.(m?js|jsx|ts|tsx)$/.test(f) && !/\.test\.|\.spec\.|\/__tests__\//.test(f));
  const readers = files.filter((f) => /Parcours(Item|Event|Reminder)\b/.test(code(f)));
  it('only the allowed places name a Mon Parcours table in code', () => {
    const extra = readers.filter((f) => !ALLOWED[f] && !/^src\/(pages|lib)\//.test(f) && f !== 'api/lib/observatory-metrics.js' && !/^api\/lib\/parcours-plan-step\.js$/.test(f));
    expect(extra).toEqual([]);
    expect(readers.some((f) => /^api\/_handlers\/(admin|pro|public)\//.test(f)), readers.join(', ')).toBe(false);
    expect(readers.some((f) => /observator|analytic|telemetr|matomo|pilot|metrics|stats/i.test(f) && f !== 'api/lib/observatory-metrics.js'), readers.join(', ')).toBe(false);
  });
  it('the observatory names Mon Parcours only to say it never reads it (a definition text, no query)', () => {
    const t = code('api/lib/observatory-metrics.js');
    const lines = t.split('\n').filter((l) => /Parcours(Item|Event)/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/source: 'ParcoursItem \/ ParcoursEvent \(espace personnel, jamais lu par les statistiques\)'/);
    expect(t).not.toMatch(/FROM "Parcours|from\(Parcours/);
  });
  it('the browser code only reaches Mon Parcours through the citizen API (no table, no other endpoint)', () => {
    for (const f of readers.filter((x) => x.startsWith('src/') && x !== 'src/db/schema.ts')) expect(code(f), f).not.toMatch(/FROM "Parcours|from\(Parcours|db\.(select|query)/);
  });
  it('only the person’s own handlers and the delegate view call the Mon Parcours services', () => {
    const callers = files.filter((f) => /\b(listParcours|itemHistory|delegateView|sensitiveItemIds|espaceSummary)\b/.test(code(f)) && f.startsWith('api/'));
    expect(callers.sort()).toEqual(['api/_handlers/citizen/delegations.js', 'api/_handlers/citizen/espace.js', 'api/_handlers/citizen/parcours.js', 'api/_services/delegation-actions.js', 'api/_services/delegation.js', 'api/_services/legal-protection.js', 'api/_services/mon-espace.js']);   // G14-R3G: the verified representative's view
  });
  it('(c) the erasure lineage names every Mon Parcours table (they cascade with the account)', () => {
    expect(USER_PERSONAL_DATA_LINEAGE.CitizenProfile.storageEntities).toEqual(expect.arrayContaining(['ParcoursItem', 'ParcoursEvent', 'ParcoursReminder']));
    const mig = fs.readFileSync('drizzle/0016_pkg2_mon_espace.sql', 'utf8') + fs.readFileSync('drizzle/0017_pkg2_parcours_reminders.sql', 'utf8');
    expect(mig).toMatch(/"ParcoursItem_user_fkey" FOREIGN KEY \("userId"\) REFERENCES "public"\."CitizenUser"\("id"\) ON DELETE cascade/);
    expect(mig).toMatch(/"ParcoursEvent_item_fkey" FOREIGN KEY \("itemId"\) REFERENCES "public"\."ParcoursItem"\("id"\) ON DELETE cascade/);
    expect(mig).toMatch(/"ParcoursReminder_item_fkey" FOREIGN KEY \("itemId"\) REFERENCES "public"\."ParcoursItem"\("id"\) ON DELETE cascade/);
  });
});

describe('G8 — a failed Mon Parcours write never puts the person’s words in a log line', () => {
  it('the bound values of a failed query are redacted from the error message and stack; the statement stays', async () => {
    const { redactForLog, redactText } = await import('../../api/_utils/redact.js');
    const err = new Error('Failed query: update "ParcoursItem" set "note" = $1 where "id" = $2\nparams: RDV au CMP mardi pour le traitement,p1');
    const out = JSON.stringify(redactForLog({ err }));
    expect(out).toContain('Failed query: update \\"ParcoursItem\\"');
    expect(out).toContain('params: [redacted]');
    expect(out).not.toMatch(/CMP|traitement/);
    expect(redactText('insert failed\nparams: Dossier MDPH,u1')).toBe('insert failed\nparams: [redacted]');
  });
});
