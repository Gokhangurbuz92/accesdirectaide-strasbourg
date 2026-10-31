import crypto from 'node:crypto';
/**
 * PKG-1 / D-5 — the ONE definition of "may this record be shown to the public as content of the product".
 *
 * Owner decision D-5 (2026-10-18, fail-closed publication): public-facing content is NOT represented as verified or launch-ready unless
 *   1. its official source/provenance is established (source_url or source_url_exact),
 *   2. a verification has been recorded (verification_status = 'VERIFIED', verified_by, written only by api/_services/content-verification.js) — by a named human
 *      reviewer or, since owner decision D-5 v2 (2026-10-25), by the automatic verification chain from official sources with its evidence (api/_services/verification),
 *   3. the verification is current (date_verification within VERIFICATION_MAX_AGE_DAYS and not in the future),
 *   4. launch eligibility and territorial applicability are confirmed (launch_eligible, territory_verified),
 *   5. there is no blocking privacy/safety hold (publication_hold IS NULL),
 *   6. and the record is published (statut) and, for aides, not explicitly archived (status_code <> 'ARCHIVED'; an archive decision always wins over a 'publie' statut).
 *      `statut = 'publie'`, a successful import or a non-null timestamp is NOT sufficient.
 * No verification date is ever synthesised and a language model has no verification authority: it may draft texts, which the chain checks against the official source;
 * the decision is the chain's deterministic checks, recorded in the ledger (nothing lets a model write these columns).
 *
 * Modes (env ADA_PUBLIC_CONTENT_MODE):
 *   'strict' (default, and the only mode honoured when NODE_ENV/VERCEL_ENV is production): only fully eligible records are public.
 *   'lab'    isolated test/demo contexts: ADDITIONALLY shows rows whose data_origin is 'unclassified' or 'synthetic_fixture' (the pre-D-5 test and demo fixtures),
 *            always labelled contentStatus = 'LAB_UNVERIFIED' (never "verified"). Rows with any other origin obey the strict rules even in lab mode.
 *
 * The same rule is expressed three ways that are tested against each other on a real PostgreSQL: decide() (JS), visibleWhere() (drizzle conditions) and visibleSql() (raw SQL).
 */
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { publicServices } from '../_services/verification/datainclusion.js';
import { claimsEntitlement } from './entitlementWording.js';

export const LAB_ORIGINS = ['unclassified', 'synthetic_fixture'];
/** Product contract (docs/ada-agent/PRODUCT_CONTRACTS.md): <= 90 d current, 91-180 d update needed, > 180 d at risk. Beyond the second bound a verification no longer "remains current". */
export const CURRENT_DAYS = 90;
export const DEFAULT_MAX_AGE_DAYS = 180;

/** @typedef {'aide' | 'demarche' | 'structure' | 'dispositif'} ContentKind */
/** Public `statut` values per kind (Structure rows use 'actif' for the directory; the sitemap historically used 'publie'). */
export const PUBLIC_STATUTS = /** @type {Record<ContentKind, string[]>} */ ({ aide: ['publie'], demarche: ['publie'], dispositif: ['publie'], structure: ['actif', 'publie'] });

