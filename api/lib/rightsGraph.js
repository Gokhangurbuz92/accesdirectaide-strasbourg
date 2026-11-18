// @ts-nocheck
/**
 * FA-D6 (18/11/2026) — the Rights Graph as a verifiable data structure (reference 06; VISION_FINALE §1 row 1: « need→right relations are code constants »).
 *
 *   need ──CITES──▶ source (DILA fiche, with its version)            need ──NEXT_ACTION──▶ action ──SOURCED_BY──▶ source
 *   need ──MAY_CONCERN──▶ potential_right (only through a fiche both cite)   need ──CALL──▶ service (official number)
 *   need ──TEMPORAL_RULE──▶ rule (seasonal window, Paris calendar)          caution ──DOUBTS──▶ condition
 *   potential_right ──HAS_CONDITION──▶ condition ──SOURCED_BY──▶ source     potential_right ──LEGAL_BASIS──▶ source (LEGIARTI, in-force window)
 *   potential_right ──DECIDED_BY──▶ actor                                    potential_right ──APPLIES_IN──▶ territory
 *   potential_right / aid ──EXCLUSIVE_WITH | SUBSIDIARY_TO | AUTOMATIC_WITH | ONE_RECOMMENDED──▶ potential_right / aid
 *
 * NO DUPLICATED TRUTH: needs, actions, numbers, cited fiches, seasonal rules and cautions are read from the orientation constants (api/lib/multi-need.js,
 * NEED_DEFINITIONS / CAUTION_DEFINITIONS); rights, conditions, decision bodies, dated parts and source conflicts from the D11 register
 * (data/rules/rights-rules.v1.json); legal articles and their versions from the LEGI subset (data/rules/legal-articles.v1.json); fiche versions from the
 * archive snapshot (data/rules/rights-graph-sources.v1.json, written by scripts/rights-graph-sources.mjs). The only data written here are the few
 * relations no other file holds (INTERACTIONS, AIDS, TERRITORIES, ACTORS), each with the fiche and the exact sentence it was read in — the snapshot
 * script re-checks every quoted sentence against the archive.
 *
 * EVERY EDGE carries provenance { origin (file#path), sources [node ids], readAt } and an uncertainty among:
 *   etabli (an official text says it, read and dated) · a_verifier (plausible / depends on the person; the organism decides) · contradictoire (official
 *   texts disagree: both cited) · inconnu (nothing ADA can read).
 *
 * The graph NEVER decides: `orientRights` only ever answers « possible / à vérifier » (outcome A_VERIFIER, entitlement false, amount null), and abstains
 * (signal ABSTENTION) when the sources contradict each other. It is read-only: nothing user-facing reads it today; the orientation and the diagnostic
 * keep their answers (pinned by tests/unit/fa-d6-rights-graph.test.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { NEED_DEFINITIONS, CAUTION_DEFINITIONS, TREVE_HIVERNALE, inTreveHivernale, sheetUrl } from './multi-need.js';
import { readConditions, RESULTS } from './rulesDraft.js';
import { factsFromAnswers } from './validatedRules.js';
import { TERRITORY_SCOPES, territoryStatus } from './territoryScopes.js';

export const UNCERTAINTY = Object.freeze({ ETABLI: 'etabli', A_VERIFIER: 'a_verifier', CONTRADICTOIRE: 'contradictoire', INCONNU: 'inconnu' });
export const NODE_TYPES = Object.freeze(['need', 'potential_right', 'aid', 'condition', 'source', 'actor', 'service', 'territory', 'action', 'rule', 'caution']);
export const EDGE_TYPES = Object.freeze(['CITES', 'MAY_CONCERN', 'NEXT_ACTION', 'SOURCED_BY', 'CALL', 'TEMPORAL_RULE', 'DOUBTS', 'HAS_CONDITION', 'LEGAL_BASIS',
  'DECIDED_BY', 'APPLIES_IN', 'EXCLUSIVE_WITH', 'SUBSIDIARY_TO', 'AUTOMATIC_WITH', 'ONE_RECOMMENDED']);
/** the only outcome the graph ever gives: it never says a person has, or has not, a right */
export const OUTCOME = 'A_VERIFIER';
export const SIGNALS = Object.freeze({ PISTE: 'PISTE', CONDITION_EN_DOUTE: 'CONDITION_EN_DOUTE', ABSTENTION: 'ABSTENTION' });

