// @ts-nocheck
/**
 * PKG-4 / E07 R19 — organization statistics, all MEASURED, never estimated:
 *   teamStats      (Mon équipe)      — the caller's OWN organization: today's / upcoming appointments, active conversations, per member: appointments they created
 *                                      in the last 30 days and the open cases assigned to them. Active members only.
 *   regionalStats  (observatoire)    — cross-organization AGGREGATES only: per commune, only when at least K_ORGS verified active organizations are there, and every
 *                                      count below K_MIN is suppressed (null). No organization is named, no organization's own figures are disclosed to another.
 *                                      Complete calendar quarters only (see regionalStats).
 *   reportCsv      (export E07)      — the caller's organization's indicators for a period as CSV (indicator,value); small outcome cells suppressed; no personal data;
 *                                      cells protected against spreadsheet formula injection.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { activeMemberSql } from '../_utils/share-access.js';
import { notGuestDecoySql } from '../_utils/rdv-guest-decoy.js';   // R41-B: a decoy hold is no appointment
import { capabilityOpen } from '../_utils/capabilities.js';
import { lastQuarters } from './stat-periods.js';

/**
 * R46 / R45 residual F-9: the reports, team statistics and CSV of an organization no longer return the aggregate counts of a capability that is CLOSED in this
 * environment (pro.case_management → follow-ups and outcomes; pro.referrals → referrals; citizen.shared_dossier → dossiers shared with the organization). The
 * response keeps its keys (value null, never 0: « not measured » is not « none ») and names the closed capabilities in `withheldCapabilities`; the closed tables
 * are not even read. In the LAB (enforcement off) every capability is open and nothing changes.
 * @param {Record<string, string | undefined>} [envVars]
 */
export function closedCounterCapabilities(envVars = process.env) {
  const cases = !capabilityOpen('pro.case_management', envVars);
  const referrals = !capabilityOpen('pro.referrals', envVars);
  const dossiers = !capabilityOpen('citizen.shared_dossier', envVars);
  const withheldCapabilities = [cases && 'pro.case_management', referrals && 'pro.referrals', dossiers && 'citizen.shared_dossier'].filter(Boolean);
  return { cases, referrals, dossiers, withheldCapabilities };
}

/**
 * Audit A16 — the commune of an organization in the cross-organization tables used to be the free text `ville` as typed (then, A16, its name without case,
 * accents or « cedex »). C8: every cross-organization table now places an organization in its INSEE commune from its name AND postal code
 * (api/lib/geography/territoryScope.js communeOfAddress, read through api/_services/territorial-stats.js locatedPopulation) — one population for every view.
 */
export const K_MIN = 5;
export const K_ORGS = 3;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const suppress = (n) => (Number(n) >= K_MIN ? Number(n) : null);
async function member(ctx, db) { return Boolean((await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).rows[0]); }

export async function teamStats(ctx, db = defaultDb, envVars = process.env) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const s = ctx.structureId;
  // R46: « today » is the Paris calendar day (the database runs in UTC: between 00:00 and 01:00/02:00 in Paris, date_trunc('day', NOW()) was still yesterday)
  const parisToday = sql`(date_trunc('day', NOW() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris')`;
  const parisTomorrow = sql`((date_trunc('day', NOW() AT TIME ZONE 'Europe/Paris') + interval '1 day') AT TIME ZONE 'Europe/Paris')`;
  const closed = closedCounterCapabilities(envVars);
  const casesUnassigned = closed.cases ? sql`NULL::int` : sql`(SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${s} AND status <> 'CLOSED' AND "assigneeProUserId" IS NULL)`;
  const openCases = closed.cases ? sql`NULL::int` : sql`(SELECT count(*)::int FROM "ProCase" c WHERE c."structureId" = ${s} AND c."assigneeProUserId" = u.id AND c.status <> 'CLOSED')`;
  const [g] = (await db.execute(sql`SELECT
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND ${notGuestDecoySql(sql`"beneficiaryName"`)} AND status NOT IN ('cancelled') AND "startAt" >= ${parisToday} AND "startAt" < ${parisTomorrow}) AS "appointmentsToday",
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND ${notGuestDecoySql(sql`"beneficiaryName"`)} AND status NOT IN ('cancelled', 'done', 'no_show') AND "startAt" >= NOW()) AS "appointmentsUpcoming",
      (SELECT count(*)::int FROM "RdvConversation" WHERE "structureId" = ${s} AND "lastMessageAt" >= NOW() - interval '30 days') AS "conversationsActive",
      ${casesUnassigned} AS "casesUnassigned"`)).rows;
  const members = (await db.execute(sql`SELECT u.id,
      (SELECT count(*)::int FROM "ProAppointment" a WHERE a."structureId" = ${s} AND a."createdByProUserId" = u.id AND a."createdAt" >= NOW() - interval '30 days') AS "appointmentsCount",
      ${openCases} AS "openCases"
    FROM "ProUser" u WHERE u."structureId" = ${s} AND u.status = 'active' ORDER BY u.email`)).rows;
  return { ok: true, global: g, members, measured: 'appointmentsCount = appointments created by the member in the last 30 days', withheldCapabilities: closed.withheldCapabilities };
}

