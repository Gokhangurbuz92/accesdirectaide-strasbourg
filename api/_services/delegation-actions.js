// @ts-nocheck
/**
 * G14-AID (owner 23/11/2026) — « mode accompagnant » at a distance: a trusted person (an ACTIVE delegation, role AIDANT, api/_services/delegation.js) may ASK
 * to do one thing for the person in a part the person shared with them. Read-only stays the default: nothing is done until the person CONFIRMS that one
 * request (Personnes de confiance → « Demandes à confirmer », also announced in the in-app notification centre), unless the person switched on « agir pour
 * moi » for that part (password re-entered; withdrawn at any time; ends with the delegation).
 *
 * The closed list of actions (nothing else, ever — never the password, the e-mail, the second factor, the account deletion, a full export, the vault, a
 * further delegation):
 *   RDV_CANCEL       cancel one of the person's upcoming appointments         (part RDV_READ; through the appointment's own cancellation path, so the structure
 *                    and the person are told exactly as when the person cancels)
 *   PARCOURS_STATUS  change the state of one Mon Parcours step                (part PARCOURS_READ; never a step hidden from delegates as sensitive, G8)
 * Each action is ALSO gated by its part's capability (A-18) and by citizen.assisted_mode + citizen.delegations; a minor's account or a processing restriction
 * (art. 18) opens nothing. Every request, confirmation, refusal and execution is in the audit log and shown to the person in « ce qu'elle a fait ».
 *
 * Storage without a new migration: a pending request = an AuthToken row of the PERSON (type DELEGATION_ACTION, tokenHash « dlgact: » + sha-256(id): never a
 * usable token, expires after 48 h, single use: the confirmation claims it atomically) + its content in the AuditLog row « dlgact:<id> » (read by primary
 * key); « agir pour moi » = ConsentLog decisions (append-only, the latest wins). The clean schema is in the G14-AID report (DelegationActionRequest).
 */
import crypto from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, AuthToken, CitizenDelegation, CitizenUser, ConsentLog, ParcoursItem, ProAppointment, Structure } from '../../src/db/schema.js';
import { capabilityOpen } from '../_utils/capabilities.js';
import { isAdultAccount } from '../_utils/age-policy.js';
import { isUnsetPassword, verifyPassword } from '../_utils/user-auth.js';
import { isRestricted } from './processing-restriction.js';
import { openScopes } from './delegation.js';
import { PARCOURS_STATUSES, sensitiveItemIds, setStatus } from './mon-espace.js';
import { parcoursItemTable, parcoursPlanStepSchema } from '../_utils/schema-features.js';

export const ACTION_TYPES = Object.freeze({ RDV_CANCEL: Object.freeze({ scope: 'RDV_READ' }), PARCOURS_STATUS: Object.freeze({ scope: 'PARCOURS_READ' }) });
/** the parts « agir pour moi » can be switched on for */
export const ACT_SCOPES = Object.freeze(['RDV_READ', 'PARCOURS_READ']);
export const REQUEST_TOKEN_TYPE = 'DELEGATION_ACTION';
export const REQUEST_HOURS = 48;
export const MAX_PENDING_PER_DELEGATION = 10;
export const ACT_FOR_ME_VERSION = 'delegation-act-2026-11-23-draft';
const ACT_PREFIX = 'DELEGATION_ACT_FOR_ME:';
const actPurpose = (delegationId, scope) => `${ACT_PREFIX}${delegationId}:${scope}`;
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
export const requestTokenHash = (rid) => `dlgact:${sha(rid)}`;
const payloadId = (rid) => `dlgact:${rid}`;
const ACTIVE_RDV = ['booked', 'requested', 'confirmed', 'locked'];
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const notOpen = () => bad('CAPABILITY_NOT_OPEN', 'Cette fonction n’est pas ouverte sur ce service.', 404);

