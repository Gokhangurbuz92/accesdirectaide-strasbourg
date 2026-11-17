// @ts-nocheck
/**
 * PKG-5 batch 2 — territorial statistics for institutions (I03 export, I04 observatoire). Measured indicators only; nothing is estimated.
 * Disclosure control (the same rules everywhere, see STRASBOURG_FULL_PRODUCT_PLAN/ANONYMITY_REVIEW.md):
 *   1. population: only communes with at least K_ORGS verified active organizations are shown; organizations elsewhere are only counted
 *   2. cell suppression: every count below K_MIN is published as null ("< 5")
 *   3. complementary suppression: totals are the sum of PUBLISHED cells only (a total minus the other cells can never give back a masked cell); and (PKG-11
 *      audit) a column never has exactly ONE masked cell — the tables by need, by commune and by month describe the same referrals, so one table's total minus
 *      another's published cells used to give a single masked cell back: the smallest published cell of that column is masked too
 *      (visibility audit, 2026-11): NO true total is published anywhere. The trend by quarter is the sum of the PUBLISHED cells of that quarter's table by need
 *      (the same number as `totals`) — the true total of the last quarter minus the published cells gave the SUM of the masked cells. For the same reason the
 *      two tables of a quarter are aligned (alignColumns): when one has masked cells and the other none, the other one's two smallest cells are masked too
 *      (an unmasked table is a true total); the table by commune lists EVERY shown commune (a commune without referral is « < 5 », not an absent row that
 *      reads as zero) and the CSV export publishes exactly the same commune cells as the observatoire (publishTables is the only place that decides)
 *   4. fixed grid: complete calendar QUARTERS only, no free date range and no free filter (PKG-11 audit pass 2: the observatoire used a rolling 12-month window —
 *      two consecutive months differenced into one month's count per commune — and the export offered months, quarters and years — a year minus three
 *      published quarters gave the fourth, masked one back): one non-overlapping grid for every table
 *   5. no organization, professional or person is ever named; no free text is exported
 *   7. authorised territory (owner decision G1 = b): an institutional account reads scopedObservatoire / scopedTerritoryCsv only, never the functions
 *      that count every commune (those are the platform administrators' preview). See « ONE suppressed base » below.
 *   8. (C8) ONE base for every view: the scoped views, the administrators' preview and the professional regional observatoire are all restrictions of the
 *      same block tables (located organizations, EPCI blocks, published once) — no view has its own population or its own masks to subtract from another's
 *   9. (C8) collusion of contributors: the p % rule with coalitions (`dominated`) masks a cell that two organizations could subtract down to a third one's
 *  10. (C8) bounds from the two marginal tables of a block: protectMarginals masks more until no masked cell is narrowed below « masked »
 *  11. (C8, drizzle/0052) a closed quarter is frozen once and read back unchanged (re-reading a past quarter no longer isolates a later change)
 *   6. what a number is called: « besoin non couvert » is a referral answered NO_CAPACITY only. OUT_OF_SCOPE is a referral sent to the wrong place (a
 *      mis-orientation), published as its own indicator « orientations hors périmètre » under the same suppression rules — never as an unmet need
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { K_MIN, K_ORGS } from './org-stats.js';
import { periodWindow, lastQuarters } from './stat-periods.js';
import { notGuestDecoySql } from '../_utils/rdv-guest-decoy.js';   // R41-B: a decoy hold is no appointment
import { communeOfAddress } from '../lib/geography/territoryScope.js';

export const SCHEMA_VERSION = 'ada.territory-stats.v2';   // v2: column orientations_hors_perimetre; besoins_non_couverts = « pas de capacité » only
export const LICENCE_STATUS = 'PENDING_OWNER_DECISION';   // I03: the open-data licence is the owner's decision; until then the export is for signed partners only
const suppress = (n) => (Number(n) >= K_MIN ? Number(n) : null);

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------
 * C8 follow-up — the collusion of contributors (owner Paket 4). The counts are contributed by ORGANIZATIONS, and an organization knows its own share. In a
 * commune of exactly three organizations, two of them subtract their own referrals from the published cell and obtain the third one's exactly; the
 * « at least 3 organizations » rule never prevented it. Standard rule for magnitude tables: the p % rule, in its variant for coalitions of intruders
 * (Hundepool et al., « Statistical Disclosure Control », Wiley 2012, chapter on magnitude tables / sensitivity rules; the τ-ARGUS manual — section
 * numbers not re-checked here). With contributions x1 ≥ x2 ≥ … of a cell T and a coalition of c intruders, the cell is SENSITIVE when
 *     T − (x1 + x2 + … + x(c+1))  <  p / 100 · x1
 * i.e. the coalition of the c next-largest contributors, subtracting their own shares, could estimate the largest one to within p %. The largest
 * contributor is the worst case (for any other target the remainder is at least as large and the target smaller), so checking it is enough.
 * c = 2 (two colluding organizations — the residual described for the three-organization commune) and p = 20 are this file's defaults; they are
 * ENGINEERING choices, not values taken from a source, and can only be TIGHTENED by configuration (OBS_DOMINANCE_COALITION up to 5,
 * OBS_DOMINANCE_P_PERCENT up to 100); a lower value is ignored. A sensitive cell is masked exactly like a cell below K_MIN (then complemented).
 * Consequence, on purpose: a cell whose referrals come from three organizations or fewer is never published (two can always recover the third).
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
export const DOMINANCE_DEFAULTS = Object.freeze({ coalition: 2, pPercent: 20 });
const tighten = (raw, base, max) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return base;
  const n = Number(raw); return Number.isFinite(n) ? Math.min(max, Math.max(base, n)) : base;
};
/** The disclosure rules in force (configuration can only tighten them). @param {Record<string, string | undefined>} [envVars] */
export function disclosureRules(envVars = process.env) {
  return Object.freeze({ kMin: K_MIN, minOrganizations: K_ORGS, coalition: Math.floor(tighten(envVars.OBS_DOMINANCE_COALITION, DOMINANCE_DEFAULTS.coalition, 5)),
    pPercent: tighten(envVars.OBS_DOMINANCE_P_PERCENT, DOMINANCE_DEFAULTS.pPercent, 100) });
}
/**
 * p % rule with coalitions. `contributions`: the count of each organization in the cell; `total`: the cell (defaults to their sum; for a count of DISTINCT
 * people the sum of the organizations' counts can exceed it — the remainder is then smaller, so the rule is stricter, never looser).
 */
