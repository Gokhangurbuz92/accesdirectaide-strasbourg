// @ts-check
/**
 * G14 release 3 — storage and review of a place's own booking page ("StructureExternalBooking", drizzle/0063). Only writer of that table.
 *
 *   submitExternalBooking   a structure administrator (source PRO), an administrator (ADMIN) or the open-data import (IMPORT) records the page. The URL must
 *                           pass validateExternalBookingUrl (api/lib/external-booking.js). A new or CHANGED page (URL or needs) is PENDING: nothing is
 *                           shown until an administrator approves it. An import never replaces a page recorded by the structure or an administrator, and
 *                           never one already reviewed.
 *   reviewExternalBooking   an administrator (named session with MFA) APPROVES or REJECTS, with a note (10–500 characters, plain text) — like the other
 *                           publication flows (structure proposals, service sensitivity). An approved page can later be rejected (withdrawn).
 *   removeExternalBooking   the structure administrator deletes its page.
 *   approvedExternalBookings / externalBookingSql   the public reads: APPROVED rows only; the switch (ADA_EXTERNAL_BOOKING) is applied by the callers through
 *                           publicExternalBooking(), so nothing reaches a public answer while it is closed.
 * Every write leaves one AuditLog row « external_booking.* » with identifiers and the decision only (no URL, no note text). No person's data is stored.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { bookingReachSchema } from '../_utils/schema-features.js';
import { validateExternalBookingUrl } from '../lib/external-booking.js';
import { parseServiceSubdomains } from '../lib/service-needs.js';

export const NOT_AVAILABLE = Object.freeze({ status: 503, code: 'EXTERNAL_BOOKING_NOT_AVAILABLE', message: 'Cette fonction n’est pas encore installée sur ce serveur.' });
const SOURCES = ['PRO', 'ADMIN', 'IMPORT'];
const ID = /^[A-Za-z0-9_-]{1,128}$/;
// a tag, a comment, a doctype or a character reference
const MARKUP = /<\s*[a-zA-Z!/?]|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]{2,8});/;

/** @param {any} res */
const rowsOf = (res) => (Array.isArray(res?.rows) ? res.rows : Array.isArray(res) ? res : []);
/** @param {any} database */
export const externalBookingAvailable = async (database = defaultDb) => (await bookingReachSchema(database)).external;

/** @param {any} database @param {string} action @param {string} actor @param {string} structureId @param {Record<string, unknown>} details */
async function audit(database, action, actor, structureId, details) {
  try { await database.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'Structure', entity_id: structureId, target: structureId, details }); } catch { /* the journal never blocks the decision */ }
}

/** the stored record of one place, or null @param {string} structureId @param {any} [database] */
export async function readExternalBooking(structureId, database = defaultDb) {
  const rows = rowsOf(await database.execute(sql`SELECT "structureId", url, platform, subdomains, status, source, "submittedAt", "reviewedAt", "reviewNote", "updatedAt"
    FROM "StructureExternalBooking" WHERE "structureId" = ${structureId}`));
  return rows[0] || null;
}

/**
 * @param {{ structureId: unknown, url: unknown, subdomains?: unknown, source: string, by: string, sourceRef?: string | null }} input @param {any} [database]
 * @returns {Promise<{ ok: true, record: any, changed: boolean } | { ok: false, status: number, code: string }>}
 */