/** both capabilities of remote assistance @param {(c: string) => boolean} [isOpen] */
export const actionsOpen = (isOpen = (c) => capabilityOpen(c)) => isOpen('citizen.assisted_mode') && isOpen('citizen.delegations');
const live = (d, now = Date.now()) => d && d.status === 'ACTIVE' && new Date(d.expiresAt).getTime() > now && d.role === 'AIDANT';

async function passwordOk(userId, password, db) {
  const [u] = await db.select({ h: CitizenUser.passwordHash }).from(CitizenUser).where(eq(CitizenUser.id, userId)).limit(1);
  if (!u || isUnsetPassword(u.h)) return false;
  const pw = String(password || '');
  return Boolean(pw) && (await verifyPassword(pw, u.h).catch(() => false));
}

/** the latest « agir pour moi » decisions of a person: Map purpose → boolean */
async function actDecisions(principalId, db) {
  const rows = await db.select({ purpose: ConsentLog.purpose, decision: ConsentLog.decision, withdrawn: ConsentLog.withdrawn_at }).from(ConsentLog)
    .where(and(eq(ConsentLog.subject_type, 'CITIZEN_USER'), eq(ConsentLog.subject_id, principalId), sql`${ConsentLog.purpose} LIKE ${`${ACT_PREFIX}%`}`))
    .orderBy(desc(ConsentLog.created_at), desc(ConsentLog.id));
  const out = new Map();
  for (const r of rows) if (!out.has(r.purpose)) out.set(r.purpose, r.decision === true && !r.withdrawn);
  return out;
}

/** { [delegationId]: { RDV_READ: bool, PARCOURS_READ: bool } } for the person's delegations */
export async function actForMeMap(principalId, delegationIds, db = defaultDb) {
  const d = await actDecisions(principalId, db);
  return Object.fromEntries(delegationIds.map((id) => [id, Object.fromEntries(ACT_SCOPES.map((s) => [s, d.get(actPurpose(id, s)) === true]))]));
}

/**
 * The person switches « agir pour moi » on (password re-entered) or off (at once) for one part of one delegation.
 * @param {{ id: string, assist?: object | null }} principal @param {{ id: string, scope: string, on: boolean, password?: string }} input
 */
export async function setActForMe(principal, input, deps = {}) {
  const db = deps.db || defaultDb;
  if (!actionsOpen(deps.isOpen)) return notOpen();
  if (principal.assist) return bad('ASSIST_NOT_ALLOWED', 'Seule la personne elle-même, sans accompagnant, peut changer cet accord.', 403);
  const scope = String(input?.scope || ''); const on = input?.on === true;
  const [d] = await db.select().from(CitizenDelegation).where(and(eq(CitizenDelegation.id, String(input?.id || '')), eq(CitizenDelegation.principalUserId, principal.id))).limit(1);
  if (!d) return bad('NOT_FOUND', 'Délégation introuvable.', 404);
  if (!ACT_SCOPES.includes(scope) || !d.scopes.includes(scope)) return bad('INVALID_SCOPES', 'Cette partie n’a pas été partagée avec cette personne.');
  if (on) {
    if (!live(d)) return bad('DELEGATION_INACTIVE', 'Cette délégation n’est pas active.', 409);
    if (!openScopes(deps.isOpen).includes(scope)) return bad('SCOPE_NOT_OPEN', 'Cette partie n’est pas ouverte sur ce service.', 409);
    if (!(await isAdultAccount(principal.id, db))) return bad('ASSIST_ADULT_ONLY', 'Cette fonction est réservée aux comptes de personnes majeures.', 409);
    if (await isRestricted(principal.id, db)) return bad('PROCESSING_RESTRICTED', 'Vous avez demandé la limitation du traitement de vos données : levez-la d’abord.', 409);
    if (!(await passwordOk(principal.id, input?.password, db))) return bad('INVALID_PASSWORD', 'Mot de passe incorrect.', 403);
  }
  await db.insert(ConsentLog).values({ subject_type: 'CITIZEN_USER', subject_id: principal.id, purpose: actPurpose(d.id, scope), decision: on, policy_version: ACT_FOR_ME_VERSION,
    policy_hash: `${ACT_FOR_ME_VERSION}:${ACT_PREFIX}`, collection_channel: 'account', guardian_involved: false, proof_level: on ? 'PASSWORD_REAUTH' : 'SESSION' });
  await db.insert(AuditLog).values({ action: 'DELEGATION_ACT_FOR_ME_SET', actor: principal.id, actor_id: principal.id, entity: 'CitizenUser', entity_id: principal.id, details: { delegationId: d.id, scope, on } });
  return { ok: true, status: 200, delegationId: d.id, scope, on };
}

