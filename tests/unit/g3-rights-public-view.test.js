/**
 * G3 (19/11/2026) — the public sub-graph of the Rights Graph (api/lib/rightsPublicView.js → data/reference/rights-public-view.v1.json), shown by /droits.
 * Owner decision C4 (18/11/2026): no D11 rule node or edge and no condition text may reach it. The committed JSON must be the generator's output.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadRightsGraph, graphProblems } from '../../api/lib/rightsGraph.js';
import { publicRightsView, CONDITION_SENTENCE, EXCLUDED_NODE_TYPES } from '../../api/lib/rightsPublicView.js';
import { NEED_DEFINITIONS, CAUTION_DEFINITIONS } from '../../api/lib/multi-need.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { OFFICIAL_TOOLS } from '../../src/config/officialTools.js';
import { renderPublicView, OUT } from '../../scripts/rights-public-view.mjs';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const committed = fs.readFileSync(OUT, 'utf8');
const view = JSON.parse(committed);
const { graph, register } = loadRightsGraph();
/** every string value of a JSON value */
const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const keys = (v) => (Array.isArray(v) ? v.flatMap(keys) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

describe('G3 public rights view — generated from the graph', () => {
  it('the committed file is exactly what scripts/rights-public-view.mjs generates (no hand edit, no stale data)', () => {
    expect(committed).toBe(renderPublicView());
    expect(graphProblems(graph)).toEqual([]);
  });

  it('has every need of the orientation, in its order, with its own label, topic and numbers', () => {
    const byPriority = [...NEED_DEFINITIONS].sort((a, b) => a.priority - b.priority);
    expect(view.needs.map((n) => n.id)).toEqual(byPriority.map((n) => n.id));
    for (const n of view.needs) {
      const def = NEED_DEFINITIONS.find((d) => d.id === n.id);
      expect(n.label).toBe(def.label); expect(n.topic).toBe(def.topic); expect(n.numbers).toEqual(def.numbers);
      expect(n.fiches.map((f) => f.id)).toEqual(def.sheets);
    }
  });
});

describe('G3 public rights view — C4: no D11 rule, no condition', () => {
  it('the full graph DOES hold D11 rights, conditions, legal bases, decision bodies and cautions (so the exclusions below are tested on real data)', () => {
    const types = new Set(Object.values(graph.nodes).map((n) => n.type));
    for (const t of EXCLUDED_NODE_TYPES) expect(types.has(t), t).toBe(true);
    expect(graph.edges.some((e) => e.type === 'MAY_CONCERN' && e.to.startsWith('right:'))).toBe(true);
    expect(graph.edges.some((e) => e.type === 'HAS_CONDITION')).toBe(true);
  });

  it('no node id, edge type or origin of the D11 register, the LEGI subset or the cautions appears anywhere in the view', () => {
    for (const bad of ['right:', 'condition:', 'caution:', 'actor:', 'source:legi', 'LEGIARTI', 'LEGITEXT', 'rights-rules', 'legal-articles', 'HAS_CONDITION', 'LEGAL_BASIS', 'DECIDED_BY', 'potential_right', 'reviewState', 'EXPERT']) {
      const hits = strings({ ...view, excluded: null, statement: null }).filter((s) => s.includes(bad));
      expect(hits, bad).toEqual([]);
    }
    for (const k of ['conditions', 'condition', 'legalBasis', 'decidedBy', 'cautions', 'signal', 'outcome', 'entitlement', 'amount', 'quotes']) expect(keys(view), k).not.toContain(k);
  });

  it('no condition text of the register (conditions, dated parts, source conflicts, notes) and no caution text appears in the view', () => {
    const texts = strings({ ...view, excluded: null, statement: null }).join('\n');
    const forbidden = [];
    for (const r of register.rights) {
      for (const c of r.conditions) {
        forbidden.push(c.text);
        for (const p of c.datedParts || []) forbidden.push(p.text, p.quote);
      }
      for (const k of r.conflicts || []) for (const s of k.sources) forbidden.push(s.quote);
    }
    for (const c of CAUTION_DEFINITIONS) forbidden.push(c.text);
    const real = forbidden.filter((x) => typeof x === 'string' && x.trim().length > 12);
    expect(real.length).toBeGreaterThan(30);
    for (const f of real) expect(texts.includes(f), f).toBe(false);
  });

  it('every advice sentence shown is the orientation’s own (nothing invented) and states no condition of access; the others are counted, not shown', () => {
    let omitted = 0;
    for (const n of view.needs) {
      const def = NEED_DEFINITIONS.find((d) => d.id === n.id);
      for (const a of n.actions) { expect(def.actions).toContain(a.text); expect(CONDITION_SENTENCE.test(a.text), a.text).toBe(false); }
      expect(n.actions.length + n.omittedActions).toBe(def.actions.length);
      for (const r of n.rules) expect(CONDITION_SENTENCE.test(r.text), r.text).toBe(false);
      omitted += n.omittedActions;
    }
    expect(omitted).toBe(view.excluded.omittedActions);
    // the detector itself: sentences of the orientation that state a condition are caught
    for (const s of ['sous conditions de ressources', 'les enfants mineurs y ont droit sans délai', 'des jeunes de 16 à 25 ans', 'c’est la condition pour une allocation chômage', 'reconnues éligibles par la commission',
      'après plus de 3 mois de résidence en France', 'Un salarié peut prendre un congé']) expect(CONDITION_SENTENCE.test(s), s).toBe(true);
    for (const s of ['Appelez le 115', 'Le FSL peut aider à payer une dette de loyer (fiche F1334).']) expect(CONDITION_SENTENCE.test(s), s).toBe(false);
  });

  it('never claims that a person has a right (entitlement guard over every string of the view)', () => {
    for (const s of strings(view)) expect(claimsEntitlement(s), s).toBe(false);
  });

  it('a graph with an extra D11 right reachable from a need still gives no right in the public view (exclusion by construction, not by data)', () => {
    const nodes = { ...graph.nodes, 'right:test': { id: 'right:test', type: 'potential_right', rightId: 'test', label: 'Droit de test' },
      'condition:test:age': { id: 'condition:test:age', type: 'condition', text: 'Avoir entre 18 et 24 ans' } };
    const edges = [...graph.edges, { type: 'MAY_CONCERN', from: 'need:minima-sociaux', to: 'right:test', uncertainty: 'a_verifier', provenance: { origin: 'test' } },
      { type: 'HAS_CONDITION', from: 'right:test', to: 'condition:test:age', uncertainty: 'a_verifier', provenance: { origin: 'test' } }];
    const v = publicRightsView({ ...graph, nodes, edges }, { offices: read('data/reference/guide-offices.v1.json'), guides: read('data/reference/published-guides.v1.json') });
    expect(JSON.stringify(v)).not.toMatch(/Droit de test|Avoir entre 18 et 24 ans|right:test/);
  });
});

describe('G3 public rights view — sources, freshness, links', () => {
  it('every fiche is an official Service-Public page present in the archive, not redirected, with the archive read date', () => {
    const all = [...view.needs.flatMap((n) => n.fiches), ...view.aidFiches];
    expect(all.length).toBeGreaterThan(30);
    for (const f of all) {
      expect(f.url).toBe(`https://www.service-public.gouv.fr/particuliers/vosdroits/${f.id}`);
      expect(f.present, f.id).toBe(true); expect(f.redirectedTo).toBeNull(); expect(f.title).toBeTruthy();
      expect(f.readAt).toBe(view.sourcesReadAt);
      if (f.localGuide) expect(f.localGuide.endsWith(`-${f.id.toLowerCase()}`)).toBe(true);
    }
    for (const n of view.needs) for (const a of n.aids) expect(view.aidFiches.map((f) => f.id)).toContain(a.sheet);
  });

  it('local guide links come only from the dated published-guides snapshot; tools only from /outils; offices from the DILA « Où s’adresser »', () => {
    const guides = read('data/reference/published-guides.v1.json');
    expect(guides.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const f of view.needs.flatMap((n) => n.fiches)) expect(f.localGuide).toBe(guides.guides[f.id] ?? null);
    const toolIds = OFFICIAL_TOOLS.map((t) => t.id);
    for (const n of view.needs) for (const id of n.tools) expect(toolIds).toContain(id);
    const offices = read('data/reference/guide-offices.v1.json');
    for (const n of view.needs) for (const o of n.offices) for (const s of o.sheets) expect(offices.sheets[s].types).toContain(o.type);
  });

  it('territory: aids carry their territory; the Alsace-Moselle procedure is marked as such with its official source', () => {
    const debts = view.needs.find((n) => n.id === 'surendettement');
    expect(debts.aids.map((a) => [a.id, a.territory])).toEqual([['surendettement', 'FR'], ['faillite-civile', 'alsace-moselle']]);
    expect(view.territories['alsace-moselle']).toMatchObject({ departements: ['57', '67', '68'], sheet: 'F1121' });
    expect(view.territories.FR).toBeTruthy();
  });

  it('uncertainty is said for every advice: etabli when it names its fiche, inconnu when no fiche at all', () => {
    for (const n of view.needs) for (const a of n.actions) expect(['etabli', 'a_verifier', 'inconnu']).toContain(a.uncertainty);
    const iso = view.needs.find((n) => n.id === 'isolement');
    expect(iso.actions.every((a) => a.uncertainty === 'inconnu')).toBe(true);
    const fsl = view.needs.find((n) => n.id === 'energie').actions.find((a) => a.text.includes('F1334'));
    expect(fsl).toMatchObject({ uncertainty: 'etabli', sources: ['F1334'] });
  });
});
