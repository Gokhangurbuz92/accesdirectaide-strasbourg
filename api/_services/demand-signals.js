// @ts-nocheck
/**
 * G14-OBS — the ONLY reader and writer of the anonymous demand signals (drizzle/0062: "DemandSignalDaily", "DemandSignalQuarter"), the supply map of the
 * public directory, and the public observatoire answer. Registry and publication rules: api/lib/demand-signals.js.
 *
 *   record*()               count one closed-list code for today (UTC); never throws, never delays the caller beyond one small INSERT; nothing when the
 *                           family is not named in ADA_DEMAND_SIGNALS or the table does not exist (database before 0062).
 *   freezeDemandQuarters()  for every CLOSED quarter that has daily counts: compute its published grid (suppressed), store it once, then DELETE its daily
 *                           counts. Called by the daily job /api/cron/observatory-freeze (already scheduled), after the C8 freeze.
 *   publicObservatoire()    the frozen quarters (never the running one) + the live supply map of the public directory; aggregates only.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import logger from '../_utils/logger.js';
import { visibleSql } from '../lib/publicVisibility.js';
import { communeOfAddress } from '../lib/geography/territoryScope.js';
import { contributorKey } from '../lib/structure-model.js';
import { notGuestDecoySql } from '../_utils/rdv-guest-decoy.js';
import { alignColumns, disclosureRules, primaryCell, protectMarginals } from './territorial-stats.js';
import {
  COMMUNE_TABLE_MIN, FAMILIES, K_MIN, LICENCE, QUARTER_SCHEMA, SCHEMA, EMS_EPCI, codesOf, complement, computeGaps, emsCommunes, normaliseSignal, publishCodes,
  publishSearches, quarterBounds, quarterOfDay, signalRecorded, socialReference, supplyCell, utcDay,
} from '../lib/demand-signals.js';

const STRICT = Object.freeze({ mode: /** @type {'strict'} */ ('strict') });
const UNCLASSIFIED = 'non_classe';
const rowsOf = async (db, q) => { const r = await db.execute(q); return r?.rows || r || []; };

