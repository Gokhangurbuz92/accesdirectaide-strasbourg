/**
 * R42 (owner decision R42-A07): booking needs an account that declared an ADULT age band (api/_utils/age-policy.js). Test citizens that book declare one
 * here (CitizenProfile.ageBand; the row is removed with the account: ON DELETE CASCADE).
 * @param {{ execute: Function }} db @param {Function} sql the drizzle sql tag @param {string[]} ids @param {string} [band]
 */
export async function declareAdult(db, sql, ids, band = '25-59') {
  for (const id of ids) {
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "ageBand", "updatedAt") VALUES (${id}, ${band}, NOW()) ON CONFLICT ("userId") DO UPDATE SET "ageBand" = EXCLUDED."ageBand"`);
  }
}
