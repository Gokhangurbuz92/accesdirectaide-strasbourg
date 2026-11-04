/**
 * R42-A07 — age policy of an INDEPENDENT citizen account: adults only (18 or over), enforced on the server.
 *
 * Design (privacy assessment: STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r42/R42_ACCOUNTS_AND_PRO_MFA.md §3):
 * - The person DECLARES being 18 or over when the account is created (an explicit, unticked-by-default statement). No date of birth, no birth year, no identity
 *   document is collected: the account features need a yes/no answer, never an age. A declaration is NOT a verification (it can be false); the product says so.
 * - The declaration is kept in the existing append-only consent ledger (`ConsentLog`, trigger ConsentLog_append_only since drizzle/0030): purpose
 *   AGE_DECLARATION_ADULT, decision true/false, proof_level SELF_DECLARATION, the wording version and the channel. No column is added to any table, so the code
 *   works unchanged on a database at migration 0042 or later.
 * - A later statement wins (a person who says they are under 18, or who sets the profile age band « moins-de-18 », is no longer treated as an adult).
 * - Accounts created before R42 have no declaration: they are NOT adult accounts until they make one (fail closed, no silent grant).
 *
 * `isAdultAccount(user)` is the single entry point for every feature reserved to adults (booking: R42-BOOK). It never throws: any doubt (no row, a database
 * error, an unknown id) answers false.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { CitizenProfile, CitizenUser, ConsentLog } from '../../src/db/schema.js';
import logger from './logger.js';

export const ADULT_AGE = 18;
export const AGE_DECLARATION_PURPOSE = 'AGE_DECLARATION_ADULT';
/** the version of the declaration wording shown to the person (changes when the wording changes) */
export const AGE_DECLARATION_VERSION = 'r42-a07-2026-11-04';
export const MINOR_AGE_BAND = 'moins-de-18';
export const SELF_DECLARATION = 'SELF_DECLARATION';

/**
 * The answer of the sign-up form. Only the boolean `true` counts: a missing field, "true" as text, 1 or anything else is not a declaration.
 * @param {unknown} value @returns {boolean}
 */
export function adultDeclarationGiven(value) {
  return value === true;
}

/** The refusal of an account request without the adult declaration (same answer whatever the address: no account oracle). */
export const ADULT_REQUIRED_REFUSAL = Object.freeze({
  error: 'ADULT_DECLARATION_REQUIRED',
  code: 'ADULT_DECLARATION_REQUIRED',
  message: 'La création d’un compte personnel est réservée aux personnes de 18 ans ou plus. Les informations publiques restent accessibles sans compte. '
    + 'Si vous avez moins de 18 ans et que vous êtes en danger ou avez besoin d’aide : 119 (Enfance en danger) ; en cas d’urgence : 112.',
});

/**
 * Appends one declaration row (the ledger is append-only).
 * @param {string} userId
 * @param {{ adult?: boolean, channel?: string }} [opts] adult: what the person stated; channel: where (signup, account)
 * @param {any} [dbh]
 */
export async function recordAgeDeclaration(userId, opts = {}, dbh = defaultDb) {
  const adult = opts.adult !== false;
  await dbh.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER',
    subject_id: String(userId),
    purpose: AGE_DECLARATION_PURPOSE,
    decision: adult,
    policy_version: AGE_DECLARATION_VERSION,
    policy_hash: `${AGE_DECLARATION_VERSION}:${AGE_DECLARATION_PURPOSE}`,
    collection_channel: String(opts.channel || 'account'),
    guardian_involved: false,
    proof_level: SELF_DECLARATION,
  });
}

/**
 * @param {unknown} user a citizen account ({ id }) or its id
 * @returns {string}
 */
function accountId(user) {
  if (typeof user === 'string') return user.trim();
  if (user && typeof user === 'object' && 'id' in user) return String(/** @type {{ id: unknown }} */ (user).id ?? '').trim();
  return '';
}

/**
 * The latest age statement of the account: true (adult), false (said under 18) or null (never asked).
 * Rows written in the same millisecond resolve to « not adult » (fail closed).
 * @param {string} userId @param {any} [dbh] @returns {Promise<boolean | null>}
 */
export async function latestAgeDeclaration(userId, dbh = defaultDb) {
  const rows = await dbh.select({ decision: ConsentLog.decision }).from(ConsentLog)
    .where(and(eq(ConsentLog.subject_type, 'CITIZEN_USER'), eq(ConsentLog.subject_id, userId), eq(ConsentLog.purpose, AGE_DECLARATION_PURPOSE)))
    .orderBy(desc(ConsentLog.created_at), asc(ConsentLog.decision))
    .limit(1);
  if (!rows.length) return null;
  return rows[0].decision === true;
}

/**
 * R42-A07 single entry point: may this citizen account use the features reserved to adults (book an appointment, …)?
 * True only when the account exists with a verified e-mail address, its latest age statement is « 18 or over » AND its profile does not say « moins-de-18 ».
 * (An erased account is never adult: the ledger row survives the erasure — ConsentLog is RETAIN_WITH_LEGAL_BASIS — but the account does not.)
 * The caller still checks the session itself (requireCitizen).
 * @param {unknown} user the citizen account ({ id }) or its id
 * @param {any} [dbh] database handle (tests)
 * @returns {Promise<boolean>}
 */
export async function isAdultAccount(user, dbh = defaultDb) {
  const id = accountId(user);
  if (!id) return false;
  try {
    const [account] = await dbh.select({ verifiedAt: CitizenUser.emailVerifiedAt }).from(CitizenUser).where(eq(CitizenUser.id, id)).limit(1);
    if (!account || !account.verifiedAt) return false;
    if ((await latestAgeDeclaration(id, dbh)) !== true) return false;
    const [profile] = await dbh.select({ ageBand: CitizenProfile.ageBand }).from(CitizenProfile).where(eq(CitizenProfile.userId, id)).limit(1);
    return profile?.ageBand !== MINOR_AGE_BAND;
  } catch (err) {
    logger.error({ err: { name: /** @type {{ name?: string }} */ (err)?.name } }, '[age-policy] adult check failed (refused)');
    return false;
  }
}
