// @ts-nocheck
/**
 * G14-AID (owner 23/11/2026) — « mode accompagnant » next to the person: a helper (family member, social worker, France Services adviser, an ADA Pro member…)
 * uses the person's OWN signed-in account on the person's device, WITH the person's consent.
 *
 * Fail-closed, consent-first:
 *   - started only by the person, from a normal session of a verified ADULT account (C05: minors are out of scope), not under a processing restriction (art. 18),
 *     not for an account that declared a legal mandate (C23: tutelle / curatelle / représentant are out of scope — a mandate is not an assisted session);
 *     G14-R3G: under a court measure VERIFIED by the administrator (api/_services/legal-protection.js assistRuleFor) the verified representative may be
 *     the helper (role REPRESENTANT_LEGAL + the code of their link, areas the decision covers), which also lifts the C23 refusal for them; a third
 *     party stays refused while the verified measure gives the representative the power to ACT (tutelle, habilitation générale en représentation) and
 *     is allowed under an assistance measure or a mandat spécial (the person keeps the exercise of their rights);
 *   - the person re-enters their password and accepts a consent screen that says who helps (name + role, + structure for a professional), which areas the
 *     helper may use, what the helper can never do, and for how long (30, 60 or 120 minutes — never more than 2 h);
 *   - the session cookie is REPLACED by an assisted session token (claim « assist », api/_utils/user-auth.js) that lives at most until the end; its id is an
 *     AuthToken row (type ASSIST_SESSION, tokenHash « assist: » + sha-256(id) — never a usable token: the reset / verification handlers check their own type,
 *     and the prefix cannot be the hex digest of any raw token) checked on EVERY request (api/_utils/assist-gate.js): ended or expired = no session at all;
 *   - while it runs, only the chosen areas are reachable (assistDecision); the account's security is NEVER reachable: password, e-mail, phone, MFA, account
 *     deletion, full data export, restriction, delegations (no further access can be granted), sharing, household, guardians; Mon Coffre only when the person
 *     ticked it — and never for a professional helper (HDS-gated data, R45 matrix row 8);
 *   - every view (once per area per 10 minutes), every action and every refusal is written to the audit log (AuditLog, entity CitizenUser) and shown to the
 *     person (« fait avec l'aide de … », GET /api/citizen/assist);
 *   - it ends when the person says so (« Terminer » signs out at once; « Continuer seul(e) » needs the person's password again), at its end time, or from
 *     another device of the person.
 * An ADA Pro member is recorded as such only with a one-time helper code shown in their console (GET /api/pro/assist-code: active account, second factor
 * enrolled AND passed in that session); the structure is then recorded from the database, not typed.
 *
 * Storage without a new migration: AuthToken (session), ConsentLog (consent, append-only), AuditLog (history). The clean schema, when a migration is allowed,
 * is listed in the G14-AID report (AssistedSession, AssistedSessionEvent).
 */
import crypto from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, AuthToken, CitizenDelegation, CitizenUser, ConsentLog, ProUser, Structure } from '../../src/db/schema.js';
import { isUnsetPassword, normalizeEmail, verifyPassword } from '../_utils/user-auth.js';
import { isAdultAccount } from '../_utils/age-policy.js';
import { isRestricted } from './processing-restriction.js';
import { env } from '../_utils/env.js';
import { assistRuleFor } from './legal-protection.js';

