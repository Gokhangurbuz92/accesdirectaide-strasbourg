// @ts-nocheck
/**
 * G3 (19/11/2026) — the PUBLIC sub-graph of the Rights Graph (api/lib/rightsGraph.js), for the anonymous page /droits (src/pages/Droits.jsx).
 *
 * Owner decision C4 (18/11/2026): the D11 rules and their conditions are NOT published before the named expert review. So this view keeps only what the
 * orientation already publishes from official sources, and drops, by construction:
 *   - every node of the D11 register (types potential_right, condition), every caution (its text repeats a register condition), every LEGI source (reached
 *     only through LEGAL_BASIS of a register right), every actor of the graph (DECIDED_BY is read in the register's « decidedBy »), and every edge that
 *     touches one of them (MAY_CONCERN → right, HAS_CONDITION, LEGAL_BASIS, DECIDED_BY, APPLIES_IN of a right, DOUBTS, interactions with a right);
 *   - every advice sentence that states a condition of access (age, resources, residence, « sous conditions », « éligible », « ont droit »…): the person
 *     reads the conditions on the official fiche, the deciding body decides.
 * What remains: need → official fiches (CITES, with the DILA version dates and the archive read date) → advice sentences (NEXT_ACTION, with their
 * SOURCED_BY uncertainty) → official numbers (CALL) → seasonal rules (TEMPORAL_RULE: the trêve hivernale, a protection, not a condition) → aids the
 * fiches name (MAY_CONCERN → aid, APPLIES_IN territory). Plus two public, sourced lookups: the bodies the advice names (« who decides or where to ask »)
 * and the « Où s'adresser » of each fiche (data/reference/guide-offices.v1.json, DILA), which opens the structure directory on that type.
 *
 * Pure: the graph and the two reference files are passed in. Written to data/reference/rights-public-view.v1.json by scripts/rights-public-view.mjs
 * (build time): the page imports the JSON, so nothing about the visitor is ever sent (no input, no request beyond the page itself).
 */

/** node types of the graph that never reach the public view (C4) */
export const EXCLUDED_NODE_TYPES = Object.freeze(['potential_right', 'condition', 'caution', 'actor']);
/** edge types that never reach the public view (C4): they all start or end at a register right / condition, a caution or a LEGI article */
export const EXCLUDED_EDGE_TYPES = Object.freeze(['HAS_CONDITION', 'LEGAL_BASIS', 'DECIDED_BY', 'DOUBTS', 'EXCLUSIVE_WITH', 'SUBSIDIARY_TO', 'AUTOMATIC_WITH', 'ONE_RECOMMENDED']);

/**
 * A sentence that states a condition of access: it is left out of the public view (the fiche, linked, says it; the body decides).
 * Deliberately broad: a false positive only hides an advice sentence that stays on the official fiche.
 */
export const CONDITION_SENTENCE = new RegExp(`(?<!\\p{L})(?:${[
  'conditions?', '[ée]ligibles?', '(?:ont|avez|a|aurez) droit', '\\d+\\s*(?:à|a|-)\\s*\\d+\\s*ans', '\\d+\\s*ans', 'âg[ée]e?s? de', 'ressources', 'résidence', 'salarié(?:e|s|es)?',
  'titre de séjour', 'revenus?', 'plafonds?',
].join('|')})(?!\\p{L})`, 'iu');

/**
 * Bodies the advice names: who decides, or where to ask. Official names (French), recognised in the advice sentences of a need.
 * Not the graph's ACTORS (those are read in the D11 register's « decidedBy »: excluded).
 */