export function dominated(contributions, rules = disclosureRules(), total = null) {
  const xs = (contributions || []).map(Number).filter((v) => v > 0).sort((a, b) => b - a);
  const cell = total === null ? xs.reduce((a, b) => a + b, 0) : Number(total);
  if (!(cell > 0) || !xs.length) return false;
  const top = xs.slice(0, rules.coalition + 1).reduce((a, b) => a + b, 0);
  return cell - top < (rules.pPercent / 100) * xs[0];
}
/** Primary suppression of one cell: below K_MIN, or dominated (when the organizations' contributions are known). */
export function primaryCell(value, contributions, rules = disclosureRules()) {
  const v = Number(value);
  if (!(v >= K_MIN)) return null;
  return contributions && dominated(contributions, rules, v) ? null : v;
}

/** Secondary suppression of one column: if exactly one cell is masked, the smallest published cell is masked as well (two unknowns, never one). */
export function complementColumn(values) {
  const out = values.map((v) => (v === null || v === undefined ? null : Number(v)));
  const masked = out.filter((v) => v === null).length;
  if (masked !== 1) return out;
  let at = -1; out.forEach((v, i) => { if (v !== null && (at < 0 || v < out[at])) at = i; });
  if (at >= 0) out[at] = null;
  return out;
}
const MEASURES = ['sent', 'unmet', 'outOfScope'];
const maskSmallest = (values, count) => {
  const out = [...values];
  for (let k = 0; k < count; k += 1) { let at = -1; out.forEach((v, i) => { if (v !== null && (at < 0 || v < out[at])) at = i; }); if (at < 0) break; out[at] = null; }
  return out;
};
/**
 * Two columns that count the SAME events along two axes (by need, by commune): when one has masked cells and the other none, the unmasked one is a true total
 * and « its sum minus the other's published cells » is the sum of the masked cells. Its two smallest cells are masked too (two unknowns on each side).
 */