/* ------------------------------------------------------------------------------------------------------------------------------------ schema presence */
const TTL_MS = 60_000;
const presence = new WeakMap();
/** whether drizzle/0062 is applied in this database — asked of the catalogue at most once a minute per process */
export function demandTablesAvailable(database = defaultDb) {
  if (!database || typeof database.execute !== 'function') return Promise.resolve(false);
  const hit = presence.get(database);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = database.execute(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('DemandSignalDaily', 'DemandSignalQuarter')`)
    .then((res) => Number((res?.rows || res || [])[0]?.n) === 2);
  presence.set(database, { at: Date.now(), value });
  value.catch(() => { if (presence.get(database)?.value === value) presence.delete(database); });
  return value;
}
/** tests: forget what was read */
export function forgetDemandSchema(database = defaultDb) { presence.delete(database); }

/* ------------------------------------------------------------------------------------------------------------------------------------------- recording */

/**
 * Counts a list of signals for today. Only the shapes normaliseSignal accepts are written; duplicates in one call are summed. Returns how many counts were
 * added (0 when closed, unavailable or on any error — the caller never sees an error).
 * @param {Array<{ signal: string, code: unknown, commune?: unknown }>} list
 * @param {{ db?: any, env?: Record<string, string | undefined>, now?: Date }} [opts]
 */
export async function recordSignals(list, { db = defaultDb, env = process.env, now = new Date() } = {}) {
  try {
    const by = new Map();
    for (const x of list || []) {
      if (!signalRecorded(x.signal, env)) continue;
      const v = normaliseSignal(x.signal, x.code, x.commune);
      if (!v) continue;
      const k = `${v.signal}|${v.code}|${v.commune}`;
      by.set(k, { ...v, n: (by.get(k)?.n || 0) + 1 });
    }
    if (!by.size || !(await demandTablesAvailable(db))) return 0;
    const day = utcDay(now);
    const values = sql.join([...by.values()].map((v) => sql`(${day}::date, ${v.signal}, ${v.code}, ${v.commune}, ${v.n})`), sql`, `);
    await db.execute(sql`INSERT INTO "DemandSignalDaily" (day, signal, code, commune, count) VALUES ${values}
      ON CONFLICT (day, signal, code, commune) DO UPDATE SET count = "DemandSignalDaily".count + EXCLUDED.count`);
    return [...by.values()].reduce((a, v) => a + v.n, 0);
  } catch (error) {
    logger.warn({ err: { name: error?.name } }, '[demand-signals] not recorded');
    return 0;
  }
}

/**
 * Hook of the search (api/_handlers/search.js): the subdomains the server's own reading found (analyseNeeds → needs[].id), the aid-category filter and the
 * territory filter (INSEE code). Never the query. @param {{ needs?: Array<{ id: string }> } | null | undefined} analysis @param {{ category?: string | null, territory?: string | null }} filters
 */
export function recordSearch(analysis, { category = null, territory = null } = {}, opts = {}) {
  const needs = [...new Set((analysis?.needs || []).map((n) => n.id))];
  return recordSignals([...needs.map((code) => ({ signal: 'search_need', code, commune: territory })), ...(category ? [{ signal: 'search_category', code: category }] : [])], opts);
}
/** Hook of the limited Mon Parcours: a step of this type was added @param {string} code */
export const recordParcoursAdded = (code, opts = {}) => recordSignals([{ signal: 'parcours_added', code }], opts);
/** Hook of the limited Mon Parcours: a step of this type reached a final state @param {string} code */
export const recordParcoursClosed = (code, opts = {}) => recordSignals([{ signal: 'parcours_closed', code }], opts);
/** Hook for the social referral (g14-ps): the closed reasons of a referral SENT @param {string[]} reasons */
export const recordSocialReferral = (reasons, opts = {}) => recordSignals([...new Set(reasons || [])].map((code) => ({ signal: 'social_referral', code })), opts);
/** The opt-in situation counter (POST /api/public/signal) @param {string} id */
export const recordSituation = (id, opts = {}) => recordSignals([{ signal: 'situation', code: id }], opts);

/* ----------------------------------------------------------------------------------------------------------------------------------------- the supply */

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
/** a keyword of the reference, prepared once: acronyms (CCAS, PASS…) match as whole words, other keywords as folded substrings (scripts/social-coverage.mjs) */
const keyword = (kw) => {
  const k = fold(kw);
  if (!/^[A-Z0-9]{2,5}$/.test(kw)) return { test: (t) => k !== '' && t.includes(k) };
  const re = new RegExp(`(?<![\\p{L}\\d])${k}(?![\\p{L}\\d])`, 'u');
  return { test: (t) => re.test(t) };
};
/** @type {Array<{ id: string, domain: string, types: Set<string> }> | null} */
let matchers = null;
const subdomainMatchers = () => (matchers ||= [...socialReference().subdomains.values()].map((s) => ({ id: s.id, domain: s.domain, types: new Set(s.structureTypes.map(fold)) })));
/**
 * The social domains a published place serves, from what the directory itself says: its kind (« type_structure ») listed by a subdomain of the reference,
 * or a keyword of that subdomain in its declared services. A place that matches none is « non classé » (never guessed further). A place can serve several
 * domains. @param {{ type_structure?: string | null, services?: string[] | null }} r @param {Map<string, string[]> | null} [keywordsBySub]
 */
export function domainsOfPlace(r, keywordsBySub = null) {
  const kind = fold(r.type_structure);
  const services = (Array.isArray(r.services) ? r.services : []).map(fold);
  const out = new Set();
  for (const m of subdomainMatchers()) {
    if (kind && m.types.has(kind)) { out.add(m.domain); continue; }
    const kws = keywordsBySub?.get(m.id) || [];
    if (kws.length && services.some((x) => kws.some((kw) => kw.test(x)))) out.add(m.domain);
  }
  return out;
}
let keywordCache = null;
async function subdomainKeywords() {
  if (keywordCache) return keywordCache;
  const fs = await import('node:fs'); const path = await import('node:path');
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/reference/social-domains.v1.json'), 'utf8'));
  keywordCache = new Map(raw.domains.flatMap((d) => d.subdomains.map((s) => [String(s.id), (s.keywords || []).map((kw) => keyword(String(kw)))])));
  return keywordCache;
}

/**
 * The supply of the PUBLIC directory in the Eurométropole now: places per domain (and « non classé »), places with online booking, places that state
 * opening hours; places per commune and domain. Values: exact from K_MIN, « 1 à 4 » (null), 0 exact — the directory is public; the band is a precaution
 * for one-person organisations, as on the public indicators (G8).
 */
export async function supplyMap(db = defaultDb, now = new Date()) {
  const rows = await rowsOf(db, sql`SELECT s.ville, s.code_postal, s.type_structure, s.services,
      (NULLIF(btrim(COALESCE(s.horaires, '')), '') IS NOT NULL) AS hours,
      (s.is_pro_enabled AND EXISTS (SELECT 1 FROM "ProRdvService" r WHERE r."structureId" = s.id AND r."isActive")) AS bookable
    FROM "Structure" s WHERE ${visibleSql('structure', STRICT)}`);
  const keywords = await subdomainKeywords();
  const communes = emsCommunes(); const inEms = new Set(communes.map((c) => c.code));
  const domains = [...socialReference().domains, UNCLASSIFIED];
  const zero = () => Object.fromEntries(domains.map((d) => [d, 0]));
  const places = zero(); const bookable = zero(); const hours = zero();
  const perCommune = new Map(communes.map((c) => [c.code, zero()])); const communeTotal = new Map(communes.map((c) => [c.code, 0]));
  let outside = 0; let unlocated = 0; let total = 0;
  for (const r of rows) {
    const c = communeOfAddress({ ville: r.ville, code_postal: r.code_postal });
    if (!c) { unlocated += 1; continue; }
    if (!inEms.has(c.code)) { outside += 1; continue; }
    total += 1; communeTotal.set(c.code, communeTotal.get(c.code) + 1);
    const ds = domainsOfPlace(r, keywords); if (!ds.size) ds.add(UNCLASSIFIED);
    for (const d of ds) {
      places[d] += 1; if (r.bookable === true) bookable[d] += 1; if (r.hours === true) hours[d] += 1;
      perCommune.get(c.code)[d] += 1;
    }
  }
  return {
    computedAt: now.toISOString(),
    places: supplyCell(total), outsideEurometropole: supplyCell(outside), unlocated: supplyCell(unlocated),
    byDomain: domains.map((d) => ({ domain: d, places: supplyCell(places[d]), bookable: supplyCell(bookable[d]), hours: supplyCell(hours[d]) })),
    byCommune: communes.map((c) => ({ commune: c.code, places: supplyCell(communeTotal.get(c.code)), byDomain: Object.fromEntries(domains.map((d) => [d, supplyCell(perCommune.get(c.code)[d])])) })),
  };
}

/**
 * Appointment REQUESTS of a quarter per domain, at places of the public directory (created in the quarter, decoy holds excluded, every status — a request is a demand), with the C8 rules
 * for counts contributed by organisations (below K_MIN, or dominated under the p % rule with coalitions → masked; then complementary suppression).
 */
async function bookingsOf(db, q, supply) {
  const { start, end } = quarterBounds(q);
  const rows = await rowsOf(db, sql`SELECT s.id, s.siret, s.type_structure, s.services, count(*)::int AS n FROM "ProAppointment" a JOIN (SELECT id, siret, type_structure, services FROM "Structure" WHERE ${visibleSql('structure', STRICT)}) s ON s.id = a."structureId"
    WHERE ${notGuestDecoySql(sql`a."beneficiaryName"`)} AND a."createdAt" >= ${start}::date AND a."createdAt" < ${end}::date GROUP BY s.id, s.siret, s.type_structure, s.services`);
  const keywords = await subdomainKeywords();
  const domains = [...socialReference().domains, UNCLASSIFIED];
  const contrib = new Map(domains.map((d) => [d, new Map()]));
  for (const r of rows) {
    const ds = domainsOfPlace(r, keywords); if (!ds.size) ds.add(UNCLASSIFIED);
    const who = contributorKey({ id: r.id, siret: r.siret });
    for (const d of ds) contrib.get(d).set(who, (contrib.get(d).get(who) || 0) + Number(r.n));
  }
  const rules = disclosureRules();
  const cells = complement(domains.map((d) => { const xs = [...contrib.get(d).values()]; return primaryCell(xs.reduce((a, b) => a + b, 0), xs, rules); }));
  const bookableOf = new Map(supply.byDomain.map((x) => [x.domain, x.bookable]));
  return { byDomain: domains.map((d, i) => ({ domain: d, requested: cells[i], bookablePlaces: bookableOf.get(d) ?? 0 })) };
}

/* ---------------------------------------------------------------------------------------------------------------------------------------------- freeze */

const protect = (a, c) => { const [x, y] = alignColumns(a, c); return protectMarginals(x, y, { lowerA: 0, lowerC: 0, kMin: K_MIN }); };

/** the published grid of one closed quarter from its daily rows (pure apart from the bookings and supply reads) */
export async function publishQuarter(db, label, daily, now = new Date()) {
  const of = (signal) => daily.filter((r) => r.signal === signal);
  const collected = Object.fromEntries(Object.entries(FAMILIES).map(([family, signals]) => {
    const days = daily.filter((r) => signals.includes(r.signal)).map((r) => r.day).sort();
    return [family, days.length ? { from: days[0], to: days[days.length - 1] } : null];
  }));
  const supply = await supplyMap(db, now);
  const search = collected.search ? publishSearches(of('search_need'), protect) : null;
  return {
    quarter: label,
    collected,
    search,
    categories: collected.search ? publishCodes('search_category', of('search_category')) : null,
    situations: collected.situation ? publishCodes('situation', of('situation')) : null,
    parcoursAdded: collected.parcours ? publishCodes('parcours_added', of('parcours_added')) : null,
    parcoursClosed: collected.parcours ? publishCodes('parcours_closed', of('parcours_closed')) : null,
    referrals: collected.referral ? publishCodes('social_referral', of('social_referral')) : null,
    bookings: await bookingsOf(db, label, supply),
    supplyAtFreeze: { computedAt: supply.computedAt, byDomain: supply.byDomain.map((d) => ({ domain: d.domain, places: d.places })) },
    gaps: search ? computeGaps(search, supply) : null,
  };
}

/**
 * Freezes every CLOSED quarter that still has daily counts, then deletes the daily counts of every frozen quarter. Idempotent (INSERT … ON CONFLICT DO
 * NOTHING; an UPDATE is refused by the database). Without 0062: nothing, said.
 * @returns {Promise<{ ok: true, available: boolean, frozen: string[], alreadyFrozen: string[], deletedDailyRows: number }>}
 */
export async function freezeDemandQuarters(db = defaultDb, now = new Date(), { release = null } = {}) {
  if (!(await demandTablesAvailable(db))) return { ok: true, available: false, frozen: [], alreadyFrozen: [], deletedDailyRows: 0 };
  const current = quarterBounds(quarterOfDay(utcDay(now))).start;
  const days = await rowsOf(db, sql`SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day FROM "DemandSignalDaily" WHERE day < ${current}::date`);
  const labels = [...new Set(days.map((r) => quarterOfDay(String(r.day))))].sort();
  const existing = new Set(labels.length ? (await rowsOf(db, sql`SELECT quarter FROM "DemandSignalQuarter" WHERE quarter IN (${sql.join(labels.map((l) => sql`${l}`), sql`, `)})`)).map((r) => r.quarter) : []);
  const rules = { kMin: K_MIN, communeTableMin: COMMUNE_TABLE_MIN, dominance: disclosureRules(), supplyBand: '1-4' };
  const frozen = []; const alreadyFrozen = [];
  for (const label of labels) {
    if (existing.has(label)) { alreadyFrozen.push(label); continue; }
    const { start, end } = quarterBounds(label);
    const daily = (await rowsOf(db, sql`SELECT to_char(day, 'YYYY-MM-DD') AS day, signal, code, commune, count AS n FROM "DemandSignalDaily" WHERE day >= ${start}::date AND day < ${end}::date`))
      .map((r) => ({ day: String(r.day), signal: String(r.signal), code: String(r.code), commune: String(r.commune || ''), n: Number(r.n) }));
    const published = await publishQuarter(db, label, daily, now);
    const r = await rowsOf(db, sql`INSERT INTO "DemandSignalQuarter" (quarter, "schemaVersion", rules, published, release)
      VALUES (${label}, ${QUARTER_SCHEMA}, ${JSON.stringify(rules)}::jsonb, ${JSON.stringify(published)}::jsonb, ${release}) ON CONFLICT (quarter) DO NOTHING RETURNING quarter`);
    (r.length ? frozen : alreadyFrozen).push(label);
  }
  // the daily counts of a frozen quarter are deleted (only of a quarter whose frozen row exists — a failed freeze keeps its counts for the next run)
  const del = await db.execute(sql`DELETE FROM "DemandSignalDaily" d WHERE d.day < ${current}::date
    AND EXISTS (SELECT 1 FROM "DemandSignalQuarter" q WHERE q.quarter = to_char(d.day, 'YYYY') || '-T' || extract(quarter FROM d.day)::int)`);
  return { ok: true, available: true, frozen, alreadyFrozen, deletedDailyRows: Number(del?.rowCount ?? 0) };
}

/* ------------------------------------------------------------------------------------------------------------------------------------- public answer */

const PUBLISHED_QUARTERS = 8;
/** jsonb keeps no key order: rebuild a frozen quarter in the order the freeze writes it (same bytes on every read) */
const ordered = (p, frozenAt) => ({ quarter: p.quarter, frozenAt, collected: p.collected, search: p.search, categories: p.categories, situations: p.situations,
  parcoursAdded: p.parcoursAdded, parcoursClosed: p.parcoursClosed, referrals: p.referrals, bookings: p.bookings, supplyAtFreeze: p.supplyAtFreeze, gaps: p.gaps });

/** the public answer (schema ada.observatoire.v1): frozen quarters, newest first, and the live supply map */
export async function publicObservatoire(db = defaultDb, now = new Date()) {
  const available = await demandTablesAvailable(db).catch(() => false);
  const quarters = available
    ? (await rowsOf(db, sql`SELECT quarter, published, to_char("frozenAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "frozenAt" FROM "DemandSignalQuarter" ORDER BY quarter DESC LIMIT ${PUBLISHED_QUARTERS}`))
      .map((r) => ordered(typeof r.published === 'string' ? JSON.parse(r.published) : r.published, String(r.frozenAt)))
    : [];
  return {
    schema: SCHEMA,
    computedAt: now.toISOString(),
    licence: LICENCE,
    territory: { epci: EMS_EPCI, communes: emsCommunes().map((c) => ({ code: c.code, label: c.nom })) },
    rules: { kMin: K_MIN, communeTableMin: COMMUNE_TABLE_MIN, supplyBand: '1-4', closedQuartersOnly: true },
    collecting: available,
    codes: { domains: [...socialReference().domains, UNCLASSIFIED], situations: codesOf('situation'), categories: codesOf('search_category'), parcours: codesOf('parcours_added'), referralReasons: codesOf('social_referral') },
    quarters,
    supply: await supplyMap(db, now),
  };
}
