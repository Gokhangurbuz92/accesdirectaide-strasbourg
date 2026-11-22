/**
 * FA-D6 (18/11/2026) — the Rights Graph (api/lib/rightsGraph.js): a verifiable structure GENERATED from the orientation constants (api/lib/multi-need.js),
 * the D11 register, the LEGI subset and the DILA source snapshot; provenance and uncertainty on every edge; never a decision.
 * Covers: structure, consistency (no duplicated truth), positive, negative, boundary, temporal, residence (Bas-Rhin / Alsace-Moselle / elsewhere), age,
 * overlapping / conflicting benefits, unknown conditions, contradictory sources → abstention « à vérifier », and unchanged public behaviour.
 * The cases below are the graph's reference cases (LAB, written from the fiches they cite; not expert-validated).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildRightsGraph, graphProblems, orientRights, readRight, articleVersionAt, territoryCovers, OUTCOME, SIGNALS, UNCERTAINTY, NODE_TYPES } from '../../api/lib/rightsGraph.js';
import { NEED_DEFINITIONS, CAUTION_DEFINITIONS, analyseNeeds } from '../../api/lib/multi-need.js';
import { citedByGraph } from '../../scripts/rights-graph-sources.mjs';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const register = read('data/rules/rights-rules.v1.json');
const legal = read('data/rules/legal-articles.v1.json');
const sources = read('data/rules/rights-graph-sources.v1.json');
const graph = buildRightsGraph({ register, legal, sources });
const right = (id, facts = {}, day = '2026-11-18', territory = null) => readRight(graph, register, id, { day, territory, facts });
const cond = (r, fact) => r.conditions.find((c) => c.fact === fact && !c.effectiveFrom);
const FORBIDDEN = /éligible|eligible|vous avez droit|avez droit|non applicable|vous n'avez pas droit|vous recevrez|montant estimé/i;

describe('structure and provenance', () => {
  it('every edge has known endpoints, a known type, an uncertainty and a provenance origin; every node a known type', () => {
    expect(graphProblems(graph)).toEqual([]);
    for (const e of graph.edges) {
      expect(Object.values(UNCERTAINTY)).toContain(e.uncertainty);
      expect(e.provenance.origin).toMatch(/^(api|data)\//);
      expect(Array.isArray(e.provenance.sources)).toBe(true);
    }
    for (const n of Object.values(graph.nodes)) expect(NODE_TYPES).toContain(n.type);
  });
  it('the graph is immutable (read-only for the orientation and diagnostic paths)', () => {
    expect(Object.isFrozen(graph)).toBe(true); expect(Object.isFrozen(graph.edges)).toBe(true); expect(Object.isFrozen(graph.edges[0])).toBe(true);
    expect(Object.isFrozen(NEED_DEFINITIONS)).toBe(true); expect(Object.isFrozen(NEED_DEFINITIONS[0].actions)).toBe(true);
  });
  it('every DILA source node carries its version (dates) and the archive it was read in; every LEGI node its LEGIARTI id and in-force window', () => {
    for (const n of Object.values(graph.nodes).filter((x) => x.type === 'source' && x.kind === 'dila_fiche')) {
      expect(n.present, n.id).toBe(true);
      expect(n.version, n.id).toHaveProperty('modifiedAt');
      expect(n.readAt).toBe('2026-11-18');
      expect(n.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const legi = Object.values(graph.nodes).filter((x) => x.kind === 'legiarti' || x.kind === 'legitext');
    expect(legi.filter((x) => x.kind === 'legiarti').length).toBeGreaterThan(50);
    for (const n of legi) { expect(n.legiarti).toMatch(n.kind === 'legiarti' ? /^LEGIARTI\d{12}$/ : /^LEGITEXT\d{12}$/); expect(n.dateDebut).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(n.url).toMatch(/^https:\/\/www\.legifrance\.gouv\.fr\//); }
  });
});

describe('generated from the orientation constants and the register — no duplicated truth', () => {
  it('one need node per orientation need, same label and priority; one CITES edge per cited fiche', () => {
    const needs = Object.values(graph.nodes).filter((n) => n.type === 'need');
    expect(needs.map((n) => n.needId).sort()).toEqual(NEED_DEFINITIONS.map((n) => n.id).sort());
    for (const d of NEED_DEFINITIONS) {
      const n = graph.nodes[`need:${d.id}`];
      expect([n.label, n.priority]).toEqual([d.label, d.priority]);
      expect(graph.edges.filter((e) => e.type === 'CITES' && e.from === n.id).map((e) => e.to)).toEqual(d.sheets.map((s) => `source:dila:${s}`));
      expect(graph.edges.filter((e) => e.type === 'NEXT_ACTION' && e.from === n.id).map((e) => graph.nodes[e.to].text)).toEqual(d.actions);
    }
  });
  it('need → right edges exist exactly where the need cites a fiche the register reads the right on', () => {
    const expected = new Set();
    for (const d of NEED_DEFINITIONS) for (const r of register.rights) if (r.sources.some((s) => d.sheets.some((f) => s.url.endsWith(`/${f}`)))) expected.add(`${d.id}->${r.id}`);
    const got = new Set(graph.edges.filter((e) => e.type === 'MAY_CONCERN' && e.to.startsWith('right:')).map((e) => `${e.from.slice(5)}->${e.to.slice(6)}`));
    expect(got).toEqual(expected);
    expect([...got].sort()).toEqual(['aide-domicile->apa', 'aides-logement->apl', 'minima-sociaux->rsa']);
  });
  it('every register right and condition is a node; every caution doubt points at an existing condition', () => {
    for (const r of register.rights) for (const c of r.conditions) expect(graph.nodes[`condition:${r.id}:${c.fact}`], `${r.id}.${c.fact}`).toBeTruthy();
    for (const c of CAUTION_DEFINITIONS) for (const d of c.doubts) expect(graph.nodes[`condition:${d.right}:${d.fact}`], `${c.id}`).toBeTruthy();
    expect(graph.edges.filter((e) => e.type === 'DOUBTS').length).toBe(CAUTION_DEFINITIONS.reduce((n, c) => n + c.doubts.length, 0));
  });
  it('the source snapshot covers exactly what the graph cites, every fiche is present and every quoted sentence was found (re-run scripts/rights-graph-sources.mjs)', () => {
    const cited = citedByGraph(register);
    expect(sources.fiches.map((f) => f.id)).toEqual(cited.fiches);
    expect(sources.quotes.map((q) => `${q.where}|${q.quote}`)).toEqual(cited.quotes.map((q) => `${q.where}|${q.quote}`));
    expect(sources.fiches.filter((f) => !f.present || f.redirectedTo)).toEqual([]);
    expect(sources.quotes.filter((q) => !q.found)).toEqual([]);
  });
});

describe('public behaviour unchanged', () => {
  it('analyseNeeds answers keep their shape (no graph field, cautions without doubts)', () => {
    const r = analyseNeeds(['sans papiers, à la rue, j’ai 22 ans et pas de revenus'], { now: new Date('2026-11-18T12:00:00Z') });
    expect(Object.keys(r).sort()).toEqual(['cautions', 'multi', 'needs', 'questions']);
    for (const c of r.cautions) expect(Object.keys(c).sort()).toEqual(['aides', 'id', 'sheets', 'text']);
    for (const n of r.needs) expect(Object.keys(n).sort()).toEqual(['actions', 'id', 'label', 'numbers', 'rules', 'sheets', 'topic', 'urgent']);
  });
  it('the assessment modules do not read the graph', () => {
    for (const f of ['api/lib/assessmentContract.js', 'api/lib/diagnosticAssessment.js', 'api/_handlers/search.js', 'api/_handlers/diagnostic.js']) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/rightsGraph/);
  });
});

describe('positive / negative — never a decision', () => {
  it('positive: low resources at 40 in Paris → RSA « piste à vérifier », decided by the Caf, entitlement false, no amount', () => {
    const o = orientRights(graph, register, { needs: ['minima-sociaux'], date: '2026-11-18', territory: '75011', answers: { birthDate: '1986-03-02' } });
    const rsa = o.results[0].rights[0];
    expect([rsa.right, rsa.outcome, rsa.signal, rsa.entitlement, rsa.amount]).toEqual(['rsa', OUTCOME, SIGNALS.PISTE, false, null]);
    expect(cond(rsa, 'age').result).toBe('MET');
    expect(rsa.decidedBy).toContain('Caf');
    expect(rsa.reasons).toContain('CONDITIONS_UNKNOWN');
    expect(rsa.sources[0]).toMatchObject({ ficheId: 'F19778', pageVerifiedOn: '2026-04-01' });
    expect(o).toMatchObject({ entitlement: false, amount: null, outcome: OUTCOME });
  });
  it('negative: APA at 45 → a condition not met per the answers, still « à vérifier » (CONDITION_EN_DOUTE), never « non éligible »', () => {
    const apa = right('apa', { ageRange: [45, 45] });
    expect([apa.outcome, apa.signal]).toEqual([OUTCOME, SIGNALS.CONDITION_EN_DOUTE]);
    expect(cond(apa, 'age').result).toBe('NOT_MET');
    expect(apa.reasons).toContain('CONDITION_NOT_MET_PER_ANSWERS');
  });
  it('no output says or implies a right', () => {
    const all = orientRights(graph, register, { needs: NEED_DEFINITIONS.map((n) => n.id), date: '2026-11-18', territory: '67000', answers: { birthDate: '2001-01-01' } });
    const ids = register.rights.map((r) => right(r.id, { ageRange: [30, 30] }));
    expect(JSON.stringify(all)).not.toMatch(FORBIDDEN);
    expect(JSON.stringify(ids)).not.toMatch(FORBIDDEN);
    for (const r of ids) expect([r.outcome, r.entitlement, r.amount]).toEqual([OUTCOME, false, null]);
  });
});

describe('boundaries and age (computed at the query date)', () => {
  const apaOn = (day) => cond(readRight(graph, register, 'apa', { day, facts: { ageRange: ageAt('1966-11-18', day) } }), 'age').result;
  function ageAt(b, day) { const [y, m, d] = b.split('-').map(Number); const [Y, M, D] = day.split('-').map(Number); const a = Y - y - (M < m || (M === m && D < d) ? 1 : 0); return [a, a]; }
  it('APA: 59 the day before the 60th birthday (NOT_MET), 60 on the day (MET)', () => {
    expect(apaOn('2026-11-17')).toBe('NOT_MET'); expect(apaOn('2026-11-18')).toBe('MET');
  });
  it('the same answers read on two dates give two ages (orientRights computes the age at its date)', () => {
    const at = (date) => cond(orientRights(graph, register, { needs: ['aide-domicile'], date, answers: { birthDate: '1966-11-18' } }).results[0].rights[0], 'age').result;
    expect(at('2026-11-17')).toBe('NOT_MET'); expect(at('2026-11-18')).toBe('MET');
  });
  it('C2S resources (metropole, ameli.fr « au 1er avril 2026 »): 10 421 MET, 14 069 MET, 14 070 NOT_MET; 2 persons 12 000 MET (G14); no declared basis UNKNOWN', () => {
    const c2s = (n, hh = 1, basis = 'ressources-foyer-12-mois-c2s') => cond(right('c2s', { annualResources: n, householdSize: hh, area: 'metropole', resourcesBasis: basis }), 'resources').result;
    expect([c2s(10421), c2s(14069), c2s(14070), c2s(12000, 2), c2s(9000, 1, null)]).toEqual(['MET', 'MET', 'NOT_MET', 'MET', 'UNKNOWN']);
  });
  it('FAJ: 15 NOT_MET, 16 MET, 25 UNKNOWN (inclusion of 25 not stated), 26 NOT_MET; prime d\'activité 17 / 18', () => {
    const faj = (a) => cond(right('faj-strasbourg', { ageRange: [a, a] }), 'age').result;
    expect([faj(15), faj(16), faj(25), faj(26)]).toEqual(['NOT_MET', 'MET', 'UNKNOWN', 'NOT_MET']);
    const pa = (a) => cond(right('prime-activite', { ageRange: [a, a] }), 'age').result;
    expect([pa(17), pa(18)]).toEqual(['NOT_MET', 'MET']);
  });
});

describe('temporal — the rule changes with the date', () => {
  it('trêve hivernale: in force on 18/11/2026, not on 15/06/2026; Paris calendar at both ends', () => {
    const rule = (date) => orientRights(graph, register, { needs: ['expulsion-impayes'], date }).results[0].rules[0].inForce;
    expect(rule(new Date('2026-11-18T10:00:00Z'))).toBe(true);
    expect(rule(new Date('2026-06-15T10:00:00Z'))).toBe(false);
    expect(rule(new Date('2026-10-31T23:30:00Z'))).toBe(true);    // 1 Nov 00:30 Paris
    expect(rule(new Date('2027-03-31T22:30:00Z'))).toBe(false);   // 1 Apr 00:30 Paris
    expect(graph.nodes['rule:expulsion-impayes:0'].window).toMatchObject({ from: '11-01', to: '03-31', timeZone: 'Europe/Paris' });
  });
  it('APL: the non-EU student rule is « à venir » on 30/06/2026 and in force from 01/07/2026 (F12006 « Depuis le 1er juillet 2026 »)', () => {
    const part = (day) => right('apl', {}, day).conditions.find((c) => c.effectiveFrom === '2026-07-01');
    expect(part('2026-06-30')).toMatchObject({ result: 'A_VENIR', inForce: false });
    expect(part('2026-07-01')).toMatchObject({ result: 'UNKNOWN', inForce: true });
  });
  it('ARE: the primo-entrant affiliation rule applies from 01/04/2026 (F38881 « À compter du 1er avril 2026 »)', () => {
    const part = (day) => right('are', {}, day).conditions.find((c) => c.effectiveFrom === '2026-04-01');
    expect(part('2026-03-31').inForce).toBe(false); expect(part('2026-04-01').inForce).toBe(true);
  });
  it('LEGI: the version of CASF L262-2 in force depends on the date', () => {
    const a = graph.nodes['source:legi:LEGIARTI000031087764'];
    expect(articleVersionAt(a, '2026-11-18').id).toBe('LEGIARTI000031087764');
    expect(articleVersionAt(a, '2010-01-01').id).toBe('LEGIARTI000019869118');
    expect(articleVersionAt(a, '1999-01-01')).toBeNull();
    const rsa1999 = right('rsa', { ageRange: [40, 40] }, '1999-01-01');
    expect(rsa1999.legalBasis.find((l) => l.num === 'L262-2').inForce).toBe(false);
  });
});

describe('residence — Bas-Rhin, Alsace-Moselle, elsewhere', () => {
  it('FAJ (Eurométropole): 67000 commune to check, 68100 (Haut-Rhin) and 57000 (Moselle) and 75011 outside the declared territory — still « à vérifier », unreadable code unknown', () => {
    const t = (code) => right('faj-strasbourg', { ageRange: [20, 20], territory: code }, '2026-11-18', code);
    expect(t('67000').territoryResult).toBe('COMMUNE_A_VERIFIER');
    for (const c of ['68100', '57000', '75011']) { const r = t(c); expect(r.territoryResult, c).toBe('HORS_TERRITOIRE_DECLARE'); expect([r.outcome, r.signal]).toEqual([OUTCOME, SIGNALS.CONDITION_EN_DOUTE]); }
    expect(t('abc').territoryResult).toBe('TERRITOIRE_INCONNU');
  });
  it('Alsace-Moselle: the three départements (F1121), never Paris; a national right read there keeps « exceptions de droit local non vérifiées »', () => {
    expect(['67000', '68100', '57000', '67'].map((c) => territoryCovers('alsace-moselle', c))).toEqual([true, true, true, true]);
    expect(territoryCovers('alsace-moselle', '75011')).toBe(false); expect(territoryCovers('alsace-moselle', 'x')).toBeNull();
    expect(right('rsa', { ageRange: [40, 40] }, '2026-11-18', '57000').reasons).toContain('ALSACE_MOSELLE_EXCEPTIONS_NOT_CHECKED');
    expect(right('rsa', { ageRange: [40, 40] }, '2026-11-18', '75011').reasons).not.toContain('ALSACE_MOSELLE_EXCEPTIONS_NOT_CHECKED');
  });
  it('faillite civile (F134, habitants d\'Alsace-Moselle): shown in Strasbourg, Mulhouse and Metz, not in Paris; unknown territory stays shown with a reason', () => {
    const aid = (territory) => orientRights(graph, register, { needs: ['surendettement'], date: '2026-11-18', territory }).results[0].aids.find((a) => a.aid === 'faillite-civile');
    for (const c of ['67000', '68100', '57000']) expect(aid(c).shown, c).toBe(true);
    expect(aid('75011')).toMatchObject({ shown: false, reasons: ['HORS_TERRITOIRE'] });
    expect(aid(null)).toMatchObject({ shown: true, reasons: ['TERRITOIRE_INCONNU'] });
  });
});

describe('overlapping and conflicting benefits', () => {
  it('APA and PCH cannot be received together (F10009); both stay « à vérifier »', () => {
    const o = orientRights(graph, register, { needs: ['aide-domicile', 'adaptation-logement'], date: '2026-11-18', answers: { birthDate: '1950-01-01' } });
    const apa = o.results[0].rights.find((r) => r.right === 'apa');
    expect(apa.interactions).toEqual([expect.objectContaining({ id: 'apa-pch-non-cumul', type: 'EXCLUSIVE_WITH', with: 'aid:pch' })]);
    expect(o.results[1].aids.find((a) => a.aid === 'pch').interactions[0].id).toBe('apa-pch-non-cumul');
  });
  it('ALS only when neither APL nor ALF (F1280); RSA brings C2S automatically unless refused (F10027); one of surendettement / faillite civile recommended (F134)', () => {
    const housing = orientRights(graph, register, { needs: ['aides-logement'], date: '2026-11-18' }).results[0];
    expect(housing.aids.find((a) => a.aid === 'als').interactions[0]).toMatchObject({ id: 'als-subsidiaire-apl', type: 'SUBSIDIARY_TO', with: 'right:apl' });
    expect(right('rsa', { ageRange: [40, 40] }).interactions).toContainEqual(expect.objectContaining({ id: 'rsa-c2s-automatique', type: 'AUTOMATIC_WITH', with: 'right:c2s' }));
    const debt = orientRights(graph, register, { needs: ['surendettement'], date: '2026-11-18', territory: '67000' }).results[0];
    expect(debt.aids.find((a) => a.aid === 'surendettement').interactions[0]).toMatchObject({ id: 'surendettement-faillite-civile', type: 'ONE_RECOMMENDED' });
  });
  it('the orientation cautions are tied to the conditions they put in doubt (no permit → APL / RSA nationality; under 25 → RSA age)', () => {
    expect(right('apl').cautions).toEqual(expect.arrayContaining([{ caution: 'permit-housing-aid', fact: 'nationality' }, { caution: 'no-home-housing-aid', fact: 'housing.status' }]));
    expect(right('rsa', { ageRange: [40, 40] }).cautions).toEqual(expect.arrayContaining([{ caution: 'under-25-rsa', fact: 'age' }, { caution: 'permit-rsa', fact: 'nationality' }]));
  });
});

describe('unknown conditions and contradictory sources → abstention « à vérifier »', () => {
  it('no answers: every condition UNKNOWN, still a « piste à vérifier » for a national right, never a refusal', () => {
    const r = right('prime-activite');
    expect(r.conditions.filter((c) => !c.effectiveFrom).every((c) => c.result === 'UNKNOWN')).toBe(true);
    expect([r.outcome, r.signal]).toEqual([OUTCOME, SIGNALS.PISTE]);
  });
  it('unknown need / unknown right: abstention', () => {
    expect(orientRights(graph, register, { needs: ['nope'] }).results[0]).toMatchObject({ known: false, signal: SIGNALS.ABSTENTION, reasons: ['UNKNOWN_NEED'] });
    expect(right('nope')).toMatchObject({ signal: SIGNALS.ABSTENTION, reasons: ['UNKNOWN_RIGHT'], outcome: OUTCOME });
  });
  it('RSA jeune actif: F286 (18-25 / 16-25) and N19775 (18-24) disagree → abstention for 16-25 and for an unknown age, not at 40', () => {
    for (const a of [16, 20, 24, 25]) { const r = right('rsa', { ageRange: [a, a] }); expect(r.signal, String(a)).toBe(SIGNALS.ABSTENTION); expect(cond(r, 'activity_young').result).toBe('CONTRADICTORY'); expect(r.reasons).toContain('CONTRADICTORY_SOURCES'); }
    expect(right('rsa').signal).toBe(SIGNALS.ABSTENTION);
    expect(right('rsa', { ageRange: [26, 26] }).signal).toBe(SIGNALS.PISTE);
    expect(right('rsa', { ageRange: [40, 40] }).signal).toBe(SIGNALS.PISTE);
    const conflictEdges = graph.edges.filter((e) => e.uncertainty === UNCERTAINTY.CONTRADICTOIRE && e.type === 'SOURCED_BY');
    expect(conflictEdges.map((e) => e.to).sort()).toEqual(['source:dila:F286', 'source:dila:F286', 'source:dila:N19775']);
  });
  it('the D11 gate is untouched: no right is expert-validated; source-checked rights stay EXPERT_REVIEW_PENDING', () => {
    for (const r of register.rights) {
      expect(r.status).toBe('RESEARCHED_UNVALIDATED');
      expect(graph.nodes[`right:${r.id}`].reviewState).toBe('EXPERT_REVIEW_PENDING');
      expect(graph.nodes[`right:${r.id}`].expertValidated).toBe(false);
    }
  });
});

describe('D11 source check of 18/11/2026 (SOURCE_CHECKED, EXPERT_REVIEW_PENDING)', () => {
  it('every right records its source check: live page date unchanged or undated, DILA archive dates, legal basis in force, no item failing', () => {
    for (const r of register.rights) {
      const s = r.sourceCheck;
      expect([s.result, s.reviewState, s.checkedAt], r.id).toEqual(['SOURCE_CHECKED', 'EXPERT_REVIEW_PENDING', '2026-11-18']);
      expect(s.kind).toMatch(/pas une relecture d'expert/);
      for (const p of s.pages) {
        expect(p.http, p.url).toBe(200);
        expect(['UNCHANGED', 'NO_DATE_ON_PAGE']).toContain(p.liveVerdict);
        if (p.id) expect(p.pageVerifiedOnLive).toBe(r.sources.find((x) => x.url === p.url).pageVerifiedOn);
      }
      expect(Object.keys(s.formItems).filter((v) => !['TEXT_CONFIRMED', 'METADATA_UNCHANGED', 'NOT_MACHINE_CHECKABLE', 'LIVE_PAGE_CONFIRMED', 'NO_ARCHIVE_SOURCE'].includes(v)), r.id).toEqual([]);
      expect(s.legalBasis.inForce, r.id).toBe(s.legalBasis.articlesOrTexts);
      expect(s.legalBasis.unresolved).toEqual([]);
    }
    const ev = read('docs/rules/D11_SOURCE_CHECK_2026-11-18.json');
    expect(ev.assert.items).toBe(85);
    expect(ev.assert.archive.sha256).toBe(sources.archive.sha256);
    expect(legal.referenceDate).toBe(ev.assert.referenceDate);
  });
});