// ------------------------------------------------------------------------------------------------ relations no other file holds (each one quoted)
/** territories; a postal code / département is matched on its first two digits (Corsica and overseas are not modelled: they stay « inconnu ») */
export const TERRITORIES = Object.freeze({
  FR: Object.freeze({ label: 'France (règle nationale)', departements: null, source: null, quote: null }),
  'alsace-moselle': Object.freeze({ label: 'Alsace-Moselle', departements: Object.freeze(['57', '67', '68']), source: 'F1121',
    quote: 'Alsace-Moselle (départements du Bas-Rhin, du Haut-Rhin et de la Moselle)' }),
  'bas-rhin': Object.freeze({ label: 'Bas-Rhin', departements: Object.freeze(['67']), source: null, quote: null }),
  // the Eurométropole: its list of communes is NOT verified (api/lib/territoryScopes.js); a Bas-Rhin postal code only says « commune à vérifier »
  ems: Object.freeze({ label: 'Eurométropole de Strasbourg', departements: TERRITORY_SCOPES['faj-strasbourg'].departmentPrefixes, source: null, quote: null, communeList: 'NOT_VERIFIED' }),
});
/** aids the orientation's fiches name that are not rights of the D11 register (no condition is modelled for them: they stay « à vérifier ») */
export const AIDS = Object.freeze({
  pch: Object.freeze({ label: 'Prestation de compensation du handicap (PCH)', sheet: 'F14202', territory: 'FR' }),
  als: Object.freeze({ label: 'Allocation de logement sociale (ALS)', sheet: 'F1280', territory: 'FR' }),
  surendettement: Object.freeze({ label: 'Dossier de surendettement (Banque de France)', sheet: 'F134', territory: 'FR' }),
  'faillite-civile': Object.freeze({ label: 'Faillite civile (Alsace-Moselle)', sheet: 'F134', territory: 'alsace-moselle',
    quote: 'engager une procédure de faillite civile spécifique aux habitants d\'Alsace-Moselle' }),
});
/** overlapping or conflicting benefits, each read in the fiche it names (DILA archive of 17/11/2026) */
export const INTERACTIONS = Object.freeze([
  Object.freeze({ id: 'apa-pch-non-cumul', type: 'EXCLUSIVE_WITH', from: 'right:apa', to: 'aid:pch', source: 'F10009',
    quotes: Object.freeze(['Il n\'est pas possible de recevoir l\'Apa lorsque l\'on reçoit au moins l\'une des prestations suivantes', 'Prestation de compensation du handicap (PCH)']) }),
  Object.freeze({ id: 'als-subsidiaire-apl', type: 'SUBSIDIARY_TO', from: 'aid:als', to: 'right:apl', source: 'F1280',
    quotes: Object.freeze(['L\'ALS est versée si vous ne pouvez prétendre ni à l\'aide personnalisée au logement (APL), ni à l\'allocation de logement familiale (ALF)']) }),
  Object.freeze({ id: 'rsa-c2s-automatique', type: 'AUTOMATIC_WITH', from: 'right:rsa', to: 'right:c2s', source: 'F10027',
    quotes: Object.freeze(['Cette attribution est automatique sauf opposition de votre part']) }),
  Object.freeze({ id: 'surendettement-faillite-civile', type: 'ONE_RECOMMENDED', from: 'aid:surendettement', to: 'aid:faillite-civile', source: 'F134', territory: 'alsace-moselle',
    quotes: Object.freeze(['il est recommandé d\'opter pour 1 seule de ces 2 procédures']) }),
]);
/** decision bodies, recognised in the register's own « decidedBy » text (an actor is named, never a local office: right ≠ service) */
export const ACTORS = Object.freeze([
  ['caf', 'Caf', /\bCaf\b/i], ['msa', 'MSA', /\bMSA\b/], ['cpam', 'CPAM (Assurance maladie)', /\bCPAM\b/], ['mdph', 'MDPH / CDAPH', /MDPH|CDAPH/],
  ['france-travail', 'France Travail', /France Travail/], ['departement', 'Département (Bas-Rhin : Collectivité européenne d\'Alsace)', /[Dd]épartement|Collectivité européenne d'Alsace/],
  ['eurometropole', 'Eurométropole de Strasbourg', /Eurométropole/], ['mission-locale', 'Mission locale', /Mission locale/],
]);
/** territory a right applies in: national unless the register says otherwise (FAJ: Eurométropole; APA: decided by the département) */
const RIGHT_TERRITORY = Object.freeze({ 'faj-strasbourg': 'ems' });

// ------------------------------------------------------------------------------------------------ helpers
const sheetIdsIn = (text) => [...String(text || '').matchAll(/\b([FN]\d{2,6})\b/g)].map((m) => m[1]);
const sheetOfUrl = (url) => (String(url || '').match(/\/vosdroits\/([FN]\d+)$/) || [])[1] || null;
const legifranceUrl = (id) => `https://www.legifrance.gouv.fr/codes/article_lc/${id}`;
const dept = (t) => { const s = String(t ?? '').trim(); return /^\d{5}$/.test(s) || /^\d{2}$/.test(s) ? s.slice(0, 2) : null; };

/** whether a territory node covers a postal code / département: true, false, or null when the code is unreadable */
export function territoryCovers(territoryId, code) {
  const t = TERRITORIES[territoryId];
  if (!t) return null;
  if (!t.departements) return dept(code) === null ? null : true;
  const d = dept(code);
  return d === null ? null : t.departements.includes(d);
}

/** the version of a LEGI article in force on `date` (YYYY-MM-DD), from its version chain; null when none */
export function articleVersionAt(article, date) {
  const chain = article.versions?.length ? article.versions : [{ id: article.legiarti, debut: article.dateDebut, fin: article.dateFin, etat: article.etat }];
  const v = chain.find((x) => x.debut && x.fin && x.debut <= date && date < x.fin && x.etat !== 'ABROGE');
  return v ? { id: v.id, debut: v.debut, fin: v.fin, etat: v.etat } : null;
}

/**
 * Builds the graph. Pure: the three data files are passed in.
 * @param {{ register: any, legal: any, sources: any }} data
 */
export function buildRightsGraph({ register, legal, sources }) {
  /** @type {Map<string, any>} */ const nodes = new Map();
  /** @type {any[]} */ const edges = [];
  const snap = new Map((sources?.fiches || []).map((f) => [f.id, f]));
  const readAt = sources?.archive?.readAt || null;
  const node = (id, type, props) => { if (!nodes.has(id)) nodes.set(id, Object.freeze({ id, type, ...props })); return id; };
  const edge = (type, from, to, uncertainty, provenance, extra = {}) => {
    edges.push(Object.freeze({ type, from, to, uncertainty, provenance: Object.freeze({ readAt, ...provenance, sources: Object.freeze([...(provenance.sources || [])]) }), ...extra }));
  };
  const fiche = (id) => {
    const f = snap.get(id);
    return node(`source:dila:${id}`, 'source', { kind: 'dila_fiche', ficheId: id, url: sheetUrl(id), title: f?.title ?? null, present: f ? f.present : null,
      redirectedTo: f?.redirectedTo ?? null, version: f ? { importantChangeAt: f.importantChangeAt ?? null, modifiedAt: f.modifiedAt ?? null } : null,
      readAt: f ? readAt : null, archiveSha256: f ? sources.archive.sha256 : null });
  };
  for (const [id, t] of Object.entries(TERRITORIES)) {
    node(`territory:${id}`, 'territory', { label: t.label, departements: t.departements, communeList: t.communeList ?? null });
    if (t.source) edge('SOURCED_BY', `territory:${id}`, fiche(t.source), UNCERTAINTY.ETABLI, { origin: `api/lib/rightsGraph.js#TERRITORIES.${id}`, sources: [`source:dila:${t.source}`], quote: t.quote });
  }

  // ---- needs (orientation constants)
  for (const n of NEED_DEFINITIONS) {
    const nid = node(`need:${n.id}`, 'need', { needId: n.id, label: n.label, priority: n.priority, urgent: n.priority <= 1, topic: n.topic });
    const origin = `api/lib/multi-need.js#CONTENT.${n.id}`;
    for (const s of n.sheets) edge('CITES', nid, fiche(s), UNCERTAINTY.ETABLI, { origin: `${origin}.sheets`, sources: [`source:dila:${s}`] });
    for (const num of n.numbers) edge('CALL', nid, node(`service:tel:${num}`, 'service', { kind: 'official_number', label: num }), UNCERTAINTY.ETABLI, { origin: `${origin}.numbers`, sources: n.sheets.map((s) => `source:dila:${s}`) });
    n.actions.forEach((text, i) => {
      const aid = node(`action:${n.id}:${i}`, 'action', { text });
      edge('NEXT_ACTION', nid, aid, UNCERTAINTY.A_VERIFIER, { origin: `${origin}.actions[${i}]`, sources: n.sheets.map((s) => `source:dila:${s}`) });
      const cited = sheetIdsIn(text);
      const backing = cited.length ? cited : n.sheets;
      for (const s of backing) edge('SOURCED_BY', aid, fiche(s), cited.length ? UNCERTAINTY.ETABLI : UNCERTAINTY.A_VERIFIER, { origin: `${origin}.actions[${i}]`, sources: [`source:dila:${s}`], explicit: cited.length > 0 });
      // an action with no fiche at all (France services, isolement) is « inconnu » as to its official source — said, not hidden
      if (!backing.length) edge('SOURCED_BY', aid, node('source:none', 'source', { kind: 'none', title: 'aucune fiche officielle citée' }), UNCERTAINTY.INCONNU, { origin: `${origin}.actions[${i}]`, sources: [] });
    });
    (n.rules || []).forEach((r, i) => {
      const rid = node(`rule:${n.id}:${i}`, 'rule', { text: r.text, sheet: r.sheet, window: r.winter ? { ...TREVE_HIVERNALE, sheets: [...TREVE_HIVERNALE.sheets] } : null });
      edge('TEMPORAL_RULE', nid, rid, UNCERTAINTY.ETABLI, { origin: `${origin}.rules[${i}]`, sources: [`source:dila:${r.sheet}`] });
      edge('SOURCED_BY', rid, fiche(r.sheet), UNCERTAINTY.ETABLI, { origin: `${origin}.rules[${i}]`, sources: [`source:dila:${r.sheet}`] });
    });
  }

  // ---- rights of the D11 register
  const byFiche = new Map();   // fiche id → right node ids that cite it
  for (const r of register.rights) {
    const rid = node(`right:${r.id}`, 'potential_right', { rightId: r.id, label: r.label, status: r.status, reviewState: r.sourceCheck?.reviewState ?? 'EXPERT_REVIEW_PENDING',
      expertValidated: r.status === 'EXPERT_VALIDATED', decidedBy: r.decidedBy, sourceCheck: r.sourceCheck ? { result: r.sourceCheck.result, checkedAt: r.sourceCheck.checkedAt } : null });
    const origin = `data/rules/rights-rules.v1.json#rights[${r.id}]`;
    const srcIds = r.sources.map((s) => {
      const f = sheetOfUrl(s.url);
      if (f) { (byFiche.get(f) || byFiche.set(f, []).get(f)).push(rid); return fiche(f); }
      return node(`source:page:${s.url}`, 'source', { kind: 'local_page', url: s.url, title: s.publisher, version: { pageVerifiedOn: s.pageVerifiedOn ?? null }, readAt: s.consultedAt ?? null });
    });
    const conflictFacts = new Map((r.conflicts || []).map((c) => [c.fact, c]));
    for (const c of r.conditions) {
      const cid = node(`condition:${r.id}:${c.fact}`, 'condition', { rightId: r.id, fact: c.fact, text: c.text, machineReadable: Boolean(c.draftCheck) });
      const conflict = conflictFacts.get(c.fact);
      const unc = conflict ? UNCERTAINTY.CONTRADICTOIRE : c.draftCheck ? UNCERTAINTY.A_VERIFIER : UNCERTAINTY.INCONNU;
      edge('HAS_CONDITION', rid, cid, unc, { origin: `${origin}.conditions[${c.fact}]`, sources: [/^[FN]\d+$/.test(c.source) ? `source:dila:${c.source}` : srcIds[0]] });
      edge('SOURCED_BY', cid, /^[FN]\d+$/.test(c.source) ? fiche(c.source) : srcIds[0], UNCERTAINTY.ETABLI, { origin: `${origin}.conditions[${c.fact}].source`, sources: [] });
      for (const [j, p] of (c.datedParts || []).entries()) {
        const pid = node(`condition:${r.id}:${c.fact}:dated:${j}`, 'condition', { rightId: r.id, fact: c.fact, text: p.text, machineReadable: false, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo ?? null });
        edge('HAS_CONDITION', rid, pid, UNCERTAINTY.INCONNU, { origin: `${origin}.conditions[${c.fact}].datedParts[${j}]`, sources: [`source:dila:${p.source}`], quote: p.quote }, { validFrom: p.effectiveFrom, validTo: p.effectiveTo ?? null });
        edge('SOURCED_BY', pid, fiche(p.source), UNCERTAINTY.ETABLI, { origin: `${origin}.conditions[${c.fact}].datedParts[${j}]`, sources: [`source:dila:${p.source}`], quote: p.quote });
      }
      if (conflict) for (const s of conflict.sources) edge('SOURCED_BY', cid, fiche(s.id), UNCERTAINTY.CONTRADICTOIRE, { origin: `${origin}.conflicts[${c.fact}]`, sources: [`source:dila:${s.id}`], quote: s.quote });
    }
    for (const a of ACTORS) if (a[2].test(String(r.decidedBy || ''))) edge('DECIDED_BY', rid, node(`actor:${a[0]}`, 'actor', { label: a[1] }), UNCERTAINTY.ETABLI, { origin: `${origin}.decidedBy`, sources: srcIds });
    const terr = RIGHT_TERRITORY[r.id] || 'FR';
    edge('APPLIES_IN', rid, `territory:${terr}`, terr === 'FR' ? UNCERTAINTY.A_VERIFIER : UNCERTAINTY.A_VERIFIER, { origin: terr === 'FR' ? `${origin} (no territorial condition in the register)` : `api/lib/territoryScopes.js#${r.id}`, sources: srcIds });
    for (const ref of (legal?.references || []).filter((x) => x.right === r.id)) {
      for (const a of ref.resolved || []) {
        // a code article (LEGIARTI, with its version chain) or a whole décret / arrêté (LEGITEXT, kind « text »: its own in-force window)
        const isText = a.kind === 'text' || String(a.id).startsWith('LEGITEXT');
        const lid = node(`source:legi:${a.id}`, 'source', { kind: isText ? 'legitext' : 'legiarti', legiarti: a.id, code: a.code ?? a.nature ?? null, num: a.num, etat: a.etat,
          dateDebut: a.dateDebut, dateFin: a.dateFin, versions: (a.versions || []).map((v) => ({ ...v })), url: isText && a.url ? a.url : legifranceUrl(a.id),
          textSha256: a.textSha256 ?? null, readAt: legal.referenceDate });
        edge('LEGAL_BASIS', rid, lid, UNCERTAINTY.ETABLI, { origin: `data/rules/legal-articles.v1.json#${r.id}/${ref.basis}`, sources: [lid], readAt: legal.referenceDate }, { validFrom: a.dateDebut, validTo: a.dateFin });
      }
    }
  }
  // need → potential right: only through a fiche that the need cites and the register's right is read on (derived, never declared)
  for (const n of NEED_DEFINITIONS) {
    for (const s of n.sheets) for (const rid of byFiche.get(s) || []) {
      edge('MAY_CONCERN', `need:${n.id}`, rid, UNCERTAINTY.A_VERIFIER, { origin: `api/lib/multi-need.js#CONTENT.${n.id}.sheets ∩ data/rules/rights-rules.v1.json`, sources: [`source:dila:${s}`] });
    }
    for (const [aid, a] of Object.entries(AIDS)) if (n.sheets.includes(a.sheet) || n.actions.some((t) => sheetIdsIn(t).includes(a.sheet))) {
      if (aid === 'faillite-civile' && !n.actions.some((t) => /faillite civile/i.test(t))) continue;
      edge('MAY_CONCERN', `need:${n.id}`, `aid:${aid}`, UNCERTAINTY.A_VERIFIER, { origin: `api/lib/multi-need.js#CONTENT.${n.id}`, sources: [`source:dila:${a.sheet}`] });
    }
  }
  for (const [id, a] of Object.entries(AIDS)) {
    node(`aid:${id}`, 'aid', { aidId: id, label: a.label });
    edge('SOURCED_BY', `aid:${id}`, fiche(a.sheet), UNCERTAINTY.ETABLI, { origin: `api/lib/rightsGraph.js#AIDS.${id}`, sources: [`source:dila:${a.sheet}`], quote: a.quote ?? null });
    edge('APPLIES_IN', `aid:${id}`, `territory:${a.territory}`, a.territory === 'FR' ? UNCERTAINTY.A_VERIFIER : UNCERTAINTY.ETABLI, { origin: `api/lib/rightsGraph.js#AIDS.${id}`, sources: [`source:dila:${a.sheet}`], quote: a.quote ?? null });
  }
  for (const x of INTERACTIONS) edge(x.type, x.from, x.to, UNCERTAINTY.ETABLI, { origin: `api/lib/rightsGraph.js#INTERACTIONS.${x.id}`, sources: [fiche(x.source)], quotes: [...x.quotes] }, { interaction: x.id, territory: x.territory ?? null });
  // cautions (orientation constants) → the register conditions they put in doubt
  for (const c of CAUTION_DEFINITIONS) {
    const cid = node(`caution:${c.id}`, 'caution', { text: c.text });
    for (const d of c.doubts) edge('DOUBTS', cid, `condition:${d.right}:${d.fact}`, UNCERTAINTY.A_VERIFIER, { origin: `api/lib/multi-need.js#CAUTIONS.${c.id}.doubts`, sources: c.sheets.map((s) => `source:dila:${s}`) });
  }
  return Object.freeze({ schema: 'ADA_RIGHTS_GRAPH_V1', registerBuiltAt: register.builtAt, legalReferenceDate: legal?.referenceDate ?? null, sourcesReadAt: readAt,
    nodes: Object.freeze(Object.fromEntries(nodes)), edges: Object.freeze(edges) });
}

/** integrity of the graph: every edge has known endpoints, a known type, an uncertainty and a provenance origin. @returns {string[]} problems */
export function graphProblems(graph) {
  const out = [];
  for (const e of graph.edges) {
    if (!EDGE_TYPES.includes(e.type)) out.push(`edge type ${e.type}`);
    if (!graph.nodes[e.from]) out.push(`${e.type} from unknown ${e.from}`);
    if (!graph.nodes[e.to]) out.push(`${e.type} to unknown ${e.to}`);
    if (!Object.values(UNCERTAINTY).includes(e.uncertainty)) out.push(`${e.type} ${e.from}→${e.to} uncertainty ${e.uncertainty}`);
    if (!e.provenance || !e.provenance.origin) out.push(`${e.type} ${e.from}→${e.to} without provenance`);
  }
  for (const n of Object.values(graph.nodes)) if (!NODE_TYPES.includes(n.type)) out.push(`node type ${n.type}`);
  return out;
}

const out = (graph, id, type) => graph.edges.filter((e) => e.from === id && (!type || e.type === type));
const inbound = (graph, id, type) => graph.edges.filter((e) => e.to === id && (!type || e.type === type));
const ymd = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));