/** validates the target of an action for the person; returns { target } (what the person will be shown) or a refusal */
async function checkTarget(principalId, type, input, db) {
  if (type === 'RDV_CANCEL') {
    const id = String(input?.appointmentId || '');
    const [a] = await db.select({ id: ProAppointment.id, startAt: ProAppointment.startAt, status: ProAppointment.status, owner: ProAppointment.citizenUserId, structure: Structure.nom })
      .from(ProAppointment).leftJoin(Structure, eq(Structure.id, ProAppointment.structureId)).where(eq(ProAppointment.id, id)).limit(1);
    if (!a || a.owner !== principalId) return bad('NOT_FOUND', 'Rendez-vous introuvable.', 404);   // someone else's = unknown (no existence oracle)
    if (!ACTIVE_RDV.includes(String(a.status || '').toLowerCase()) || new Date(a.startAt).getTime() <= Date.now()) return bad('APPOINTMENT_NOT_ACTIVE', 'Ce rendez-vous n’est plus actif.', 409);
    return { ok: true, target: { appointmentId: a.id, startAt: new Date(a.startAt).toISOString(), structure: a.structure || '' } };
  }
  const id = String(input?.itemId || ''); const status = String(input?.status || '');
  if (!PARCOURS_STATUSES.includes(status)) return bad('INVALID_STATUS', 'État inconnu.');
  // the plan data is read (where the database has it, migration 0046) only to decide sensitivity, as in the delegate's view
  const has = await parcoursPlanStepSchema(db); const T = parcoursItemTable(has);
  const [i] = await db.select({ id: ParcoursItem.id, userId: ParcoursItem.userId, title: ParcoursItem.title, status: ParcoursItem.status, itemCodes: ParcoursItem.itemCodes,
    ...(has ? { planStep: T.planStep } : {}) }).from(T).where(eq(ParcoursItem.id, id)).limit(1);
  if (!i || i.userId !== principalId) return bad('NOT_FOUND', 'Étape introuvable.', 404);
  // G8: a step never shown to a delegate cannot be acted on by one (answered as unknown)
  if ((await sensitiveItemIds([i], db)).has(i.id)) return bad('NOT_FOUND', 'Étape introuvable.', 404);
  return { ok: true, target: { itemId: i.id, title: i.title, from: i.status, status } };
}

/** runs one action AS the person's own decision (after their confirmation, or under « agir pour moi ») */
async function execute(principalId, type, target, deps) {
  const db = deps.db || defaultDb;
  if (deps.execute) return deps.execute(principalId, type, target);
  if (type === 'PARCOURS_STATUS') {
    const out = await setStatus(principalId, target.itemId, target.status, db);
    return { ok: out.ok !== false, status: out.status || 200 };
  }
  // RDV_CANCEL: the appointment's own cancellation path (the capability link of the confirmation e-mail: bound to this appointment and its owner, 24 h)
  const rdv = await import('../_handlers/rdv.js');
  const { token } = rdv.issueAppointmentConfirmationToken({ appointmentId: target.appointmentId, citizenUserId: principalId });
  const res = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } };
  await rdv.default({ method: 'POST', url: `/api/rdv/appointments/${encodeURIComponent(target.appointmentId)}/cancel`, headers: { host: 'localhost' }, query: {}, body: { token } }, res);
  return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode };
}

const audit = (db, action, principalId, actorId, details, id) => db.insert(AuditLog).values({ ...(id ? { id } : {}), action, actor: actorId, actor_id: actorId, entity: 'CitizenUser', entity_id: principalId, details });

