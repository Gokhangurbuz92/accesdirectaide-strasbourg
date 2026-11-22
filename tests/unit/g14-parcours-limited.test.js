/**
 * G14 — the LIMITED Mon Parcours (owner requirements 1–4, 22/11/2026): the reviewed positive list of step types, the request contract enforced by the
 * server before any database access, the flags that stay OFF (notes, delegated read, external reminders, consent mode, import), the retention step wired
 * behind its approval, and the six-language labels. Pure: no database (the setup mocks it; any touch throws).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import { PARCOURS_STEP_TYPES_FILE, STEP_TYPE_PREFIX, deadlineSourceOf, stepCatalogue, stepCatalogueView, stepTypeOf, stepTypeOfItem, structureFitsStepType,
  structureKindOf, validateStepCatalogue } from '../../api/lib/parcours-step-types.js';
import { LIMITED_POST_FIELDS, legacyContractAllowed, limitedRequestRefusal, parcoursDelegateReadOpen, parcoursExternalRemindersOpen } from '../../api/lib/parcours-limited.js';
import { classifyParcoursStep, parcoursNotesOpen } from '../../api/lib/parcours-sensitivity.js';
import { RETENTION_POLICY, isPolicyApproved, stepApprovalProblem } from '../../api/_services/retention-policy.js';
import { TARGET_LANGUAGES, languageOf } from '../../src/i18n/languages.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), PARCOURS_STEP_TYPES_FILE), 'utf8'));
const cat = stepCatalogue();

// the words that must never appear in a code or label of the list (groups A art. 9, B art. 10, C reinforced protection — analyse documentaire du responsable, Q10)
const FORBIDDEN = /sant|handicap|mdph|aah|pch|aeeh|apa\b|autonomie|addict|grossesse|paje|sexu|psy|soin|maladi|c2s|css\b|\bame\b|sejour|séjour|asile|naturalis|oqtf|cada|ofii|penal|pénal|justice|juridiction|spip|pjj|prison|detenu|tutelle|curatelle|protection|ase\b|enfance|violence|victime|domicil|dalo|hebergement|hébergement|115|chrs|urgence|sans.abri|reversion|réversion|deces|décès|orphelin|soutien familial|adoption/i;

describe('G14 — the reviewed list of step types (data/reference/parcours-step-types.v1.json)', () => {
  it('is the exact reviewed list: 28 types, 9 domains, 9 structure kinds, every code unique and well-formed, marked PROJET (not approved)', () => {
    expect(cat.types).toHaveLength(28);
    expect(Object.keys(cat.domains)).toHaveLength(9);
    expect(Object.keys(cat.structureKinds).sort()).toEqual(['caf', 'ccas', 'cio', 'france_services', 'france_travail', 'information_jeunesse', 'mairie', 'maison_solidarites', 'mission_locale']);
    expect(new Set(cat.types.map((t) => t.code)).size).toBe(28);
    expect(raw.status).toMatch(/PROJET/);
    expect(raw.status).toMatch(/non approuvée/);
    expect(raw.sourceArchive.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no code, label or structure kind reveals a group A / B / C category (explicit list and the G8 guard)', () => {
    for (const t of cat.types) {
      expect(FORBIDDEN.test(t.code.replace(/_/g, ' ')), t.code).toBe(false);
      expect(FORBIDDEN.test(t.label), t.label).toBe(false);
      expect(classifyParcoursStep({ texts: [t.label, t.code.replace(/_/g, ' ')] }).sensitive, t.code).toBe(false);
      expect(claimsEntitlement(t.label), t.label).toBe(false);
    }
    for (const [k, v] of Object.entries(cat.structureKinds)) for (const s of v.typeStructure) expect(FORBIDDEN.test(s) || FORBIDDEN.test(k), s).toBe(false);
  });

  it('the excluded topics are listed by group (A art. 9, B art. 10, C reinforced protection), including the categories of the owner analysis', () => {
    const groups = new Set(raw.excluded.map((e) => e.group));
    expect([...groups].sort()).toEqual(['A', 'B', 'C']);
    const text = JSON.stringify(raw.excluded);
    for (const w of ['séjour', 'Violences', 'enfance', 'Protection juridique', 'Précarité extrême', 'hébergement d\'urgence', 'informations familiales', 'art. 10']) expect(text).toContain(w);
  });

  it('every source is an official Service-Public fiche (https, vosdroits, id in the address) — a deadline can only cite one of them', () => {
    for (const t of cat.types) {
      for (const s of t.sources) expect(s.url).toBe(`https://www.service-public.gouv.fr/particuliers/vosdroits/${s.id}`);
      expect(deadlineSourceOf(t, undefined)).toBe(t.sources[0].url);
      expect(deadlineSourceOf(t, t.sources[t.sources.length - 1].url)).toBe(t.sources[t.sources.length - 1].url);
      expect(deadlineSourceOf(t, 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12242')).toBeNull();   // AAH: an address can reveal what the step is about
      expect(deadlineSourceOf(t, 'https://example.org/x')).toBeNull();
    }
  });

  it('fails closed on a malformed or sensitive file', () => {
    const clone = () => JSON.parse(JSON.stringify(raw));
    const a = clone(); a.types[0].label = 'Déposer le dossier MDPH'; expect(() => validateStepCatalogue(a)).toThrow(/sensitive/);
    const b = clone(); b.types[1].code = b.types[0].code; expect(() => validateStepCatalogue(b)).toThrow(/duplicate/);
    const c = clone(); c.types[0].sources = [{ id: 'X', url: 'https://example.org/X' }]; expect(() => validateStepCatalogue(c)).toThrow(/source/);
    const d = clone(); d.types[0].structureKinds = ['csapa']; expect(() => validateStepCatalogue(d)).toThrow(/structure kind/);
    const e = clone(); e.structureKinds.mairie.typeStructure.push('Centre de soins, d’accompagnement et de prévention en addictologie (CSAPA)'); expect(() => validateStepCatalogue(e)).toThrow(/sensitive/);
  });

  it('a stored step gives back its type from itemCodes; a step of the former contract has none', () => {
    expect(stepTypeOfItem({ itemCodes: [`${STEP_TYPE_PREFIX}RSA_DEMANDE`, 'structure:s1'] }).code).toBe('RSA_DEMANDE');
    expect(stepTypeOfItem({ itemCodes: ['aide:x'] })).toBeNull();
    expect(stepTypeOf('rsa_demande')).toBeNull();
    expect(stepTypeOf('UNKNOWN_CODE')).toBeNull();
    expect(stepCatalogueView().types[0]).toEqual(expect.objectContaining({ code: expect.any(String), label: expect.any(String), structureKinds: expect.any(Array) }));
  });
});

describe('G14 — indirect disclosure: step type × structure × deadline source', () => {
  const RSA = stepTypeOf('RSA_DEMANDE'); const CNI = stepTypeOf('CARTE_IDENTITE_DEMANDE'); const FT = stepTypeOf('FRANCE_TRAVAIL_INSCRIPTION');
  it('a structure must be of a listed kind AND of a kind the step type allows', () => {
    expect(structureFitsStepType(RSA, { nom: 'Caf du Bas-Rhin', type_structure: 'Caf (Caisse d\'allocations familiales)' })).toBe(true);
    expect(structureFitsStepType(RSA, { nom: 'Caf du Bas-Rhin', type_structure: 'Caf (Caisse d’allocations familiales)' })).toBe(true);   // typographic apostrophe
    expect(structureFitsStepType(RSA, { nom: 'Mairie de Strasbourg', type_structure: 'Mairie' })).toBe(false);   // kind not allowed for that type
    expect(structureFitsStepType(CNI, { nom: 'Mairie de Strasbourg', type_structure: 'Mairie' })).toBe(true);
  });
  it('the kinds that reveal health, disability, addiction, residence, justice, emergency housing or legal protection never fit any type', () => {
    const sensitive = ['Centre de soins, d’accompagnement et de prévention en addictologie (CSAPA)', 'Centre d’accueil de demandeurs d’asile (CADA)', 'Centre d’hébergement et de réinsertion sociale (CHRS)',
      'Centre de santé', 'MDPH', 'Point-justice (accès au droit)', 'Sous-préfecture', 'Service mandataire judiciaire à la protection des majeurs', 'Centre médico-psychologique (CMP)',
      'Espace de vie affective, relationnelle et sexuelle (EVARS)', 'PMI (protection maternelle et infantile)', 'CIDFF (droits des femmes et des familles)', 'Résidence sociale', 'Association', 'Service Public', 'CPAM'];
    for (const ty of sensitive) {
      expect(structureKindOf(ty), ty).toBeNull();
      for (const t of cat.types) expect(structureFitsStepType(t, { nom: 'X', type_structure: ty })).toBe(false);
    }
  });
  it('a place of an allowed kind whose NAME reveals a sensitive fact is refused too', () => {
    expect(structureFitsStepType(FT, { nom: 'France Travail — antenne du centre de détention', type_structure: 'France Travail' })).toBe(false);
    expect(structureFitsStepType(CNI, { nom: 'Mairie — permanence CADA', type_structure: 'Mairie' })).toBe(false);
  });
  it('no combination of a type, one of its kinds and one of its sources trips the guard (the whole space is checked)', () => {
    for (const t of cat.types) for (const k of t.structureKinds) for (const ts of cat.structureKinds[k].typeStructure) for (const s of t.sources) {
      expect(classifyParcoursStep({ texts: [t.label, ts, s.title] }).sensitive, `${t.code} × ${ts} × ${s.id}`).toBe(false);
    }
  });
});

describe('G14 — the request contract (api/lib/parcours-limited.js), before any database access', () => {
  const post = (body, env = {}) => limitedRequestRefusal({ method: 'POST', body }, env);
  it('add: only stepType (+ structureId); a free title, records, plan data, consent or any other field is refused, naming the field only', () => {
    expect(post({ action: 'add', stepType: 'RSA_DEMANDE' })).toBeNull();
    expect(post({ action: 'add', stepType: 'RSA_DEMANDE', structureId: 'abc-123' })).toBeNull();
    for (const extra of [{ title: 'Dossier MDPH' }, { records: [{ type: 'aide', id: 'aah' }] }, { planStep: { actor: { kind: 'organisation', name: 'CSAPA' } } }, { sensitiveConsent: true },
      { organisation: 'Hôpital' }, { note: 'x' }, { metadata: { a: 1 } }, { dueDate: '2027-01-01' }]) {
      const r = post({ action: 'add', stepType: 'RSA_DEMANDE', ...extra });
      expect(r).toEqual(expect.objectContaining({ ok: false, status: 400, code: 'FIELD_NOT_ALLOWED' }));
      expect(r.message).toContain(Object.keys(extra)[0]);
      expect(r.message).not.toMatch(/MDPH|CSAPA|Hôpital|aah/);   // the value is never echoed
    }
    expect(post({ action: 'add', stepType: 'free text' }).code).toBe('INVALID_STEP_TYPE');
    expect(post({ action: 'add' }).code).toBe('INVALID_STEP_TYPE');
    expect(post({ action: 'add', stepType: 'RSA_DEMANDE', structureId: '../x' }).code).toBe('STRUCTURE_NOT_ALLOWED');
  });
  it('import (shared dossier) and plan (free organisation name, links, need) are refused; an unknown action is refused', () => {
    expect(post({ action: 'import', shareId: 's1' })).toEqual(expect.objectContaining({ status: 400, code: 'ACTION_NOT_ALLOWED' }));
    expect(post({ action: 'plan', id: 'p1', planStep: {} }).code).toBe('ACTION_NOT_ALLOWED');
    expect(post({ action: 'whatever' }).code).toBe('INVALID_ACTION');
    expect(post(null).code).toBe('INVALID_BODY');
    expect(post([]).code).toBe('INVALID_BODY');
    expect(Object.keys(LIMITED_POST_FIELDS).sort()).toEqual(['add', 'deadline', 'note', 'status']);
  });
  it('notes: OFF by default — a note is refused (409 NOTES_CLOSED), clearing stays possible; only ADA_PARCOURS_NOTES=on opens them', () => {
    expect(parcoursNotesOpen({})).toBe(false);
    for (const v of ['off', 'true', '1', 'ON', 'yes']) expect(parcoursNotesOpen({ ADA_PARCOURS_NOTES: v })).toBe(false);
    expect(parcoursNotesOpen({ ADA_PARCOURS_NOTES: 'on' })).toBe(true);
    expect(post({ action: 'note', id: 'p1', note: 'rendez-vous mardi' })).toEqual(expect.objectContaining({ status: 409, code: 'NOTES_CLOSED' }));
    expect(post({ action: 'note', id: 'p1', note: null })).toBeNull();
    expect(post({ action: 'note', id: 'p1', note: '' })).toBeNull();
    expect(post({ action: 'note', id: 'p1', note: 'rendez-vous mardi' }, { ADA_PARCOURS_NOTES: 'on' })).toBeNull();
    expect(post({ action: 'note', id: 'p1', note: 'x', sensitiveConsent: true }, { ADA_PARCOURS_NOTES: 'on' }).code).toBe('FIELD_NOT_ALLOWED');
  });
  it('status / deadline / delete / GET accept only their fields', () => {
    expect(post({ action: 'status', id: 'p1', status: 'IN_PROGRESS' })).toBeNull();
    expect(post({ action: 'status', id: 'p1', status: 'IN_PROGRESS', title: 'x' }).code).toBe('FIELD_NOT_ALLOWED');
    expect(post({ action: 'deadline', id: 'p1', dueDate: '2027-02-01' })).toBeNull();
    expect(post({ action: 'deadline', id: 'p1', dueDate: '2027-02-01', dueSourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F10007' })).toBeNull();
    expect(post({ action: 'deadline', id: 'p1', dueDate: 'demain' }).code).toBe('INVALID_DATE');
    expect(post({ action: 'deadline', id: 'p1', dueDate: null, dueSourceUrl: 'https://x' }).code).toBe('FIELD_NOT_ALLOWED');
    expect(post({ action: 'deadline', id: 'p1', dueDate: '2027-02-01', label: 'x' }).code).toBe('FIELD_NOT_ALLOWED');
    expect(limitedRequestRefusal({ method: 'DELETE', body: { id: 'p1' } })).toBeNull();
    expect(limitedRequestRefusal({ method: 'DELETE', body: { id: 'p1', all: true } }).code).toBe('FIELD_NOT_ALLOWED');
    expect(limitedRequestRefusal({ method: 'GET', query: { path: 'citizen/parcours' } })).toBeNull();
    expect(limitedRequestRefusal({ method: 'GET', query: { history: 'p1' } })).toBeNull();
    expect(limitedRequestRefusal({ method: 'GET', query: { structuresFor: 'RSA_DEMANDE', q: 'Caf' } })).toBeNull();
    expect(limitedRequestRefusal({ method: 'GET', query: { structuresFor: 'RSA_DEMANDE', q: 'C' } }).code).toBe('INVALID_QUERY');
    expect(limitedRequestRefusal({ method: 'GET', query: { userId: 'other' } }).code).toBe('FIELD_NOT_ALLOWED');
  });
});

describe('G14 — what stays OFF', () => {
  it('delegated read, external reminders: off unless exactly « on »', () => {
    expect(parcoursDelegateReadOpen({})).toBe(false);
    expect(parcoursDelegateReadOpen({ ADA_PARCOURS_DELEGATE_READ: 'true' })).toBe(false);
    expect(parcoursDelegateReadOpen({ ADA_PARCOURS_DELEGATE_READ: 'on' })).toBe(true);
    expect(parcoursExternalRemindersOpen({})).toBe(false);
    expect(parcoursExternalRemindersOpen({ ADA_PARCOURS_EXTERNAL_REMINDERS: '1' })).toBe(false);
    expect(parcoursExternalRemindersOpen({ ADA_PARCOURS_EXTERNAL_REMINDERS: 'on' })).toBe(true);
  });
  it('the former contract is reachable only inside the test suites, never on Vercel Production', () => {
    expect(legacyContractAllowed({})).toBe(false);
    expect(legacyContractAllowed({ ADA_PARCOURS_LEGACY_CONTRACT: 'test-only' })).toBe(false);
    expect(legacyContractAllowed({ NODE_ENV: 'production', ADA_PARCOURS_LEGACY_CONTRACT: 'test-only' })).toBe(false);
    expect(legacyContractAllowed({ NODE_ENV: 'test', VERCEL_ENV: 'production', ADA_PARCOURS_LEGACY_CONTRACT: 'test-only' })).toBe(false);
    expect(legacyContractAllowed({ NODE_ENV: 'test', ADA_PARCOURS_LEGACY_CONTRACT: 'on' })).toBe(false);
    expect(legacyContractAllowed({ NODE_ENV: 'test', VERCEL_ENV: 'development', ADA_PARCOURS_LEGACY_CONTRACT: 'test-only' })).toBe(true);
  });
  it('no configuration file of the repository sets an opening flag; the manifest forbids the test-only switch on any deployment', () => {
    for (const f of ['vercel.json', '.env.example'].filter((x) => fs.existsSync(x))) {
      const s = fs.readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/ADA_PARCOURS_(NOTES|DELEGATE_READ|EXTERNAL_REMINDERS)\s*["=:]\s*"?on/);
      expect(s, f).not.toMatch(/ADA_PARCOURS_LEGACY_CONTRACT\s*["=:]\s*"?[a-z]/);
    }
    const m = JSON.parse(fs.readFileSync('config/activation-manifest.json', 'utf8'));
    const v = m.variables || m.vars || m;
    const find = (k) => JSON.stringify(m).includes(`"${k}"`) && (v[k] || Object.values(m).find((x) => x && typeof x === 'object' && x[k])?.[k]);
    expect(find('ADA_PARCOURS_LEGACY_CONTRACT').class).toBe('forbidden');
    for (const k of ['ADA_PARCOURS_NOTES', 'ADA_PARCOURS_DELEGATE_READ', 'ADA_PARCOURS_EXTERNAL_REMINDERS']) expect(find(k).format, k).toBe('^(on)?$');
  });
});

describe('G14 — retention (proposal « à approuver »)', () => {
  it('the closed-step duration is 730 days, marked pending approval; the approved policy version is unchanged', () => {
    const d = RETENTION_POLICY.durations.PARCOURS_CLOSED_STEP_DAYS;
    expect(d.days).toBe(730);
    expect(d.pendingApproval).toMatch(/À APPROUVER/);
    expect(isPolicyApproved(RETENTION_POLICY)).toBe(true);
    expect(RETENTION_POLICY.approvedSteps.parcoursClosedStepsDeleted).toBeUndefined();
  });
  it('even with a step approval record, a pending duration never executes', () => {
    const policy = { ...RETENTION_POLICY, approvedSteps: { parcoursClosedStepsDeleted: { approvedOn: '2026-12-01', dryRunReviewedOn: '2026-11-30', backupVerified: 'restore test' } } };
    expect(stepApprovalProblem(policy, { id: 'parcoursClosedStepsDeleted', durationKey: 'PARCOURS_CLOSED_STEP_DAYS' })).toBe('DURATION_PENDING_APPROVAL');
    const approvedDuration = { ...policy, durations: { ...policy.durations, PARCOURS_CLOSED_STEP_DAYS: { ...policy.durations.PARCOURS_CLOSED_STEP_DAYS, pendingApproval: undefined } } };
    expect(stepApprovalProblem(approvedDuration, { id: 'parcoursClosedStepsDeleted', durationKey: 'PARCOURS_CLOSED_STEP_DAYS' })).toBeNull();
  });
  it('the purge step exists, deletes ParcoursItem only, and is protected by legal hold / restriction / open request', async () => {
    const src = fs.readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8');
    expect(src).toMatch(/id: 'parcoursClosedStepsDeleted'[^\n]*kind: 'delete', table: 'ParcoursItem', durationKey: 'PARCOURS_CLOSED_STEP_DAYS'/);
    expect(src).toMatch(/parcoursClosedStepsWhere = \(before\) => and\([^\n]*\n[^\n]*heldSql\(ParcoursItem\.id, ParcoursItem\.userId\)[^\n]*personProtectedSql\(ParcoursItem\.userId\)/);
  });
});

describe('G14 — six languages (fr canonical in the code, en/de/tr/ar/uk), Arabic right-to-left', () => {
  const keys = [...cat.types.map((t) => `parcours.type.${t.code}`), ...Object.keys(cat.domains).map((d) => `parcours.domain.${d}`),
    ...['already', 'place', 'place_gone', 'due_source', 'notice_title', 'notice_body', 'notice_rights', 'privacy_link', 'add_title', 'type_label', 'type_none', 'place_title', 'place_query', 'place_find', 'place_pick', 'place_none', 'place_empty'].map((k) => `parcours.limited.${k}`),
    'notifications.kind.parcours_closed_expiring'];
  it('every label exists, is not empty, keeps French official names, asserts no right', () => {
    for (const lang of TARGET_LANGUAGES) {
      const json = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/compte.json`, 'utf8'));
      for (const k of keys) { expect(typeof json[k], `${lang} ${k}`).toBe('string'); expect(json[k].trim().length, `${lang} ${k}`).toBeGreaterThan(0); expect(claimsEntitlement(json[k]), `${lang} ${k}`).toBe(false); }
      for (const name of ['RSA', 'France Travail', 'pass Culture']) expect(Object.values(json).join(' ')).toContain(name);
      // the new keys were appended at the END of the file (G14 convention)
      const order = Object.keys(json); expect(order.slice(-keys.length).sort()).toEqual([...keys].sort());
    }
    expect(languageOf('ar').dir).toBe('rtl');
  });
});
