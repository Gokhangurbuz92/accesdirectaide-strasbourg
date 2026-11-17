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
/**
 * The ONLY place that decides what is published for one quarter (pure: raw counts in, published cells out). `needRows` [{ need, sent, unmet, outOfScope }],
 * `communeRows` [{ commune, sent, unmet, outOfScope }] — every shown commune, zeros included.
 */
export function publishTables(needRows, communeRows) {
  const cols = (rows) => Object.fromEntries(MEASURES.map((m) => [m, complementColumn(rows.map((r) => suppress(r[m])))]));
  const n = cols(needRows); const c = cols(communeRows);
  for (const m of MEASURES) [n[m], c[m]] = alignColumns(n[m], c[m]);
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
  totaux: 'Aucun total réel n’est publié : les totaux et la tendance par trimestre additionnent seulement les valeurs publiées. Quand l’un des deux tableaux (par besoin, par commune) a des valeurs masquées et l’autre aucune, les deux plus petites valeurs de l’autre sont masquées aussi : sans cela, la différence entre les deux tableaux donnerait la somme des valeurs masquées.',
  periodes: 'Trimestres civils complets uniquement, sans chevauchement (pas de mois, d’année ni de période libre : deux périodes emboîtées permettraient de retrouver une valeur masquée).',
  base: 'Une seule base publiée pour tous les tableaux (observatoire des institutions, export, aperçu de l’administration, observatoire des professionnels) : chaque intercommunalité est publiée une fois, avec les mêmes masques, et chaque vue n’additionne que ces valeurs publiées. Deux vues ne peuvent donc pas être soustraites l’une de l’autre pour retrouver une valeur masquée.',
};

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------
 * ONE suppressed base (C8, owner Paket 4) — every cross-organization figure the platform shows, to anyone, is read from it:
 *   institutional observatoire and CSV (scoped, G1 = b), the administrators' preview (unscoped), the professional regional observatoire (org-stats.js).
 *
 * Why: before C8 the unscoped preview and the professional observatoire placed an organization in a commune by the NAME typed in its address (A16), the scoped
 * views by its INSEE commune (name AND postal code). An organization whose name and postal code disagree (« Sélestat, 68000 ») was in the preview's commune
 * and in no scoped view: preview cell − scoped cell = that ONE organization's count, below the threshold; the same between the professional observatoire's
 * appointments and the institutional CSV's. Two populations, two sets of masks — differencing between views a single actor (or two colluding accounts) can
 * reach. Now there is one population and one publication:
 *   - population: verified active organizations located by communeOfAddress (api/lib/geography/territoryScope.js); not located means counted NOWHERE;
 *   - shown communes: at least K_ORGS located organizations;
 *   - a block = the shown communes of one EPCI (a commune without EPCI is its own block). Blocks never overlap;
 *   - each block is published ONCE per quarter by publishTables (referrals by need and by commune, complementary suppression, alignColumns) and, for the
 *     appointments, by complementColumn over the block's communes — the same cells whoever asks;
 *   - every view is a RESTRICTION of those block tables: the commune rows it may see, the table by need of the blocks ENTIRELY inside it (cell by cell, the sum
 *     of the published cells; a masked cell adds nothing), totals and trend = sums of published cells. The administrators' preview is the restriction to
 *     every block — never a separate, unsuppressed computation.
 * Whatever views or accounts are combined, they hold sums of published block cells only; a count below K_MIN is in none of them and changes none of them.
 * Residual risks that this does NOT remove are documented in docs/security/observatory-disclosure-control.md.
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

/** The referral block tables of one quarter (raw counts never leave this function). */
async function blockReferrals(db, pop, { start, end }) {
  const raw = pop.orgs.length ? (await db.execute(sql`SELECT m.c AS commune, r."reasonCode" AS need, count(*)::int AS sent, count(*) FILTER (WHERE ${NO_CAPACITY})::int AS unmet, count(*) FILTER (WHERE ${OUT_OF_SCOPE})::int AS "outOfScope"
    FROM "Referral" r JOIN ${jsonRows(pop.orgs)} ON m.id = r."toStructureId" WHERE r."sentAt" >= ${start} AND r."sentAt" < ${end} GROUP BY m.c, r."reasonCode"`)).rows : [];
  const zero = () => ({ sent: 0, unmet: 0, outOfScope: 0 });
  const out = [];
  for (const communes of pop.blocks.values()) {
    const perNeed = new Map(); const perCommune = new Map(communes.map((c) => [c, zero()]));
    for (const r of raw) {
      const c = perCommune.get(r.commune); if (!c) continue;
      const n = perNeed.get(r.need) || zero(); perNeed.set(r.need, n);
      for (const k of MEASURES) { c[k] += Number(r[k]); n[k] += Number(r[k]); }
    }
    const needRows = [...perNeed.keys()].sort((a, b) => String(a).localeCompare(String(b))).map((need) => ({ need, ...perNeed.get(need) }));
    out.push({ communes, pub: publishTables(needRows, communes.map((commune) => ({ commune, ...perCommune.get(commune) }))) });
  }
  return out;
}