/**
 * The trusted person asks to do one action. Executed at once only under « agir pour moi » for that part; otherwise a request waits for the person (48 h).
 * @param {{ id: string }} delegate @param {{ id: string, type: string, appointmentId?: string, itemId?: string, status?: string }} input
 */
export async function requestAction(delegate, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (!actionsOpen(deps.isOpen)) return notOpen();
  const type = String(input?.type || ''); const spec = ACTION_TYPES[type];
  if (!spec) return bad('INVALID_ACTION', 'Action inconnue.');
  const [d] = await db.select().from(CitizenDelegation).where(and(eq(CitizenDelegation.id, String(input?.id || '')), eq(CitizenDelegation.delegateUserId, delegate.id))).limit(1);
  if (!live(d, now)) return bad('NOT_FOUND', 'Délégation introuvable ou inactive.', 404);
  if (!d.scopes.includes(spec.scope)) return bad('SCOPE_NOT_GRANTED', 'La personne ne vous a pas donné accès à cette partie.', 403);
  if (!openScopes(deps.isOpen).includes(spec.scope)) return bad('CAPABILITY_NOT_OPEN', 'Cette partie n’est pas ouverte sur ce service.', 404);
  const principalId = d.principalUserId;
  if (!(await isAdultAccount(principalId, db))) return bad('ASSIST_ADULT_ONLY', 'Cette fonction n’est pas disponible pour ce compte.', 409);
  if (await isRestricted(principalId, db)) return bad('PROCESSING_RESTRICTED', 'La personne a demandé la limitation du traitement de ses données : aucune action n’est possible.', 409);
  const checked = await checkTarget(principalId, type, input, db);
  if (!checked.ok) return checked;
  const base = { delegationId: d.id, delegateUserId: delegate.id, type, target: checked.target };
  if ((await actDecisions(principalId, db)).get(actPurpose(d.id, spec.scope)) === true) {
    const out = await execute(principalId, type, checked.target, deps);
    await audit(db, 'DELEGATION_ACTION_EXECUTED', principalId, delegate.id, { ...base, mode: 'ACT_FOR_ME', outcome: out.status });
    if (!out.ok) return bad('ACTION_FAILED', 'L’action n’a pas pu être faite (elle a peut-être déjà été faite).', 409);
    return { ok: true, status: 200, executed: true, mode: 'ACT_FOR_ME' };
  }
  const pending = await pendingOf(principalId, db, now);
  if (pending.filter((p) => p.delegationId === d.id).length >= MAX_PENDING_PER_DELEGATION) return bad('TOO_MANY_REQUESTS', `Au plus ${MAX_PENDING_PER_DELEGATION} demandes en attente.`, 409);
  const rid = crypto.randomUUID(); const expiresAt = new Date(now + REQUEST_HOURS * 3600000);
  await db.insert(AuthToken).values({ id: rid, userId: principalId, type: REQUEST_TOKEN_TYPE, tokenHash: requestTokenHash(rid), expiresAt });
  await audit(db, 'DELEGATION_ACTION_REQUESTED', principalId, delegate.id, { ...base, requestId: rid, expiresAt: expiresAt.toISOString() }, payloadId(rid));
  return { ok: true, status: 202, executed: false, request: { id: rid, expiresAt: expiresAt.toISOString() } };
}

