// @ts-nocheck
/**
 * PKG-5 batch 2 — territorial statistics for institutions (I03 export, I04 observatoire). Measured indicators only; nothing is estimated.
 * Disclosure control (the same rules everywhere, see STRASBOURG_FULL_PRODUCT_PLAN/ANONYMITY_REVIEW.md):
 *   1. population: only communes with at least K_ORGS verified active organizations are shown; organizations elsewhere are only counted
 *   2. cell suppression: every count below K_MIN is published as null ("< 5")
 *   3. complementary suppression: totals are the sum of PUBLISHED cells only (a total minus the other cells can never give back a masked cell); and (PKG-11
 *      audit) a column never has exactly ONE masked cell — the tables by need, by commune and by month describe the same referrals, so one table's total minus
 *      another's published cells used to give a single masked cell back: the smallest published cell of that column is masked too
 *   4. fixed grid: complete calendar QUARTERS only, no free date range and no free filter (PKG-11 audit pass 2: the observatoire used a rolling 12-month window —
 *      two consecutive months differenced into one month's count per commune — and the export offered months, quarters and years — a year minus three
 *      published quarters gave the fourth, masked one back): one non-overlapping grid for every table
 *   5. no organization, professional or person is ever named; no free text is exported
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { K_MIN, K_ORGS } from './org-stats.js';

export const SCHEMA_VERSION = 'ada.territory-stats.v1';
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
/** Applies primary + secondary suppression to the measure columns of a table. */
function protect(rows, keyName, measures) {
  const cols = Object.fromEntries(measures.map((m) => [m, complementColumn(rows.map((r) => suppress(r[m])))]));
  return rows.map((r, i) => ({ [keyName]: r[keyName], ...Object.fromEntries(measures.map((m) => [m, cols[m][i]])) }));
}
const verified = sql`s.statut = 'actif' AND s.verification_status = 'VERIFIED'`;
const orgCte = sql`org AS (SELECT s.id, coalesce(nullif(trim(s.ville), ''), 'Commune non renseignée') AS commune FROM "Structure" s WHERE ${verified}),
  shown AS (SELECT commune FROM org GROUP BY commune HAVING count(*) >= ${K_ORGS}),
  sorg AS (SELECT o.id, o.commune FROM org o WHERE o.commune IN (SELECT commune FROM shown))`;

/** Calendar period [start, end) for 'month' | 'quarter' | 'year' ending with the last COMPLETE period before `now`. */
export function periodWindow(period, now = new Date()) {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  if (period === 'year') return { label: String(y - 1), start: new Date(Date.UTC(y - 1, 0, 1)), end: new Date(Date.UTC(y, 0, 1)) };
  if (period === 'quarter') { const q = Math.floor(m / 3); const sq = q === 0 ? 3 : q - 1; const sy = q === 0 ? y - 1 : y;
    return { label: `${sy}-T${sq + 1}`, start: new Date(Date.UTC(sy, sq * 3, 1)), end: new Date(Date.UTC(sy, sq * 3 + 3, 1)) }; }
  const sm = m === 0 ? 11 : m - 1; const sy = m === 0 ? y - 1 : y;
  return { label: `${sy}-${String(sm + 1).padStart(2, '0')}`, start: new Date(Date.UTC(sy, sm, 1)), end: new Date(Date.UTC(sy, sm + 1, 1)) };
}

/** The four complete calendar quarters before `now`, oldest first. */
export function lastQuarters(now = new Date(), count = 4) {
  const out = []; let at = now;
  for (let i = 0; i < count; i += 1) { const w = periodWindow('quarter', at); out.unshift(w); at = new Date(w.start.getTime() + 86400000); }
  return out;
}