export const ASSIST_TOKEN_TYPE = 'ASSIST_SESSION';
export const ASSIST_MINUTES = Object.freeze([30, 60, 120]);
export const ASSIST_MAX_MINUTES = 120;
/** what a helper may use, chosen by the person (RDV = appointments and their messages; PROFIL = the profile page; COFFRE = see / download the vault) */
export const ASSIST_AREAS = Object.freeze(['RDV', 'PARCOURS', 'PROFIL', 'COFFRE']);
/** areas a professional helper never gets (HDS-gated data) */
export const PRO_FORBIDDEN_AREAS = Object.freeze(['COFFRE']);
/** G14-R3G: REPRESENTANT_LEGAL = the verified representative of a protected adult (tuteur, curateur…), only with the code of a VERIFIED link (legal-protection.js) */
export const HELPER_ROLES = Object.freeze(['PROCHE', 'TRAVAILLEUR_SOCIAL', 'CONSEILLER_FRANCE_SERVICES', 'BENEVOLE', 'AUTRE', 'REPRESENTANT_LEGAL']);
export const ASSIST_CONSENT_PURPOSE = 'ASSISTED_MODE';
/** the consent text version (DRAFT until the legal review of the notice; the wording is in the G14-AID report) */
export const ASSIST_CONSENT_VERSION = 'assist-2026-11-23-draft';
const LEGAL_ROLES = ['TUTEUR', 'CURATEUR', 'REPRESENTANT'];
const LIVE_DELEGATION = ['INVITED', 'ACTIVE', 'PROOF_REQUIRED'];
const MINUTE = 60000;
const DEDUPE_MS = 10 * MINUTE;

/**
 * Route families that use the citizen session (or another account): while an assisted session runs, a route of these families is REFUSED unless listed below.
 * A route outside them (public information, search, guides…) never reads the person's session, so it is served normally.
 */
export const ACCOUNT_FAMILIES = Object.freeze(['auth', 'citizen', 'rdv', 'messages', 'share', 'download', 'public/dossier-revoke', 'public/dossier-grants',
  'public/passport', 'public/sms-notify', 'pro', 'admin', 'institution', 'login-pro-guard']);
/** always served in an assisted session (the session itself, the Mon Espace summary, the in-app notices) */
const ALWAYS = Object.freeze([['GET', 'auth/me'], ['POST', 'auth/logout'], ['GET', 'citizen/espace'], ['GET', 'citizen/notifications'],
  ['GET', 'citizen/age-declaration'], ['GET', 'citizen/assist'], ['POST', 'citizen/assist']]);
/** the routes of each area: [prefix, methods] (prefix: the path or the path followed by « / »; '*' = every method) */
const AREA_ROUTES = Object.freeze({
  RDV: [['rdv', '*'], ['messages', '*']],
  PARCOURS: [['citizen/parcours', ['GET', 'POST', 'DELETE']]],
  PROFIL: [['citizen/profile', ['GET', 'PUT']]],
  COFFRE: [['citizen/coffre', ['GET']]],   // see and download only: no upload, no deletion by a helper
});

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const under = (p, x) => p === x || p.startsWith(`${x}/`);
const normPath = (p) => String(p || '').replace(/^\/api(\/|$)/, '/').replace(/^\/+/, '').replace(/\/+$/, '').split('?')[0];
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
/** the AuthToken hash of an assisted session id */
export const assistTokenHash = (sid) => `assist:${sha(sid)}`;
/** a short label without control characters (names typed by the person) */
const clean = (v, max) => [...String(v ?? '').normalize('NFC')].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '<' || c === '>' ? ' ' : c)).join('')
  .replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * What an assisted session may do on this route. { allow, kind: 'PUBLIC' | 'ALWAYS' | 'AREA' | 'REFUSED', area }.
 * @param {string} path normalized API path @param {string} method @param {{ areas: string[], pro: boolean }} assist
 */
export function assistDecision(path, method, assist) {
  const p = normPath(path); const m = String(method || 'GET').toUpperCase() === 'HEAD' ? 'GET' : String(method || 'GET').toUpperCase();
  if (!ACCOUNT_FAMILIES.some((f) => under(p, f))) return { allow: true, kind: 'PUBLIC', area: null };
  if (ALWAYS.some(([mm, pp]) => mm === m && pp === p)) return { allow: true, kind: 'ALWAYS', area: null };
  for (const area of assist?.areas || []) {
    if (!ASSIST_AREAS.includes(area) || (assist.pro && PRO_FORBIDDEN_AREAS.includes(area))) continue;
    for (const [prefix, methods] of AREA_ROUTES[area]) {
      if (under(p, prefix) && (methods === '*' || methods.includes(m))) return { allow: true, kind: 'AREA', area };
    }
  }
  const area = Object.entries(AREA_ROUTES).find(([, rules]) => rules.some(([prefix]) => under(p, prefix)))?.[0] || null;
  return { allow: false, kind: 'REFUSED', area };
}

