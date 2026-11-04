/**
 * R42 (owner decision R42-A07): booking needs an ADULT account (api/_utils/age-policy.js isAdultAccount, R42-AUTH): a verified e-mail and the latest
 * AGE_DECLARATION_ADULT statement « 18 or over » in the append-only ConsentLog. Test citizens that book make that statement here (and, optionally, a
 * profile age band). ConsentLog rows are append-only (trigger): they stay in the disposable test database.
 * @param {{ execute: Function }} db @param {Function} sql the drizzle sql tag @param {string[]} ids @param {{ adult?: boolean, band?: string | null }} [o]
 */
export async function declareAdult(db, sql, ids, o = {}) {
  const adult = o.adult !== false;
  for (const id of ids) {
    await db.execute(sql`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level)
      VALUES (gen_random_uuid()::text, 'CITIZEN_USER', ${id}, 'AGE_DECLARATION_ADULT', ${adult}, 'r42-a07-2026-11-04', 'r42-a07-2026-11-04:AGE_DECLARATION_ADULT', 'test', false, 'SELF_DECLARATION')`);
    if (o.band) await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "ageBand", "updatedAt") VALUES (${id}, ${o.band}, NOW()) ON CONFLICT ("userId") DO UPDATE SET "ageBand" = EXCLUDED."ageBand"`);
  }
}
