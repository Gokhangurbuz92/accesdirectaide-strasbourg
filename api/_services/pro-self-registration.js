// @ts-nocheck
/**
 * G14 (owner decision 23/11/2026: ADA Pro opens without a pilot structure) — the administration's decision on a structure's own sign-up request
 * (POST /api/pro/auth/register creates the first administrator with the status PRO_PENDING_VERIFICATION_STATUS: no sign-in, no session, no MFA invitation).
 * From /admin/organizations, a named ADA administrator with MFA (api/_handlers/admin/organizations.js):
 *   VERIFY_AND_ACTIVATE_PRO_REGISTRATION  verifies the structure on an official source (the D-5 content-verification VERIFY: note ≥ 20 characters, https
 *                                         source of an allowed official domain, territory confirmed, bound to the version read), activates it (org-lifecycle
 *                                         REACTIVATE brouillon → actif, reason journalised), makes the account active and writes the MFA enrolment invitation
 *                                         — in ONE transaction with the journal rows; then the invitation e-mail goes to that administrator (configured mailer).
 *                                         The ledger and the journal name the administrator; the invitation stays valid while that AdminUser is enabled
 *                                         (api/_utils/invite-token.js, senderRealm ADMIN).
 *   REFUSE_PRO_REGISTRATION               disables the pending account (api/_services/pro-account-admin.js DISABLE_PRO_ACCOUNT, reason journalised) and
 *                                         journals the refusal; nothing is deleted (the journal and the terms acceptance stay).
 * A request on a SUSPENDED, archived or duplicate-put-aside organisation is not activated from here: the existing actions of the card come first.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { PRO_PENDING_VERIFICATION_STATUS } from '../_utils/auth.js';
import { keptInsteadOf } from '../_utils/org-eligibility.js';
import { recordVerification } from './content-verification.js';
import { setActivity } from './org-lifecycle.js';
import { administerProAccount } from './pro-account-admin.js';
import { mailMfaInvitation, writeMfaInvitation } from './pro-mfa-invitation.js';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
/** a refusal found after a write: thrown to roll the whole transaction back, then returned as the answer */
class Rollback extends Error { constructor(out) { super(out.code); this.out = out; } }

const NOT_PENDING = () => bad('not_pending', 'Aucune demande d’inscription en attente pour ce compte (déjà traitée ou inexistante).', 404);

/** the pending administrator, locked @param {any} tx @param {string} userId */
async function pendingAccount(tx, userId) {
  const [u] = (await tx.execute(sql`SELECT id, email, role, status, "structureId", mfa_enabled FROM "ProUser" WHERE id = ${String(userId || '')} FOR UPDATE`)).rows;
  return u && u.status === PRO_PENDING_VERIFICATION_STATUS && String(u.role).toUpperCase() === 'STRUCTURE_ADMIN' ? u : null;
}

/**
 * @param {{ userId?: string, sourceUrl?: string, evidenceNote?: string, territoryConfirmed?: boolean, expectedVersion?: string }} input
 * @param {{ email: string, role: string }} reviewer the administrator (admin JWT with MFA — the handler enforces it)
 * @param {{ db?: any, env?: Record<string, string | undefined> }} [deps]
 */
