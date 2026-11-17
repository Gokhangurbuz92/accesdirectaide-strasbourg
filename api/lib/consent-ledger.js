import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

/**
 * PKG-11 / C22 — a new consent-ledger row is strictly LATER than the previous decision of the same subject / purpose. Two decisions recorded in the same
 * millisecond used to tie on created_at, so « the latest decision » (what applies now, what retention keeps) became arbitrary.
 * @param {string} subjectType @param {string} subjectId @param {string | null} purpose
 */
export const nextDecisionAt = (subjectType, subjectId, purpose) => sql`GREATEST(LOCALTIMESTAMP(3), COALESCE((SELECT max(c.created_at) FROM "ConsentLog" c
  WHERE c.subject_type = ${subjectType} AND c.subject_id = ${subjectId} AND c.purpose IS NOT DISTINCT FROM ${purpose}) + interval '1 millisecond', LOCALTIMESTAMP(3)))`;

/** the per-organisation purposes of a shared dossier that the owner decides separately from the access itself (PURP-05 automated analysis, PURP-07 SIAO transmission) */
export const GRANT_PURPOSES_WITH_OWN_DECISION = Object.freeze(['PURP-05', 'PURP-07']);

/** PURP-06: sharing the dossier with ONE organisation. The access itself — granted when the organisation redeems the person's invitation or when the person
 * accepts a referral, withdrawn when the person removes the organisation or stops sharing (FA-D5). */
export const SHARING_PURPOSE = 'PURP-06';
/** the policy version of the dossier purposes (PURP-05 / PURP-06 / PURP-07); its hash is sha256(`<version>:<purpose>`) */
export const DOSSIER_PURPOSE_POLICY_VERSION = 'pkg11-2026-10-22-dossier-purposes';
/** @param {string} purpose */
export const dossierPurposePolicyHash = (purpose) => crypto.createHash('sha256').update(`${DOSSIER_PURPOSE_POLICY_VERSION}:${purpose}`, 'utf8').digest('hex');
/** how the person's « yes » to PURP-06 was collected */
export const SHARING_GRANTED_BY = Object.freeze({
  /** the person issued a single-use invitation for this organisation with the owner secret; the organisation redeemed it */
  INVITE: Object.freeze({ channel: 'owner_invite', proof: 'OWNER_SECRET' }),
  /** the person accepted, signed in to their account, the referral that gives this organisation access */
  REFERRAL: Object.freeze({ channel: 'citizen_account', proof: 'AUTHENTICATED_SESSION' }),
});

/**
 * FA-D5 — the « yes » to PURP-06 for (dossier, organisation): call it in the SAME transaction that creates or re-activates the grant (no proof, no access).
 * Derived from the state: written only when the organisation holds an ACTIVE grant and the latest PURP-06 decision is not already « yes » — so a page reload or a
 * second colleague writes nothing, and an access granted again after a revocation writes a new « yes ». Append-only.
 * @param {any} db @param {string} shareId @param {string} structureId @param {{ channel: string, proof: string }} by
 * @returns {Promise<number>} 1 when a row was written, else 0
 */
export async function recordSharingGranted(db, shareId, structureId, by) {
  const dossier = String(shareId || ''), org = String(structureId || '');
  if (!dossier || !org || !by?.channel || !by?.proof) return 0;
  const subject = `${dossier}:${org}`;
  const out = await db.execute(sql`
    INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, withdrawn_at, policy_version, policy_hash, collection_channel, guardian_involved, proof_level, created_at)
    SELECT gen_random_uuid()::text, 'SHARED_DOSSIER_GRANT', ${subject}, ${SHARING_PURPOSE}, true, NULL, ${DOSSIER_PURPOSE_POLICY_VERSION}, ${dossierPurposePolicyHash(SHARING_PURPOSE)},
           ${by.channel}, false, ${by.proof}, ${nextDecisionAt('SHARED_DOSSIER_GRANT', subject, SHARING_PURPOSE)}
    WHERE EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = ${dossier} AND g."structureId" = ${org} AND g."revokedAt" IS NULL)
      AND (SELECT c.decision FROM "ConsentLog" c WHERE c.subject_type = 'SHARED_DOSSIER_GRANT' AND c.subject_id = ${subject} AND c.purpose = ${SHARING_PURPOSE}
           ORDER BY c.created_at DESC LIMIT 1) IS NOT TRUE
    RETURNING id`);
  return (out.rows || []).length;
}