/** I04 — unmet needs (referrals answered NO_CAPACITY / OUT_OF_SCOPE) by need and by commune for the last complete calendar quarter; trend by quarter (the last four). */
export async function observatoire(db = defaultDb, now = new Date()) {
  const quarters = lastQuarters(now); const { start, end } = quarters[quarters.length - 1];
  const byNeed = (await db.execute(sql`WITH ${orgCte}
    SELECT r."reasonCode" AS need, count(*)::int AS sent, count(*) FILTER (WHERE r."responseCode" IN ('NO_CAPACITY', 'OUT_OF_SCOPE'))::int AS unmet
    FROM "Referral" r JOIN sorg ON sorg.id = r."toStructureId" WHERE r."sentAt" >= ${start} AND r."sentAt" < ${end} GROUP BY r."reasonCode" ORDER BY r."reasonCode"`)).rows;
  const byCommune = (await db.execute(sql`WITH ${orgCte}
    SELECT sorg.commune, count(*)::int AS sent, count(*) FILTER (WHERE r."responseCode" IN ('NO_CAPACITY', 'OUT_OF_SCOPE'))::int AS unmet
    FROM "Referral" r JOIN sorg ON sorg.id = r."toStructureId" WHERE r."sentAt" >= ${start} AND r."sentAt" < ${end} GROUP BY sorg.commune ORDER BY sorg.commune`)).rows;
  const trend = [];
  for (const q of quarters) {
    const [row] = (await db.execute(sql`WITH ${orgCte}
      SELECT count(*)::int AS sent, count(*) FILTER (WHERE r."responseCode" IN ('NO_CAPACITY', 'OUT_OF_SCOPE'))::int AS unmet
      FROM "Referral" r JOIN sorg ON sorg.id = r."toStructureId" WHERE r."sentAt" >= ${q.start} AND r."sentAt" < ${q.end}`)).rows;
    trend.push({ quarter: q.label, sent: row?.sent ?? 0, unmet: row?.unmet ?? 0 });
  }
  const need = protect(byNeed, 'need', ['sent', 'unmet']); const commune = protect(byCommune, 'commune', ['sent', 'unmet']); const months = protect(trend, 'quarter', ['sent', 'unmet']);
  const pub = (rows, k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  return { ok: true, window: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), period: quarters[quarters.length - 1].label }, kAnonymityMin: K_MIN, minOrganizationsPerCommune: K_ORGS,
    byNeed: need, byCommune: commune, trend: months,
    totals: { sent: suppress(pub(need, 'sent')), unmet: suppress(pub(need, 'unmet')), note: 'somme des cellules publiées seulement' },
    methodology: METHODOLOGY };
}

/** I03 — reproducible CSV for a calendar period: same database + same period = the same bytes (no generation time in the body). */
export async function territoryCsv(period, db = defaultDb, now = new Date()) {
  // PKG-11 audit pass 2: one granularity only (the last complete calendar quarter), the same grid as the observatoire — never months or years beside it
  if (period !== undefined && period !== null && period !== '' && period !== 'quarter') return { ok: false, status: 400, code: 'PERIOD_NOT_OFFERED', message: 'Seul le dernier trimestre civil complet est publié.' };
  const w = periodWindow('quarter', now);
  const rows = (await db.execute(sql`WITH ${orgCte}
    SELECT sorg.commune, count(DISTINCT sorg.id)::int AS organisations,
      (SELECT count(*)::int FROM "ProAppointment" a JOIN sorg s2 ON s2.id = a."structureId" WHERE s2.commune = sorg.commune AND a.status <> 'cancelled' AND a."startAt" >= ${w.start} AND a."startAt" < ${w.end}) AS rendez_vous,
      (SELECT count(*)::int FROM "Referral" r JOIN sorg s2 ON s2.id = r."toStructureId" WHERE s2.commune = sorg.commune AND r."sentAt" >= ${w.start} AND r."sentAt" < ${w.end}) AS orientations_recues,
      (SELECT count(*)::int FROM "Referral" r JOIN sorg s2 ON s2.id = r."toStructureId" WHERE s2.commune = sorg.commune AND r."sentAt" >= ${w.start} AND r."sentAt" < ${w.end} AND r."responseCode" IN ('NO_CAPACITY', 'OUT_OF_SCOPE')) AS besoins_non_couverts
    FROM sorg GROUP BY sorg.commune ORDER BY sorg.commune`)).rows;
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n;\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const head = ['schema', 'licence', 'periode', 'commune', 'organisations_verifiees', 'rendez_vous', 'orientations_recues', 'besoins_non_couverts'];
  const safe = protect(rows, 'commune', ['rendez_vous', 'orientations_recues', 'besoins_non_couverts']);
  const body = rows.map((r, i) => [SCHEMA_VERSION, LICENCE_STATUS, w.label, r.commune, r.organisations, safe[i].rendez_vous, safe[i].orientations_recues, safe[i].besoins_non_couverts]);
  const tot = (i) => body.reduce((n, r) => n + (r[i] ?? 0), 0);
  body.push([SCHEMA_VERSION, LICENCE_STATUS, w.label, 'TOTAL (cellules publiées)', tot(4), suppress(tot(5)), suppress(tot(6)), suppress(tot(7))]);
  const csv = '﻿' + [head, ...body].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return { ok: true, csv, period: w.label, sha256: crypto.createHash('sha256').update(csv).digest('hex') };
}

export const METHODOLOGY = {
  sources: 'Rendez-vous et orientations enregistrés dans la plateforme par les structures vérifiées (aucune estimation, aucune donnée externe).',
  besoinsNonCouverts: 'Orientations auxquelles la structure destinataire a répondu « pas de capacité » ou « hors de notre champ ».',
  limites: 'Seules les demandes passées par la plateforme sont comptées ; une commune n’apparaît qu’avec au moins 3 structures vérifiées ; toute valeur inférieure à 5 est masquée, et une autre valeur de la même colonne l’est aussi quand elle serait seule masquée ; les totaux n’additionnent que les valeurs publiées.',
  periodes: 'Trimestres civils complets uniquement, sans chevauchement (pas de mois, d’année ni de période libre : deux périodes emboîtées permettraient de retrouver une valeur masquée).',
};