/** the person-facing label of a write made in an assisted session (shown as « fait avec l'aide de … ») @param {string} path @param {string} method */
export function assistActionLabel(path, method) {
  const p = normPath(path); const m = String(method || '').toUpperCase();
  if (p === 'rdv/appointments' && m === 'POST') return 'RDV_BOOKED';
  if (/^rdv\/appointments\/[^/]+\/cancel$/.test(p)) return 'RDV_CANCELLED';
  if (/^rdv\/appointments\/[^/]+\/reschedule$/.test(p)) return 'RDV_MOVED';
  if (under(p, 'messages')) return 'MESSAGE_SENT';
  if (under(p, 'rdv')) return 'RDV_OTHER';
  if (p === 'citizen/parcours') return 'PARCOURS_CHANGED';
  if (p === 'citizen/profile') return 'PROFILE_CHANGED';
  return 'OTHER';
}

/**
 * Is this assisted session still live (its AuthToken row exists for this account, not ended, not expired). A token without an assist claim is not concerned.
 * @param {string} userId @param {{ sid: string, until: number } | null | undefined} assist
 */
export async function assistSessionLive(userId, assist, db = defaultDb, now = Date.now()) {
  if (!assist) return true;
  if (!(Number(assist.until) > now)) return false;
  const [row] = await db.select({ userId: AuthToken.userId, type: AuthToken.type, expiresAt: AuthToken.expiresAt, usedAt: AuthToken.usedAt })
    .from(AuthToken).where(eq(AuthToken.tokenHash, assistTokenHash(assist.sid))).limit(1);
  return Boolean(row && row.type === ASSIST_TOKEN_TYPE && row.userId === userId && !row.usedAt && new Date(row.expiresAt).getTime() > now);
}

/**
 * One line of the person's history of an assisted session. VIEW and REFUSED are written once per area (or route) per 10 minutes (deterministic id: a reload
 * does not flood the history); every ACTION is written. Throws when the database refuses: the caller then refuses the request (no unlogged helper access).
 * @param {string} userId @param {{ sid: string }} assist @param {'VIEW' | 'ACTION' | 'REFUSED'} kind @param {{ area?: string | null, label?: string, method?: string, route?: string }} what
 */
export async function recordAssistEvent(userId, assist, kind, what = {}, db = defaultDb, now = Date.now()) {
  const details = { sid: assist.sid, area: what.area || null, label: what.label || null, method: what.method || null, route: what.route || null };
  const id = kind === 'ACTION' ? crypto.randomUUID() : `assist-${kind.toLowerCase()}:${assist.sid}:${what.area || what.route || '-'}:${Math.floor(now / DEDUPE_MS)}`;
  const rows = await db.insert(AuditLog).values({ id, action: `ASSIST_${kind}`, actor: 'assisted-session', actor_id: userId, entity: 'CitizenUser', entity_id: userId, details })
    .onConflictDoNothing().returning({ id: AuditLog.id });
  return rows[0]?.id || null;
}

/** the outcome (HTTP status) of an action already logged — best effort, never blocks */
export async function recordAssistOutcome(id, status, db = defaultDb) {
  if (!id) return;
  await db.execute(sql`UPDATE "AuditLog" SET details = jsonb_set(COALESCE(details, '{}'::jsonb), '{outcome}', to_jsonb(${Number(status) || 0}::int)) WHERE id = ${id}`).catch(() => {});
}