/**
 * « Which rights could this person look at, for these needs, on this date, here? » — never a decision.
 * @param {ReturnType<typeof buildRightsGraph>} graph
 * @param {any} register the D11 register the graph was built from (its conditions are read with api/lib/rulesDraft.js)
 * @param {{ needs: string[], date?: Date | string, territory?: string | null, answers?: object, facts?: object }} q
 *   answers = the diagnostic's answers (birthDate / ageBand / housing.status / territory), facts = rulesDraft facts (annualResources, children…), added on top
 */
export function orientRights(graph, register, { needs = [], date = new Date(), territory = null, answers = {}, facts = {} } = {}) {
  const day = ymd(date);
  const at = typeof date === 'string' ? new Date(`${date}T12:00:00Z`) : date;
  const baseFacts = { ...factsFromAnswers({ ...answers, territory: territory ?? answers.territory }, day), ...facts };
  const results = [];
  for (const needId of needs) {
    const nid = `need:${needId}`;
    if (!graph.nodes[nid]) { results.push({ need: needId, known: false, outcome: OUTCOME, signal: SIGNALS.ABSTENTION, reasons: ['UNKNOWN_NEED'], rights: [], aids: [], rules: [] }); continue; }
    const rules = out(graph, nid, 'TEMPORAL_RULE').map((e) => {
      const r = graph.nodes[e.to];
      return { text: r.text, sheet: r.sheet, inForce: r.window ? inTreveHivernale(at) : true, window: r.window };
    });
    const rights = out(graph, nid, 'MAY_CONCERN').filter((e) => e.to.startsWith('right:')).map((e) => readRight(graph, register, graph.nodes[e.to].rightId, { day, territory, facts: baseFacts, via: e }));
    const aids = out(graph, nid, 'MAY_CONCERN').filter((e) => e.to.startsWith('aid:')).map((e) => readAid(graph, e.to, territory, e));
    results.push({ need: needId, known: true, label: graph.nodes[nid].label, outcome: OUTCOME, rights, aids, rules,
      cites: out(graph, nid, 'CITES').map((e) => graph.nodes[e.to].ficheId) });
  }
  return { date: day, territory: territory ?? null, entitlement: false, amount: null, outcome: OUTCOME, results };
}