/**
 * Visibility audit (2026-11): every period figure is the last COMPLETE calendar quarter and the trend is the last four complete quarters — the grid of the
 * institution observatoire (stat-periods.js). Before: appointments were month-to-date and the trend seven rolling days, so two polls a day apart differenced
 * into one day's appointments of a commune. The trend is the sum of the PUBLISHED commune cells of each quarter (never a true total: true total minus the
 * published cells gave the sum of the masked communes). `peopleWithAppointment` counts distinct citizen accounts with an appointment booked, confirmed or
 * honoured in the quarter: a booking, NOT a person helped (the former key « totalCitizensHelped » claimed a social outcome nobody measures).
 * C8 (owner Paket 4): the communes, organizations and appointment cells are read from the ONE suppressed base of api/_services/territorial-stats.js — the
 * same located organizations, the same EPCI blocks and the same appointment cells as the institutional CSV. Before, this table placed organizations by the
 * name typed in their address: its commune cell minus the institutional CSV's gave the appointments of an organization located nowhere else (one org).
 */
export async function regionalStats(ctx, db = defaultDb, now = new Date()) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  // PKG-5 / I02 (differencing): every figure is computed over the SAME population — organizations of communes shown (>= K_ORGS located verified
  // organizations). Organizations elsewhere (hidden communes, or no single commune named by their address) are only COUNTED, never measured.
  const base = await import('./territorial-stats.js');   // dynamic: territorial-stats imports K_MIN / K_ORGS from this file
  const quarters = lastQuarters(now); const last = quarters[quarters.length - 1];
  const pop = await base.locatedPopulation(db);
  const all = [...pop.perCommune.keys()]; const labels = base.communeLabels(all, pop.names);
  const listed = all.sort((a, b) => String(labels.get(a)).localeCompare(String(labels.get(b)), 'fr')).slice(0, 100);
  const appointments = [];
  for (const q of quarters) appointments.push(await base.blockAppointments(db, pop, q));
  const rdv = appointments[appointments.length - 1];
  const rows = base.populationRows(pop);
  const inQuarter = sql`a."startAt" >= ${last.start} AND a."startAt" < ${last.end}`;
  const agentsOf = new Map(pop.orgs.length ? (await db.execute(sql`SELECT m.c AS commune, count(u.id)::int AS n FROM ${rows} JOIN "ProUser" u ON u."structureId" = m.id AND u.status = 'active' GROUP BY m.c`)).rows.map((r) => [r.commune, Number(r.n)]) : []);
  const peopleOf = new Map(pop.orgs.length ? (await db.execute(sql`SELECT m.c AS commune, count(DISTINCT a."citizenUserId")::int AS n FROM ${rows} JOIN "ProAppointment" a ON a."structureId" = m.id
    WHERE a."citizenUserId" IS NOT NULL AND a.status IN ('done', 'booked', 'confirmed') AND ${inQuarter} GROUP BY m.c`)).rows.map((r) => [r.commune, Number(r.n)]) : []);
  const communes = listed.map((c) => ({ code: c, name: labels.get(c), orgs: pop.perCommune.get(c), agents: agentsOf.get(c) || 0, people: peopleOf.get(c) || 0, rdv: rdv.get(c) ?? null }));
  // the trend: per quarter, the published appointment cells of the listed communes (the same cells as the table), summed, then suppressed
  const trend = quarters.map((q, i) => ({ quarter: q.label, value: suppress(listed.reduce((n, c) => n + (appointments[i].get(c) ?? 0), 0)) }));
  // PKG-5 batch 2 / I02 (complementary suppression): a total is the sum of the PUBLISHED cells only; the number of masked cells is stated instead.
  const published = (k) => communes.reduce((n, c) => n + ((k === 'rdv' ? c.rdv : suppress(c[k])) ?? 0), 0);
  const masked = (k) => communes.filter((c) => (k === 'rdv' ? c.rdv : suppress(c[k])) === null).length;
  const shownOrgs = communes.reduce((n, c) => n + c.orgs, 0);
  return { ok: true, kAnonymityMin: K_MIN, minOrganizationsPerCommune: K_ORGS,
    period: { label: last.label, from: last.start.toISOString().slice(0, 10), to: last.end.toISOString().slice(0, 10) },
    stats: {
      activeStructures: pop.verifiedTotal, structuresInShownCommunes: shownOrgs, structuresInHiddenCommunes: pop.verifiedTotal - shownOrgs,
      totalAgents: suppress(published('agents')), appointmentsLastQuarter: suppress(published('rdv')), peopleWithAppointment: suppress(published('people')),
      maskedCells: { agents: masked('agents'), appointments: masked('rdv'), peopleWithAppointment: masked('people') },
      cities: communes.map((c) => ({ id: c.name, name: c.name, city: `${c.orgs} structures vérifiées`, orgs: c.orgs, agents: suppress(c.agents), rdv: c.rdv, status: c.rdv === null ? 'masked' : 'published' })),
      trend,
    },
    note: 'Agrégats mesurés uniquement, calculés sur les communes affichées (au moins 3 structures vérifiées situées par leur adresse : nom de commune et code postal concordants) ; rendez-vous et personnes avec un rendez-vous : dernier trimestre civil complet ; tendance : quatre derniers trimestres complets ; valeurs inférieures à 5 masquées, et une autre valeur de la même intercommunalité quand elle serait seule masquée ; les totaux et la tendance additionnent seulement les valeurs publiées ; les autres structures sont seulement dénombrées. Les rendez-vous publiés sont les mêmes valeurs que celles de l’export des institutions. Un rendez-vous enregistré n’est pas une aide obtenue.' };
}