/** the person's pending requests, with their content (by primary key) @returns {Promise<any[]>} */
async function pendingOf(principalId, db, now = Date.now()) {
  const tokens = await db.select({ id: AuthToken.id, expiresAt: AuthToken.expiresAt, createdAt: AuthToken.createdAt }).from(AuthToken)
    .where(and(eq(AuthToken.userId, principalId), eq(AuthToken.type, REQUEST_TOKEN_TYPE), isNull(AuthToken.usedAt), gt(AuthToken.expiresAt, new Date(now))));
  if (!tokens.length) return [];
  const payloads = await db.select({ id: AuditLog.id, details: AuditLog.details }).from(AuditLog).where(inArray(AuditLog.id, tokens.map((t) => payloadId(t.id))));
  const byId = Object.fromEntries(payloads.map((p) => [p.id, p.details || {}]));
  return tokens.filter((t) => byId[payloadId(t.id)]).map((t) => ({ id: t.id, createdAt: t.createdAt, expiresAt: t.expiresAt, ...byId[payloadId(t.id)] }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** « Demandes à confirmer » of the person (with the trusted person's e-mail and what would be done) */
export async function listRequests(principalId, db = defaultDb) {
  const rows = await pendingOf(principalId, db);
  const ids = [...new Set(rows.map((r) => r.delegateUserId).filter(Boolean))];
  const who = ids.length ? Object.fromEntries((await db.select({ id: CitizenUser.id, email: CitizenUser.email }).from(CitizenUser).where(inArray(CitizenUser.id, ids))).map((u) => [u.id, u.email])) : {};
  return rows.map((r) => ({ id: r.id, delegationId: r.delegationId, type: r.type, target: r.target, delegateEmail: who[r.delegateUserId] || '', createdAt: r.createdAt, expiresAt: r.expiresAt }));
}

/** do the person's pending requests exist (in-app notification centre): [{ id, at }] */
export async function pendingRequestNotices(principalId, db = defaultDb, now = Date.now()) {
  const tokens = await db.select({ id: AuthToken.id, at: AuthToken.createdAt }).from(AuthToken)
    .where(and(eq(AuthToken.userId, principalId), eq(AuthToken.type, REQUEST_TOKEN_TYPE), isNull(AuthToken.usedAt), gt(AuthToken.expiresAt, new Date(now))));
  return tokens;
}

/**
 * The person confirms (the action is done as their own decision) or refuses one request. Single use: the request is claimed atomically first.
 * @param {{ id: string, assist?: object | null }} principal @param {{ requestId: string, accept: boolean }} input
 */
export async function resolveRequest(principal, input, deps = {}) {
  const db = deps.db || defaultDb;
  if (!actionsOpen(deps.isOpen)) return notOpen();
  if (principal.assist) return bad('ASSIST_NOT_ALLOWED', 'Seule la personne elle-même, sans accompagnant, peut confirmer une demande.', 403);
  const rid = String(input?.requestId || ''); const accept = input?.accept === true;
  const claimed = await db.update(AuthToken).set({ usedAt: new Date() })
    .where(and(eq(AuthToken.id, rid), eq(AuthToken.userId, principal.id), eq(AuthToken.type, REQUEST_TOKEN_TYPE), isNull(AuthToken.usedAt), gt(AuthToken.expiresAt, new Date())))
    .returning({ id: AuthToken.id });
  if (!claimed.length) return bad('REQUEST_NOT_FOUND', 'Demande introuvable, expirée ou déjà traitée.', 404);
  const [p] = await db.select({ details: AuditLog.details }).from(AuditLog).where(eq(AuditLog.id, payloadId(rid))).limit(1);
  const req = p?.details || {};
  const base = { requestId: rid, delegationId: req.delegationId, delegateUserId: req.delegateUserId, type: req.type, target: req.target };
  if (!accept) {
    await audit(db, 'DELEGATION_ACTION_REFUSED', principal.id, principal.id, base);
    return { ok: true, status: 200, done: false };
  }
  const spec = ACTION_TYPES[req.type];
  const [d] = spec ? await db.select().from(CitizenDelegation).where(and(eq(CitizenDelegation.id, String(req.delegationId || '')), eq(CitizenDelegation.principalUserId, principal.id))).limit(1) : [];
  if (!spec || !live(d) || !d.scopes.includes(spec.scope) || !openScopes(deps.isOpen).includes(spec.scope)) {
    await audit(db, 'DELEGATION_ACTION_REFUSED', principal.id, principal.id, { ...base, reason: 'DELEGATION_INACTIVE' });
    return bad('DELEGATION_INACTIVE', 'Cet accès n’est plus actif : la demande n’a pas été faite. Vous pouvez faire cette action vous-même.', 409);
  }
  const checked = await checkTarget(principal.id, req.type, { ...req.target, status: req.target?.status }, db);
  if (!checked.ok) {
    await audit(db, 'DELEGATION_ACTION_REFUSED', principal.id, principal.id, { ...base, reason: checked.code });
    return checked;
  }
  const out = await execute(principal.id, req.type, checked.target, deps);
  await audit(db, 'DELEGATION_ACTION_CONFIRMED', principal.id, principal.id, { ...base, outcome: out.status });
  if (!out.ok) return bad('ACTION_FAILED', 'L’action n’a pas pu être faite (elle a peut-être déjà été faite).', 409);
  return { ok: true, status: 200, done: true };
}

/**
 * What happened with the actions of one delegation, for the person's log and for the trusted person's own requests (newest first):
 * [{ at, event: REQUESTED | CONFIRMED | REFUSED | EXECUTED, type, target, requestId, mode }]
 */
export async function actionEventsOf(principalId, delegationId, db = defaultDb) {
  const rows = await db.select({ action: AuditLog.action, at: AuditLog.timestamp, details: AuditLog.details }).from(AuditLog)
    .where(and(eq(AuditLog.entity, 'CitizenUser'), eq(AuditLog.entity_id, principalId), sql`${AuditLog.action} LIKE 'DELEGATION_ACTION_%'`, sql`${AuditLog.details}->>'delegationId' = ${String(delegationId)}`))
    .orderBy(desc(AuditLog.timestamp)).limit(200);
  return rows.map((r) => ({ at: r.at, event: r.action.replace('DELEGATION_ACTION_', ''), type: r.details?.type || null, target: r.details?.target || null,
    requestId: r.details?.requestId || null, mode: r.details?.mode || null, reason: r.details?.reason || null, expiresAt: r.details?.expiresAt || null }));
}

/** the trusted person's view of their requests on one delegation they hold (only theirs; never the person's other data) */
export async function delegateRequests(delegateId, delegationId, db = defaultDb) {
  const [d] = await db.select({ id: CitizenDelegation.id, principalUserId: CitizenDelegation.principalUserId }).from(CitizenDelegation)
    .where(and(eq(CitizenDelegation.id, String(delegationId || '')), eq(CitizenDelegation.delegateUserId, delegateId))).limit(1);
  if (!d) return bad('NOT_FOUND', 'Délégation introuvable.', 404);
  const events = await actionEventsOf(d.principalUserId, d.id, db);
  const byReq = new Map();
  for (const e of [...events].reverse()) {
    if (e.event === 'EXECUTED') { byReq.set(`x:${e.at}`, { type: e.type, target: e.target, state: 'DONE', at: e.at }); continue; }
    if (!e.requestId) continue;
    const cur = byReq.get(e.requestId) || { type: e.type, target: e.target, state: e.expiresAt && new Date(e.expiresAt).getTime() <= Date.now() ? 'EXPIRED' : 'PENDING', at: e.at };
    if (e.event === 'CONFIRMED') cur.state = 'DONE'; else if (e.event === 'REFUSED') cur.state = 'REFUSED';
    byReq.set(e.requestId, cur);
  }
  // a request still waiting is EXPIRED once its row is gone or past its end (the purge removes expired rows)
  const waiting = [...byReq.entries()].filter(([k, v]) => v.state === 'PENDING' && !k.startsWith('x:')).map(([k]) => k);
  if (waiting.length) {
    const rows = await db.select({ id: AuthToken.id, expiresAt: AuthToken.expiresAt }).from(AuthToken).where(and(inArray(AuthToken.id, waiting), eq(AuthToken.type, REQUEST_TOKEN_TYPE)));
    const live = new Set(rows.filter((r) => new Date(r.expiresAt).getTime() > Date.now()).map((r) => r.id));
    for (const k of waiting) if (!live.has(k)) byReq.get(k).state = 'EXPIRED';
  }
  return { ok: true, status: 200, requests: [...byReq.values()].reverse().slice(0, 50) };
}