// ───────────── ADA Pro helper code
const CODE_WINDOW_MS = 10 * MINUTE;
const codeSecret = () => env.auth?.secret || env.secrets?.jwtSecret || '';
/** the 8-digit helper code of a professional for a 10-minute window (HMAC of the server secret; nothing stored) */
export function proHelperCode(proUserId, at = Date.now(), secret = codeSecret()) {
  if (!secret) throw new Error('Missing signing secret');
  const w = Math.floor(at / CODE_WINDOW_MS);
  const h = crypto.createHmac('sha256', String(secret)).update(`ada-assist-code|v1|${proUserId}|${w}`).digest();
  return String(h.readUIntBE(0, 6) % 100000000).padStart(8, '0');
}
/** valid for the current and the previous window (10 to 20 minutes) — compared in constant time */
export function proHelperCodeValid(proUserId, code, at = Date.now(), secret = codeSecret()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 8 || !secret) return false;
  return [0, 1].some((k) => crypto.timingSafeEqual(Buffer.from(proHelperCode(proUserId, at - k * CODE_WINDOW_MS, secret)), Buffer.from(c)));
}

/**
 * The code a professional shows to the person (GET /api/pro/assist-code). Only an ACTIVE account with the second factor enrolled and passed in this session.
 * @param {{ userId: string, structureId: string, mfa: boolean }} pro
 */
export async function issueProHelperCode(pro, db = defaultDb, now = Date.now()) {
  if (pro.mfa !== true) return bad('PRO_MFA_REQUIRED', 'Reconnectez-vous avec la double authentification pour obtenir un code d’accompagnement.', 403);
  const [u] = await db.select({ id: ProUser.id, status: ProUser.status, mfa: ProUser.mfa_enabled, structureId: ProUser.structureId, structure: Structure.nom })
    .from(ProUser).leftJoin(Structure, eq(Structure.id, ProUser.structureId)).where(and(eq(ProUser.id, pro.userId), eq(ProUser.structureId, pro.structureId))).limit(1);
  if (!u || u.status !== 'active' || u.mfa !== true) return bad('PRO_NOT_ELIGIBLE', 'Seul un compte ADA Pro actif, avec la double authentification, peut accompagner une personne.', 403);
  const code = proHelperCode(u.id, now);
  const validUntil = new Date((Math.floor(now / CODE_WINDOW_MS) + 2) * CODE_WINDOW_MS);
  await db.insert(AuditLog).values({ action: 'ASSIST_PRO_CODE_ISSUED', actor: u.id, actor_id: u.id, entity: 'ProUser', entity_id: u.id, details: { structureId: u.structureId } });
  return { ok: true, status: 200, code: `${code.slice(0, 4)} ${code.slice(4)}`, validUntil, structureName: u.structure || '' };
}

async function verifyProHelper(email, code, db, now) {
  const e = normalizeEmail(email);
  if (!e || !code) return null;
  const rows = await db.select({ id: ProUser.id, status: ProUser.status, mfa: ProUser.mfa_enabled, structureId: ProUser.structureId, structure: Structure.nom })
    .from(ProUser).leftJoin(Structure, eq(Structure.id, ProUser.structureId)).where(sql`lower(${ProUser.email}) = ${e}`).limit(20);
  const hit = rows.find((r) => r.status === 'active' && r.mfa === true && proHelperCodeValid(r.id, code, now));
  return hit ? { id: hit.id, structureId: hit.structureId, structureName: hit.structure || '' } : null;
}

// ───────────── the person's side
const publicView = (claim, helper) => ({ sid: claim.sid, areas: claim.areas, until: new Date(claim.until).toISOString(),
  helper: { name: helper.name, role: helper.role, structureName: helper.structureName || null, verifiedPro: Boolean(helper.verifiedPro), verifiedRepresentative: Boolean(helper.verifiedRepresentative) } });

/** the claim's view for the banner and the page (from the token alone) */
export const assistClaimView = (assist) => (assist ? { sid: assist.sid, areas: assist.areas, until: new Date(assist.until).toISOString(), helper: { name: assist.name, role: assist.role, verifiedPro: assist.pro } } : null);

