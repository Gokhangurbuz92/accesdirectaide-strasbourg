// @ts-nocheck
/**
 * G12 (owner 20/11/2026: « a two-administrator system is pointless while there is one administrator — make it single-administrator approval »).
 * The rule first shipped for erasure (owner decision 18/11, dsr-erasure-review.js) now applies to every « propose, then confirm » review:
 *   - a DIFFERENT enabled MFA administrator may still confirm at once (unchanged);
 *   - the proposer may confirm their own proposal only while they are the SOLE enabled MFA administrator, and — for a decision that changes or removes data —
 *     only after SOLE_ADMIN_DELAY_MS (24 h of reflection) and a fresh journalised reading made after that delay; the outcome and the audit say soleAdministrator;
 *   - as soon as a second enabled MFA administrator exists, the two-person rule applies again automatically.
 */
import { sql } from 'drizzle-orm';

export const SOLE_ADMIN_DELAY_MS = 24 * 3600 * 1000;

/** Is `email` a registered, enabled, MFA administrator, and how many OTHER such administrators exist? */
export async function soleAdministratorCheck(db, email) {
  const e = String(email || '').trim().toLowerCase();
  const [row] = (await db.execute(sql`SELECT
      count(*) FILTER (WHERE lower(email) = ${e})::int AS self,
      count(*) FILTER (WHERE lower(email) <> ${e})::int AS others
    FROM "AdminUser" WHERE "disabledAt" IS NULL AND "mfaEnabled" = true`)).rows;
  const self = Number(row?.self || 0); const others = Number(row?.others || 0);
  return { registered: self === 1, others, sole: self === 1 && others === 0 };
}

/**
 * G13: for the lists of open reviews — the date from which the PROPOSER may confirm their own proposal, only while they are currently the sole enabled MFA
 * administrator; null otherwise (another administrator exists, the proposer is no longer an enabled MFA administrator, no proposal, or the check failed).
 * Before, the lists announced that date for every proposal, even with a second administrator. One check per proposer per list (memoised).
 * @param {any} db @param {(db: any, email: string) => Promise<{ sole: boolean }>} [check]
 * @returns {(proposal: { proposedBy?: string|null, proposedAt?: string|null } | null | undefined) => Promise<string|null>}
 */
export function soleConfirmableFrom(db, check = soleAdministratorCheck) {
  /** @type {Map<string, Promise<boolean>>} */ const memo = new Map();
  return async (proposal) => {
    const from = Date.parse(String(proposal?.proposedAt || '')) + SOLE_ADMIN_DELAY_MS;
    const who = String(proposal?.proposedBy || '').trim().toLowerCase();
    if (!who || !Number.isFinite(from)) return null;
    if (!memo.has(who)) memo.set(who, Promise.resolve().then(() => check(db, who)).then((c) => Boolean(c?.sole), () => false));
    return (await memo.get(who)) ? new Date(from).toISOString() : null;
  };
}

/**
 * Decide whether `reviewer` may confirm a proposal made by `proposedBy` at `proposedAt`.
 * @returns {Promise<{ ok: true, soleAdministrator: boolean, readFrom: string|null } | { ok: false, status: number, code: string, message: string, confirmableFrom?: string|null }>}
 */
export async function selfConfirmation(db, { reviewer, proposedBy, proposedAt, applying = true, delay = true, check = soleAdministratorCheck, code = 'second_reviewer_required' }) {
  const same = String(proposedBy || '').trim().toLowerCase() === String(reviewer || '').trim().toLowerCase();
  if (!same) return { ok: true, soleAdministrator: false, readFrom: proposedAt ? String(proposedAt) : null };
  const c = await check(db, reviewer);
  if (!c.sole) return { ok: false, status: 403, code, message: 'La confirmation doit venir d’une autre personne que celle qui a proposé (plusieurs administrateurs sont actifs).' };
  if (!delay) return { ok: true, soleAdministrator: true, readFrom: proposedAt ? String(proposedAt) : null };
  const from = Date.parse(String(proposedAt || '')) + SOLE_ADMIN_DELAY_MS;
  const fromIso = Number.isFinite(from) ? new Date(from).toISOString() : null;
  if (applying && !(Date.now() >= from)) {
    return { ok: false, status: 409, code: 'sole_admin_delay', confirmableFrom: fromIso,
      message: `Seul administrateur : vous pourrez confirmer votre propre proposition à partir du ${fromIso || new Date(Date.now() + SOLE_ADMIN_DELAY_MS).toISOString()} (24 h de réflexion).` };
  }
  return { ok: true, soleAdministrator: true, readFrom: fromIso };
}
