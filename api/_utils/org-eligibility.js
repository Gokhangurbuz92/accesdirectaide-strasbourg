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
