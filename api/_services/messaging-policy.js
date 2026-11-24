// @ts-check
/**
 * R3 (24/11/2026) — the per-conversation decision of the appointment messaging (capability `messaging.conversations`, api/_utils/capabilities.js).
 *
 * The route gate lets a conversation route through in its best case (capability listed, surface open). Each conversation is then decided here, from its
 * appointment: it is served ONLY when (G14-R4: whatever the HDS attestation says — the messages are stored in Neon, not at the HDS service)
 *   - the appointment's structure is positively classified NOT_ESSMS by the reviewed rule of the social referral (verified, active, no FINESS registration,
 *     a reviewed non-medical kind, no sensitive word — api/lib/social-referral-policy.js), AND
 *   - the appointment's service is reviewed « ordinary » by an administrator (api/lib/service-sensitivity.js; unknown = sensitive, fail closed).
 * Otherwise (ESSMS, health, unknown kind, sensitive or unreviewed service) the free text may be health data hosted on behalf of a care / medico-social
 * follow-up (R44 AIPD § 11.5, R45 matrix row 5): the conversation stays closed (owner decision P29: NOT_ESSMS + ordinary only); an HDS attestation does not
 * open it, since its text is not stored at the HDS service. Attachments are a separate capability (`messaging.attachments`, stored at the HDS service).
 *
 * Nothing here reads a message: one query on the appointment, its structure and the stored service review. No personal data is logged or answered.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { capabilityEnforced, capabilityOpen, capabilityRefusal, capabilityState, STORED_OUTSIDE_HDS } from '../_utils/capabilities.js';
import { socialReferralStructureClass } from '../lib/social-referral-policy.js';
import { SENSITIVITY, resolveServiceSensitivity } from '../lib/service-sensitivity.js';

export const CONVERSATIONS = 'messaging.conversations';
export const ATTACHMENTS = 'messaging.attachments';

/** @param {any} res */
const rowsOf = (res) => (Array.isArray(res?.rows) ? res.rows : Array.isArray(res) ? res : []);

/**
 * The HDS class of one conversation from its appointment row (pure).
 * @param {{ statut?: string | null, verification_status?: string | null, numero_finess?: string | null, type_finess?: string | null, type_structure?: string | null, nom?: string | null, sensitivity?: unknown } | null | undefined} row
 * @returns {{ structureCategory: 'NOT_ESSMS' | 'UNKNOWN', reason: string | null }}
 */
export function conversationClass(row) {
  if (!row) return { structureCategory: 'UNKNOWN', reason: 'NOT_FOUND' };
  const cls = socialReferralStructureClass(row);
  if (cls.category !== 'NOT_ESSMS') return { structureCategory: 'UNKNOWN', reason: cls.reason || cls.category };
  if (resolveServiceSensitivity(row.sensitivity) !== SENSITIVITY.ORDINARY) return { structureCategory: 'UNKNOWN', reason: 'SERVICE_NOT_REVIEWED_ORDINARY' };
  return { structureCategory: 'NOT_ESSMS', reason: null };
}

/**
 * The decision for one conversation's appointment row (pure).
 * @param {Parameters<typeof conversationClass>[0]} row @param {Record<string, string | undefined>} [envVars]
 * @returns {{ open: boolean, reason: string | null }}
 */
export function conversationDecision(row, envVars = process.env) {
  if (!capabilityEnforced(envVars)) return { open: true, reason: 'ENFORCEMENT_OFF' };   // development / test LAB only, like every capability
  const { structureCategory, reason } = conversationClass(row);
  const state = capabilityState(CONVERSATIONS, envVars, { structureCategory });
  return state.open ? { open: true, reason: null } : { open: false, reason: (state.reason === 'HDS_HOSTING_NOT_ATTESTED' || state.reason === STORED_OUTSIDE_HDS) && reason ? `HDS_REQUIRED:${reason}` : state.reason };
}

/** the appointment rows of these appointment ids, with what the decision needs @param {string[]} appointmentIds @param {any} db */
async function appointmentRows(appointmentIds, db) {
  const ids = [...new Set(appointmentIds.map(String).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = rowsOf(await db.execute(sql`SELECT a.id, s.statut, s.verification_status, s.numero_finess, s.type_finess, s.type_structure, s.nom,
      s.settings_json -> 'serviceSensitivity' -> 'services' -> a."serviceId" AS sensitivity
    FROM "ProAppointment" a JOIN "Structure" s ON s.id = a."structureId" WHERE a.id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`));
  return new Map(rows.map((/** @type {any} */ r) => [String(r.id), r]));
}

/**
 * The decisions for several appointments at once (a conversation list). Without enforcement nothing is read.
 * @param {string[]} appointmentIds @param {{ db?: any, envVars?: Record<string, string | undefined> }} [deps]
 * @returns {Promise<Map<string, { open: boolean, reason: string | null }>>}
 */
export async function conversationDecisions(appointmentIds, deps = {}) {
  const envVars = deps.envVars || process.env;
  if (!capabilityEnforced(envVars)) return new Map(appointmentIds.map((id) => [String(id), { open: true, reason: 'ENFORCEMENT_OFF' }]));
  let rows = new Map();
  try { rows = await appointmentRows(appointmentIds, deps.db || defaultDb); } catch { rows = new Map(); }   // a read failure decides « closed »
  return new Map(appointmentIds.map((id) => [String(id), conversationDecision(rows.get(String(id)) || null, envVars)]));
}

/** @param {string} appointmentId @param {{ db?: any, envVars?: Record<string, string | undefined> }} [deps] */
export async function conversationAllowed(appointmentId, deps = {}) {
  return (await conversationDecisions([String(appointmentId || '')], deps)).get(String(appointmentId || '')) || { open: false, reason: 'NOT_FOUND' };
}

/** may files be attached to (or read from) a conversation here @param {Record<string, string | undefined>} [envVars] */
export function attachmentsOpen(envVars = process.env) {
  return capabilityOpen(ATTACHMENTS, envVars);
}

/** 503 CAPABILITY_NOT_OPEN for a conversation that stays closed here (no data, the same answer whatever the reason) @param {any} res @param {string} [capability] */
export function refuseClosed(res, capability = CONVERSATIONS) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json(capabilityRefusal(capability));
}