/**
 * A-21 — when the owner removes an organisation (or stops sharing), the purposes that organisation still held end with its access: the ledger must say so.
 * Before: the grant was revoked (enforcement correct) but the last ledger row of PURP-05 / PURP-07 stayed « yes », so the ledger and the personal-data export
 * showed a consent that no longer applied.
 *
 * Derived from the STATE, not from the caller: a withdrawal row is appended for every (dossier, organisation, purpose) whose LATEST decision is « yes » while the
 * organisation holds NO active grant on the dossier. So it is idempotent (a second call finds a latest « no »), it never touches an organisation that keeps its
 * access (changing one purpose is recorded by its own action), and it also closes rows left open by an earlier revocation. The new row copies the policy version,
 * hash, channel and proof level of the decision it withdraws and is strictly later than it. Append-only: nothing is updated.
 * FA-D5: the same call also writes the PURP-06 (sharing) withdrawal of every revoked grant of the dossier — see the second statement below.
 * @param {any} db @param {string} shareId @param {string | null} [structureId] one organisation, or every organisation of the dossier
 * @returns {Promise<number>} the number of withdrawal rows written
 */
export async function withdrawPurposesOfRevokedGrants(db, shareId, structureId = null) {
  const dossier = String(shareId || '');
  if (!dossier) return 0;
  const subjects = structureId ? sql`c.subject_id = ${`${dossier}:${String(structureId)}`}` : sql`split_part(c.subject_id, ':', 1) = ${dossier}`;
  const out = await db.execute(sql`
    INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, withdrawn_at, policy_version, policy_hash, collection_channel, guardian_involved, proof_level, created_at)
    SELECT gen_random_uuid()::text, l.subject_type, l.subject_id, l.purpose, false, LOCALTIMESTAMP(3), l.policy_version, l.policy_hash, l.collection_channel, COALESCE(l.guardian_involved, false), l.proof_level,
           GREATEST(LOCALTIMESTAMP(3), l.created_at + interval '1 millisecond')
    FROM (
      SELECT DISTINCT ON (c.subject_id, c.purpose) c.* FROM "ConsentLog" c
      WHERE c.subject_type = 'SHARED_DOSSIER_GRANT' AND ${subjects} AND c.purpose IN (${sql.join(GRANT_PURPOSES_WITH_OWN_DECISION.map((p) => sql`${p}`), sql`, `)})
      ORDER BY c.subject_id, c.purpose, c.created_at DESC
    ) l
    WHERE l.decision IS TRUE
      AND NOT EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" || ':' || g."structureId" = l.subject_id AND g."revokedAt" IS NULL)
    RETURNING id`);
  // FA-D5 — PURP-06 itself: every REVOKED grant of the dossier (or of that organisation) whose latest PURP-06 decision is not already « no ». A grant that never
  // had a ledger row (created before this change, or by the transitional legacy link) gets its withdrawal too, with the dossier-purpose policy. withdrawn_at is
  // the moment the access ended (the grant's revokedAt), created_at the moment the ledger records it, strictly after any earlier decision.
  const grantScope = structureId ? sql`AND g."structureId" = ${String(structureId)}` : sql``;
  const sharing = await db.execute(sql`
    INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, withdrawn_at, policy_version, policy_hash, collection_channel, guardian_involved, proof_level, created_at)
    SELECT gen_random_uuid()::text, 'SHARED_DOSSIER_GRANT', s.subject_id, ${SHARING_PURPOSE}, false, s.revoked_at,
           COALESCE(l.policy_version, ${DOSSIER_PURPOSE_POLICY_VERSION}), COALESCE(l.policy_hash, ${dossierPurposePolicyHash(SHARING_PURPOSE)}),
           COALESCE(l.collection_channel, 'owner_link'), COALESCE(l.guardian_involved, false), COALESCE(l.proof_level, 'OWNER_SECRET'),
           GREATEST(LOCALTIMESTAMP(3), COALESCE(l.created_at + interval '1 millisecond', LOCALTIMESTAMP(3)))
    FROM (SELECT g."sharedDiagnosticId" || ':' || g."structureId" AS subject_id, g."revokedAt" AS revoked_at FROM "SharedDossierGrant" g
          WHERE g."sharedDiagnosticId" = ${dossier} ${grantScope} AND g."revokedAt" IS NOT NULL) s
    LEFT JOIN LATERAL (SELECT c.* FROM "ConsentLog" c WHERE c.subject_type = 'SHARED_DOSSIER_GRANT' AND c.subject_id = s.subject_id AND c.purpose = ${SHARING_PURPOSE}
                       ORDER BY c.created_at DESC LIMIT 1) l ON TRUE
    WHERE l.decision IS NOT FALSE
    RETURNING id`);
  return (out.rows || []).length + (sharing.rows || []).length;
}