export const BODIES = Object.freeze([
  ['caf', 'Caf (Caisse d’allocations familiales)', /\bCaf\b/u],
  ['msa', 'MSA (Mutualité sociale agricole)', /\bMSA\b/u],
  ['assurance-maladie', 'Assurance maladie (CPAM)', /\bCPAM\b|Assurance maladie/u],
  ['mdph', 'MDPH (maison départementale des personnes handicapées)', /\bMDPH\b/u],
  ['france-travail', 'France Travail', /France Travail/u],
  ['departement', 'Département (dans le Bas-Rhin : Collectivité européenne d’Alsace)', /services du département|relève du département|Le département\b|Collectivité européenne d[’']Alsace/u],
  ['eurometropole', 'Eurométropole de Strasbourg', /Eurométropole/u],
  ['banque-de-france', 'Banque de France', /Banque de France/u],
  ['ccas', 'CCAS (centre communal d’action sociale)', /\bCCAS\b/u],
  ['maison-solidarites', 'Maison des solidarités', /Maisons? des solidarités/u],
  ['france-services', 'Espace France services', /France services/iu],
  ['mairie', 'Mairie', /\bmairie\b/iu],
  ['france-renov', 'France Rénov’', /France Rénov/u],
  ['samu-social', 'Samu social (115)', /\b115\b/u],
]);

/** official online services of /outils (src/config/officialTools.js ids) relevant to a need: links only, AccesDirectAide computes nothing */
export const NEED_TOOLS = Object.freeze({
  'minima-sociaux': ['mes-droits-sociaux', 'caf-demarches'],
  'aides-logement': ['caf-demarches', 'mes-droits-sociaux'],
  'expulsion-impayes': ['caf-demarches'],
  'prestations-familiales': ['caf-demarches', 'mes-droits-sociaux'],
  'garde-enfants': ['caf-demarches'],
  'scolarite-inclusive': ['caf-demarches'],
  'adaptation-logement': ['mes-aides-reno'],
  'recherche-emploi': ['mes-droits-sociaux'],
  'acces-aux-droits': ['annuaire-administration', 'mes-droits-sociaux'],
  'sortie-ase': ['1jeune1solution', 'logement-social'],
  'droits-sans-titre': ['annuaire-administration'],
  'mdph-droits': ['annuaire-administration'],
});

const ficheOf = (nodeId) => (String(nodeId).startsWith('source:dila:') ? String(nodeId).slice('source:dila:'.length) : null);

/**
 * @param {ReturnType<import('./rightsGraph.js').buildRightsGraph>} graph
 * @param {{ offices?: any, guides?: any }} [refs] offices = data/reference/guide-offices.v1.json, guides = data/reference/published-guides.v1.json
 */
export function publicRightsView(graph, { offices = null, guides = null } = {}) {
  const nodes = graph.nodes;
  const from = (id, type) => graph.edges.filter((e) => e.from === id && e.type === type);
  const localGuide = (id) => (guides?.guides && typeof guides.guides[id] === 'string' ? guides.guides[id] : null);
  const fiche = (id) => {
    const n = nodes[`source:dila:${id}`];
    return { id, title: n?.title ?? null, url: n?.url ?? `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}`, present: n?.present ?? null, redirectedTo: n?.redirectedTo ?? null,
      importantChangeAt: n?.version?.importantChangeAt ?? null, modifiedAt: n?.version?.modifiedAt ?? null, readAt: n?.readAt ?? null, localGuide: localGuide(id) };
  };
  const needs = Object.values(nodes).filter((n) => n.type === 'need').sort((a, b) => a.priority - b.priority).map((n) => {
    const nid = n.id;
    const cites = from(nid, 'CITES');
    const fiches = cites.map((e) => ({ ...fiche(ficheOf(e.to)), uncertainty: e.uncertainty }));
    const allActions = from(nid, 'NEXT_ACTION').map((e) => {
      const a = nodes[e.to];
      const src = from(e.to, 'SOURCED_BY');
      const explicit = src.filter((s) => s.provenance.explicit === true).map((s) => ficheOf(s.to)).filter(Boolean);
      // the uncertainty of the advice's official source: etabli (it names its fiche), a_verifier (backed by the need's fiches), inconnu (no fiche at all)
      const uncertainty = src.some((s) => s.uncertainty === 'inconnu') ? 'inconnu' : explicit.length ? 'etabli' : 'a_verifier';
      return { text: a.text, sources: explicit.length ? explicit : src.map((s) => ficheOf(s.to)).filter(Boolean), uncertainty };
    });
    const actions = allActions.filter((a) => !CONDITION_SENTENCE.test(a.text));
    const rules = from(nid, 'TEMPORAL_RULE').map((e) => { const r = nodes[e.to]; return { text: r.text, sheet: r.sheet, window: r.window ? { from: r.window.from, to: r.window.to, timeZone: r.window.timeZone } : null }; })
      .filter((r) => !CONDITION_SENTENCE.test(r.text));
    const numbers = from(nid, 'CALL').map((e) => nodes[e.to].label);
    const aids = from(nid, 'MAY_CONCERN').filter((e) => e.to.startsWith('aid:')).map((e) => {
      const a = nodes[e.to];
      const terr = from(e.to, 'APPLIES_IN')[0];
      const src = from(e.to, 'SOURCED_BY')[0];
      return { id: a.aidId, label: a.label, sheet: ficheOf(src?.to), territory: terr ? terr.to.slice('territory:'.length) : 'FR', territoryUncertainty: terr?.uncertainty ?? 'inconnu', uncertainty: e.uncertainty };
    });
    // bodies named by the advice (all its sentences: a body's name states no condition), then the « Où s'adresser » of the fiches
    const said = allActions.map((a) => a.text).join('\n');
    const bodies = BODIES.filter(([, , re]) => re.test(said)).map(([id, label]) => ({ id, label }));
    const officeTypes = new Map();
    for (const f of fiches) for (const type of offices?.sheets?.[f.id]?.types || []) (officeTypes.get(type) || officeTypes.set(type, []).get(type)).push(f.id);
    return {
      id: n.needId, label: n.label, priority: n.priority, urgent: n.urgent, topic: n.topic, numbers, fiches, actions, omittedActions: allActions.length - actions.length, rules, aids, bodies,
      offices: [...officeTypes].map(([type, sheets]) => ({ type, sheets })), tools: [...(NEED_TOOLS[n.needId] || [])],
    };
  });
  // aid fiches not cited by their need (PCH F14202 is; F134 is): resolved too, so every link the page shows has its dates
  const aidFiches = [...new Set(needs.flatMap((x) => x.aids.map((a) => a.sheet)).filter(Boolean))].map(fiche);
  const usedTerritories = new Set(['FR', ...needs.flatMap((x) => x.aids.map((a) => a.territory))]);
  const territories = Object.fromEntries(Object.values(nodes).filter((t) => t.type === 'territory' && usedTerritories.has(t.id.slice('territory:'.length))).map((t) => {
    const src = from(t.id, 'SOURCED_BY')[0];
    return [t.id.slice('territory:'.length), { label: t.label, departements: t.departements ? [...t.departements] : null, sheet: ficheOf(src?.to), quote: src?.provenance?.quote ?? null }];
  }));
  return {
    schema: 'ADA_RIGHTS_PUBLIC_VIEW_V1',
    statement: 'Public sub-graph of api/lib/rightsGraph.js: needs, official fiches, advice, numbers, seasonal rules, aids and their territory. No D11 rule, no condition (owner decision C4, 18/11/2026). Generated by scripts/rights-public-view.mjs; do not edit.',
    graphSchema: graph.schema, sourcesReadAt: graph.sourcesReadAt, officesBuiltAt: offices?.archiveBuiltAt ?? null, guidesCheckedAt: guides?.checkedAt ?? null,
    excluded: { nodeTypes: [...EXCLUDED_NODE_TYPES, 'source:legi'], edgeTypes: [...EXCLUDED_EDGE_TYPES], omittedActions: needs.reduce((s, x) => s + x.omittedActions, 0) },
    territories, aidFiches, needs,
  };
}
