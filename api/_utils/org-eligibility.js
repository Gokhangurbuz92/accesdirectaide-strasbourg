// @ts-nocheck
/**
 * PKG-5 / E01 (owner decision 2026-10-20) — the organization a person NEWLY gives access to their dossier (invitation, counter hand-over C24, referral) or with
 * which they NEWLY book an appointment inside ADA must be:
 *   - active            (Structure.statut = 'actif' — not a draft, not suspended),
 *   - identity-verified (Structure.verification_status = 'VERIFIED' — the organization-verification contract: an ADA reviewer with MFA, api/_services/content-verification.js),
 *   - able to act       (an active PRO / STRUCTURE_ADMIN member to receive a dossier; a published booking setup + active service for an appointment).
 * Organization verification, D-5 publication eligibility (api/lib/publicVisibility.js) and a professional's dossier access (share-access.js) are three separate checks:
 * none stands in for another.
 * Lifecycle: losing activity or verification blocks NEW grants / redemptions / referrals / bookings / moves to a new slot. Nothing existing is deleted or cancelled:
 * existing grants stay under the person's control (they can withdraw them at any time) and appointments can still be cancelled; a SUSPENDED organization's members
 * also lose dossier access (share-access activeMemberSql requires statut = 'actif'), a merely UNVERIFIED one keeps what the person already granted.
 */
import { sql } from 'drizzle-orm';

export const VERIFIED = 'VERIFIED';
/** SQL predicate on a Structure row alias / table: active + identity-verified. */
export const orgVerifiedActiveSql = (alias = sql`"Structure"`) => sql`${alias}.statut = 'actif' AND ${alias}.verification_status = ${VERIFIED}`;
/** Same rule on a loaded row. */
export const isVerifiedActive = (s) => Boolean(s) && s.statut === 'actif' && s.verification_status === VERIFIED;

/**
 * D8 (owner 17/11: organisation ≠ establishment ≠ service) — an IDENTITY rule, not a publication one: a record that an ACTIVE « same organisation » decision
 * of the duplicate register (StructureDuplicateDecision SAME_ENTITY, api/_services/duplicate-register.js) put aside is the other record's organisation. It is
 * never offered as a NEW destination (referral receiver, redirect suggestion, dossier sharing, a first administrator's invitation): the same organisation used
 * to appear twice in each picker. Nothing that exists is touched (its members, the access people gave it, its referrals). A DISTINCT decision, or a
 * replaced one, excludes nothing. `idExpr`: the SQL expression of the structure id.
 */
export const notPutAsideAsDuplicateSql = (idExpr) => sql`NOT EXISTS (SELECT 1 FROM "StructureDuplicateDecision" dd WHERE dd."supersededAt" IS NULL
  AND dd.decision = 'SAME_ENTITY' AND (dd."structureA" = ${idExpr} OR dd."structureB" = ${idExpr}) AND dd."primaryId" <> ${idExpr})`;
/** the record an active SAME_ENTITY decision keeps instead of `id` (null when `id` is not put aside) @param {any} dbh @param {string} id */
export async function keptInsteadOf(dbh, id) {
  const [r] = (await dbh.execute(sql`SELECT dd."primaryId" AS id, s.nom FROM "StructureDuplicateDecision" dd JOIN "Structure" s ON s.id = dd."primaryId"
    WHERE dd."supersededAt" IS NULL AND dd.decision = 'SAME_ENTITY' AND (dd."structureA" = ${String(id)} OR dd."structureB" = ${String(id)}) AND dd."primaryId" <> ${String(id)}
    ORDER BY dd."decidedAt" DESC LIMIT 1`)).rows;
  return r || null;
}
