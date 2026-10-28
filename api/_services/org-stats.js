// @ts-nocheck
/**
 * PKG-4 / E07 R19 — organization statistics, all MEASURED, never estimated:
 *   teamStats      (Mon équipe)      — the caller's OWN organization: today's / upcoming appointments, active conversations, per member: appointments they created
 *                                      in the last 30 days and the open cases assigned to them. Active members only.
 *   regionalStats  (observatoire)    — cross-organization AGGREGATES only: per commune, only when at least K_ORGS verified active organizations are there, and every
 *                                      count below K_MIN is suppressed (null). No organization is named, no organization's own figures are disclosed to another.
 *   reportCsv      (export E07)      — the caller's organization's indicators for a period as CSV (indicator,value); small outcome cells suppressed; no personal data;
 *                                      cells protected against spreadsheet formula injection.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { activeMemberSql } from '../_utils/share-access.js';

export const K_MIN = 5;
export const K_ORGS = 3;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const suppress = (n) => (Number(n) >= K_MIN ? Number(n) : null);
async function member(ctx, db) { return Boolean((await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).rows[0]); }

export async function teamStats(ctx, db = defaultDb) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const s = ctx.structureId;
  const [g] = (await db.execute(sql`SELECT
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND status NOT IN ('cancelled') AND "startAt" >= date_trunc('day', NOW()) AND "startAt" < date_trunc('day', NOW()) + interval '1 day') AS "appointmentsToday",
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND status NOT IN ('cancelled', 'done', 'no_show') AND "startAt" >= NOW()) AS "appointmentsUpcoming",
      (SELECT count(*)::int FROM "RdvConversation" WHERE "structureId" = ${s} AND "lastMessageAt" >= NOW() - interval '30 days') AS "conversationsActive",
      (SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${s} AND status <> 'CLOSED' AND "assigneeProUserId" IS NULL) AS "casesUnassigned"`)).rows;
  const members = (await db.execute(sql`SELECT u.id,
      (SELECT count(*)::int FROM "ProAppointment" a WHERE a."structureId" = ${s} AND a."createdByProUserId" = u.id AND a."createdAt" >= NOW() - interval '30 days') AS "appointmentsCount",
      (SELECT count(*)::int FROM "ProCase" c WHERE c."structureId" = ${s} AND c."assigneeProUserId" = u.id AND c.status <> 'CLOSED') AS "openCases"
    FROM "ProUser" u WHERE u."structureId" = ${s} AND u.status = 'active' ORDER BY u.email`)).rows;
  return { ok: true, global: g, members, measured: 'appointmentsCount = appointments created by the member in the last 30 days' };
}

export async function regionalStats(ctx, db = defaultDb) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  // PKG-5 / I02 (differencing): every figure is computed over the SAME population — organizations of communes shown (>= K_ORGS verified organizations).
  // Platform-wide totals minus the shown communes would otherwise reveal the organizations of hidden communes (possibly ONE organization). Organizations of
  // hidden communes are only COUNTED (the number of verified organizations is public through the directory), never measured.
  const verified = sql`s.statut = 'actif' AND s.verification_status = 'VERIFIED'`;
  const communes = (await db.execute(sql`WITH org AS (SELECT s.id, coalesce(nullif(trim(s.ville), ''), 'Commune non renseignée') AS commune FROM "Structure" s WHERE ${verified}),
      shown AS (SELECT commune FROM org GROUP BY commune HAVING count(*) >= ${K_ORGS})
    SELECT o.commune, count(DISTINCT o.id)::int AS orgs,
      (SELECT count(*)::int FROM "ProUser" u JOIN org o2 ON o2.id = u."structureId" WHERE o2.commune = o.commune AND u.status = 'active') AS agents,
      (SELECT count(*)::int FROM "ProAppointment" a JOIN org o2 ON o2.id = a."structureId" WHERE o2.commune = o.commune AND a.status <> 'cancelled' AND a."startAt" >= date_trunc('month', NOW())) AS rdv,
      (SELECT count(DISTINCT a."citizenUserId")::int FROM "ProAppointment" a JOIN org o2 ON o2.id = a."structureId" WHERE o2.commune = o.commune AND a."citizenUserId" IS NOT NULL AND a.status IN ('done', 'booked', 'confirmed')) AS helped
    FROM org o WHERE o.commune IN (SELECT commune FROM shown) GROUP BY o.commune ORDER BY o.commune LIMIT 100`)).rows;
  const [cnt] = (await db.execute(sql`SELECT count(*)::int AS n FROM "Structure" s WHERE ${verified}`)).rows;
  const shownIds = sql`(WITH org AS (SELECT s.id, coalesce(nullif(trim(s.ville), ''), 'Commune non renseignée') AS commune FROM "Structure" s WHERE ${verified})
      SELECT id FROM org WHERE commune IN (SELECT commune FROM org GROUP BY commune HAVING count(*) >= ${K_ORGS}))`;
  const trend = (await db.execute(sql`SELECT to_char(d, 'YYYY-MM-DD') AS date, (SELECT count(*)::int FROM "ProAppointment" a WHERE a."structureId" IN ${shownIds} AND a.status <> 'cancelled' AND a."startAt" >= d AND a."startAt" < d + interval '1 day') AS n
    FROM generate_series(date_trunc('day', NOW()) - interval '6 days', date_trunc('day', NOW()), interval '1 day') d ORDER BY d`)).rows;
  const sum = (k) => communes.reduce((n, c) => n + Number(c[k] || 0), 0);
  // PKG-5 batch 2 / I02 (complementary suppression): a total is the sum of the PUBLISHED cells only. A total over every commune minus the published communes
  // would otherwise give back a masked commune when exactly one is masked. The number of masked cells is stated instead.
  const published = (k) => communes.reduce((n, c) => n + (suppress(c[k]) ?? 0), 0);
  const masked = (k) => communes.filter((c) => suppress(c[k]) === null).length;
  const shownOrgs = sum('orgs');
  return { ok: true, kAnonymityMin: K_MIN, minOrganizationsPerCommune: K_ORGS,
    stats: {
      activeStructures: cnt.n, structuresInShownCommunes: shownOrgs, structuresInHiddenCommunes: cnt.n - shownOrgs,
      totalAgents: suppress(published('agents')), appointmentsThisMonth: suppress(published('rdv')), totalCitizensHelped: suppress(published('helped')),
      maskedCells: { agents: masked('agents'), appointments: masked('rdv'), citizensHelped: masked('helped') },
      cities: communes.map((c) => ({ id: c.commune, name: c.commune, city: `${c.orgs} structures vérifiées`, agents: suppress(c.agents), rdv: suppress(c.rdv), status: suppress(c.rdv) ? 'optimal' : 'inactive' })),
      trend: trend.map((d) => ({ date: d.date, value: suppress(d.n) })),
    },
    note: 'Agrégats mesurés uniquement, calculés sur les communes affichées (au moins 3 structures vérifiées) ; valeurs inférieures à 5 masquées ; les totaux additionnent seulement les valeurs publiées ; les structures des autres communes sont seulement dénombrées.' };
}

const PERIODS = { month: '1 month', quarter: '3 months', year: '1 year' };
const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

export async function reportCsv(ctx, period = 'month', db = defaultDb) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const span = PERIODS[period] || PERIODS.month; const s = ctx.structureId;
  const since = sql`NOW() - ${span}::interval`;
  const [r] = (await db.execute(sql`SELECT
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND "startAt" >= ${since}) AS appointments,
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND "startAt" >= ${since} AND status = 'cancelled') AS cancelled,
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND "startAt" >= ${since} AND status = 'done') AS attended,
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND "startAt" >= ${since} AND status = 'no_show') AS "noShow",
      (SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${s} AND "openedAt" >= ${since}) AS "casesOpened",
      (SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${s} AND status = 'CLOSED' AND "closedAt" >= ${since}) AS "casesClosed",
      (SELECT count(*)::int FROM "Referral" WHERE "fromStructureId" = ${s} AND "createdAt" >= ${since}) AS "referralsSent",
      (SELECT count(*)::int FROM "Referral" WHERE "toStructureId" = ${s} AND "sentAt" IS NOT NULL AND "createdAt" >= ${since}) AS "referralsReceived",
      (SELECT count(*)::int FROM "Referral" WHERE "toStructureId" = ${s} AND status IN ('COMPLETED', 'CLOSED') AND "closedAt" >= ${since}) AS "referralsCompleted"`)).rows;
  const outcomes = (await db.execute(sql`SELECT outcome, count(*)::int AS n FROM "ProCase" WHERE "structureId" = ${s} AND status = 'CLOSED' AND "closedAt" >= ${since} GROUP BY outcome ORDER BY outcome`)).rows;
  // PKG-11 audit: the closed total is the sum of the published outcome cells (with the raw total, total minus published cells gave back a masked one)
  const closedPublished = outcomes.reduce((n, o) => n + (suppress(o.n) ?? 0), 0);
  const closedPartial = outcomes.some((o) => suppress(o.n) === null);
  const rows = [['indicateur', 'valeur'], ['periode', period in PERIODS ? period : 'month'], ['genere_le', new Date().toISOString()],
    ['rdv_total', r.appointments], ['rdv_annules', r.cancelled], ['rdv_honores', r.attended], ['rdv_absences', r.noShow],
    ['dossiers_ouverts', r.casesOpened], ['dossiers_clotures', closedPartial ? `${closedPublished} (hors résultats < ${K_MIN})` : closedPublished], ['orientations_envoyees', r.referralsSent], ['orientations_recues', r.referralsReceived], ['orientations_terminees', r.referralsCompleted],
    ...outcomes.map((o) => [`resultat_${String(o.outcome || 'NON_RENSEIGNE').toLowerCase()}`, suppress(o.n) ?? `<${K_MIN}`])];
  return { ok: true, csv: '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n' };
}
