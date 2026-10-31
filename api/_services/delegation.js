// @ts-nocheck
/**
 * PKG-2 / C23 — delegation: the person (principal) lets someone they trust (delegate) SEE parts of Mon Espace. Never an impersonation: the delegate keeps their own session,
 * gets read-only projections chosen by the principal (scopes), for a limited time (at most one year), and every view is logged for the principal. Either side ends it at any
 * time. The invitation is accepted only by the account whose VERIFIED e-mail is the invited one. Legal mandates (tuteur, curateur, représentant) need a proof whose
 * verification is not designed yet: they stay PROOF_REQUIRED and open nothing (the database refuses ACTIVE for them) — said plainly, never presented as verified.
 */
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { CitizenDelegation, CitizenUser, DelegationAccessEvent, ParcoursItem, ProAppointment, Structure } from '../../src/db/schema.js';
import { listCoffre } from './mon-espace.js';
import { mailLedgerStatus } from '../_utils/mailer.js';
import { isRestricted } from './processing-restriction.js';
import { ageGate, ageRefusal } from './citizen-account.js';

export const DELEGATION_ROLES = ['AIDANT', 'TUTEUR', 'CURATEUR', 'REPRESENTANT'];
export const DELEGATION_SCOPES = ['PARCOURS_READ', 'COFFRE_LIST', 'RDV_READ'];
export const DELEGATION_DURATIONS = [30, 90, 180, 365];
export const MAX_LIVE_DELEGATIONS = 10;
export const INVITE_DAYS = 7;
const LIVE = ['INVITED', 'ACTIVE', 'PROOF_REQUIRED'];
const VIEWS = Object.freeze({ parcours: ['PARCOURS_READ', 'PARCOURS_VIEWED'], coffre: ['COFFRE_LIST', 'COFFRE_LISTED'], rdv: ['RDV_READ', 'RDV_VIEWED'] });
const ACTION_LABELS = Object.freeze({ PARCOURS_VIEWED: 'a consulté Mon Parcours', COFFRE_LISTED: 'a consulté la liste de Mon Coffre', RDV_VIEWED: 'a consulté les rendez-vous' });
const day = 86400000;

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const norm = (v) => String(v || '').trim().toLowerCase();
export const hashInviteToken = (t) => crypto.createHash('sha256').update(String(t || '')).digest('hex');
const isEmail = (v) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(v);

/** What the person sees of a delegation: EXPIRED is computed (an expired live delegation opens nothing). */
function statusOf(r, now = Date.now()) {
  if (r.status === 'INVITED' && r.inviteExpiresAt && new Date(r.inviteExpiresAt).getTime() <= now) return 'INVITATION_EXPIRED';
  if (LIVE.includes(r.status) && new Date(r.expiresAt).getTime() <= now) return 'EXPIRED';
  return r.status;
}
const view = (r, other) => ({ id: r.id, role: r.role, scopes: r.scopes, status: statusOf(r), proofStatus: r.proofStatus, expiresAt: r.expiresAt, createdAt: r.createdAt,
  acceptedAt: r.acceptedAt, endedAt: r.endedAt, endedBy: r.endedBy, ...other });