export async function activateSelfRegistration(input, reviewer, deps = {}) {
  const db = deps.db || defaultDb;
  const userId = String(input?.userId || '').trim();
  if (!userId) return NOT_PENDING();
  if (!/^[0-9a-f]{64}$/.test(String(input?.expectedVersion || ''))) {
    return bad('VERSION_REQUIRED', 'Relisez la fiche avant de décider : la décision porte sur la version lue (expectedVersion).');
  }
  const note = String(input?.evidenceNote || '').trim();
  let out;
  try {
    out = await db.transaction(async (tx) => {
      const u = await pendingAccount(tx, userId);
      if (!u) return NOT_PENDING();
      const sid = String(u.structureId);
      const [s] = (await tx.execute(sql`SELECT id, nom, statut, verification_status FROM "Structure" WHERE id = ${sid} FOR UPDATE`)).rows;
      if (!s) return NOT_PENDING();
      if (!['actif', 'brouillon'].includes(String(s.statut))) {
        return bad('structure_not_activable', 'Cette organisation est suspendue ou archivée : traitez d’abord son activité (motif dans le journal), puis la demande.', 409);
      }
      const kept = await keptInsteadOf(tx, sid);
      if (kept) return bad('put_aside_as_duplicate', `Cette fiche a été écartée comme doublon de « ${kept.nom} » : la demande n’est pas activée ici.`, 409);

      const v = await recordVerification({ entityType: 'structure', entityId: sid, action: 'VERIFY', reviewer: { id: reviewer.email, role: reviewer.role },
        sourceUrl: String(input?.sourceUrl || ''), evidenceNote: note, territoryConfirmed: input?.territoryConfirmed === true, expectedVersion: String(input.expectedVersion) },
      { db: tx, ...(deps.env ? { env: deps.env } : {}) });
      if (!v.ok) throw new Rollback(bad(v.code, v.message, v.status));
      const wasActive = s.statut === 'actif';
      if (!wasActive) {
        const a = await setActivity(sid, { action: 'REACTIVATE', reason: `Inscription ADA Pro vérifiée sur une source officielle : ${note}` }, reviewer.email, tx);
        if (!a.ok) throw new Rollback(a);
      }
      const done = (await tx.execute(sql`UPDATE "ProUser" SET status = 'active', "updatedAt" = NOW() WHERE id = ${userId} AND status = ${PRO_PENDING_VERIFICATION_STATUS} RETURNING id`)).rows;
      if (!done.length) throw new Rollback(NOT_PENDING());
      const inv = await writeMfaInvitation(tx, { ...u, status: 'active' });
      // the sender of the invitation is this administrator (admin realm): redemption checks the AdminUser is still enabled
      await tx.insert(AuditLog).values({ action: 'INVITATION_SENT', entity: 'ProUser', entity_id: userId, actor: reviewer.email, actor_id: reviewer.email,
        details: { kind: 'MFA_ENROLMENT', invitationId: inv.invitationId, memberId: userId, role: inv.role, lostDevice: false, senderRealm: 'ADMIN', structureId: sid }, ip_hash: 'ADMIN_MFA' });
      await tx.insert(AuditLog).values({ action: 'PRO_SELF_REGISTRATION_ACTIVATED', entity: 'ProUser', entity_id: userId, actor: reviewer.email, actor_id: reviewer.email,
        details: { structureId: sid, structureWasActive: wasActive, sourceUrl: String(input?.sourceUrl || '').trim(), invitationId: inv.invitationId }, ip_hash: 'ADMIN_MFA' });
      return { ok: true, sid, invitationId: inv.invitationId, token: inv.token, email: inv.email };
    });
  } catch (e) {
    if (e instanceof Rollback) return e.out;
    throw e;
  }
  if (!out.ok) return out;
  const mailStatus = await mailMfaInvitation(out.email, out.token, 'platform');
  return { ok: true, account: { id: userId, status: 'active' }, organization: { id: out.sid, statut: 'actif', identity: 'VERIFIED' }, invitation: { id: out.invitationId }, mailStatus };
}

/**
 * @param {{ userId?: string, reason?: string }} input @param {{ email: string }} reviewer @param {{ db?: any }} [deps]
 */
export async function refuseSelfRegistration(input, reviewer, deps = {}) {
  const db = deps.db || defaultDb;
  const userId = String(input?.userId || '').trim();
  const reason = String(input?.reason || '').trim().slice(0, 1000);
  if (!userId) return NOT_PENDING();
  if (reason.length < 5) return bad('reason_required', 'Indiquez le motif (il est conservé dans le journal).');
  try {
    return await db.transaction(async (tx) => {
      const u = await pendingAccount(tx, userId);
      if (!u) return NOT_PENDING();
      const r = await administerProAccount('DISABLE_PRO_ACCOUNT', { userId, reason }, reviewer.email, tx);
      if (!r.ok) throw new Rollback(r);
      await tx.insert(AuditLog).values({ action: 'PRO_SELF_REGISTRATION_REFUSED', entity: 'ProUser', entity_id: userId, actor: reviewer.email, actor_id: reviewer.email,
        details: { structureId: String(u.structureId), reason }, ip_hash: 'ADMIN_MFA' });
      return { ok: true, account: { id: userId, status: 'disabled' } };
    });
  } catch (e) {
    if (e instanceof Rollback) return e.out;
    throw e;
  }
}