export function alignColumns(a, b) {
  const ma = a.some((v) => v === null); const mb = b.some((v) => v === null);
  if (ma && !mb) return [a, maskSmallest(b, 2)];
  if (mb && !ma) return [maskSmallest(a, 2), b];
  return [a, b];
}

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------
 * C8 follow-up — bounds from the marginal tables. The two columns of a block count the same referrals: Σ masked(by need) − Σ masked(by commune) =
 * published(by commune) − published(by need) = D, known. An attacker who also assumes that a masked cell is at most U = max(K_MIN − 1, smallest published
 * cell of its column) (a primary cell is < 5, a complementary one was the smallest published) and that a listed need has at least one referral bounds every
 * masked cell; with one equation and box constraints those interval bounds are exact (marginalIntervals). protectMarginals masks one more cell — on the
 * other side first — until no masked cell is narrowed below what « masked » already says (5 values for a commune cell 0..4, 4 for a listed need 1..4).
 * Not covered (documented): dominance-masked cells may exceed U (the attacker cannot know which), the relations BETWEEN measures (unmet ≤ sent), and
 * attackers with outside knowledge beyond their own contributions.
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
const sumOf = (xs) => xs.reduce((a, b) => a + b, 0);
const times = (n, u) => (n === 0 ? 0 : n * u);
/** The attacker's interval [lo, hi] of every masked cell of columns `a` (by need) and `c` (by commune); null for a published cell. */
export function marginalIntervals(a, c, { lowerA = 0, lowerC = 0, kMin = K_MIN } = {}) {
  const bound = (col) => { const p = col.filter((v) => v !== null); return p.length ? Math.max(kMin - 1, Math.min(...p)) : Infinity; };
  const uA = bound(a); const uC = bound(c);
  const nA = a.filter((v) => v === null).length; const nC = c.filter((v) => v === null).length;
  const D = sumOf(c.filter((v) => v !== null)) - sumOf(a.filter((v) => v !== null));
  return {
    a: a.map((v) => (v !== null ? null : [Math.max(lowerA, D + times(nC, lowerC) - times(nA - 1, uA)), Math.min(uA, D + times(nC, uC) - times(nA - 1, lowerA))])),
    c: c.map((v) => (v !== null ? null : [Math.max(lowerC, times(nA, lowerA) - D - times(nC - 1, uC)), Math.min(uC, times(nA, uA) - D - times(nC - 1, lowerC))])),
  };
}
/** Mask further cells of two aligned columns until no masked cell is narrowed below K_MIN − its lower bound possible values. */
export function protectMarginals(a, c, { lowerA = 0, lowerC = 0, kMin = K_MIN } = {}) {
  let A = [...a]; let C = [...c];
  const narrow = (list, lower) => list.some((x) => x && x[1] !== Infinity && x[1] - x[0] + 1 < kMin - lower);
  for (let guard = 0; guard <= A.length + C.length; guard += 1) {
    if (!A.some((v) => v === null) && !C.some((v) => v === null)) break;
    const iv = marginalIntervals(A, C, { lowerA, lowerC, kMin });
    const badA = narrow(iv.a, lowerA); const badC = narrow(iv.c, lowerC);
    if (!badA && !badC) break;
    const sides = badA ? ['C', 'A'] : ['A', 'C'];
    const side = sides.find((s) => (s === 'A' ? A : C).some((v) => v !== null));
    if (!side) break;
    if (side === 'A') A = maskSmallest(A, 1); else C = maskSmallest(C, 1);
  }
  return [A, C];
}

/**
 * The ONLY place that decides what is published for one block and quarter (pure). `needRows` [{ need, sent, unmet, outOfScope, contrib? }],
 * `communeRows` [{ commune, sent, unmet, outOfScope, contrib? }] — every shown commune, zeros included; `contrib` = { measure: [count per organization] }
 * (the collusion rule applies when it is given — it always is on the database paths).
 */
export function publishTables(needRows, communeRows, rules = disclosureRules()) {
  const cols = (rows) => Object.fromEntries(MEASURES.map((m) => [m, complementColumn(rows.map((r) => primaryCell(r[m], r.contrib?.[m], rules)))]));
  const n = cols(needRows); const c = cols(communeRows);
  for (const m of MEASURES) {
    [n[m], c[m]] = alignColumns(n[m], c[m]);
    [n[m], c[m]] = protectMarginals(n[m], c[m], { lowerA: m === 'sent' ? 1 : 0 });
  }
  const build = (rows, key, col) => rows.map((r, i) => ({ [key]: r[key], ...Object.fromEntries(MEASURES.map((m) => [m, col[m][i]])) }));
  return { byNeed: build(needRows, 'need', n), byCommune: build(communeRows, 'commune', c) };
}
/** Sum of the published cells of a column: the only « total » this file ever publishes. */
export const publishedSum = (rows, k) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
const verified = sql`s.statut = 'actif' AND s.verification_status = 'VERIFIED'`;

export { periodWindow, lastQuarters };   // api/_services/stat-periods.js: one grid for the institution and the professional observatoires

const NO_CAPACITY = sql`r."responseCode" = 'NO_CAPACITY'`; const OUT_OF_SCOPE = sql`r."responseCode" = 'OUT_OF_SCOPE'`;