async function passwordOk(userId, password, db) {
  const [u] = await db.select({ passwordHash: CitizenUser.passwordHash }).from(CitizenUser).where(eq(CitizenUser.id, userId)).limit(1);
  if (!u) return 'NO_ACCOUNT';
  if (isUnsetPassword(u.passwordHash)) return 'UNSET';
  const pw = String(password || '');
  return pw && (await verifyPassword(pw, u.passwordHash).catch(() => false)) ? 'OK' : 'BAD';
}

/**
 * Start an assisted session (the person, on their own normal session). Returns the claim and its lifetime; the handler signs the new session cookie.
 * @param {{ id: string, assist?: object | null }} citizen
 * @param {{ password?: string, consent?: boolean, helperName?: string, helperRole?: string, structureName?: string, proEmail?: string, proCode?: string, areas?: string[], minutes?: number }} input
 */
export async function startAssist(citizen, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (citizen.assist) return bad('ASSIST_ALREADY_ACTIVE', 'Le mode accompagnant est déjà en cours.', 409);
  if (input?.consent !== true) return bad('CONSENT_REQUIRED', 'Lisez ce que la personne qui vous aide pourra faire, puis cochez la case pour donner votre accord.');
  const name = clean(input?.helperName, 80);
  if (name.length < 2) return bad('INVALID_HELPER_NAME', 'Indiquez le nom de la personne qui vous aide.');
  const role = String(input?.helperRole || '');
  if (!HELPER_ROLES.includes(role)) return bad('INVALID_HELPER_ROLE', 'Choisissez qui est la personne qui vous aide.');
  const minutes = Number(input?.minutes);
  if (!ASSIST_MINUTES.includes(minutes)) return bad('INVALID_DURATION', 'Choisissez une durée (2 heures au plus).');
  const areas = [...new Set(Array.isArray(input?.areas) ? input.areas.map(String) : [])];
  if (!areas.length || areas.some((a) => !ASSIST_AREAS.includes(a))) return bad('INVALID_AREAS', 'Choisissez au moins ce que la personne pourra faire avec vous.');
  // C05: minors are out of scope (no assisted session for an account that is not a verified adult one)
  if (!(await isAdultAccount(citizen.id, db))) return bad('ASSIST_ADULT_ONLY', 'Le mode accompagnant est réservé aux comptes de personnes majeures.', 409);
  if (await isRestricted(citizen.id, db)) return bad('PROCESSING_RESTRICTED', 'Vous avez demandé la limitation du traitement de vos données : levez-la avant d’utiliser le mode accompagnant.', 409);
  // G14-R3G: a court measure verified by the administrator decides who may help (legal-protection.js assistRuleFor)
  const lp = await assistRuleFor(citizen.id, input, { db, now });
  if (!lp.ok) return lp;
  const rep = lp.representative;
  // C23: a legal mandate (tutelle, curatelle, représentant légal) declared in the trusted persons is out of scope — the mode is not a representation —
  // except for the representative whose court decision the administrator verified (rep)
  const [legal] = rep ? [] : await db.select({ id: CitizenDelegation.id }).from(CitizenDelegation)
    .where(and(eq(CitizenDelegation.principalUserId, citizen.id), inArray(CitizenDelegation.role, LEGAL_ROLES), inArray(CitizenDelegation.status, LIVE_DELEGATION))).limit(1);
  if (legal) return bad('ASSIST_LEGAL_PROTECTION_OUT_OF_SCOPE', 'Le mode accompagnant ne remplace pas une mesure de protection (tutelle, curatelle) ni un mandat légal : il n’est pas disponible pour un compte qui en a déclaré un.', 409);
  const pw = await passwordOk(citizen.id, input?.password, db);
  if (pw === 'UNSET') return bad('PASSWORD_NOT_SET', 'Choisissez d’abord un mot de passe pour votre compte : il sert à confirmer que c’est bien vous.', 409);
  if (pw !== 'OK') return bad('INVALID_PASSWORD', 'Mot de passe incorrect.', 403);
  let pro = null;
  if (!rep && (input?.proEmail || input?.proCode)) {
    pro = await verifyProHelper(input.proEmail, input.proCode, db, now);
    if (!pro) return bad('PRO_HELPER_NOT_VERIFIED', 'Le code de l’intervenant ADA Pro n’est pas valable, ou son compte n’est pas actif avec la double authentification. Demandez-lui un nouveau code.', 403);
    if (areas.some((a) => PRO_FORBIDDEN_AREAS.includes(a))) return bad('AREA_NOT_ALLOWED_FOR_PRO', 'Mon Coffre ne peut pas être ouvert à un professionnel dans ce mode.', 409);
  }
  const sid = crypto.randomUUID();
  const expiresAt = new Date(now + minutes * MINUTE);
  const helper = { name, role, structureName: rep ? rep.structureName : pro ? pro.structureName : (clean(input?.structureName, 120) || null), verifiedPro: Boolean(pro), structureId: pro ? pro.structureId : null,
    ...(rep ? { verifiedRepresentative: true, mandateId: rep.mandateId } : {}) };
  await db.insert(AuthToken).values({ id: sid, userId: citizen.id, type: ASSIST_TOKEN_TYPE, tokenHash: assistTokenHash(sid), expiresAt });
  await db.insert(ConsentLog).values({ subject_type: 'CITIZEN_USER', subject_id: citizen.id, purpose: ASSIST_CONSENT_PURPOSE, decision: true, policy_version: ASSIST_CONSENT_VERSION,
    policy_hash: `${ASSIST_CONSENT_VERSION}:${ASSIST_CONSENT_PURPOSE}`, collection_channel: 'account', guardian_involved: false, proof_level: 'PASSWORD_REAUTH' });
  await db.insert(AuditLog).values({ action: 'ASSIST_STARTED', actor: citizen.id, actor_id: citizen.id, entity: 'CitizenUser', entity_id: citizen.id,
    details: { sid, helper, areas, minutes, until: expiresAt.toISOString() } });
  // the professional's own trail: that they helped someone, never who (no citizen identifier reaches the structure)
  if (pro) await db.insert(AuditLog).values({ action: 'ASSIST_PRO_HELPED', actor: pro.id, actor_id: pro.id, entity: 'ProUser', entity_id: pro.id, details: { structureId: pro.structureId, minutes } });
  const claim = { sid, areas, pro: Boolean(pro), name, role, until: expiresAt.getTime() };
  return { ok: true, status: 201, claim, maxAgeSeconds: minutes * 60, session: publicView(claim, helper) };
}

