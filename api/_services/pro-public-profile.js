/**
 * R47 — the PUBLIC display name and title of a professional (ProProfile.displayName / jobTitle, present since migration 0005: Production 0042 has them).
 * They are what a person sees when the structure makes this professional selectable for a booking (api/_services/rdv-team.js: never an e-mail, never
 * an account id). Nothing here makes a professional visible in a directory: ProProfile.isPubliclyVisible is not touched.
 *
 * Who writes: every professional their OWN name (self-service); the structure's administrator for a member of THEIR structure (an unknown id, a disabled
 * member or another structure's member is the same 404). Journaled (AuditLog PRO_PROFILE_UPDATED: member id, whether each field is set — never the text).
 *
 * Validation (pure, below): Unicode NFC, trimmed, inner spaces collapsed; display name 2–60 characters, title up to 80, both optional (empty = removed:
 * the member then cannot be chosen by name); letters of any script, digits, spaces and . , ' ’ - ( ) & / only — so no HTML, no markup, no control
 * character, no e-mail address; no web address either. A name must start with a letter or a digit.
 */
import crypto from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProProfile, ProUser } from '../../src/db/schema.js';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 60;
export const JOB_TITLE_MAX = 80;
const ALLOWED = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’\-()&/]*$/u;
const WEB = /(https?:|www\.|\b[\p{L}\p{N}-]+\.(?:fr|com|org|net|eu|io|info|biz|de|uk|tr|ua)\b)/iu;

/** @param {unknown} v @returns {string} */
const clean = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/gu, ' ').trim() : '');

/**
 * @param {unknown} raw @param {{ max: number, min?: number, field: 'displayName' | 'jobTitle' }} rule
 * @returns {{ value: string | null } | { error: string }}
 */
function check(raw, { max, min = 1, field }) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { error: `${field.toUpperCase()}_INVALID` };
  const v = clean(raw);
  if (!v) return { value: null };
  if ([...v].length > max) return { error: `${field.toUpperCase()}_TOO_LONG` };
  if ([...v].length < min) return { error: `${field.toUpperCase()}_TOO_SHORT` };
  if (!ALLOWED.test(v) || WEB.test(v)) return { error: `${field.toUpperCase()}_INVALID` };
  return { value: v };
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, value: { displayName: string | null, jobTitle: string | null } } | { ok: false, field: 'displayName' | 'jobTitle', code: string }}
 */
export function validatePublicProfile(body) {
  const name = check(body?.displayName, { max: DISPLAY_NAME_MAX, min: DISPLAY_NAME_MIN, field: 'displayName' });
  if ('error' in name) return { ok: false, field: 'displayName', code: name.error };
  const title = check(body?.jobTitle, { max: JOB_TITLE_MAX, field: 'jobTitle' });
  if ('error' in title) return { ok: false, field: 'jobTitle', code: title.error };
  return { ok: true, value: { displayName: name.value, jobTitle: title.value } };
}

/** the active members of a structure with their public name (never another structure's) @param {string} structureId @param {typeof defaultDb} [database] */
export async function membersWithProfiles(structureId, database = defaultDb) {
  const users = await database.select({ id: ProUser.id, email: ProUser.email, role: ProUser.role }).from(ProUser)
    .where(and(eq(ProUser.structureId, structureId), eq(ProUser.status, 'active'))).orderBy(asc(ProUser.email));
  const profiles = users.length ? await database.select({ proUserId: ProProfile.proUserId, displayName: ProProfile.displayName, jobTitle: ProProfile.jobTitle }).from(ProProfile)
    .where(inArray(ProProfile.proUserId, users.map((u) => u.id))) : [];
  const byId = new Map(profiles.map((p) => [p.proUserId, p]));
  return users.map((u) => ({ id: u.id, email: u.email, role: u.role, displayName: byId.get(u.id)?.displayName || null, jobTitle: byId.get(u.id)?.jobTitle || null }));
}

/**
 * Upsert the two public fields of one member (the other ProProfile fields are kept). @param {string} proUserId
 * @param {{ displayName: string | null, jobTitle: string | null }} value @param {typeof defaultDb} [database]
 */
export async function writePublicProfile(proUserId, value, database = defaultDb) {
  const now = new Date();
  await database.insert(ProProfile).values({ id: `pp_${crypto.randomUUID()}`, proUserId, displayName: value.displayName, jobTitle: value.jobTitle, updatedAt: now })
    .onConflictDoUpdate({ target: ProProfile.proUserId, set: { displayName: value.displayName, jobTitle: value.jobTitle, updatedAt: now } });
}