/** The principal invites a person by e-mail. Returns the one-time link (also sent by e-mail when a provider is configured; delivery is reported honestly). */
export async function inviteDelegate(principal, input, deps = {}) {
  const db = deps.db || defaultDb;
  // C05 (R28): giving another person access to one's account is a sensitive account feature — same age rule as the Coffre and the household
  const gate = await ageGate(principal.id, db); if (!gate.allowed) return ageRefusal(gate);
  const email = norm(input?.email); const role = String(input?.role || ''); const days = Number(input?.days);
  const scopes = [...new Set(Array.isArray(input?.scopes) ? input.scopes.map(String) : [])];
  if (!isEmail(email)) return bad('INVALID_EMAIL', 'Indiquez l’adresse e-mail de la personne de confiance.');
  if (email === norm(principal.email)) return bad('SELF_DELEGATION', 'Vous ne pouvez pas vous déléguer à vous-même.');
  if (!DELEGATION_ROLES.includes(role)) return bad('INVALID_ROLE', 'Choisissez le rôle de la personne.');
  // PKG-11 audit: no new access to the account while the person restricts processing (art. 18)
  if (await isRestricted(principal.id, db)) return bad('PROCESSING_RESTRICTED', 'Vous avez demandé la limitation du traitement : levez-la avant d’inviter une personne de confiance.', 409);
  if (!scopes.length || scopes.some((s) => !DELEGATION_SCOPES.includes(s))) return bad('INVALID_SCOPES', 'Choisissez au moins ce que la personne pourra consulter.');
  if (!DELEGATION_DURATIONS.includes(days)) return bad('INVALID_DURATION', 'Choisissez une durée (au plus un an).');
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "CitizenDelegation" WHERE "principalUserId" = ${principal.id} AND status IN ('INVITED', 'ACTIVE', 'PROOF_REQUIRED')`)).rows;
  if (n >= MAX_LIVE_DELEGATIONS) return bad('TOO_MANY_DELEGATIONS', `Au plus ${MAX_LIVE_DELEGATIONS} délégations en cours.`, 409);
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const rows = await db.insert(CitizenDelegation).values({ principalUserId: principal.id, inviteEmail: email, inviteTokenHash: hashInviteToken(token),
    inviteExpiresAt: new Date(now.getTime() + INVITE_DAYS * day), role, scopes, status: 'INVITED', proofStatus: role === 'AIDANT' ? 'NOT_REQUIRED' : 'REQUIRED_NOT_VERIFIED',
    createdAt: now, expiresAt: new Date(now.getTime() + days * day) }).onConflictDoNothing().returning();
  if (!rows.length) return bad('ALREADY_INVITED', 'Une délégation est déjà en cours avec cette personne.', 409);
  const link = (deps.buildUrl || ((p) => p))(`/compte/delegations?invitation=${encodeURIComponent(token)}`);
  let delivery = 'NOT_DELIVERED';
  if (deps.sendMail) {
    const out = await deps.sendMail({ to: email, category: 'delegation-invitation', subject: 'Invitation : personne de confiance sur AccesDirectAide',
      text: `${principal.email} vous propose de consulter une partie de son espace AccesDirectAide, en lecture seule, pendant ${days} jours.\n`
        + `Pour accepter ou refuser, connectez-vous avec cette adresse e-mail puis ouvrez ce lien (valable ${INVITE_DAYS} jours) :\n${link}\n`
        + 'Si vous ne connaissez pas cette personne, ignorez ce message.' }).catch(() => null);
    if (out) delivery = mailLedgerStatus(out);   // PROVIDER_ACCEPTED | TEST_RECORDED | NOT_DELIVERED (never DELIVERED without a delivery event)
  }
  return { ok: true, status: 201, delegation: view(rows[0], { inviteEmail: email }), inviteLink: link, delivery };
}

/** The invited person answers. Only the account whose verified e-mail is the invited one can; one use; an expired invitation opens nothing. */
export async function respondInvitation(citizen, input, db = defaultDb) {
  const hash = hashInviteToken(input?.token); const accept = input?.accept === true;
  const [r] = await db.select().from(CitizenDelegation).where(eq(CitizenDelegation.inviteTokenHash, hash)).limit(1);
  if (!r || r.status !== 'INVITED' || statusOf(r) !== 'INVITED') return bad('invitation_invalid', 'Cette invitation n’est plus valable.', 404);
  if (norm(citizen.email) !== norm(r.inviteEmail) || citizen.id === r.principalUserId) return bad('invitation_not_for_you', 'Cette invitation est destinée à une autre adresse e-mail.', 403);
  const now = new Date();
  const set = accept ? { status: r.proofStatus === 'NOT_REQUIRED' ? 'ACTIVE' : 'PROOF_REQUIRED', delegateUserId: citizen.id, acceptedAt: now, inviteTokenHash: null }
    : { status: 'DECLINED', endedAt: now, endedBy: 'DELEGATE', inviteTokenHash: null };
  const rows = await db.update(CitizenDelegation).set(set).where(and(eq(CitizenDelegation.id, r.id), eq(CitizenDelegation.status, 'INVITED'), eq(CitizenDelegation.inviteTokenHash, hash))).returning();
  if (!rows.length) return bad('invitation_invalid', 'Cette invitation n’est plus valable.', 404);
  return { ok: true, status: 200, delegation: view(rows[0], {}) };
}

/** Either side ends a delegation at any time (the principal revokes, the delegate renounces). */
export async function endDelegation(userId, id, db = defaultDb) {
  const [r] = await db.select().from(CitizenDelegation).where(eq(CitizenDelegation.id, String(id || ''))).limit(1);
  const side = r && (r.principalUserId === userId ? 'PRINCIPAL' : r.delegateUserId === userId ? 'DELEGATE' : null);
  if (!side) return bad('NOT_FOUND', 'Délégation introuvable.', 404);
  const rows = await db.update(CitizenDelegation).set({ status: 'REVOKED', endedAt: new Date(), endedBy: side, inviteTokenHash: null })
    .where(and(eq(CitizenDelegation.id, r.id), inArray(CitizenDelegation.status, LIVE))).returning();
  if (!rows.length) return bad('ALREADY_ENDED', 'Cette délégation est déjà terminée.', 409);
  return { ok: true, status: 200, delegation: view(rows[0], {}) };
}

async function emails(ids, db) {
  const uniq = [...new Set(ids.filter(Boolean))]; if (!uniq.length) return {};
  const rows = await db.select({ id: CitizenUser.id, email: CitizenUser.email }).from(CitizenUser).where(inArray(CitizenUser.id, uniq));
  return Object.fromEntries(rows.map((x) => [x.id, x.email]));
}

/** granted: what I gave (with the invited e-mail); received: what was given to me and is not declined (with the principal's e-mail). */
export async function listDelegations(userId, db = defaultDb) {
  const granted = await db.select().from(CitizenDelegation).where(eq(CitizenDelegation.principalUserId, userId)).orderBy(desc(CitizenDelegation.createdAt));
  const received = await db.select().from(CitizenDelegation).where(and(eq(CitizenDelegation.delegateUserId, userId), inArray(CitizenDelegation.status, ['ACTIVE', 'PROOF_REQUIRED', 'REVOKED'])))
    .orderBy(desc(CitizenDelegation.createdAt));
  const who = await emails(received.map((r) => r.principalUserId), db);
  return { ok: true, status: 200, granted: granted.map((r) => view(r, { inviteEmail: r.inviteEmail })), received: received.map((r) => view(r, { principalEmail: who[r.principalUserId] || '' })) };
}

/** The principal's log of what the delegate viewed (newest first). */
export async function delegationAccessLog(userId, id, db = defaultDb) {
  const [r] = await db.select({ id: CitizenDelegation.id, principalUserId: CitizenDelegation.principalUserId }).from(CitizenDelegation).where(eq(CitizenDelegation.id, String(id || ''))).limit(1);
  if (!r || r.principalUserId !== userId) return bad('NOT_FOUND', 'Délégation introuvable.', 404);
  const rows = await db.select().from(DelegationAccessEvent).where(eq(DelegationAccessEvent.delegationId, r.id)).orderBy(desc(DelegationAccessEvent.createdAt)).limit(200);
  return { ok: true, status: 200, events: rows.map((e) => ({ action: e.action, label: ACTION_LABELS[e.action], at: e.createdAt })) };
}

/** A read-only projection for the delegate: ACTIVE, not expired, scope granted — otherwise nothing. Every view is logged before it is returned. */
export async function delegateView(userId, id, what, db = defaultDb) {
  const spec = VIEWS[String(what || '')];
  if (!spec) return bad('INVALID_VIEW', 'Vue inconnue.');
  const [r] = await db.select().from(CitizenDelegation).where(and(eq(CitizenDelegation.id, String(id || '')), eq(CitizenDelegation.delegateUserId, userId))).limit(1);
  if (!r || statusOf(r) !== 'ACTIVE') return bad('NOT_FOUND', 'Délégation introuvable ou inactive.', 404);
  if (!r.scopes.includes(spec[0])) return bad('SCOPE_NOT_GRANTED', 'La personne ne vous a pas donné accès à cette partie.', 403);
  const owner = r.principalUserId;
  // PKG-11 audit: while the person restricts processing (art. 18), the delegate sees nothing (the delegation itself stays, nothing is deleted)
  if (await isRestricted(owner, db)) return bad('PROCESSING_RESTRICTED', 'La personne a demandé la limitation du traitement de ses données : la consultation est suspendue.', 409);
  let data;
  if (what === 'parcours') {
    const rows = await db.select().from(ParcoursItem).where(eq(ParcoursItem.userId, owner)).orderBy(asc(ParcoursItem.createdAt));
    data = { items: rows.map((i) => ({ id: i.id, title: i.title, status: i.status, dueDate: i.dueDate, dueSourceUrl: i.dueSourceUrl })) }; // private notes never leave
  } else if (what === 'coffre') {
    data = { documents: (await listCoffre(owner, db)).documents.map((d) => ({ name: d.name, category: d.category, byteLength: d.byteLength, createdAt: d.createdAt, expired: d.expired })) };
  } else {
    const rows = await db.select({ startAt: ProAppointment.startAt, status: ProAppointment.status, structure: Structure.nom }).from(ProAppointment)
      .leftJoin(Structure, eq(Structure.id, ProAppointment.structureId))
      .where(and(eq(ProAppointment.citizenUserId, owner), sql`${ProAppointment.startAt} > NOW()`, sql`${ProAppointment.status} <> 'cancelled'`)).orderBy(asc(ProAppointment.startAt)).limit(20);
    data = { appointments: rows.map((a) => ({ startAt: a.startAt, status: a.status, structure: a.structure || '' })) };
  }
  await db.insert(DelegationAccessEvent).values({ delegationId: r.id, principalUserId: owner, action: spec[1] });
  const who = await emails([owner], db);
  return { ok: true, status: 200, delegation: view(r, { principalEmail: who[owner] || '' }), ...data };
}