async function endRow(userId, sid, by, db) {
  const rows = await db.update(AuthToken).set({ usedAt: new Date() })
    .where(and(eq(AuthToken.tokenHash, assistTokenHash(sid)), eq(AuthToken.userId, userId), eq(AuthToken.type, ASSIST_TOKEN_TYPE), isNull(AuthToken.usedAt))).returning({ id: AuthToken.id });
  if (rows.length) await db.insert(AuditLog).values({ action: 'ASSIST_ENDED', actor: userId, actor_id: userId, entity: 'CitizenUser', entity_id: userId, details: { sid, by } });
  return rows.length > 0;
}

/**
 * End the CURRENT assisted session (from it). continueAlone: the person types their password again and gets a normal session back; otherwise the device is
 * signed out at once (no password needed to stop). A wrong password ends nothing (the helper cannot take a normal session).
 * @param {{ id: string, assist: { sid: string } }} citizen @param {{ continueAlone?: boolean, password?: string }} input
 */
export async function endCurrentAssist(citizen, input, deps = {}) {
  const db = deps.db || defaultDb;
  if (!citizen.assist) return bad('NOT_ASSISTED', 'Le mode accompagnant n’est pas en cours.', 409);
  const alone = input?.continueAlone === true;
  if (alone && (await passwordOk(citizen.id, input?.password, db)) !== 'OK') return bad('INVALID_PASSWORD', 'Mot de passe incorrect : le mode accompagnant continue.', 403);
  await endRow(citizen.id, citizen.assist.sid, alone ? 'PERSON_CONTINUED_ALONE' : 'PERSON', db);
  return { ok: true, status: 200, ended: true, continueAlone: alone };
}