/**
 * The published appointments of one quarter, per commune: suppressed, then complemented inside each block (like the referral cells). The professional
 * observatoire and the CSV read THESE cells, never their own count. @returns {Promise<Map<string, number | null>>}
 */
export async function blockAppointments(db, pop, { start, end }) {
  const raw = pop.orgs.length ? (await db.execute(sql`SELECT m.c AS commune, count(*)::int AS n FROM "ProAppointment" a JOIN ${jsonRows(pop.orgs)} ON m.id = a."structureId"
    WHERE ${notGuestDecoySql(sql`a."beneficiaryName"`)} AND a.status <> 'cancelled' AND a."startAt" >= ${start} AND a."startAt" < ${end} GROUP BY m.c`)).rows : [];
  const trueCount = new Map(raw.map((r) => [r.commune, Number(r.n)]));
  const out = new Map();
  for (const communes of pop.blocks.values()) complementColumn(communes.map((c) => suppress(trueCount.get(c) || 0))).forEach((v, i) => out.set(communes[i], v));
  return out;
}

/** Commune codes → the official names shown (the code is added when two communes of the view share a name). */
export function communeLabels(codes, names) {
  const seen = new Map(); for (const c of codes) seen.set(names.get(c), (seen.get(names.get(c)) || 0) + 1);
  return new Map(codes.map((c) => [c, seen.get(names.get(c)) > 1 ? `${names.get(c)} (${c})` : names.get(c)]));
}

/** The observatoire of the communes `inScope` accepts (every commune for the administrators' preview), read from the one base. */
async function observatoireOf(db, inScope, now) {
  const quarters = lastQuarters(now); const { start, end } = quarters[quarters.length - 1];
  const pop = await locatedPopulation(db, inScope);
  const views = [];
  for (const q of quarters) views.push(restrictToScope(await blockReferrals(db, pop, q), inScope));
  const last = views[views.length - 1];
  // the « total » is the sum of the published cells of the table by need when that table covers the whole territory, of the table by commune otherwise
  const basis = last.byNeedCoverage === 'ALL' ? 'byNeed' : 'byCommune';
  const sums = (v) => Object.fromEntries(MEASURES.map((m) => [m, suppress(publishedSum(v[basis], m))]));
  const labels = communeLabels(last.byCommune.map((r) => r.commune), pop.names);
  const byCommune = last.byCommune.map((r) => ({ ...r, commune: labels.get(r.commune) })).sort((a, b) => String(a.commune).localeCompare(String(b.commune), 'fr'));
  return { window: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), period: quarters[quarters.length - 1].label }, kAnonymityMin: K_MIN, minOrganizationsPerCommune: K_ORGS,
    coverage: last.byNeedCoverage, basis, byNeed: last.byNeed, byCommune, trend: quarters.map((q, i) => ({ quarter: q.label, ...sums(views[i]) })),
    totals: { ...sums(last), note: basis === 'byNeed' ? 'somme des cellules publiées seulement' : 'somme des cellules publiées du tableau par commune seulement' } };
}

/** The CSV of the communes `inScope` accepts, read from the one base (same columns, same cells as the observatoire of the same scope). */
async function csvOf(db, inScope, now) {
  const w = periodWindow('quarter', now);
  const pop = await locatedPopulation(db, inScope);
  const referrals = new Map(restrictToScope(await blockReferrals(db, pop, w), inScope).byCommune.map((r) => [r.commune, r]));
  const rdv = await blockAppointments(db, pop, w);
  const codes = [...referrals.keys()]; const labels = communeLabels(codes, pop.names);
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n;\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const head = ['schema', 'licence', 'periode', 'commune', 'organisations_verifiees', 'rendez_vous', 'orientations_recues', 'besoins_non_couverts', 'orientations_hors_perimetre'];
  const body = codes.map((c) => { const p = referrals.get(c); return [SCHEMA_VERSION, LICENCE_STATUS, w.label, labels.get(c), pop.perCommune.get(c), rdv.get(c) ?? null, p.sent ?? null, p.unmet ?? null, p.outOfScope ?? null]; })
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