function readAid(graph, aidNodeId, territory, via) {
  const terrEdge = out(graph, aidNodeId, 'APPLIES_IN')[0];
  const terrId = terrEdge.to.slice('territory:'.length);
  const covers = territoryCovers(terrId, territory);
  const reasons = [];
  if (terrId !== 'FR' && covers === false) reasons.push('HORS_TERRITOIRE');
  if (terrId !== 'FR' && covers === null) reasons.push('TERRITOIRE_INCONNU');
  const interactions = [...out(graph, aidNodeId), ...inbound(graph, aidNodeId)].filter((e) => e.interaction).map((e) => ({ id: e.interaction, type: e.type, with: e.from === aidNodeId ? e.to : e.from, quotes: e.provenance.quotes }));
  return { aid: graph.nodes[aidNodeId].aidId, label: graph.nodes[aidNodeId].label, outcome: OUTCOME, entitlement: false, amount: null, territory: terrId,
    shown: !reasons.includes('HORS_TERRITOIRE'), reasons, interactions, provenance: via.provenance };
}

/** one right, read at a date and a place: conditions MET / NOT_MET / UNKNOWN / CONTRADICTORY / A_VENIR, never a decision */
export function readRight(graph, register, rightId, { day, territory = null, facts = {}, via = null }) {
  const rid = `right:${rightId}`;
  const right = (register.rights || []).find((r) => r.id === rightId);
  if (!graph.nodes[rid] || !right) return { right: rightId, outcome: OUTCOME, signal: SIGNALS.ABSTENTION, reasons: ['UNKNOWN_RIGHT'], entitlement: false, amount: null, conditions: [] };
  const reasons = [];
  const reading = readConditions(register, rightId, facts);
  const condEdges = out(graph, rid, 'HAS_CONDITION');
  const conditions = reading.conditions.map((c) => {
    const e = condEdges.find((x) => x.to === `condition:${rightId}:${c.fact}`);
    // a source conflict matters only for the ages it concerns (register conflicts[].appliesToAges); an unknown age is inside every range
    const k = (right.conflicts || []).find((x) => x.fact === c.fact);
    const age = Array.isArray(facts.ageRange) ? facts.ageRange : null;
    const concerned = Boolean(k) && (!k.appliesToAges || !age || (age[0] <= k.appliesToAges[1] && age[1] >= k.appliesToAges[0]));
    const result = concerned ? 'CONTRADICTORY' : c.result;
    return { fact: c.fact, text: c.text, source: c.source, result, note: c.note, uncertainty: e?.uncertainty ?? UNCERTAINTY.INCONNU, inForce: true };
  });
  // dated parts of a condition: in force from their date only; before it they are « à venir », never applied
  for (const e of condEdges.filter((x) => x.validFrom)) {
    const n = graph.nodes[e.to];
    const inForce = e.validFrom <= day && (!e.validTo || day < e.validTo);
    conditions.push({ fact: n.fact, text: n.text, source: e.provenance.sources[0]?.replace('source:dila:', '') ?? null, result: inForce ? 'UNKNOWN' : 'A_VENIR', note: inForce ? `en vigueur depuis le ${e.validFrom}` : `à venir : à partir du ${e.validFrom}`, uncertainty: e.uncertainty, inForce, effectiveFrom: e.validFrom });
  }
  // territory
  const terrId = out(graph, rid, 'APPLIES_IN')[0].to.slice('territory:'.length);
  let territoryResult = 'NATIONAL';
  if (terrId !== 'FR') {
    const st = territoryStatus(rightId, territory);
    territoryResult = st === 'OUTSIDE' ? 'HORS_TERRITOIRE_DECLARE' : st === 'DECLARED_AREA' ? 'COMMUNE_A_VERIFIER' : 'TERRITOIRE_INCONNU';
    reasons.push(territoryResult);
  }
  // local-law note: a national right read for an Alsace-Moselle address keeps « à vérifier »: the absence of an exception in the source is not a proof
  const localLaw = territoryCovers('alsace-moselle', territory) === true;
  if (localLaw) reasons.push('ALSACE_MOSELLE_EXCEPTIONS_NOT_CHECKED');
  if (conditions.some((c) => c.result === 'CONTRADICTORY')) reasons.push('CONTRADICTORY_SOURCES');
  if (conditions.some((c) => c.result === RESULTS.NOT_MET)) reasons.push('CONDITION_NOT_MET_PER_ANSWERS');
  if (conditions.some((c) => c.result === RESULTS.UNKNOWN)) reasons.push('CONDITIONS_UNKNOWN');
  if (!right.sources?.length) reasons.push('NO_SOURCE');
  const contradictory = reasons.includes('CONTRADICTORY_SOURCES') || reasons.includes('NO_SOURCE');
  const signal = contradictory ? SIGNALS.ABSTENTION
    : reasons.includes('CONDITION_NOT_MET_PER_ANSWERS') || territoryResult === 'HORS_TERRITOIRE_DECLARE' ? SIGNALS.CONDITION_EN_DOUTE : SIGNALS.PISTE;
  const legal = out(graph, rid, 'LEGAL_BASIS').map((e) => {
    const a = graph.nodes[e.to];
    const v = articleVersionAt(a, day);
    return { legiarti: a.legiarti, code: a.code, num: a.num, versionInForce: v, inForce: Boolean(v), readAt: a.readAt };
  });
  if (legal.length && legal.every((l) => !l.inForce)) reasons.push('NO_LEGAL_BASIS_IN_FORCE_AT_DATE');
  const interactions = [...out(graph, rid), ...inbound(graph, rid)].filter((e) => e.interaction).map((e) => ({ id: e.interaction, type: e.type, with: e.from === rid ? e.to : e.from, quotes: e.provenance.quotes }));
  const doubts = condEdges.flatMap((e) => inbound(graph, e.to, 'DOUBTS').map((d) => ({ caution: d.from.slice('caution:'.length), fact: graph.nodes[e.to].fact })));
  return {
    right: rightId, label: right.label, outcome: OUTCOME, signal, entitlement: false, amount: null, status: right.status,
    reviewState: graph.nodes[rid].reviewState, expertValidated: right.status === 'EXPERT_VALIDATED',
    decidedBy: out(graph, rid, 'DECIDED_BY').map((e) => graph.nodes[e.to].label), territory: terrId, territoryResult,
    conditions, reasons: [...new Set(reasons)], legalBasis: legal, interactions, cautions: doubts,
    sources: right.sources.map((s) => ({ url: s.url, ficheId: sheetOfUrl(s.url), pageVerifiedOn: s.pageVerifiedOn ?? null, consultedAt: s.consultedAt ?? null })),
    provenance: via ? via.provenance : null,
  };
}

/** the three data files, read once (repository root = process.cwd(), as api/_handlers/diagnostic.js does) */
let cached = null;
export function loadRightsGraph(root = process.cwd()) {
  if (cached && cached.root === root) return cached;
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const register = read('data/rules/rights-rules.v1.json');
  const graph = buildRightsGraph({ register, legal: read('data/rules/legal-articles.v1.json'), sources: read('data/rules/rights-graph-sources.v1.json') });
  cached = { root, register, graph };
  return cached;
}