export async function submitExternalBooking(input, database = defaultDb) {
  if (!(await externalBookingAvailable(database))) return { ok: false, status: NOT_AVAILABLE.status, code: NOT_AVAILABLE.code };
  const structureId = typeof input.structureId === 'string' ? input.structureId.trim() : '';
  if (!ID.test(structureId) || !SOURCES.includes(input.source)) return { ok: false, status: 400, code: 'INVALID_REQUEST' };
  const v = validateExternalBookingUrl(input.url);
  if (!v.ok) return { ok: false, status: 400, code: v.code };
  const needs = input.subdomains === undefined ? { ok: /** @type {const} */ (true), value: /** @type {any[]} */ ([]) } : parseServiceSubdomains(input.subdomains);
  if (!needs.ok) return { ok: false, status: 400, code: needs.code };
  const subdomains = needs.value.map((x) => x.subdomain);
  const exists = rowsOf(await database.execute(sql`SELECT 1 FROM "Structure" WHERE id = ${structureId}`)).length > 0;
  if (!exists) return { ok: false, status: 404, code: 'STRUCTURE_NOT_FOUND' };
  const current = await readExternalBooking(structureId, database);
  const sameContent = current && current.url === v.url && JSON.stringify([...(current.subdomains || [])].sort()) === JSON.stringify(subdomains);
  if (input.source === 'IMPORT' && current) return { ok: true, record: current, changed: false };   // never over a structure's, an administrator's or a reviewed page
  if (sameContent) return { ok: true, record: current, changed: false };
  const subs = `{${subdomains.join(',')}}`;
  await database.execute(sql`INSERT INTO "StructureExternalBooking" ("structureId", url, platform, subdomains, status, source, "sourceRef", "submittedBy", "submittedAt", "updatedAt")
    VALUES (${structureId}, ${v.url}, ${v.platform}, ${subs}::text[], 'PENDING', ${input.source}, ${input.sourceRef ?? null}, ${input.by || null}, now(), now())
    ON CONFLICT ("structureId") DO UPDATE SET url = EXCLUDED.url, platform = EXCLUDED.platform, subdomains = EXCLUDED.subdomains, status = 'PENDING',
      source = EXCLUDED.source, "sourceRef" = EXCLUDED."sourceRef", "submittedBy" = EXCLUDED."submittedBy", "submittedAt" = now(), "reviewedBy" = NULL,
      "reviewedAt" = NULL, "reviewNote" = NULL, "updatedAt" = now()`);
  await audit(database, 'external_booking.submitted', input.by || 'system', structureId, { source: input.source, platform: v.platform, previousStatus: current?.status || null });
  return { ok: true, record: await readExternalBooking(structureId, database), changed: true };
}

/** @param {string} structureId @param {string} by @param {any} [database] */
export async function removeExternalBooking(structureId, by, database = defaultDb) {
  if (!(await externalBookingAvailable(database))) return { ok: false, status: NOT_AVAILABLE.status, code: NOT_AVAILABLE.code };
  const rows = rowsOf(await database.execute(sql`DELETE FROM "StructureExternalBooking" WHERE "structureId" = ${structureId} RETURNING status`));
  if (!rows.length) return { ok: false, status: 404, code: 'NOT_FOUND' };
  await audit(database, 'external_booking.removed', by, structureId, { previousStatus: rows[0].status });
  return { ok: true };
}

/**
 * @param {{ structureId: unknown, decision: unknown, note: unknown, by: string }} input @param {any} [database]
 * @returns {Promise<{ ok: true, previous: string, status: string } | { ok: false, status: number, code: string }>}
 */
export async function reviewExternalBooking(input, database = defaultDb) {
  if (!(await externalBookingAvailable(database))) return { ok: false, status: NOT_AVAILABLE.status, code: NOT_AVAILABLE.code };
  const structureId = typeof input.structureId === 'string' ? input.structureId.trim() : '';
  const decision = String(input.decision || '').toUpperCase();
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!ID.test(structureId) || !['APPROVE', 'REJECT'].includes(decision)) return { ok: false, status: 400, code: 'INVALID_REQUEST' };
  if (note.length < 10 || note.length > 500 || MARKUP.test(note)) return { ok: false, status: 400, code: 'NOTE_REQUIRED' };
  if (!input.by) return { ok: false, status: 403, code: 'HUMAN_MFA_SESSION_REQUIRED' };
  const current = await readExternalBooking(structureId, database);
  if (!current) return { ok: false, status: 404, code: 'NOT_FOUND' };
  // an approval re-checks the stored URL against today's rules (a rule tightened since the submission is applied)
  if (decision === 'APPROVE' && !validateExternalBookingUrl(current.url).ok) return { ok: false, status: 409, code: 'URL_NO_LONGER_VALID' };
  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await database.execute(sql`UPDATE "StructureExternalBooking" SET status = ${status}, "reviewedBy" = ${input.by}, "reviewedAt" = now(), "reviewNote" = ${note}, "updatedAt" = now()
    WHERE "structureId" = ${structureId}`);
  await audit(database, 'external_booking.reviewed', input.by, structureId, { previous: current.status, status, platform: current.platform, source: current.source });
  return { ok: true, previous: String(current.status), status };
}