/** @param {Record<string, string | undefined>} [env] @returns {'strict' | 'lab'} */
export function contentMode(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  return !production && env.ADA_PUBLIC_CONTENT_MODE === 'lab' ? 'lab' : 'strict';
}
/** @param {Record<string, string | undefined>} [env] */
export function maxAgeDays(env = process.env) {
  const n = Number(env.ADA_VERIFICATION_MAX_AGE_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_MAX_AGE_DAYS;
}

/**
 * @typedef {{ statut?: string | null, launch_eligible?: boolean | null, verification_status?: string | null, verified_by?: string | null, territory_verified?: boolean | null,
 *   publication_hold?: string | null, data_origin?: string | null, date_verification?: Date | string | null, source_url?: string | null, source_url_exact?: string | null }} VisibilityRecord
 * @typedef {{ visible: boolean, contentStatus: 'VERIFIED' | 'LAB_UNVERIFIED' | 'HIDDEN', freshness: 'current' | 'update_needed' | null, reasons: string[] }} Decision
 */

/**
 * Pure decision for ONE record (used for single-record guards, API provenance and the admin "why is this hidden" view).
 * @param {VisibilityRecord | null | undefined} r @param {ContentKind} kind @param {{ now?: Date, mode?: 'strict' | 'lab', maxAge?: number }} [opts]
 * @returns {Decision}
 */
export function decide(r, kind, opts = {}) {
  const now = opts.now ?? new Date(); const mode = opts.mode ?? contentMode(); const maxAge = opts.maxAge ?? maxAgeDays();
  /** @type {string[]} */ const reasons = [];
  if (!r) return { visible: false, contentStatus: 'HIDDEN', freshness: null, reasons: ['NOT_FOUND'] };
  if (!PUBLIC_STATUTS[kind].includes(String(r.statut ?? ''))) reasons.push('NOT_PUBLISHED');
  else if (kind === 'aide' && /** @type {any} */ (r).status_code === 'ARCHIVED') reasons.push('ARCHIVED');   // callers that do not select status_code are unaffected; the SQL forms always enforce it
  const origin = String(r.data_origin ?? 'unclassified');
  const labOrigin = LAB_ORIGINS.includes(origin);
  if (reasons.length === 0 && labOrigin && mode === 'lab') return { visible: true, contentStatus: 'LAB_UNVERIFIED', freshness: null, reasons: [] };
  if (labOrigin) reasons.push('LAB_ORIGIN_NOT_PUBLIC_IN_STRICT_MODE');
  if (r.launch_eligible !== true) reasons.push('NOT_LAUNCH_ELIGIBLE');
  if (r.verification_status !== 'VERIFIED' || !r.verified_by) reasons.push('NOT_VERIFIED');
  if (r.territory_verified !== true) reasons.push('TERRITORY_NOT_VERIFIED');
  if (r.publication_hold) reasons.push('PUBLICATION_HOLD');
  if (!String(r.source_url ?? '').trim() && !String(r.source_url_exact ?? '').trim()) reasons.push('NO_PROVENANCE');
  /** @type {Decision['freshness']} */ let freshness = null;
  if (!r.date_verification) reasons.push('NO_VERIFICATION_DATE');
  else {
    const t = new Date(r.date_verification).getTime();
    if (!Number.isFinite(t)) reasons.push('NO_VERIFICATION_DATE');
    else if (t > now.getTime() + 86400000) reasons.push('VERIFICATION_IN_FUTURE');
    else {
      const ageDays = (now.getTime() - t) / 86400000;
      if (ageDays > maxAge) reasons.push('VERIFICATION_STALE');
      else freshness = ageDays <= CURRENT_DAYS ? 'current' : 'update_needed';
    }
  }
  return reasons.length === 0 ? { visible: true, contentStatus: 'VERIFIED', freshness, reasons } : { visible: false, contentStatus: 'HIDDEN', freshness: null, reasons };
}

/** @param {any} table @param {ContentKind} kind @param {{ now?: Date, mode?: 'strict' | 'lab', maxAge?: number }} [opts] drizzle condition for builder and relational queries (columns carry the table alias) */
export function visibleWhere(table, kind, opts = {}) {
  const now = opts.now ?? new Date(); const mode = opts.mode ?? contentMode(); const maxAge = opts.maxAge ?? maxAgeDays();
  const oldest = new Date(now.getTime() - maxAge * 86400000); const latest = new Date(now.getTime() + 86400000);
  const published = and(inArray(table.statut, PUBLIC_STATUTS[kind]), kind === 'aide' && table.status_code ? ne(table.status_code, 'ARCHIVED') : undefined);
  const provenance = or(and(isNotNull(table.source_url), sql`btrim(${table.source_url}) <> ''`), and(isNotNull(table.source_url_exact), sql`btrim(${table.source_url_exact}) <> ''`));
  const strict = and(
    eq(table.launch_eligible, true), eq(table.verification_status, 'VERIFIED'), isNotNull(table.verified_by), eq(table.territory_verified, true), isNull(table.publication_hold),
    notInArray(table.data_origin, LAB_ORIGINS), isNotNull(table.date_verification), gte(table.date_verification, oldest), lte(table.date_verification, latest), provenance,
  );
  return and(published, mode === 'lab' ? or(strict, inArray(table.data_origin, LAB_ORIGINS)) : strict);
}

/**
 * Raw SQL for hand-written queries. `alias` is a code constant (never user input) and may be '' for bare column names.
 * @param {ContentKind} kind @param {{ alias?: string, now?: Date, mode?: 'strict' | 'lab', maxAge?: number }} [opts]
 */
export function visibleSql(kind, opts = {}) {
  const mode = opts.mode ?? contentMode(); const maxAge = opts.maxAge ?? maxAgeDays();
  const a = opts.alias ? `"${opts.alias.replace(/[^A-Za-z0-9_]/g, '')}".` : '';
  const c = (/** @type {string} */ n) => sql.raw(`${a}"${n}"`);
  const statuts = sql.join(PUBLIC_STATUTS[kind].map((s) => sql`${s}`), sql`, `);
  const origins = sql.join(LAB_ORIGINS.map((s) => sql`${s}`), sql`, `);
  const notArchived = kind === 'aide' ? sql` AND ${c('status_code')} <> 'ARCHIVED'` : sql``;
  const strict = sql`(${c('launch_eligible')} = true AND ${c('verification_status')} = 'VERIFIED' AND ${c('verified_by')} IS NOT NULL AND ${c('territory_verified')} = true AND ${c('publication_hold')} IS NULL
    AND ${c('data_origin')} NOT IN (${origins}) AND ${c('date_verification')} IS NOT NULL AND ${c('date_verification')} <= now() + interval '1 day' AND ${c('date_verification')} >= now() - make_interval(days => ${maxAge})
    AND (NULLIF(btrim(COALESCE(${c('source_url')}, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(${c('source_url_exact')}, '')), '') IS NOT NULL))`;
  return mode === 'lab'
    ? sql`(${c('statut')} IN (${statuts})${notArchived} AND (${strict} OR ${c('data_origin')} IN (${origins})))`
    : sql`(${c('statut')} IN (${statuts})${notArchived} AND ${strict})`;
}

/**
 * Reviewer identity (verified_by) and hold reasons (publication_hold) are internal review data: never part of a public payload (admin reviewers keep them).
 * @template {Record<string, any> | null | undefined} T @param {T} row @param {boolean} [isAdmin] @returns {T}
 */
export function stripReviewFields(row, isAdmin = false) {
  if (!row) return row;
  // an administrator keeps the internal data, and sees the record's public line too (the owner looking at a public page)
  if (isAdmin) { const a = publicAutoCheck(/** @type {any} */ (row).auto_check); return /** @type {T} */ (a ? { ...row, verification_auto: a } : row); }
  // PKG-11 audit: also the staff identities and internal reasons other writers keep on the row (updatedBy and falc_reviewed_by hold administrator e-mails;
  // commentaire_statut holds the internal suspension / reactivation reason)
  // automatic verification chain: the run's bookkeeping (run ids, scores, drafts) is internal; the public part is publicAutoCheck
  const { verified_by: _reviewer, publication_hold: _hold, updatedBy: _by, falc_reviewed_by: _falcBy, commentaire_statut: _why, falc_field_reviews: _fr, auto_check: _auto, services_externes: _ext, ...rest } = /** @type {Record<string, any>} */ (row);
  const review = falcFieldReview(row);   // ADM-11: per FALC field, the review date while the text is still the one reviewed (no reviewer identity)
  const auto = publicAutoCheck(/** @type {any} */ (row).auto_check);
  // R11 / D05: the services other platforms list, each with its producer and that producer's authority — never the run's bookkeeping (places, absences)
  const ext = publicServices(/** @type {any} */ (row).services_externes);
  // R31: a published simplified text that asserts a right (« Vous avez droit si… ») is withheld until the chain rewrites it; the standard text stays
  const withheld = Object.keys(rest).filter((k) => k.endsWith('_falc') && claimsEntitlement(rest[k]));
  for (const k of withheld) delete rest[k];
  return /** @type {T} */ ({ ...rest, ...(withheld.length ? { falc_withheld: withheld } : {}), ...(review ? { falc_field_review: review } : {}), ...(auto ? { verification_auto: auto } : {}), ...(ext ? { services_externes: ext } : {}) });
}

/**
 * Automatic verification chain — what the public is told about the last automatic check of a record: when, against which official source, when that source last
 * changed in a significant way, whether the texts were written from it; for a public office, its telephones (with their hours), accessible line and contact form
 * as the Annuaire de l'administration lists them. Never the run's internal data (ids, scores, drafts, refused sentences).
 * @param {any} a the row's auto_check
 */
export function publicAutoCheck(a) {
  if (!a || typeof a !== 'object' || !a.checkedAt) return null;
  const list = (/** @type {unknown} */ v) => /** @type {any[]} */ (Array.isArray(v) ? v : []);
  return { checkedAt: a.checkedAt, origin: a.origin || null, sourceUrl: a.sourceUrl || null, sourceTitle: a.sourceTitle || null, importantChangeAt: a.importantChangeAt || null,
    officialCheckedAt: a.officialCheckedAt || null, textsWrittenAt: a.texts?.at || null, textsMode: a.texts?.mode === 'OFFICIAL_EXCERPT' ? 'OFFICIAL_EXCERPT' : (a.texts?.at ? 'WRITTEN' : null),
    sources: list(a.sources).map((s) => ({ kind: s?.kind || null, url: s?.url || null, updatedAt: s?.updatedAt || null })),
    phones: list(a.phones).map((p) => ({ numero: p?.numero || null, precision: p?.precision || null })).filter((p) => p.numero),
    accessiblePhone: list(a.accessiblePhone).map((p) => ({ url: p?.url || null, precision: p?.precision || null })).filter((p) => p.url), contactForm: a.contactForm || null };
}

export const FALC_TEXT_FIELDS = ['summary_falc', 'conditions_falc', 'montant_falc'];
/**
 * PKG-11 / ADM-11 — { field: reviewedAt | null } for each FALC field of the row that HAS a text: a date only when a person reviewed THAT field and its text has
 * not changed since (sha256 recorded with the review). Rows reviewed before field-level records existed: the record-level stamp counts for the summary only (the
 * only field the former « mark reviewed » required). null when the row has no FALC text.
 * @param {Record<string, any> | null | undefined} row
 */
export function falcFieldReview(row) {
  if (!row) return null;
  const present = FALC_TEXT_FIELDS.filter((f) => typeof row[f] === 'string' && row[f].trim());
  if (!present.length) return null;
  /** @type {Record<string, { at?: string, by?: string, sha256?: string, legacy?: boolean }>} */
  const recorded = row.falc_field_reviews && typeof row.falc_field_reviews === 'object' ? row.falc_field_reviews : {};
  /** @type {Record<string, { at: string, legacy: boolean }>} */
  const legacy = !Object.keys(recorded).length && row.falc_reviewed_at ? { summary_falc: { at: new Date(row.falc_reviewed_at).toISOString(), legacy: true } } : {};
  /** @type {Record<string, string | null>} */
  const out = {};
  for (const f of present) {
    const r = recorded[f] || legacy[f];
    out[f] = r && (r.legacy || r.sha256 === crypto.createHash('sha256').update(String(row[f]), 'utf8').digest('hex')) ? String(r.at) : null;
  }
  return out;
}

/**
 * Public provenance block fragment for API responses: what the citizen may be told about verification. Never invents a date.
 * @param {VisibilityRecord} r @param {ContentKind} kind
 */
export function publicContentStatus(r, kind) {
  const d = decide(r, kind);
  return { contentStatus: d.contentStatus, freshness: d.freshness, verified: d.contentStatus === 'VERIFIED' };
}
