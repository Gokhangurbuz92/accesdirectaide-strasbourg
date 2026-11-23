// @ts-check
/**
 * G14 release 3 — storage of the needs of bookable services ("ProRdvServiceSubdomain", drizzle/0063). The pro services route is the only writer; every
 * reader asks bookingReachSchema() first (Production may not have 0063: then nothing is read or written and the editor hides the picker).
 */
import { sql } from 'drizzle-orm';
import { bookingReachSchema } from '../_utils/schema-features.js';

/** @param {any} res */
const rowsOf = (res) => (Array.isArray(res?.rows) ? res.rows : Array.isArray(res) ? res : []);

/** the needs of these services, a Map serviceId → sorted subdomain ids (empty when 0063 is absent) @param {any} database @param {string[]} serviceIds */
export async function readServiceNeeds(database, serviceIds) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const ids = [...new Set((serviceIds || []).filter((x) => typeof x === 'string' && x))];
  if (!ids.length || !(await bookingReachSchema(database)).needs) return out;
  const rows = rowsOf(await database.execute(sql`SELECT "serviceId" AS sid, subdomain FROM "ProRdvServiceSubdomain"
    WHERE "serviceId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY subdomain`));
  for (const r of rows) { const l = out.get(String(r.sid)) || []; l.push(String(r.subdomain)); out.set(String(r.sid), l); }
  return out;
}

/**
 * Replace the needs of ONE service (already checked to belong to the caller's structure) by `value` (parseServiceSubdomains output), atomically.
 * @param {any} database @param {string} serviceId @param {Array<{ subdomain: string, domain: string }>} value
 */
export async function writeServiceNeeds(database, serviceId, value) {
  const apply = async (/** @type {any} */ tx) => {
    await tx.execute(sql`DELETE FROM "ProRdvServiceSubdomain" WHERE "serviceId" = ${serviceId}`);
    for (const v of value) {
      await tx.execute(sql`INSERT INTO "ProRdvServiceSubdomain" ("serviceId", subdomain, domain) VALUES (${serviceId}, ${v.subdomain}, ${v.domain}) ON CONFLICT DO NOTHING`);
    }
  };
  if (typeof database.transaction === 'function') await database.transaction(apply);
  else await apply(database);
}