/** End one of the person's assisted sessions from ANOTHER (normal) session of theirs. @param {{ id: string, assist?: object | null }} citizen */
export async function endOtherAssist(citizen, sid, db = defaultDb) {
  if (citizen.assist) return bad('ASSIST_NOT_ALLOWED', 'En mode accompagnant, seule la session en cours peut être terminée.', 403);
  const ok = await endRow(citizen.id, String(sid || ''), 'PERSON_OTHER_DEVICE', db);
  return ok ? { ok: true, status: 200, ended: true } : bad('NOT_FOUND', 'Session d’accompagnement introuvable ou déjà terminée.', 404);
}

/** Recorded on sign-out of an assisted session (the session is over anyway: the sign-out revokes the account's sessions). */
export async function endAssistOnLogout(userId, assist, db = defaultDb) {
  if (!assist) return;
  await endRow(userId, assist.sid, 'SIGN_OUT', db).catch(() => {});
}

/**
 * The person's page: the current assisted session (from the token), the live ones (to end them from here) and the history « fait avec l'aide de … ».
 * While an assisted session runs, only ITS OWN history is returned (a helper never reads who helped the person before).
 * @param {{ id: string, assist?: { sid: string } | null }} citizen
 */
export async function assistOverview(citizen, db = defaultDb, now = Date.now()) {
  const rows = await db.select({ id: AuditLog.id, action: AuditLog.action, at: AuditLog.timestamp, details: AuditLog.details }).from(AuditLog)
    .where(and(eq(AuditLog.entity, 'CitizenUser'), eq(AuditLog.entity_id, citizen.id), sql`${AuditLog.action} IN ('ASSIST_STARTED', 'ASSIST_ENDED', 'ASSIST_VIEW', 'ASSIST_ACTION', 'ASSIST_REFUSED')`))
    .orderBy(desc(AuditLog.timestamp)).limit(500);
  const sessions = new Map();
  for (const r of [...rows].reverse()) {
    const d = r.details || {}; const sid = String(d.sid || '');
    if (!sid || (citizen.assist && sid !== citizen.assist.sid)) continue;
    if (!sessions.has(sid)) sessions.set(sid, { sid, helper: null, areas: [], startedAt: null, until: null, endedAt: null, endedBy: null, events: [] });
    const s = sessions.get(sid);
    if (r.action === 'ASSIST_STARTED') Object.assign(s, { helper: { name: d.helper?.name || '', role: d.helper?.role || '', structureName: d.helper?.structureName || null, verifiedPro: Boolean(d.helper?.verifiedPro), verifiedRepresentative: Boolean(d.helper?.verifiedRepresentative) }, areas: d.areas || [], startedAt: r.at, until: d.until || null });
    else if (r.action === 'ASSIST_ENDED') Object.assign(s, { endedAt: r.at, endedBy: d.by || null });
    else s.events.push({ at: r.at, kind: r.action.replace('ASSIST_', ''), area: d.area || null, label: d.label || null, outcome: typeof d.outcome === 'number' ? d.outcome : null });
  }
  let live = [];
  if (!citizen.assist) {
    const tokens = await db.select({ id: AuthToken.id }).from(AuthToken)
      .where(and(eq(AuthToken.userId, citizen.id), eq(AuthToken.type, ASSIST_TOKEN_TYPE), isNull(AuthToken.usedAt), gt(AuthToken.expiresAt, new Date(now))));
    live = tokens.map((t) => t.id);
  }
  const history = [...sessions.values()].filter((s) => s.helper).map((s) => ({ ...s, live: citizen.assist ? s.sid === citizen.assist.sid : live.includes(s.sid) })).reverse();
  return { ok: true, status: 200, current: assistClaimView(citizen.assist), sessions: history, limits: { minutes: ASSIST_MINUTES, areas: ASSIST_AREAS, roles: HELPER_ROLES, proForbiddenAreas: PRO_FORBIDDEN_AREAS } };
}
