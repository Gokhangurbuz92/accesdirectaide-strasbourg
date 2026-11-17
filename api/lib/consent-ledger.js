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

/**
 * A-21 — when the owner removes an organisation (or stops sharing), the purposes that organisation still held end with its access: the ledger must say so.
 * Before: the grant was revoked (enforcement correct) but the last ledger row of PURP-05 / PURP-07 stayed « yes », so the ledger and the personal-data export
 * showed a consent that no longer applied.
 *
 * Derived from the STATE, not from the caller: a withdrawal row is appended for every (dossier, organisation, purpose) whose LATEST decision is « yes » while the
 * organisation holds NO active grant on the dossier. So it is idempotent (a second call finds a latest « no »), it never touches an organisation that keeps its
 * access (changing one purpose is recorded by its own action), and it also closes rows left open by an earlier revocation. The new row copies the policy version,
 * hash, channel and proof level of the decision it withdraws and is strictly later than it. Append-only: nothing is updated.
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
  return (out.rows || []).length;
}
