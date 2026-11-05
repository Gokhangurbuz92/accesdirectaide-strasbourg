/**
 * R45 (ENG-LR-2) — storage and administrator review of the sensitivity of bookable services, on the Production schema 0042 (NO migration).
 *
 * Stored under the key `serviceSensitivity` of Structure.settings_json (jsonb, default '{}'; never returned by a public API — api/_handlers/structures.js
 * leaves the column out; the structure's own settings routes write other keys only: rdvBooking, rdvMemberHours). Shape:
 *   { v: 1, services: { <ProRdvService.id>: { value: 'sensitive' | 'ordinary', reviewedAt: ISO, reviewedBy: <administrator e-mail>, reason: text } } }
 * Only reviewServiceSensitivity() writes it, from the administrator route (MFA + elevation, api/_handlers/admin/service-sensitivity.js). A missing or malformed
 * entry reads as 'unknown' (api/lib/service-sensitivity.js resolveServiceSensitivity). The review leaves one AuditLog row « service.sensitivity_reviewed »
 * with identifiers and the values only (no reason text, no personal data of any citizen).
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { SENSITIVITY, resolveServiceSensitivity, suggestSensitivity } from '../lib/service-sensitivity.js';

export const REVIEW_ACTION = 'service.sensitivity_reviewed';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
// a tag, a comment, a doctype or a character reference
const MARKUP = /<\s*[a-zA-Z!/?]|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]{2,8});/;

/** @param {any} res */
const rowsOf = (res) => (Array.isArray(res?.rows) ? res.rows : Array.isArray(res) ? res : []);

/** the raw records of one structure @param {string} structureId @param {any} [database] @returns {Promise<Record<string, unknown>>} */
export async function readSensitivityRecords(structureId, database = defaultDb) {
  const rows = rowsOf(await database.execute(sql`SELECT settings_json -> 'serviceSensitivity' -> 'services' AS s FROM "Structure" WHERE id = ${structureId}`));
  const s = rows[0]?.s;
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

/** the resolved sensitivity of one service ('unknown' when not reviewed, or on any read failure: fail closed) @param {string} structureId @param {string} serviceId @param {any} [database] */
export async function readServiceSensitivity(structureId, serviceId, database = defaultDb) {
  try {
    const records = await readSensitivityRecords(structureId, database);
    return resolveServiceSensitivity(records[serviceId]);
  } catch {
    return SENSITIVITY.UNKNOWN;
  }
}

/** the resolved sensitivity of every service of a structure (a Map serviceId → value; absent = unknown) @param {string} structureId @param {any} [database] */
export async function readServiceSensitivityMap(structureId, database = defaultDb) {
  try {
    const records = await readSensitivityRecords(structureId, database);
    return new Map(Object.entries(records).map(([id, r]) => [id, resolveServiceSensitivity(r)]));
  } catch {
    return new Map();
  }
}

/**
 * The administrator's view of one structure: its active services, the verified value, who/when, and the heuristic SUGGESTION (never applied).
 * @param {string} structureId @param {any} [database]
 */
export async function listForReview(structureId, database = defaultDb) {
  const st = rowsOf(await database.execute(sql`SELECT id, nom, type_structure, type_finess, categories_aidees, services FROM "Structure" WHERE id = ${structureId}`))[0];
  if (!st) return null;
  const services = rowsOf(await database.execute(sql`SELECT id, name, "isActive" FROM "ProRdvService" WHERE "structureId" = ${structureId} ORDER BY name`));
  const records = await readSensitivityRecords(structureId, database);
  const items = services.map((/** @type {any} */ s) => {
    const record = /** @type {any} */ (records[s.id]);
    const value = resolveServiceSensitivity(record);
    return { id: s.id, name: s.name, active: s.isActive === true, value,
      reviewedAt: value === SENSITIVITY.UNKNOWN ? null : record.reviewedAt, reviewedBy: value === SENSITIVITY.UNKNOWN ? null : record.reviewedBy,
      ...suggestSensitivity({ serviceName: s.name, structure: st }) };
  });
  const bookable = items.filter((/** @type {any} */ i) => i.active);
  return { structure: { id: st.id, name: st.nom }, items, reviewComplete: bookable.length > 0 && bookable.every((/** @type {any} */ i) => i.value !== SENSITIVITY.UNKNOWN) };
}

/**
 * @param {{ structureId: unknown, serviceId: unknown, value: unknown, reason: unknown, by: string }} input
 * @param {any} [database]
 * @returns {Promise<{ ok: true, previous: string, value: string, reviewedAt: string | null } | { ok: false, status: number, code: string }>}
 */
export async function reviewServiceSensitivity(input, database = defaultDb) {
  const structureId = typeof input.structureId === 'string' ? input.structureId.trim() : '';
  const serviceId = typeof input.serviceId === 'string' ? input.serviceId.trim() : '';
  const value = input.value;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!ID.test(structureId) || !ID.test(serviceId)) return { ok: false, status: 400, code: 'invalid_target' };
  if (value !== SENSITIVITY.SENSITIVE && value !== SENSITIVITY.ORDINARY && value !== SENSITIVITY.UNKNOWN) return { ok: false, status: 400, code: 'invalid_value' };
  if (Array.from(reason).length < 10 || Array.from(reason).length > 500 || MARKUP.test(reason)) return { ok: false, status: 400, code: 'reason_required' };
  if (!input.by) return { ok: false, status: 403, code: 'reviewer_required' };
  const svc = rowsOf(await database.execute(sql`SELECT id FROM "ProRdvService" WHERE id = ${serviceId} AND "structureId" = ${structureId}`))[0];
  if (!svc) return { ok: false, status: 404, code: 'service_not_found' };
  const previous = resolveServiceSensitivity((await readSensitivityRecords(structureId, database))[serviceId]);
  const reviewedAt = new Date().toISOString();
  if (value === SENSITIVITY.UNKNOWN) {
    // back to « not reviewed »: the entry is removed (the service then follows the unknown rule)
    await database.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{serviceSensitivity}',
      jsonb_build_object('v', 1, 'services', coalesce(settings_json -> 'serviceSensitivity' -> 'services', '{}'::jsonb) - ${serviceId}::text), true) WHERE id = ${structureId}`);
  } else {
    const entry = { value, reviewedAt, reviewedBy: String(input.by), reason };
    await database.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{serviceSensitivity}',
      jsonb_build_object('v', 1, 'services', coalesce(settings_json -> 'serviceSensitivity' -> 'services', '{}'::jsonb) || jsonb_build_object(${serviceId}::text, ${JSON.stringify(entry)}::jsonb)), true)
      WHERE id = ${structureId}`);
  }
  await database.insert(AuditLog).values({ action: REVIEW_ACTION, actor: String(input.by), actor_id: String(input.by), entity: 'ProRdvService', entity_id: serviceId,
    details: { structureId, previous, value, reasonGiven: true } });
  return { ok: true, previous, value, reviewedAt: value === SENSITIVITY.UNKNOWN ? null : reviewedAt };
}