export const METHODOLOGY = {
  sources: 'Rendez-vous et orientations enregistrés dans la plateforme par les structures vérifiées (aucune estimation, aucune donnée externe).',
  besoinsNonCouverts: 'Orientations auxquelles la structure destinataire a répondu « pas de capacité ».',
  horsPerimetre: 'Orientations auxquelles la structure destinataire a répondu « hors de notre champ » : une orientation mal adressée, comptée à part — ce n’est pas un besoin non couvert.',
  limites: 'Seules les demandes passées par la plateforme sont comptées ; une structure est placée dans sa commune d’après son adresse déclarée (nom de commune et code postal concordants), sinon elle n’est comptée nulle part ; une commune n’apparaît qu’avec au moins 3 structures vérifiées ainsi situées, et chaque commune affichée figure dans le tableau même sans orientation ; toute valeur inférieure à 5 est masquée, et une autre valeur de la même colonne l’est aussi quand elle serait seule masquée.',
  dominance: 'Une valeur est aussi masquée quand elle vient de trop peu de structures : si deux structures, en retirant leurs propres chiffres, pouvaient estimer celui de la plus importante à 20 % près, la valeur est masquée (règle « p % » avec coalition). Une valeur qui vient de trois structures ou moins n’est donc jamais publiée.',
  totaux: 'Aucun total réel n’est publié : les totaux et la tendance par trimestre additionnent seulement les valeurs publiées. Quand l’un des deux tableaux (par besoin, par commune) a des valeurs masquées et l’autre aucune, les deux plus petites valeurs de l’autre sont masquées aussi, et d’autres encore quand la comparaison des deux tableaux permettrait d’encadrer trop précisément une valeur masquée.',
  periodes: 'Trimestres civils complets uniquement, sans chevauchement (pas de mois, d’année ni de période libre : deux périodes emboîtées permettraient de retrouver une valeur masquée).',
  gel: 'Un trimestre clos est figé une fois publié : les réponses tardives, les changements de structures ou les nouvelles inscriptions ne modifient plus ses valeurs (sans quoi deux lectures successives isoleraient le changement).',
  base: 'Une seule base publiée pour tous les tableaux (observatoire des institutions, export, aperçu de l’administration, observatoire des professionnels) : chaque intercommunalité est publiée une fois, avec les mêmes masques, et chaque vue n’additionne que ces valeurs publiées. Deux vues ne peuvent donc pas être soustraites l’une de l’autre pour retrouver une valeur masquée.',
};

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------
 * ONE suppressed base (C8, owner Paket 4) — every cross-organization figure the platform shows, to anyone, is read from it:
 *   institutional observatoire and CSV (scoped, G1 = b), the administrators' preview (unscoped), the professional regional observatoire (org-stats.js).
 *   - population: verified active organizations located by communeOfAddress (api/lib/geography/territoryScope.js); not located means counted NOWHERE;
 *   - shown communes: at least K_ORGS located organizations; a block = the shown communes of one EPCI (a commune without EPCI is its own block);
 *   - each block is published ONCE per quarter (publishTables: thresholds, collusion rule, complementary suppression, alignColumns, marginal protection;
 *     appointments and people with an appointment: thresholds, collusion rule, complementary suppression) — the same cells whoever asks;
 *   - a CLOSED quarter is frozen once (drizzle/0052, freezeClosedQuarters): its published blocks are stored and read back unchanged; without 0052, or for a
 *     quarter not frozen yet, the blocks are computed live (the behaviour before 0052);
 *   - every view is a RESTRICTION of the block tables: commune rows it may see, the table by need of the blocks ENTIRELY inside it, totals and trend = sums
 *     of published cells. The administrators' preview is the restriction to every block.
 * Residual risks: docs/security/observatory-disclosure-control.md.
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------- */

/**
 * Pure. `blocks` [{ communes: [code], pub: { byNeed, byCommune } }] (pub = publishTables of that block, `commune` = INSEE code); `inScope` (code) => boolean.
 * Returns the view of a territory: its commune rows, the table by need of the blocks entirely inside it, and how complete that table is.
 */
export function restrictToScope(blocks, inScope) {
  const byCommune = []; const need = new Map(); let full = 0; let partial = 0;
  for (const b of blocks) {
    const inside = b.communes.filter((c) => inScope(c));
    if (!inside.length) continue;
    byCommune.push(...b.pub.byCommune.filter((r) => inScope(r.commune)));
    if (inside.length !== b.communes.length) { partial += 1; continue; }
    full += 1;
    for (const r of b.pub.byNeed) {
      const acc = need.get(r.need) || { need: r.need, sent: null, unmet: null, outOfScope: null };
      for (const m of MEASURES) if (r[m] !== null && r[m] !== undefined) acc[m] = (acc[m] ?? 0) + r[m];
      need.set(r.need, acc);
    }
  }
  const byNeed = [...need.values()].sort((a, b) => String(a.need).localeCompare(String(b.need)));
  return { byNeed, byCommune, byNeedCoverage: full === 0 ? 'NONE' : partial === 0 ? 'ALL' : 'PARTIAL' };
}

const jsonRows = (list) => sql`jsonb_to_recordset(${JSON.stringify(list)}::jsonb) AS m(id text, c text)`;
const everywhere = () => true;
/** the (id, commune) rows of a population, for a JOIN on m.id / m.c (professional observatoire) */
export const populationRows = (pop) => jsonRows(pop.orgs);

