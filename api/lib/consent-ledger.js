import { sql } from 'drizzle-orm';

/**
 * PKG-11 / C22 — a new consent-ledger row is strictly LATER than the previous decision of the same subject / purpose. Two decisions recorded in the same
 * millisecond used to tie on created_at, so « the latest decision » (what applies now, what retention keeps) became arbitrary.
 * @param {string} subjectType @param {string} subjectId @param {string | null} purpose
 */
export const nextDecisionAt = (subjectType, subjectId, purpose) => sql`GREATEST(LOCALTIMESTAMP(3), COALESCE((SELECT max(c.created_at) FROM "ConsentLog" c
  WHERE c.subject_type = ${subjectType} AND c.subject_id = ${subjectId} AND c.purpose IS NOT DISTINCT FROM ${purpose}) + interval '1 millisecond', LOCALTIMESTAMP(3)))`;