const PERIODS = { month: '1 month', quarter: '3 months', year: '1 year' };
const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

export async function reportCsv(ctx, period = 'month', db = defaultDb, envVars = process.env) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const span = PERIODS[period] || PERIODS.month; const s = ctx.structureId;
  const since = sql`NOW() - ${span}::interval`;
  const closed = closedCounterCapabilities(envVars);
  const NA = sql`NULL::int`;
  const [r] = (await db.execute(sql`SELECT
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND ${notGuestDecoySql(sql`"beneficiaryName"`)} AND "startAt" >= ${since}) AS appointments,
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND ${notGuestDecoySql(sql`"beneficiaryName"`)} AND "startAt" >= ${since} AND status = 'cancelled') AS cancelled,
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND ${notGuestDecoySql(sql`"beneficiaryName"`)} AND "startAt" >= ${since} AND status = 'done') AS attended,
      (SELECT count(*)::int FROM "ProAppointment" WHERE "structureId" = ${s} AND ${notGuestDecoySql(sql`"beneficiaryName"`)} AND "startAt" >= ${since} AND status = 'no_show') AS "noShow",
      ${closed.cases ? NA : sql`(SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${s} AND "openedAt" >= ${since})`} AS "casesOpened",
      ${closed.referrals ? NA : sql`(SELECT count(*)::int FROM "Referral" WHERE "fromStructureId" = ${s} AND "createdAt" >= ${since})`} AS "referralsSent",
      ${closed.referrals ? NA : sql`(SELECT count(*)::int FROM "Referral" WHERE "toStructureId" = ${s} AND "sentAt" IS NOT NULL AND "createdAt" >= ${since})`} AS "referralsReceived",
      ${closed.referrals ? NA : sql`(SELECT count(*)::int FROM "Referral" WHERE "toStructureId" = ${s} AND status IN ('COMPLETED', 'CLOSED') AND "closedAt" >= ${since})`} AS "referralsCompleted"`)).rows;
  const outcomes = closed.cases ? [] : (await db.execute(sql`SELECT outcome, count(*)::int AS n FROM "ProCase" WHERE "structureId" = ${s} AND status = 'CLOSED' AND "closedAt" >= ${since} GROUP BY outcome ORDER BY outcome`)).rows;
  // PKG-11 audit: the closed total is the sum of the published outcome cells (with the raw total, total minus published cells gave back a masked one)
  const closedPublished = outcomes.reduce((n, o) => n + (suppress(o.n) ?? 0), 0);
  const closedPartial = outcomes.some((o) => suppress(o.n) === null);
  const rows = [['indicateur', 'valeur'], ['periode', period in PERIODS ? period : 'month'], ['genere_le', new Date().toISOString()],
    ['rdv_total', r.appointments], ['rdv_annules', r.cancelled], ['rdv_honores', r.attended], ['rdv_absences', r.noShow],
    ['dossiers_ouverts', r.casesOpened], ['dossiers_clotures', closed.cases ? null : closedPartial ? `${closedPublished} (hors résultats < ${K_MIN})` : closedPublished], ['orientations_envoyees', r.referralsSent], ['orientations_recues', r.referralsReceived], ['orientations_terminees', r.referralsCompleted],
    ...outcomes.map((o) => [`resultat_${String(o.outcome || 'NON_RENSEIGNE').toLowerCase()}`, suppress(o.n) ?? `<${K_MIN}`]),
    // F-9: an empty value above is « not measured » (capability not open), never zero
    ...(closed.withheldCapabilities.length ? [['fonctions_non_ouvertes', closed.withheldCapabilities.join(' ')]] : [])];
  return { ok: true, csv: '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n' };
}
