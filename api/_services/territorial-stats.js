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
 *   6. what a number is called: « besoin non couvert » is a referral answered NO_CAPACITY only. OUT_OF_SCOPE is a referral sent to the wrong place (a
 *      mis-orientation), published as its own indicator « orientations hors périmètre » under the same suppression rules — never as an unmet need
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { K_MIN, K_ORGS } from './org-stats.js';
import { periodWindow, lastQuarters } from './stat-periods.js';
import { notGuestDecoySql } from '../_utils/rdv-guest-decoy.js';   // R41-B: a decoy hold is no appointment

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
const orgCte = sql`org AS (SELECT s.id, coalesce(nullif(trim(s.ville), ''), 'Commune non renseignée') AS commune FROM "Structure" s WHERE ${verified}),
  shown AS (SELECT commune FROM org GROUP BY commune HAVING count(*) >= ${K_ORGS}),
  sorg AS (SELECT o.id, o.commune FROM org o WHERE o.commune IN (SELECT commune FROM shown))`;

export { periodWindow, lastQuarters };   // api/_services/stat-periods.js: one grid for the institution and the professional observatoires

const NO_CAPACITY = sql`r."responseCode" = 'NO_CAPACITY'`; const OUT_OF_SCOPE = sql`r."responseCode" = 'OUT_OF_SCOPE'`;
/** Raw counts of one quarter (never returned to a caller): by need, and by commune for EVERY shown commune (LEFT JOIN: zero rows stay). */
async function quarterRaw(db, { start, end }) {
  const need = (await db.execute(sql`WITH ${orgCte}
    SELECT r."reasonCode" AS need, count(*)::int AS sent, count(*) FILTER (WHERE ${NO_CAPACITY})::int AS unmet, count(*) FILTER (WHERE ${OUT_OF_SCOPE})::int AS "outOfScope"
    FROM "Referral" r JOIN sorg ON sorg.id = r."toStructureId" WHERE r."sentAt" >= ${start} AND r."sentAt" < ${end} GROUP BY r."reasonCode" ORDER BY r."reasonCode"`)).rows;
  const commune = (await db.execute(sql`WITH ${orgCte}
    SELECT sorg.commune, count(r.id)::int AS sent, count(r.id) FILTER (WHERE ${NO_CAPACITY})::int AS unmet, count(r.id) FILTER (WHERE ${OUT_OF_SCOPE})::int AS "outOfScope"
    FROM sorg LEFT JOIN "Referral" r ON r."toStructureId" = sorg.id AND r."sentAt" >= ${start} AND r."sentAt" < ${end} GROUP BY sorg.commune ORDER BY sorg.commune`)).rows;
  return { need, commune };
}

/**
 * I04 — referrals of the last complete calendar quarter by need and by commune: sent, unmet (answered NO_CAPACITY) and out of scope (answered OUT_OF_SCOPE, a
 * mis-orientation: its own indicator); trend by quarter (the last four) = the published cells of each quarter, never a true total.
 */
export async function observatoire(db = defaultDb, now = new Date()) {
  const quarters = lastQuarters(now); const { start, end } = quarters[quarters.length - 1];
  const published = [];
  for (const q of quarters) { const raw = await quarterRaw(db, q); published.push(publishTables(raw.need, raw.commune)); }
  const sums = (t) => Object.fromEntries(MEASURES.map((m) => [m, suppress(publishedSum(t.byNeed, m))]));
  const trend = quarters.map((q, i) => ({ quarter: q.label, ...sums(published[i]) }));
  const last = published[published.length - 1];
  return { ok: true, window: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), period: quarters[quarters.length - 1].label }, kAnonymityMin: K_MIN, minOrganizationsPerCommune: K_ORGS,
    byNeed: last.byNeed, byCommune: last.byCommune, trend,
    totals: { ...sums(last), note: 'somme des cellules publiées seulement' },
    methodology: METHODOLOGY };
}

