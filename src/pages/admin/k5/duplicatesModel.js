// @ts-nocheck
/**
 * Registre des doublons — the bulk review model (pure functions, unit-tested): drafts, validation, filters, sort, pagination, batch payload.
 * A draft is what the administrator chose for a pair; it carries the content versions of the two records AS SHOWN when it was chosen, so a decision is never
 * re-bound silently to a record that changed meanwhile (the server refuses it: STALE_REVIEW).
 */

export const SAME = 'SAME_ENTITY';
export const DISTINCT = 'DISTINCT';
export const CHUNK = 25;   // decisions per request (the server accepts at most 50)

const https = (u) => { try { return new URL(String(u)).protocol === 'https:'; } catch { return false; } };

/**
 * The draft of a decision for a pair. The suggestion's own evidence and explanation are used only when the chosen decision IS the suggestion; otherwise
 * the administrator writes what the source establishes (nothing is invented for a decision the evidence assistance did not support).
 */
export function draftFor(pair, decision) {
  const s = pair.assessment || {};
  const fromSuggestion = Boolean(s.suggestion) && s.suggestion === decision;
  return {
    decision,
    primaryId: decision === SAME ? (fromSuggestion ? s.primaryId || '' : '') : '',
    evidenceUrl: fromSuggestion ? s.evidenceUrl || '' : '',
    note: fromSuggestion ? s.note || '' : '',
    versionA: pair.A.version, versionB: pair.B.version,
    expectedDecisionId: pair.expectedDecisionId ?? null,
    fromSuggestion,
  };
}

/** what is still missing before a draft can be sent: codes the page translates */
export function draftProblems(pair, d) {
  if (!d || ![SAME, DISTINCT].includes(d.decision)) return ['DECISION'];
  const out = [];
  if (d.decision === SAME && ![pair.a, pair.b].includes(d.primaryId)) out.push('PRIMARY');
  if (!https(d.evidenceUrl)) out.push('EVIDENCE');
  if (String(d.note || '').trim().length < 10) out.push('NOTE');
  if (d.versionA !== pair.A.version || d.versionB !== pair.B.version) out.push('STALE');
  return out;
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const haystack = (p) => fold([p.A.nom, p.B.nom, p.A.ville, p.B.ville, p.A.adresse, p.B.adresse, p.A.siret, p.B.siret, p.A.numero_finess, p.B.numero_finess, p.A.rna_id, p.B.rna_id,
  p.A.type_structure, p.B.type_structure].filter(Boolean).join(' '));
export const detectionKind = (p) => (p.detection.sameSiret || p.detection.sameRna || p.detection.sameFiness ? 'identifier' : p.detection.sameAddress ? 'address' : 'names');

/** @param {any[]} pairs @param {{ q?: string, suggestion?: string, confidence?: string, detection?: string, state?: string }} f @param {Record<string, any>} drafts @param {Record<string, any>} outcomes */
export function filterPairs(pairs, f = {}, drafts = {}, outcomes = {}) {
  const q = fold(f.q).trim();
  return pairs.filter((p) => {
    const s = p.assessment || {};
    if (q && !q.split(/\s+/).every((w) => haystack(p).includes(w))) return false;
    if (f.suggestion && f.suggestion !== 'all' && (f.suggestion === 'none' ? s.suggestion : s.suggestion !== f.suggestion)) return false;
    if (f.confidence && f.confidence !== 'all' && (f.confidence === 'none' ? s.confidence : s.confidence !== f.confidence)) return false;
    if (f.detection && f.detection !== 'all' && detectionKind(p) !== f.detection) return false;
    if (f.warnings === 'with' && !(s.warnings || []).length) return false;
    if (f.warnings === 'without' && (s.warnings || []).length) return false;
    if (f.state === 'todo' && drafts[p.key]) return false;
    if (f.state === 'draft' && !drafts[p.key]) return false;
    if (f.state === 'failed' && !(outcomes[p.key] && !outcomes[p.key].ok)) return false;
    return true;
  });
}

const CONF = { high: 0, medium: 1 };
/** @param {any[]} list @param {string} sort */
export function sortPairs(list, sort = 'detection') {
  const out = [...list];
  const name = (p) => fold(p.A.nom);
  if (sort === 'confidence') out.sort((x, y) => (CONF[x.assessment?.confidence] ?? 9) - (CONF[y.assessment?.confidence] ?? 9) || name(x).localeCompare(name(y)));
  else if (sort === 'name') out.sort((x, y) => name(x).localeCompare(name(y)));
  else if (sort === 'city') out.sort((x, y) => fold(x.A.ville).localeCompare(fold(y.A.ville)) || name(x).localeCompare(name(y)));
  return out;   // 'detection': the server's order (identifiers first, then address, then names)
}

export function paginate(list, page, size) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, pages, items: list.slice((p - 1) * size, p * size) };
}

/** the pairs whose suggestion is well documented (high confidence, an official page, no warning) — only these can be preselected in one gesture */
export const wellDocumented = (pairs) => pairs.filter((p) => p.assessment?.wellDocumented && p.assessment?.suggestion && p.assessment?.evidenceUrl);

/** the request items for the selected, complete drafts */
export function batchItems(pairs, selected, drafts) {
  const byKey = new Map(pairs.map((p) => [p.key, p]));
  return [...selected].map((k) => [byKey.get(k), drafts[k]]).filter(([p, d]) => p && d && !draftProblems(p, d).length)
    .map(([p, d]) => ({ a: p.a, b: p.b, decision: d.decision, ...(d.decision === SAME ? { primaryId: d.primaryId } : {}), evidenceUrl: d.evidenceUrl.trim(), note: d.note.trim(),
      versionA: d.versionA, versionB: d.versionB, expectedDecisionId: d.expectedDecisionId ?? null }));
}

export const chunks = (list, n = CHUNK) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

/**
 * After a reload of the register: keep the drafts whose two records did not change; report the ones that did (their decision must be read again).
 * @returns {{ drafts: Record<string, any>, stale: string[] }}
 */
export function reconcileDrafts(pairs, drafts) {
  const byKey = new Map(pairs.map((p) => [p.key, p]));
  const kept = {}; const stale = [];
  for (const [k, d] of Object.entries(drafts)) {
    const p = byKey.get(k);
    if (!p) continue;   // decided elsewhere: left the queue
    if (p.A.version === d.versionA && p.B.version === d.versionB) kept[k] = d; else stale.push(k);
  }
  return { drafts: kept, stale };
}

/** the confirmation summary: how many of each decision, and which records would leave the public directory (put on hold) */
export function summary(pairs, items) {
  const byKey = new Map(pairs.map((p) => [`${p.a}|${p.b}`, p]));
  const held = items.filter((i) => i.decision === SAME).map((i) => {
    const p = byKey.get(`${i.a}|${i.b}`) || byKey.get(`${i.b}|${i.a}`);
    const keep = p && (p.A.id === i.primaryId ? p.A : p.B); const leave = p && (p.A.id === i.primaryId ? p.B : p.A);
    return { keep: keep?.nom, leave: leave?.nom, leaveId: leave?.id };
  });
  return { same: held.length, distinct: items.filter((i) => i.decision === DISTINCT).length, held };
}
