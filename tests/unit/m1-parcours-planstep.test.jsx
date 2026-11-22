// @vitest-environment jsdom
/**
 * M1 (C07 / C08) — the durable plan data of a Mon Parcours step ("ParcoursItem"."planStep", migration 0046): the strict validation of what is stored and
 * read, dependency loops, the next action, the column-presence guard for a database without 0046, the migration files, and what the screen shows
 * (groups by need, who acts, next action, waiting notice that never locks, honest endings, recovery, links that never complete a step).
 * The server rules on a real PostgreSQL: tests/integration/m1-parcours-planstep-db.test.js, m1-parcours-without-0046-db.test.js, m1-planstep-migration-db.test.js.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn() }));
const authMe = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({ frontendEnv: null }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: { authMe } }));
vi.mock('../../src/config/env.js', async (importOriginal) => { const real = await importOriginal(); env.frontendEnv = { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, publicBeta: false } }; return { ...real, frontendEnv: env.frontendEnv }; });
// the services are imported for their pure validation only: touching the database here is a failure
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import CompteParcours from '../../src/pages/CompteParcours.jsx';
import OrientationPanel from '../../src/components/search/OrientationPanel.jsx';
import { PARCOURS_RECORD_STEPS } from '../../src/lib/parcoursRecordSteps.js';
import { PLAN_ACTOR_KINDS, PLAN_CLOSURES, PLAN_DERIVED_ACTIONS, PLAN_DONE_STATUSES, PLAN_NEXT_ACTIONS, closureOf, dependencyCycle, groupByNeed, needsRecovery, nextActionOf } from '../../src/lib/parcoursPlan.js';
import { PARCOURS_DONE, PARCOURS_STATUS_LABELS, PARCOURS_CLOSURE_LABELS } from '../../src/lib/monEspace.js';
import { MAX_PLAN_LINKS, MAX_PLAN_STEP_BYTES, PLAN_STEP_INPUT_KEYS, mergePlanStep, planNeeds, planStepFits, planStepFromPlan, readPlanStep, validatePlanStepInput } from '../../api/lib/parcours-plan-step.js';
import { PLAN_STEP_COLUMN, forgetParcoursPlanStep, parcoursItemTable, parcoursPlanStepSchema } from '../../api/_utils/schema-features.js';
import { ParcoursItem } from '../../src/db/schema.js';
import { expectedObjects } from '../../scripts/db-migrate-guard.mjs';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { getTableColumns, getTableName } from 'drizzle-orm';

const OFFICIAL = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F20055';
const ENV = {};   // no owner-extended domains: only the product's own allow-list
const mount = (C, props = {}) => render(h(QueryClientProvider, { client: new QueryClient() }, h(HelmetProvider, null, h(MemoryRouter, null, h(C, props)))));
const item = (o = {}) => ({ id: 'p1', origin: 'MANUAL', stepKind: 'custom', title: 'Aide au logement', status: 'NOT_STARTED', closure: null, dueDate: null, note: null, itemCodes: [], records: [], available: true, plan: null,
  step: null, dependsOn: null, waiting: false, ...o });
const step = (o = {}) => ({ need: null, actor: null, links: [], nextActionKey: null, detail: null, ...o });
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); authMe.mockReset(); api.listShares.mockResolvedValue({ shares: [] }); api.parcoursHistory.mockResolvedValue({ events: [] }); env.frontendEnv.flags.publicBeta = false;
  PARCOURS_RECORD_STEPS.offered = true; });   // G14: the former record-step control (off in the application) is tested on its own
afterEach(() => { cleanup(); vi.unstubAllEnvs(); PARCOURS_RECORD_STEPS.offered = false; });

describe('what a person may send (validatePlanStepInput)', () => {
  it('the contract: five keys, three kinds of actor, the stored next actions, the two closing reasons, the same « done » states as the screen', () => {
    expect(PLAN_STEP_INPUT_KEYS).toEqual(['need', 'actor', 'links', 'dependsOnItemId', 'nextActionKey']);
    expect(PLAN_ACTOR_KINDS).toEqual(['citizen', 'organisation', 'professional']);
    expect(PLAN_CLOSURES).toEqual(['ABANDONED', 'OUTCOME_UNKNOWN']);
    expect(PLAN_DONE_STATUSES).toEqual(PARCOURS_DONE);
    expect(PLAN_NEXT_ACTIONS.filter((k) => PLAN_DERIVED_ACTIONS.includes(k))).toEqual([]);   // a derived action is never stored
    expect(Object.keys(PARCOURS_CLOSURE_LABELS)).toEqual(PLAN_CLOSURES);
    expect(Object.keys(PARCOURS_STATUS_LABELS).filter((k) => PLAN_CLOSURES.includes(k))).toEqual([]);   // the ten states are unchanged
    expect(Object.keys(PARCOURS_STATUS_LABELS)).toHaveLength(10);
    expect(planNeeds().size).toBe(86); expect(planNeeds().get('energie')).toBeTruthy();
    expect(MAX_PLAN_LINKS).toBe(5); expect(MAX_PLAN_STEP_BYTES).toBe(8192);
  });
  it('accepts a full, well-formed value and normalises it (trimmed name and labels)', () => {
    const v = validatePlanStepInput({ need: 'energie', actor: { kind: 'organisation', name: '  Caf du Bas-Rhin ' }, links: [{ url: OFFICIAL, label: ' Fiche officielle ' }], dependsOnItemId: '3f2c9a1e-0000-4000-8000-000000000001', nextActionKey: 'contact_organisation' }, ENV);
    expect(v).toEqual({ ok: true, clear: [], set: { need: 'energie', actor: { kind: 'organisation', name: 'Caf du Bas-Rhin' }, links: [{ url: OFFICIAL, label: 'Fiche officielle' }], dependsOnItemId: '3f2c9a1e-0000-4000-8000-000000000001', nextActionKey: 'contact_organisation' } });
    expect(validatePlanStepInput({ actor: { kind: 'citizen' } }, ENV)).toMatchObject({ ok: true, set: { actor: { kind: 'citizen' } } });
    expect(validatePlanStepInput({ actor: { kind: 'professional' } }, ENV)).toMatchObject({ ok: true, set: { actor: { kind: 'professional' } } });
    expect(validatePlanStepInput({}, ENV)).toEqual({ ok: true, set: {}, clear: [] });
    expect(validatePlanStepInput({ need: null, links: [], actor: null }, ENV)).toEqual({ ok: true, set: {}, clear: ['need', 'actor', 'links'] });
  });
  it('refuses everything else, naming the field: shape, unknown or server-only keys, size', () => {
    for (const bad of [null, undefined, 'x', 7, [], [{}], new Date(), Object.create({ need: 'energie' })]) expect(validatePlanStepInput(bad, ENV), String(bad)).toMatchObject({ ok: false, code: 'INVALID_PLAN_STEP' });
    for (const key of ['closure', 'detail', 'v', 'status', 'userId', '__proto__x', 'Need']) expect(validatePlanStepInput({ [key]: 'x' }, ENV), key).toEqual({ ok: false, code: 'INVALID_PLAN_STEP', field: 'key' });
    expect(validatePlanStepInput({ dependsOnItemId: 'x'.repeat(MAX_PLAN_STEP_BYTES) }, ENV)).toEqual({ ok: false, code: 'INVALID_PLAN_STEP', field: 'size' });
  });
  it('need: only an id of the taxonomy', () => {
    for (const need of ['inconnu', 'Energie', 'precarite', '', 7, {}, ['energie'], 'energie '] ) expect(validatePlanStepInput({ need }, ENV), String(need)).toMatchObject({ ok: false, field: 'need' });
  });
  it('actor: one of three kinds; only an organisation is named (2–120 characters), never a person', () => {
    for (const actor of ['citizen', {}, { kind: 'admin' }, { kind: 'organisation' }, { kind: 'organisation', name: ' x ' }, { kind: 'organisation', name: 'x'.repeat(121) }, { kind: 'organisation', name: 7 },
      { kind: 'organisation', name: 'Caf\u0000' }, { kind: 'citizen', name: 'Camille Exemple' }, { kind: 'professional', name: 'Dominique Exemple' }, { kind: 'organisation', name: 'Caf', email: 'x@example.test' }, [{ kind: 'citizen' }]]) {
      expect(validatePlanStepInput({ actor }, ENV), JSON.stringify(actor)).toMatchObject({ ok: false, field: 'actor' });
    }
  });
  it('links: at most five { url, label }, each an https address on the official allow-list — the host is matched, not a substring', () => {
    const ok = (url) => validatePlanStepInput({ links: [{ url, label: 'Lien' }] }, ENV).ok;
    for (const url of [OFFICIAL, 'https://www.service-public.fr/particuliers/vosdroits/F1', 'https://www.caf.fr/', 'https://www.ameli.fr/assure', 'https://www.francetravail.fr/', 'https://solidarites.gouv.fr/x']) expect(ok(url), url).toBe(true);
    for (const url of ['http://www.service-public.gouv.fr/x', 'https://example.org/', 'https://evil.example/?u=https://www.service-public.gouv.fr/', 'https://service-public.gouv.fr.evil.example/', 'https://notgouv.fr/',
      'https://user:pw@www.service-public.gouv.fr/', 'javascript:alert(1)', 'data:text/html,x', '//www.service-public.gouv.fr/', '/aides/rsa', 'ftp://www.caf.fr/', '', ' https://www.caf.fr/', 'https://www.caf.fr/ x', `https://www.caf.fr/${'x'.repeat(500)}`, 7, null]) {
      expect(ok(url), String(url)).toBe(false);
    }
    for (const links of ['x', {}, [OFFICIAL], [null], [{ url: OFFICIAL }], [{ url: OFFICIAL, label: '   ' }], [{ url: OFFICIAL, label: 'x'.repeat(201) }], [{ url: OFFICIAL, label: 'a\nb' }], [{ url: OFFICIAL, label: 'a', to: '/x' }], [{ to: '/aides/rsa', label: 'interne' }],
      Array.from({ length: 6 }, (_, n) => ({ url: `${OFFICIAL}?n=${n}`, label: 'Lien' }))]) {
      expect(validatePlanStepInput({ links }, ENV), JSON.stringify(links).slice(0, 60)).toMatchObject({ ok: false, field: 'links' });
    }
    // the owner-extended list of human verification applies here too (same function), and only when configured
    expect(validatePlanStepInput({ links: [{ url: 'https://www.strasbourg.eu/aide', label: 'Ville' }] }, ENV).ok).toBe(false);
    expect(validatePlanStepInput({ links: [{ url: 'https://www.strasbourg.eu/aide', label: 'Ville' }] }, { ADA_VERIFICATION_EXTRA_DOMAINS: 'strasbourg.eu' }).ok).toBe(true);
  });
  it('dependsOnItemId and nextActionKey: an id-shaped string; a listed key (never free text, never a derived action)', () => {
    for (const dependsOnItemId of [7, '', ' x', 'a b', '../x', "x' OR 1=1", 'x'.repeat(65), {}, ['x']]) expect(validatePlanStepInput({ dependsOnItemId }, ENV), String(dependsOnItemId)).toMatchObject({ ok: false, field: 'dependsOnItemId' });
    for (const nextActionKey of ['texte libre', 'READ_RECORD', ...PLAN_DERIVED_ACTIONS, 7, {}, '']) expect(validatePlanStepInput({ nextActionKey }, ENV), String(nextActionKey)).toMatchObject({ ok: false, field: 'nextActionKey' });
    for (const nextActionKey of PLAN_NEXT_ACTIONS) expect(validatePlanStepInput({ nextActionKey }, ENV).ok, nextActionKey).toBe(true);
  });
  it('the services refuse invalid plan data and an unknown state BEFORE any database access', async () => {
    const { addManualItem, setPlanStep, setStatus, PARCOURS_STATUSES } = await import('../../api/_services/mon-espace.js');
    expect(PARCOURS_STATUSES).toHaveLength(10); expect(PARCOURS_STATUSES.filter((s) => PLAN_CLOSURES.includes(s))).toEqual([]);
    for (const planStep of ['x', [], { closure: 'ABANDONED' }, { need: 'inconnu' }, { links: [{ url: 'https://example.org/', label: 'x' }] }]) {
      expect((await addManualItem('u1', { title: 'Une étape', planStep })).code, JSON.stringify(planStep)).toBe('INVALID_PLAN_STEP');
      expect((await addManualItem('u1', { records: [{ type: 'aide', id: 'a1' }], planStep })).code, JSON.stringify(planStep)).toBe('INVALID_PLAN_STEP');
      expect((await setPlanStep('u1', 'p1', planStep)).code, JSON.stringify(planStep)).toBe('INVALID_PLAN_STEP');
    }
    for (const planStep of [undefined, null]) expect((await setPlanStep('u1', 'p1', planStep)).code).toBe('INVALID_PLAN_STEP');
    for (const status of ['abandoned', 'DONE', '', null, undefined, 7]) expect((await setStatus('u1', 'p1', status)).code, String(status)).toBe('INVALID_STATUS');
  });
});

describe('what is stored and read back', () => {
  it('readPlanStep keeps only what is still valid; NULL, another version or garbage read as « no plan data »', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}, { v: 2, need: 'energie' }, { need: 'energie' }, { v: 1 }, { v: 1, need: 'inconnu', nextActionKey: 'x', links: 'x', actor: { kind: 'organisation' }, closure: 'DONE' }]) expect(readPlanStep(raw, ENV), JSON.stringify(raw)).toBeNull();
    expect(readPlanStep({ v: 1, need: 'energie', actor: { kind: 'citizen', name: 'Camille Exemple' }, links: [{ url: 'https://example.org/', label: 'retiré' }, { url: OFFICIAL, label: 'Officiel' }, { to: '/aides/rsa', label: 'Fiche' }, { to: '//evil.example', label: 'x' }, { to: '#ancre', label: 'x' }],
      dependsOnItemId: 'p2', nextActionKey: 'gather_documents', detail: ' Une explication ', closure: 'ABANDONED', surprise: true }, ENV))
      .toEqual({ need: 'energie', actor: { kind: 'citizen', name: null }, links: [{ url: OFFICIAL, label: 'Officiel' }, { to: '/aides/rsa', label: 'Fiche' }], dependsOnItemId: 'p2', nextActionKey: 'gather_documents', detail: 'Une explication', closure: 'ABANDONED' });
  });
  it('planStepFromPlan copies who acts, the explanation, the internal links and the next action of each kind of plan step', () => {
    expect(planStepFromPlan({ kind: 'verify', who: 'la CAF', detail: 'Ce plan n’est pas une décision.', links: [{ to: '/aides/rsa', label: 'Fiche d’information : RSA' }, { to: '#diag-birthdate', label: 'ancre' }, { to: 'https://example.org', label: 'externe' }] }))
      .toEqual({ v: 1, actor: { kind: 'organisation', name: 'la CAF' }, nextActionKey: 'contact_organisation', detail: 'Ce plan n’est pas une décision.', links: [{ to: '/aides/rsa', label: 'Fiche d’information : RSA' }] });
    const kinds = { complete: ['citizen', 'complete_information'], prepare: ['citizen', 'gather_documents'], accompany: ['professional', 'ask_professional'], share: ['citizen', 'share_dossier'], urgent: ['citizen', 'emergency_resources'] };
    for (const [kind, [actor, next]] of Object.entries(kinds)) expect(planStepFromPlan({ kind, who: 'ignoré' }), kind).toEqual({ v: 1, actor: { kind: actor }, nextActionKey: next });
    expect(planStepFromPlan({ kind: 'custom' })).toBeNull(); expect(planStepFromPlan(null)).toBeNull();
    const big = planStepFromPlan({ kind: 'verify', who: 'w'.repeat(400), detail: 'd'.repeat(3000), links: Array.from({ length: 30 }, (_, n) => ({ to: `/aides/a${n}`, label: 'l'.repeat(400) })) });
    expect(big.detail).toHaveLength(1000); expect(big.links).toHaveLength(10); expect(big.links[0].label).toHaveLength(200); expect(big.actor.name).toHaveLength(200); expect(planStepFits(big)).toBe(true);
    // every copy reads back whole
    expect(readPlanStep(planStepFromPlan({ kind: 'verify', who: 'la CAF', detail: 'Texte', links: [{ to: '/structures', label: 'Trouver une structure' }] }), ENV)).toMatchObject({ actor: { kind: 'organisation', name: 'la CAF' }, detail: 'Texte', links: [{ to: '/structures', label: 'Trouver une structure' }] });
  });
  it('mergePlanStep: keys set replace, keys cleared go, the rest stays; the closing reason is the status action’s; nothing left = NULL', () => {
    const current = { v: 1, need: 'energie', detail: 'Texte du plan', actor: { kind: 'citizen' }, closure: 'ABANDONED' };
    expect(mergePlanStep(current, { set: { actor: { kind: 'professional' } }, clear: ['need'] })).toEqual({ v: 1, detail: 'Texte du plan', actor: { kind: 'professional' }, closure: 'ABANDONED' });
    expect(mergePlanStep(current, {}, null)).toEqual({ v: 1, need: 'energie', detail: 'Texte du plan', actor: { kind: 'citizen' } });
    expect(mergePlanStep(null, {}, 'OUTCOME_UNKNOWN')).toEqual({ v: 1, closure: 'OUTCOME_UNKNOWN' });
    expect(mergePlanStep({ v: 1, closure: 'ABANDONED' }, {}, null)).toBeNull();
    expect(mergePlanStep(null, { set: {}, clear: ['need'] })).toBeNull();
    expect(mergePlanStep({ v: 9, need: 'x' }, { set: { need: 'energie' } })).toEqual({ v: 1, need: 'energie' });   // another version is not carried over
    expect(planStepFits({ v: 1, detail: 'x'.repeat(MAX_PLAN_STEP_BYTES) })).toBe(false);
  });
});

describe('pure rules of the pathway', () => {
  it('a dependency loop is found at any length, the step itself included; a chain without a loop is fine', () => {
    const edges = new Map([['a', null], ['b', 'a'], ['c', 'b'], ['d', null]]);
    expect(dependencyCycle('a', 'a', edges)).toBe(true);
    expect(dependencyCycle('a', 'b', edges)).toBe(true);
    expect(dependencyCycle('a', 'c', edges)).toBe(true);
    expect(dependencyCycle('d', 'c', edges)).toBe(false);
    expect(dependencyCycle('c', 'a', edges)).toBe(false);
    expect(dependencyCycle('b', 'd', { a: null, b: 'a', d: null })).toBe(false);
    // a loop already in the data (never written by the service) is not extended, and the walk ends
    expect(dependencyCycle('z', 'x', new Map([['x', 'y'], ['y', 'x'], ['z', null]]))).toBe(true);
  });
  it('closureOf: a reason only while the step is CLOSED', () => {
    expect(closureOf({ status: 'CLOSED', planStep: { v: 1, closure: 'ABANDONED' } })).toBe('ABANDONED');
    expect(closureOf({ status: 'SUBMITTED', planStep: { v: 1, closure: 'ABANDONED' } })).toBeNull();
    expect(closureOf({ status: 'CLOSED', planStep: { v: 1, closure: 'DONE' } })).toBeNull();
    expect(closureOf({ status: 'CLOSED', planStep: null })).toBeNull(); expect(closureOf({ status: 'CLOSED' })).toBeNull();
  });
  it('nextActionOf: what follows from the state the person indicated, else the planned action; nothing after a favourable answer or a plain end', () => {
    const planned = { step: { nextActionKey: 'read_record' } };
    expect(nextActionOf({ status: 'NOT_STARTED', ...planned })).toBe('read_record');
    expect(nextActionOf({ status: 'IN_PROGRESS', ...planned })).toBe('read_record');
    expect(nextActionOf({ status: 'NOT_STARTED', step: null })).toBeNull();
    expect(nextActionOf({ status: 'NOT_STARTED', step: { nextActionKey: 'inconnu' } })).toBeNull();
    expect(nextActionOf({ status: 'DOCUMENTS_REQUIRED', ...planned })).toBe('gather_documents');
    expect(nextActionOf({ status: 'READY' })).toBe('submit_request');
    expect(nextActionOf({ status: 'SUBMITTED' })).toBe('wait_answer'); expect(nextActionOf({ status: 'WAITING_ORGANIZATION' })).toBe('wait_answer');
    expect(nextActionOf({ status: 'ADDITIONAL_INFORMATION' })).toBe('answer_organisation');
    expect(nextActionOf({ status: 'DECISION_NEGATIVE', ...planned })).toBe('after_refusal');
    expect(nextActionOf({ status: 'DECISION_POSITIVE', ...planned })).toBeNull();
    expect(nextActionOf({ status: 'CLOSED', closure: null, ...planned })).toBeNull();
    expect(nextActionOf({ status: 'CLOSED', closure: 'ABANDONED' })).toBe('resume_or_search');
    expect(nextActionOf({ status: 'CLOSED', closure: 'OUTCOME_UNKNOWN' })).toBe('ask_outcome');
    expect(needsRecovery({ status: 'DECISION_NEGATIVE' })).toBe(true); expect(needsRecovery({ status: 'CLOSED', closure: 'ABANDONED' })).toBe(true);
    expect(needsRecovery({ status: 'CLOSED', closure: null })).toBe(false); expect(needsRecovery({ status: 'DECISION_POSITIVE' })).toBe(false); expect(needsRecovery({ status: 'SUBMITTED', closure: 'ABANDONED' })).toBe(false);
  });
  it('groupByNeed: by need in order of first appearance, the steps without a need last', () => {
    const e = { id: 'energie', label: 'Énergie' }; const l = { id: 'acces-logement', label: 'Logement' };
    const items = [{ id: 1, step: { need: e } }, { id: 2, step: null }, { id: 3, step: { need: l } }, { id: 4, step: { need: e } }, { id: 5 }];
    expect(groupByNeed(items).map((g) => [g.need?.id || null, g.items.map((i) => i.id)])).toEqual([['energie', [1, 4]], ['acces-logement', [3]], [null, [2, 5]]]);
    expect(groupByNeed([{ id: 1 }, { id: 2, step: null }]).map((g) => [g.need, g.items.length])).toEqual([[null, 2]]);
    expect(groupByNeed([])).toEqual([]);
  });
});

describe('a database without migration 0046 (column-presence guard)', () => {
  const fake = (impl) => ({ execute: vi.fn(impl) });
  it('asks the information schema once, and answers from what the database has', async () => {
    const present = fake(async () => ({ rows: [{ present: 1 }] })); const absent = fake(async () => ({ rows: [] }));
    expect(await parcoursPlanStepSchema(present)).toBe(true); expect(await parcoursPlanStepSchema(present)).toBe(true); expect(present.execute).toHaveBeenCalledTimes(1);
    expect(await parcoursPlanStepSchema(absent)).toBe(false); expect(absent.execute).toHaveBeenCalledTimes(1);
    forgetParcoursPlanStep(absent); await parcoursPlanStepSchema(absent); expect(absent.execute).toHaveBeenCalledTimes(2);   // a migration applied later is picked up
  });
  it('a failed read answers « absent » (nothing fails because of it) and is not remembered; a double without execute() is taken as migrated', async () => {
    let fail = true; const flaky = fake(async () => { if (fail) throw new Error('connection lost'); return { rows: [{ present: 1 }] }; });
    expect(await parcoursPlanStepSchema(flaky)).toBe(false);
    await Promise.resolve(); fail = false;
    expect(await parcoursPlanStepSchema(flaky)).toBe(true); expect(flaky.execute).toHaveBeenCalledTimes(2);
    expect(await parcoursPlanStepSchema({})).toBe(true); expect(await parcoursPlanStepSchema(null)).toBe(true);
  });
  it('the table without the column: same SQL name, every former column, no "planStep" — so no SELECT / INSERT / RETURNING names it', () => {
    expect(PLAN_STEP_COLUMN).toBe('planStep');
    expect(parcoursItemTable(true)).toBe(ParcoursItem);
    const T = parcoursItemTable(false);
    expect(getTableName(T)).toBe('ParcoursItem');
    const all = Object.keys(getTableColumns(ParcoursItem)); const some = Object.keys(getTableColumns(T));
    expect(all).toContain('planStep'); expect(some).toEqual(all.filter((k) => k !== 'planStep')); expect(T.planStep).toBeUndefined(); expect(T.userId).toBe(ParcoursItem.userId);
  });
});

describe('migration 0046 and its rollback (files)', () => {
  const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
  const up = fs.readFileSync('drizzle/0046_m1_parcours_plan_step.sql', 'utf8');
  const down = fs.readFileSync('drizzle/rollback/0046_down.sql', 'utf8');
  const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('--') && l.trim()).join('\n');
  const e46 = journal.find((x) => x.tag === '0046_m1_parcours_plan_step');
  it('the journal entry right after 0045 (the later ones — M2 0047, 0048 — come after it and keep the column); its snapshot has the nullable jsonb column', () => {
    const e = e46;
    expect(e).toMatchObject({ idx: 46, tag: '0046_m1_parcours_plan_step', version: '7', breakpoints: true });
    expect(journal[46]).toBe(e);
    expect(e.when).toBeGreaterThan(journal.find((x) => x.idx === 45).when);
    for (const later of journal.filter((x) => x.idx > 46)) {
      expect(later.when, later.tag).toBeGreaterThan(e.when);
      const s = JSON.parse(fs.readFileSync(`drizzle/meta/${String(later.idx).padStart(4, '0')}_snapshot.json`, 'utf8'));
      expect(s.tables['public.ParcoursItem'].columns.planStep, later.tag).toEqual({ name: 'planStep', type: 'jsonb', primaryKey: false, notNull: false });
      expect(fs.readFileSync(`drizzle/${later.tag}.sql`, 'utf8'), later.tag).not.toMatch(/planStep/);   // nothing later touches the column
    }
    if (journal.length > 47) expect(JSON.parse(fs.readFileSync('drizzle/meta/0047_snapshot.json', 'utf8')).prevId).toBe(JSON.parse(fs.readFileSync('drizzle/meta/0046_snapshot.json', 'utf8')).id);
    const snap = JSON.parse(fs.readFileSync('drizzle/meta/0046_snapshot.json', 'utf8'));
    expect(snap.tables['public.ParcoursItem'].columns.planStep).toEqual({ name: 'planStep', type: 'jsonb', primaryKey: false, notNull: false });
    expect(snap.prevId).toBe(JSON.parse(fs.readFileSync('drizzle/meta/0045_snapshot.json', 'utf8')).id);
  });
  it('up is ONE additive, idempotent statement: a nullable column, no default, no backfill, no index, no constraint', () => {
    expect(code(up)).toBe('ALTER TABLE "ParcoursItem" ADD COLUMN IF NOT EXISTS "planStep" jsonb;');
    expect(expectedObjects(up)).toEqual([{ op: 'add', kind: 'column', key: 'ParcoursItem.planStep', table: 'ParcoursItem' }]);
    expect(up).not.toMatch(/\b(UPDATE|DELETE|DROP|DEFAULT|NOT NULL|CREATE|CHECK \()/);
  });
  it('down drops exactly that column and forgets the migration row', () => {
    expect(code(down)).toBe(`ALTER TABLE "ParcoursItem" DROP COLUMN IF EXISTS "planStep";\nDELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${e46.when};`);
    expect(expectedObjects(down)).toEqual([{ op: 'drop', kind: 'column', key: 'ParcoursItem.planStep', table: 'ParcoursItem' }]);
  });
  it('the schema column is jsonb and nullable (an existing row needs no value)', () => {
    const c = getTableColumns(ParcoursItem).planStep;
    expect(c.getSQLType()).toBe('jsonb'); expect(c.notNull).toBe(false); expect(c.hasDefault).toBe(false);
  });
});

describe('Mon Parcours — more than a list', () => {
  const energie = { id: 'energie', label: 'Énergie : factures, précarité énergétique' };
  it('steps without plan data (every step that existed before 0046) render as the former flat list: no group, no actor, no next action, no waiting notice', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'a' }), item({ id: 'b', title: 'Autre étape', status: 'IN_PROGRESS' })] });
    mount(CompteParcours);
    expect(await screen.findAllByTestId('parcours-item')).toHaveLength(2);
    expect(screen.getByTestId('parcours-active').tagName).toBe('UL');
    for (const id of ['parcours-group', 'parcours-plan', 'parcours-actor', 'parcours-next-action', 'parcours-waiting', 'parcours-next', 'human-help-block']) expect(screen.queryByTestId(id), id).toBeNull();
  });
  it('an answer of a server that knows nothing of plan data (no closure / step / waiting fields at all) still renders', async () => {
    const legacy = { id: 'p1', origin: 'MANUAL', stepKind: 'custom', title: 'Aide au logement', status: 'SUBMITTED', dueDate: null, note: null, itemCodes: [], records: [], available: true, plan: null };
    api.listParcours.mockResolvedValue({ items: [legacy] });
    mount(CompteParcours);
    expect(await screen.findByTestId('parcours-item-status')).toHaveTextContent('Demande envoyée');
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    const select = await screen.findByTestId('parcours-status-select');
    expect(within(select).getAllByRole('option')).toHaveLength(10);   // no closing reason is offered where it cannot be stored
    expect(screen.queryByTestId('parcours-organise')).toBeNull();
  });
  it('groups the steps in progress by need (French taxonomy label, marked French), the others under « Autres étapes »', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'a', title: 'Facture d’électricité', step: step({ need: energie }) }), item({ id: 'b', title: 'Étape libre' }), item({ id: 'c', title: 'Chèque énergie', step: step({ need: energie }) })] });
    mount(CompteParcours);
    const groups = await screen.findAllByTestId('parcours-group');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByRole('heading', { level: 3 })).toHaveTextContent('Besoin : Énergie : factures, précarité énergétique');
    expect(within(groups[0]).getByText(energie.label)).toHaveAttribute('lang', 'fr');
    expect(within(groups[0]).getAllByTestId('parcours-item').map((li) => li.querySelector('p').textContent)).toEqual(['Facture d’électricité', 'Chèque énergie']);
    expect(within(groups[1]).getByRole('heading', { level: 3 })).toHaveTextContent('Autres étapes');
    expect(within(groups[1]).getAllByTestId('parcours-item')).toHaveLength(1);
    expect(groups[0]).toHaveAttribute('aria-labelledby', 'parcours-group-energie');
  });
  it('shows who acts and the next action: the person, a named organisation, a professional; official links open in a new window, internal ones stay in the site', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [
      item({ id: 'a', step: step({ actor: { kind: 'citizen', name: null }, nextActionKey: 'gather_documents' }) }),
      item({ id: 'b', step: step({ actor: { kind: 'organisation', name: 'Caf du Bas-Rhin' }, nextActionKey: 'contact_organisation', links: [{ url: OFFICIAL, label: 'Fiche officielle' }, { to: '/aides/rsa', label: 'Fiche RSA' }] }) }),
      item({ id: 'c', step: step({ actor: { kind: 'professional', name: null }, nextActionKey: 'ask_professional' }) }),
    ] });
    mount(CompteParcours);
    const [a, b, c] = await screen.findAllByTestId('parcours-item');
    expect(within(a).getByTestId('parcours-actor')).toHaveTextContent('Qui agit : vous');
    expect(within(a).getByTestId('parcours-next-action')).toHaveTextContent('Prochaine action : rassembler vos papiers');
    expect(within(b).getByTestId('parcours-plan')).toHaveTextContent('Auprès de qui : Caf du Bas-Rhin');
    expect(within(b).getByTestId('parcours-next-action')).toHaveTextContent('Prochaine action : contacter l’organisme');
    const official = within(b).getByTestId('parcours-official-link');
    expect(official).toHaveAttribute('href', OFFICIAL); expect(official).toHaveAttribute('target', '_blank'); expect(official).toHaveAttribute('rel', 'noopener noreferrer');
    expect(official).toHaveTextContent('Fiche officielle (nouvelle fenêtre)');
    expect(within(b).getByRole('link', { name: 'Fiche RSA' })).toHaveAttribute('href', '/aides/rsa');
    expect(within(c).getByTestId('parcours-actor')).toHaveTextContent('Qui agit : un professionnel qui vous accompagne');
  });
  it('the next action follows the state the person indicated, and nothing is proposed after a favourable answer', async () => {
    const planned = step({ nextActionKey: 'read_record' });
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'a', status: 'DOCUMENTS_REQUIRED', step: planned }), item({ id: 'b', status: 'WAITING_ORGANIZATION' }), item({ id: 'c', status: 'DECISION_POSITIVE', step: planned }), item({ id: 'd', status: 'NOT_STARTED', step: planned })] });
    mount(CompteParcours);
    const byTitle = async () => (await screen.findAllByTestId('parcours-item')).map((li) => li.querySelector('[data-testid="parcours-next-action"]')?.textContent || null);
    expect(await byTitle()).toEqual(['Prochaine action : rassembler vos papiers', 'Prochaine action : attendre la réponse de l’organisme ; sans nouvelles, vous pouvez le relancer', 'Prochaine action : lire la fiche d’information', null]);
  });
  it('a step that comes after an unfinished one is shown as waiting — and is never locked: its state can still be changed', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'a', title: 'Demander une attestation', status: 'IN_PROGRESS' }),
      item({ id: 'b', title: 'Envoyer le dossier', waiting: true, dependsOn: { id: 'a', title: 'Demander une attestation', status: 'IN_PROGRESS', closure: null, done: false } })] });
    api.parcours.mockResolvedValue({ item: {} });
    mount(CompteParcours);
    const waiting = await screen.findByTestId('parcours-waiting');
    expect(waiting).toHaveTextContent('En attente de l’étape « Demander une attestation » (En cours). Vous pouvez quand même mettre cette étape à jour.');
    const li = waiting.closest('[data-testid="parcours-item"]');
    fireEvent.click(within(li).getByRole('button', { name: 'Mettre à jour' }));
    const select = await within(li).findByTestId('parcours-status-select');
    expect(select).not.toBeDisabled();
    fireEvent.change(select, { target: { value: 'SUBMITTED' } });
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'status', id: 'b', status: 'SUBMITTED' }));
    // no notice once the other step is finished
    cleanup(); api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'b', waiting: false, dependsOn: { id: 'a', title: 'Demander une attestation', status: 'CLOSED', closure: null, done: true } })] });
    mount(CompteParcours); await screen.findByTestId('parcours-item');
    expect(screen.queryByTestId('parcours-waiting')).toBeNull();
  });
  it('following a link never changes a step: no request is sent by a click on a record, an official link, an internal link or a « Que faire ensuite ? » link', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'a', status: 'DECISION_NEGATIVE', itemCodes: ['aide:a1'], records: [{ code: 'aide:a1', type: 'aide', available: true, title: 'Aide au logement', href: '/aides/apl', contact: true }],
      step: step({ links: [{ url: OFFICIAL, label: 'Fiche officielle' }, { to: '/aides/rsa', label: 'Fiche RSA' }] }) })] });
    mount(CompteParcours);
    await screen.findByTestId('parcours-next');
    const links = screen.getByTestId('parcours-item').querySelectorAll('a');
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const a of links) { a.addEventListener('click', (e) => e.preventDefault()); fireEvent.click(a); }
    await tick();
    expect(api.parcours).not.toHaveBeenCalled(); expect(api.removeParcours).not.toHaveBeenCalled();
    expect(screen.getByTestId('parcours-item-status')).toHaveTextContent('Réponse défavorable (indiquée par vous)');
  });
  it('a record that is no longer available: the flag, the search, and the « Parler à une personne » block with the official locators', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ available: false, itemCodes: ['aide:a1'], records: [{ code: 'aide:a1', type: 'aide', available: false, title: null, href: null, contact: false }] })] });
    mount(CompteParcours);
    expect(await screen.findByTestId('parcours-record-unavailable')).toHaveTextContent('Cette fiche n’est plus disponible.');
    const help = screen.getByTestId('human-help-block');
    expect(within(help).getByRole('heading', { level: 3, name: 'Parler à une personne' })).toBeInTheDocument();
    expect(within(help).getByRole('link', { name: /Trouver une France services/ })).toHaveAttribute('href', 'https://www.france-services.gouv.fr/');
    expect(help).toHaveAttribute('aria-labelledby', 'parcours-help-p1-title');
    expect(claimsEntitlement(help.textContent)).toBe(false);
    // no such block while every record is available
    cleanup(); api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ itemCodes: ['aide:a1'], records: [{ code: 'aide:a1', type: 'aide', available: true, title: 'Aide', href: '/aides/a1', contact: false }] })] });
    mount(CompteParcours); await screen.findByTestId('parcours-records');
    expect(screen.queryByTestId('human-help-block')).toBeNull();
  });
});

describe('honest ways a step ends', () => {
  it('the two reasons are offered with the ten states where the database stores them, and are sent as the person chose them', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item()] }); api.parcours.mockResolvedValue({ item: {} });
    mount(CompteParcours);
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour' }));
    const select = await screen.findByTestId('parcours-status-select');
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.value)).toEqual([...Object.keys(PARCOURS_STATUS_LABELS), 'ABANDONED', 'OUTCOME_UNKNOWN']);
    expect(options.slice(-2).map((o) => o.textContent)).toEqual(['Abandonné (indiqué par vous)', 'Terminé sans connaître la réponse']);
    fireEvent.change(select, { target: { value: 'ABANDONED' } });
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'status', id: 'p1', status: 'ABANDONED' }));
  });
  it('a step given up, or whose outcome is unknown: listed with the finished steps under its own label, with a neutral « Que faire ensuite ? »', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'a', status: 'CLOSED', closure: 'ABANDONED' }), item({ id: 'b', title: 'Demande de logement', status: 'CLOSED', closure: 'OUTCOME_UNKNOWN' }), item({ id: 'c', title: 'Étape finie', status: 'CLOSED' })] });
    mount(CompteParcours);
    const done = await screen.findByTestId('parcours-done');
    const [a, b, c] = within(done).getAllByTestId('parcours-item');
    expect(within(a).getByTestId('parcours-item-status')).toHaveTextContent('Abandonné (indiqué par vous)');
    expect(within(a).getByTestId('parcours-next')).toHaveTextContent('Vous avez indiqué avoir abandonné cette étape. Vous pouvez la reprendre à tout moment');
    expect(within(a).getByTestId('parcours-next-action')).toHaveTextContent('reprendre cette étape quand vous le souhaitez, ou chercher une autre piste');
    expect(within(b).getByTestId('parcours-item-status')).toHaveTextContent('Terminé sans connaître la réponse');
    expect(within(b).getByTestId('parcours-next')).toHaveTextContent('AccesDirectAide ne la connaît pas non plus');
    expect(within(b).getByTestId('parcours-next-action')).toHaveTextContent('demander à l’organisme où en est votre demande');
    expect(within(b).getByTestId('parcours-next-search')).toHaveAttribute('href', `/recherche?q=${encodeURIComponent('Demande de logement')}`);
    expect(within(c).getByTestId('parcours-item-status')).toHaveTextContent('Terminé'); expect(within(c).queryByTestId('parcours-next')).toBeNull(); expect(within(c).queryByTestId('parcours-next-action')).toBeNull();
    for (const li of [a, b]) {
      const text = within(li).getByTestId('parcours-next').textContent;
      expect(claimsEntitlement(text)).toBe(false);
      expect(text).not.toMatch(/vous avez droit|vous pouvez contester|recours|vous obtiendrez|sera accordé|refus/i);
    }
    // the select shows the reason the person chose, not a bare « Terminé »
    fireEvent.click(within(a).getByRole('button', { name: 'Mettre à jour' }));
    expect(await within(a).findByTestId('parcours-status-select')).toHaveValue('ABANDONED');
  });
});

describe('organising a step, and a need that becomes a step', () => {
  it('who acts and the step it comes after are sent as plan data; a loop refused by the server is shown as an alert', async () => {
    api.listParcours.mockResolvedValue({ planSteps: true, items: [item({ id: 'a', title: 'Demander une attestation' }), item({ id: 'b', title: 'Envoyer le dossier' })] });
    api.parcours.mockResolvedValueOnce({ item: {} });
    mount(CompteParcours);
    const b = (await screen.findAllByTestId('parcours-item'))[1];
    fireEvent.click(within(b).getByRole('button', { name: 'Mettre à jour' }));
    const form = await within(b).findByTestId('parcours-organise');
    expect(within(form).getByLabelText('Qui agit pour cette étape ?')).toBeInTheDocument();
    const depends = within(form).getByLabelText('Cette étape vient après');
    expect(within(depends).getAllByRole('option').map((o) => o.textContent)).toEqual(['Aucune autre étape', 'Demander une attestation']);   // never the step itself
    fireEvent.change(within(form).getByTestId('parcours-actor-select'), { target: { value: 'organisation' } });
    fireEvent.change(within(form).getByLabelText('Nom de l’organisme'), { target: { value: ' Caf du Bas-Rhin ' } });
    fireEvent.change(depends, { target: { value: 'a' } });
    fireEvent.click(within(form).getByTestId('parcours-organise-save'));
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'plan', id: 'b', planStep: { actor: { kind: 'organisation', name: 'Caf du Bas-Rhin' }, dependsOnItemId: 'a' } }));
    await waitFor(() => expect(screen.getByTestId('parcours-status')).toHaveTextContent('Organisation de l’étape enregistrée.'));
    api.parcours.mockRejectedValueOnce(new Error('Ces étapes dépendraient l’une de l’autre : choisissez une autre étape.'));
    const again = (await screen.findAllByTestId('parcours-item'))[1];
    fireEvent.change(within(again).getByTestId('parcours-actor-select'), { target: { value: '' } });
    fireEvent.change(within(again).getByLabelText('Cette étape vient après'), { target: { value: '' } });
    fireEvent.click(within(again).getByTestId('parcours-organise-save'));
    await waitFor(() => expect(api.parcours).toHaveBeenLastCalledWith({ action: 'plan', id: 'b', planStep: { actor: null, dependsOnItemId: null } }));
    expect(await screen.findByTestId('parcours-problem')).toHaveTextContent('Ces étapes dépendraient l’une de l’autre');
  });
  it('an orientation need of the taxonomy carries its need, its official sheets and « lire la fiche » into the step; the value passes the server validation', async () => {
    authMe.mockResolvedValue({ session: { kind: 'user' }, user: { email: 'x@example.test' } }); api.parcours.mockResolvedValue({ added: true });
    const need = { id: 'energie', label: 'Factures impayées : électricité, gaz, eau', urgent: false, numbers: [], actions: [], rules: [], sheets: ['F20055', 'F38589', 'F1334'], topic: 'facture' };
    const sources = { F20055: { title: 'Chèque énergie', url: OFFICIAL, slug: 'cheque-energie-f20055' }, F38589: { title: 'Fiche sans page locale', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F38589', slug: null },
      F1334: { title: 'Lien non officiel', url: 'https://example.org/F1334', slug: null } };
    mount(OrientationPanel, { orientation: { needs: [need], cautions: [], questions: [], sources }, query: 'q' });
    fireEvent.click(await screen.findByTestId('parcours-add-record-button'));
    const planStep = { need: 'energie', links: [{ url: OFFICIAL, label: 'Chèque énergie' }, { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F38589', label: 'Fiche sans page locale' }], nextActionKey: 'read_record' };
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'add', records: [{ type: 'guide', id: 'cheque-energie-f20055' }], title: need.label, planStep }));
    expect(validatePlanStepInput(planStep, ENV)).toMatchObject({ ok: true, set: planStep });
  });
});