/** I03 — reproducible CSV for a calendar period: same database + same period = the same bytes (no generation time in the body). */
export async function territoryCsv(period, db = defaultDb, now = new Date()) {
  // PKG-11 audit pass 2: one granularity only (the last complete calendar quarter), the same grid as the observatoire — never months or years beside it
  if (period !== undefined && period !== null && period !== '' && period !== 'quarter') return { ok: false, status: 400, code: 'PERIOD_NOT_OFFERED', message: 'Seul le dernier trimestre civil complet est publié.' };
  const w = periodWindow('quarter', now);
  const rows = (await db.execute(sql`WITH ${orgCte}
    SELECT sorg.commune, count(DISTINCT sorg.id)::int AS organisations,
      (SELECT count(*)::int FROM "ProAppointment" a JOIN sorg s2 ON s2.id = a."structureId" WHERE s2.commune = sorg.commune AND ${notGuestDecoySql(sql`a."beneficiaryName"`)} AND a.status <> 'cancelled' AND a."startAt" >= ${w.start} AND a."startAt" < ${w.end}) AS rendez_vous
    FROM sorg GROUP BY sorg.commune ORDER BY sorg.commune`)).rows;
  // the referral cells are the observatoire's own (same function, same masks): the export can never show a cell the observatoire masks, or the reverse
  const raw = await quarterRaw(db, w);
  const referrals = new Map(publishTables(raw.need, raw.commune).byCommune.map((r) => [r.commune, r]));
  const rdv = complementColumn(rows.map((r) => suppress(r.rendez_vous)));
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n;\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const head = ['schema', 'licence', 'periode', 'commune', 'organisations_verifiees', 'rendez_vous', 'orientations_recues', 'besoins_non_couverts', 'orientations_hors_perimetre'];
  const body = rows.map((r, i) => { const p = referrals.get(r.commune) || {}; return [SCHEMA_VERSION, LICENCE_STATUS, w.label, r.commune, r.organisations, rdv[i], p.sent ?? null, p.unmet ?? null, p.outOfScope ?? null]; });
  const tot = (i) => body.reduce((n, r) => n + (r[i] ?? 0), 0);
  body.push([SCHEMA_VERSION, LICENCE_STATUS, w.label, 'TOTAL (cellules publiées)', tot(4), suppress(tot(5)), suppress(tot(6)), suppress(tot(7)), suppress(tot(8))]);
  const csv = '\uFEFF' + [head, ...body].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return { ok: true, csv, period: w.label, sha256: crypto.createHash('sha256').update(csv).digest('hex') };
}

export const METHODOLOGY = {
  sources: 'Rendez-vous et orientations enregistrés dans la plateforme par les structures vérifiées (aucune estimation, aucune donnée externe).',
  besoinsNonCouverts: 'Orientations auxquelles la structure destinataire a répondu « pas de capacité ».',
  horsPerimetre: 'Orientations auxquelles la structure destinataire a répondu « hors de notre champ » : une orientation mal adressée, comptée à part — ce n’est pas un besoin non couvert.',
  limites: 'Seules les demandes passées par la plateforme sont comptées ; une commune n’apparaît qu’avec au moins 3 structures vérifiées, et chaque commune affichée figure dans le tableau même sans orientation ; toute valeur inférieure à 5 est masquée, et une autre valeur de la même colonne l’est aussi quand elle serait seule masquée.',
  totaux: 'Aucun total réel n’est publié : les totaux et la tendance par trimestre additionnent seulement les valeurs publiées du tableau par besoin. Quand l’un des deux tableaux (par besoin, par commune) a des valeurs masquées et l’autre aucune, les deux plus petites valeurs de l’autre sont masquées aussi : sans cela, la différence entre les deux tableaux donnerait la somme des valeurs masquées.',
  periodes: 'Trimestres civils complets uniquement, sans chevauchement (pas de mois, d’année ni de période libre : deux périodes emboîtées permettraient de retrouver une valeur masquée).',
};