/**
 * The located verified organizations of the blocks that `touches` (commune code => boolean; every block when omitted) reaches:
 * { blocks: Map(block → [commune code]), names, orgs: [{ id, c }], perCommune, verifiedTotal }. A block is always taken WHOLE (its publication depends on
 * all its communes), whichever commune of it is touched.
 */
export async function locatedPopulation(db, touches = everywhere) {
  const rows = (await db.execute(sql`SELECT s.id, s.ville, s.code_postal FROM "Structure" s WHERE ${verified}`)).rows;
  const byCommune = new Map(); const names = new Map(); const blockOfCommune = new Map();
  for (const r of rows) {
    const at = communeOfAddress(r); if (!at) continue;
    names.set(at.code, at.nom); blockOfCommune.set(at.code, at.block);
    const list = byCommune.get(at.code); if (list) list.push(r.id); else byCommune.set(at.code, [r.id]);
  }
  const shown = [...byCommune.keys()].filter((c) => byCommune.get(c).length >= K_ORGS);
  const touched = new Set(shown.filter((c) => touches(c)).map((c) => blockOfCommune.get(c)));
  const blocks = new Map();
  for (const c of shown.sort()) { const b = blockOfCommune.get(c); if (!touched.has(b)) continue; const l = blocks.get(b); if (l) l.push(c); else blocks.set(b, [c]); }
  const orgs = []; const perCommune = new Map();
  for (const list of blocks.values()) for (const c of list) { perCommune.set(c, byCommune.get(c).length); for (const id of byCommune.get(c)) orgs.push({ id, c }); }
  return { blocks, names, orgs, perCommune, verifiedTotal: rows.length };
}

/**
 * The published blocks of one quarter, computed from the live data (raw counts and organization ids never leave this function):
 * [{ id, communes, names: { code: nom }, orgs: { code: n }, pub: { byNeed, byCommune }, appointments: { code: cell }, people: { code: cell } }].
 */