/** the administrator's queue (newest first; never a citizen's data) @param {{ status?: string, limit?: number }} [q] @param {any} [database] */
export async function listExternalBookings({ status = 'PENDING', limit = 100 } = {}, database = defaultDb) {
  if (!(await externalBookingAvailable(database))) return null;
  const st = ['PENDING', 'APPROVED', 'REJECTED'].includes(String(status).toUpperCase()) ? String(status).toUpperCase() : 'PENDING';
  const n = Math.min(200, Math.max(1, Math.trunc(Number(limit)) || 100));
  const rows = rowsOf(await database.execute(sql`SELECT e."structureId", s.nom, s.slug, s.site_web, e.url, e.platform, e.subdomains, e.status, e.source, e."sourceRef",
      e."submittedAt", e."reviewedBy", e."reviewedAt", e."reviewNote"
    FROM "StructureExternalBooking" e JOIN "Structure" s ON s.id = e."structureId" WHERE e.status = ${st} ORDER BY e."submittedAt" DESC LIMIT ${n}`));
  return rows.map((/** @type {any} */ r) => {
    const v = validateExternalBookingUrl(r.url);
    let sameHostAsWebsite = null;
    try { sameHostAsWebsite = r.site_web && v.ok ? new URL(String(r.site_web)).hostname.toLowerCase().replace(/^www\./, '') === v.host.replace(/^www\./, '') : null; } catch { sameHostAsWebsite = null; }
    return { ...r, urlValid: v.ok, sameHostAsWebsite };
  });
}

/** the APPROVED rows of these places, a Map structureId → row (empty when 0063 is absent) @param {string[]} structureIds @param {any} [database] */
export async function approvedExternalBookings(structureIds, database = defaultDb) {
  /** @type {Map<string, any>} */
  const out = new Map();
  const ids = [...new Set((structureIds || []).filter((x) => typeof x === 'string' && x))];
  if (!ids.length || !(await externalBookingAvailable(database))) return out;
  const rows = rowsOf(await database.execute(sql`SELECT "structureId", url, platform, subdomains, status FROM "StructureExternalBooking"
    WHERE status = 'APPROVED' AND "structureId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
  for (const r of rows) out.set(String(r.structureId), r);
  return out;
}

/**
 * The SQL predicate « this place has an APPROVED own booking page » on the row aliased `alias`, optionally for one of these needs and/or on a recognised
 * platform only. The caller applies it only when the switch is open and 0063 exists.
 * @param {{ alias?: string, subdomains?: string[] | null, platformsOnly?: boolean }} [opts]
 */
export function externalBookingSql({ alias = 'Structure', subdomains = null, platformsOnly = false } = {}) {
  const S = sql.raw(`"${alias.replace(/[^A-Za-z0-9_]/g, '')}"`);
  const needs = Array.isArray(subdomains) ? sql` AND eb.subdomains && ${`{${subdomains.join(',')}}`}::text[]` : sql``;
  const platform = platformsOnly ? sql` AND eb.platform <> 'other'` : sql``;
  return sql`EXISTS (SELECT 1 FROM "StructureExternalBooking" eb WHERE eb."structureId" = ${S}.id AND eb.status = 'APPROVED'${platform}${needs})`;
}

/**
 * Open-data import: the booking pages a source gives (data·inclusion « prise_rdv »), proposed as PENDING records for review — never published by the import.
 * @param {Map<string, { url: string, ref: string }>} candidates structureId → page @param {{ dryRun?: boolean }} [opts] @param {any} [database]
 * @returns {Promise<{ available: boolean, proposed: number, kept: number, invalid: number }>}
 */
export async function proposeImportedExternalBookings(candidates, { dryRun = false } = {}, database = defaultDb) {
  const out = { available: false, proposed: 0, kept: 0, invalid: 0 };
  if (!candidates || !candidates.size || !(await externalBookingAvailable(database))) return out;
  out.available = true;
  for (const [structureId, c] of candidates) {
    if (!validateExternalBookingUrl(c.url).ok) { out.invalid += 1; continue; }
    if (dryRun) { out.proposed += 1; continue; }
    const r = await submitExternalBooking({ structureId, url: c.url, source: 'IMPORT', by: 'system:data-inclusion', sourceRef: c.ref }, database);
    if (r.ok && r.changed) out.proposed += 1; else if (r.ok) out.kept += 1; else out.invalid += 1;
  }
  return out;
}