async function liveBlocks(db, pop, { start, end }, rules) {
  if (!pop.orgs.length) return [];
  const rows = jsonRows(pop.orgs);
  const ref = (await db.execute(sql`SELECT m.id AS org, m.c AS commune, r."reasonCode" AS need, count(*)::int AS sent, count(*) FILTER (WHERE ${NO_CAPACITY})::int AS unmet,
      count(*) FILTER (WHERE ${OUT_OF_SCOPE})::int AS "outOfScope"
    FROM "Referral" r JOIN ${rows} ON m.id = r."toStructureId" WHERE r."sentAt" >= ${start} AND r."sentAt" < ${end} GROUP BY m.id, m.c, r."reasonCode"`)).rows;
  const inQuarter = sql`a."startAt" >= ${start} AND a."startAt" < ${end}`;
  const apt = (await db.execute(sql`SELECT m.id AS org, m.c AS commune, count(*)::int AS n FROM "ProAppointment" a JOIN ${rows} ON m.id = a."structureId"
    WHERE ${notGuestDecoySql(sql`a."beneficiaryName"`)} AND a.status <> 'cancelled' AND ${inQuarter} GROUP BY m.id, m.c`)).rows;
  const people = sql`a."citizenUserId" IS NOT NULL AND a.status IN ('done', 'booked', 'confirmed') AND ${inQuarter}`;
  const pplOrg = (await db.execute(sql`SELECT m.id AS org, m.c AS commune, count(DISTINCT a."citizenUserId")::int AS n FROM "ProAppointment" a JOIN ${rows} ON m.id = a."structureId"
    WHERE ${people} GROUP BY m.id, m.c`)).rows;
  const pplCommune = new Map((await db.execute(sql`SELECT m.c AS commune, count(DISTINCT a."citizenUserId")::int AS n FROM "ProAppointment" a JOIN ${rows} ON m.id = a."structureId"
    WHERE ${people} GROUP BY m.c`)).rows.map((r) => [r.commune, Number(r.n)]));
  const cell = () => ({ sent: 0, unmet: 0, outOfScope: 0, contrib: { sent: new Map(), unmet: new Map(), outOfScope: new Map() } });
  const add = (acc, r) => { for (const m of MEASURES) { const v = Number(r[m]); acc[m] += v; acc.contrib[m].set(r.org, (acc.contrib[m].get(r.org) || 0) + v); } };
  const flat = (acc) => ({ sent: acc.sent, unmet: acc.unmet, outOfScope: acc.outOfScope, contrib: Object.fromEntries(MEASURES.map((m) => [m, [...acc.contrib[m].values()]])) });
  const out = [];
  for (const [id, communes] of pop.blocks.entries()) {
    const inBlock = new Set(communes);
    const perCommune = new Map(communes.map((c) => [c, cell()])); const perNeed = new Map();
    for (const r of ref) {
      if (!inBlock.has(r.commune)) continue;
      add(perCommune.get(r.commune), r);
      const n = perNeed.get(r.need) || cell(); perNeed.set(r.need, n); add(n, r);
    }
    const needRows = [...perNeed.keys()].sort((a, b) => String(a).localeCompare(String(b))).map((need) => ({ need, ...flat(perNeed.get(need)) }));
    const pub = publishTables(needRows, communes.map((commune) => ({ commune, ...flat(perCommune.get(commune)) })), rules);
    const aptOf = (c) => apt.filter((r) => r.commune === c).map((r) => Number(r.n));
    const appointments = complementColumn(communes.map((c) => primaryCell(sumOf(aptOf(c)), aptOf(c), rules)));
    const ppl = communes.map((c) => primaryCell(pplCommune.get(c) || 0, pplOrg.filter((r) => r.commune === c).map((r) => Number(r.n)), rules));
    out.push({ id, communes, names: Object.fromEntries(communes.map((c) => [c, pop.names.get(c)])), orgs: Object.fromEntries(communes.map((c) => [c, pop.perCommune.get(c)])),
      pub, appointments: Object.fromEntries(communes.map((c, i) => [c, appointments[i]])), people: Object.fromEntries(communes.map((c, i) => [c, ppl[i]])) });
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- frozen quarters (0052) */
const SNAPSHOT_TTL_MS = 60_000;
const snapshotCache = new WeakMap();
/** whether "ObservatoryQuarterSnapshot" (drizzle/0052) exists in this database — asked of the catalogue, at most once per minute per process */
export function snapshotAvailable(database = defaultDb) {
  if (!database || typeof database.execute !== 'function') return Promise.resolve(false);
  const hit = snapshotCache.get(database);
  if (hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.value;
  const value = database.execute(sql`SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ObservatoryQuarterSnapshot'`)
    .then((res) => (res?.rows || res || []).length > 0);
  snapshotCache.set(database, { at: Date.now(), value });
  value.catch(() => { if (snapshotCache.get(database)?.value === value) snapshotCache.delete(database); });
  return value;
}
/** for the tests: forget what was read (a migration applied or rolled back inside one process) */
export function forgetSnapshotSchema(database = defaultDb) { snapshotCache.delete(database); }

async function frozenBlocks(db, label) {
  if (!(await snapshotAvailable(db).catch(() => false))) return null;
  const [row] = (await db.execute(sql`SELECT blocks FROM "ObservatoryQuarterSnapshot" WHERE quarter = ${label}`)).rows;
  if (!row) return null;
  const blocks = typeof row.blocks === 'string' ? JSON.parse(row.blocks) : row.blocks;
  // jsonb keeps no key order: rebuild every object in the order the live path writes it (same bytes in every view, frozen or live)
  const cells = (r, key) => ({ [key]: r[key], ...Object.fromEntries(MEASURES.map((m) => [m, r[m] ?? null])) });
  const byCommune = (b, k) => Object.fromEntries(b.communes.map((c) => [c, b[k]?.[c] ?? null]));
  return blocks.map((b) => ({ id: b.id, communes: b.communes, names: byCommune(b, 'names'), orgs: byCommune(b, 'orgs'),
    pub: { byNeed: b.pub.byNeed.map((r) => cells(r, 'need')), byCommune: b.pub.byCommune.map((r) => cells(r, 'commune')) },
    appointments: byCommune(b, 'appointments'), people: byCommune(b, 'people') }));
}

/** Reads the published blocks of quarters for one scope: the frozen ones when they exist, otherwise live (one population per reader). */
function baseReader(db, touches, rules) {
  let pop = null;
  const population = async () => (pop ||= await locatedPopulation(db, touches));
  return {
    population,
    async quarter(q) {
      const frozen = await frozenBlocks(db, q.label);
      if (frozen) return frozen.filter((b) => b.communes.some((c) => touches(c)));
      return liveBlocks(db, await population(), q, rules);
    },
  };
}

/**
 * Freeze every closed quarter of the window (the last four complete calendar quarters before `now`) that is not frozen yet: its published blocks are
 * computed from the live data now and stored once (INSERT … ON CONFLICT DO NOTHING; an UPDATE is refused by the database). Without 0052: nothing, said.
 * @returns {Promise<{ ok: true, available: boolean, frozen: string[], alreadyFrozen: string[], rules?: object }>}
 */
export async function freezeClosedQuarters(db = defaultDb, now = new Date(), { release = null } = {}) {
  if (!(await snapshotAvailable(db))) return { ok: true, available: false, frozen: [], alreadyFrozen: [] };
  const rules = disclosureRules(); const quarters = lastQuarters(now);
  const labels = quarters.map((q) => q.label);
  const existing = new Set((await db.execute(sql`SELECT quarter FROM "ObservatoryQuarterSnapshot" WHERE quarter IN (${sql.join(labels.map((l) => sql`${l}`), sql`, `)})`)).rows.map((r) => r.quarter));
  const frozen = []; const alreadyFrozen = []; let pop = null;
  for (const q of quarters) {
    if (existing.has(q.label)) { alreadyFrozen.push(q.label); continue; }
    pop ||= await locatedPopulation(db);
    const blocks = await liveBlocks(db, pop, q, rules);
    const r = (await db.execute(sql`INSERT INTO "ObservatoryQuarterSnapshot" (quarter, "schemaVersion", rules, blocks, release)
      VALUES (${q.label}, ${SCHEMA_VERSION}, ${JSON.stringify(rules)}::jsonb, ${JSON.stringify(blocks)}::jsonb, ${release}) ON CONFLICT (quarter) DO NOTHING RETURNING quarter`)).rows;
    (r.length ? frozen : alreadyFrozen).push(q.label);
  }
  return { ok: true, available: true, frozen, alreadyFrozen, rules };
}

/** Commune codes → the official names shown (the code is added when two communes of the view share a name). @param {Map<string, string>} names */
export function communeLabels(codes, names) {
  const seen = new Map(); for (const c of codes) seen.set(names.get(c), (seen.get(names.get(c)) || 0) + 1);
  return new Map(codes.map((c) => [c, seen.get(names.get(c)) > 1 ? `${names.get(c)} (${c})` : names.get(c)]));
}
const namesOf = (blocks) => new Map(blocks.flatMap((b) => Object.entries(b.names)));

/**
 * The professional observatoire's base (org-stats.js regionalStats): the published blocks of the last four quarters over every block, and the live
 * population (for the figures that are not quarterly: active members).
 */
export async function regionalBase(db, now = new Date()) {
  const rules = disclosureRules(); const reader = baseReader(db, everywhere, rules);
  const quarters = lastQuarters(now); const perQuarter = [];
  for (const q of quarters) perQuarter.push(await reader.quarter(q));
  return { rules, quarters, perQuarter, population: reader.population, namesOf };
}

/** The observatoire of the communes `inScope` accepts (every commune for the administrators' preview), read from the one base. */
async function observatoireOf(db, inScope, now) {
  const rules = disclosureRules(); const reader = baseReader(db, inScope, rules);
  const quarters = lastQuarters(now); const { start, end } = quarters[quarters.length - 1];
  const perQuarter = [];
  for (const q of quarters) perQuarter.push(await reader.quarter(q));
  const views = perQuarter.map((blocks) => restrictToScope(blocks, inScope));
  const last = views[views.length - 1];
  // the « total » is the sum of the published cells of the table by need when that table covers the whole territory, of the table by commune otherwise
  const basis = last.byNeedCoverage === 'ALL' ? 'byNeed' : 'byCommune';
  const sums = (v) => Object.fromEntries(MEASURES.map((m) => [m, suppress(publishedSum(v[basis], m))]));
  const labels = communeLabels(last.byCommune.map((r) => r.commune), namesOf(perQuarter[perQuarter.length - 1]));
  const byCommune = last.byCommune.map((r) => ({ ...r, commune: labels.get(r.commune) })).sort((a, b) => String(a.commune).localeCompare(String(b.commune), 'fr'));
  return { window: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), period: quarters[quarters.length - 1].label }, kAnonymityMin: K_MIN, minOrganizationsPerCommune: K_ORGS,
    coverage: last.byNeedCoverage, basis, byNeed: last.byNeed, byCommune, trend: quarters.map((q, i) => ({ quarter: q.label, ...sums(views[i]) })),
    totals: { ...sums(last), note: basis === 'byNeed' ? 'somme des cellules publiées seulement' : 'somme des cellules publiées du tableau par commune seulement' } };
}

/** The CSV of the communes `inScope` accepts, read from the one base (same columns, same cells as the observatoire of the same scope). */
async function csvOf(db, inScope, now) {
  const w = periodWindow('quarter', now);
  const blocks = await baseReader(db, inScope, disclosureRules()).quarter(w);
  const referrals = new Map(restrictToScope(blocks, inScope).byCommune.map((r) => [r.commune, r]));
  const rdv = new Map(blocks.flatMap((b) => Object.entries(b.appointments))); const orgs = new Map(blocks.flatMap((b) => Object.entries(b.orgs)));
  const codes = [...referrals.keys()]; const labels = communeLabels(codes, namesOf(blocks));
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n;\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const head = ['schema', 'licence', 'periode', 'commune', 'organisations_verifiees', 'rendez_vous', 'orientations_recues', 'besoins_non_couverts', 'orientations_hors_perimetre'];
  const body = codes.map((c) => { const p = referrals.get(c); return [SCHEMA_VERSION, LICENCE_STATUS, w.label, labels.get(c), orgs.get(c), rdv.get(c) ?? null, p.sent ?? null, p.unmet ?? null, p.outOfScope ?? null]; })
    .sort((a, b) => String(a[3]).localeCompare(String(b[3]), 'fr'));
  const tot = (i) => body.reduce((n, r) => n + (r[i] ?? 0), 0);
  body.push([SCHEMA_VERSION, LICENCE_STATUS, w.label, 'TOTAL (cellules publiées)', tot(4), suppress(tot(5)), suppress(tot(6)), suppress(tot(7)), suppress(tot(8))]);
  const csv = '\uFEFF' + [head, ...body].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return { ok: true, csv, period: w.label, sha256: crypto.createHash('sha256').update(csv).digest('hex') };
}

const periodRefused = (period) => period !== undefined && period !== null && period !== '' && period !== 'quarter';
const PERIOD_REFUSAL = { ok: false, status: 400, code: 'PERIOD_NOT_OFFERED', message: 'Seul le dernier trimestre civil complet est publié.' };

/**
 * I04 — administrators' PREVIEW (platform administrators only, api/_handlers/admin/institutions.js): every shown commune, read from the one base with
 * the same masks as every institutional view (C8: it used to be a separate, name-keyed computation). Trend by quarter = published cells, never a true total.
 */
export async function observatoire(db = defaultDb, now = new Date()) {
  const v = await observatoireOf(db, everywhere, now);
  return { ok: true, window: v.window, kAnonymityMin: v.kAnonymityMin, minOrganizationsPerCommune: v.minOrganizationsPerCommune, scope: { kind: 'all', byNeed: v.coverage, totalsBasis: v.basis },
    byNeed: v.byNeed, byCommune: v.byCommune, trend: v.trend, totals: v.totals, methodology: METHODOLOGY };
}

/** I03 — reproducible CSV of every shown commune (same database + same period = the same bytes; no generation time in the body). */
export async function territoryCsv(period, db = defaultDb, now = new Date()) {
  // PKG-11 audit pass 2: one granularity only (the last complete calendar quarter), the same grid as the observatoire — never months or years beside it
  if (periodRefused(period)) return PERIOD_REFUSAL;
  return csvOf(db, everywhere, now);
}

const noScope = () => ({ ok: false, status: 403, code: 'TERRITORY_SCOPE_UNDEFINED', message: 'Le territoire autorisé de ce compte n’est pas défini : aucune statistique ne peut être affichée. Contactez ADA.' });
const scopeDefined = (scope) => Boolean(scope && scope.ok === true && scope.communes instanceof Set && scope.communes.size);

/**
 * I04, scoped (owner decision G1 = b) — the observatoire of ONE authorised territory (`scope` = territoryScope(account.territory), ok: true), decided on the
 * server from the account row, never from the request. Same shape as observatoire(), `scope` says what was applied. Without a defined scope: refused, no data.
 * A territory smaller than its block (a commune inside an EPCI) gets its commune rows and no table by need (the EPCI's table minus it would be the rest).
 */
export async function scopedObservatoire(scope, db = defaultDb, now = new Date()) {
  if (!scopeDefined(scope)) return noScope();
  const v = await observatoireOf(db, (c) => scope.communes.has(c), now);
  return { ok: true, window: v.window, kAnonymityMin: v.kAnonymityMin, minOrganizationsPerCommune: v.minOrganizationsPerCommune,
    scope: { kind: scope.kind, code: scope.code, byNeed: v.coverage, totalsBasis: v.basis },
    byNeed: v.byNeed, byCommune: v.byCommune, trend: v.trend, totals: v.totals,
    methodology: { ...METHODOLOGY, territoire: METHODOLOGY_TERRITORY } };
}

/** I03, scoped — the CSV of ONE authorised territory: the same columns and schema as territoryCsv, the communes of the territory only. */
export async function scopedTerritoryCsv(period, scope, db = defaultDb, now = new Date()) {
  if (!scopeDefined(scope)) return noScope();
  if (periodRefused(period)) return PERIOD_REFUSAL;
  return csvOf(db, (c) => scope.communes.has(c), now);
}

export const METHODOLOGY_TERRITORY = 'Seules les communes du territoire autorisé de votre compte sont comptées, d’après l’adresse déclarée des structures (nom de commune et code postal concordants). Le tableau par besoin additionne les valeurs publiées des intercommunalités entièrement situées dans ce territoire ; un territoire plus petit que son intercommunalité n’a pas de tableau par besoin, car la différence entre deux territoires emboîtés donnerait des valeurs masquées.';
