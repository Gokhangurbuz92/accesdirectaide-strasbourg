// @ts-nocheck
/**
 * G8 (19/11/2026, pilot onboarding acceptance) — ADA's own administration of ONE professional account, from /admin/organizations (MFA, written reason, journal).
 *
 * Why: until now only the structure's administrator could disable a member (api/_handlers/pro/team.js) and only the closure of the WHOLE organization
 * anonymised accounts (api/_services/org-closure.js). The operator could neither cut an account on incident (cgu-professionnel § 7 « le compte peut être
 * suspendu ») when the structure administrator is unavailable, nor execute a former member's erasure request (RGPD art. 17) — the account, its password
 * hash and TOTP seed stayed for ever (gdpr-purge E9b only reports disabled accounts).
 *   DISABLE_PRO_ACCOUNT  an ACTIVE PRO / STRUCTURE_ADMIN account: status disabled, every session ends, the Outlook link is deleted. Refused (409
 *                        handover_required, with counts) while the member still holds open cases, referral proposals awaiting the person, future
 *                        appointments or contact-person roles: those are handed over by the structure (team screen, successor) — never orphaned here.
 *   ERASE_PRO_ACCOUNT    an account ALREADY DISABLED (the departure — and its hand-over — happened first): what names or authenticates the person is erased,
 *                        as the closure does for every member (address, password hash, factor, notification settings, public profile, notifications, Outlook
 *                        link, the invitations sent to that address). The row stays (the structure's and ADA's journals refer to its id); the proof of the
 *                        terms acceptance (ConsentLog: id + document@version, no address) is kept for the period of the privacy notice § 4. An active
 *                        legal hold on the organization blocks it (as it blocks the closure).
 * Never the platform role (SUPERADMIN): it is not a member of a structure. Journal: AuditLog PRO_ACCOUNT_DISABLED / PRO_ACCOUNT_ERASED, ids and the reason,
 * never the address. Same transaction as the change.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const MEMBER_ROLES = sql`upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN')`;
export const ERASED_EMAIL = (id) => `closed-${id}@closed.invalid`;
const isErased = (email) => /^closed-.*@closed\.invalid$/.test(String(email || ''));

/** the accounts of one organization (no secret, no hash) — for the administrator's card @param {string} structureId */
export async function listMembers(structureId, db = defaultDb) {
  const rows = (await db.execute(sql`SELECT u.id, u.email, u.role, u.status, u.mfa_enabled AS "mfaEnabled", u."createdAt" FROM "ProUser" u
    WHERE u."structureId" = ${String(structureId || '')} AND ${MEMBER_ROLES} ORDER BY u."createdAt", u.id LIMIT 500`)).rows;
  return { ok: true, members: rows.map((r) => ({ id: r.id, email: isErased(r.email) ? null : r.email, role: String(r.role).toUpperCase(), status: r.status,
    mfaEnabled: r.mfaEnabled === true, erased: isErased(r.email), createdAt: r.createdAt })) };
}

/** what the member still holds that their structure must hand over first (counts only) */
async function holdsOf(tx, id, sid) {
  const one = async (q) => Number((await tx.execute(q)).rows[0]?.n || 0);
  const exists = async (t) => Boolean((await tx.execute(sql`SELECT to_regclass(${`"${t}"`}) IS NOT NULL AS ok`)).rows[0]?.ok);
  return {
    openCases: await one(sql`SELECT count(*)::int AS n FROM "ProCase" WHERE "structureId" = ${sid} AND "assigneeProUserId" = ${id} AND status <> 'CLOSED'`),
    pendingProposals: await one(sql`SELECT count(*)::int AS n FROM "Referral" WHERE "fromStructureId" = ${sid} AND "createdByProUserId" = ${id} AND status IN ('DRAFT', 'PENDING_CITIZEN')`),
    futureAppointments: await one(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "structureId" = ${sid} AND "createdByProUserId" = ${id} AND status IN ('booked', 'requested', 'confirmed') AND "endAt" > NOW()`),
    referentRoles: (await exists('DossierReferent')) ? await one(sql`SELECT count(*)::int AS n FROM "DossierReferent" WHERE "proUserId" = ${id} AND "structureId" = ${sid} AND status IN ('PROPOSED', 'ACCEPTED_BY_CITIZEN')`) : 0,
  };
}

/**
 * @param {'DISABLE_PRO_ACCOUNT' | 'ERASE_PRO_ACCOUNT'} action @param {{ userId?: string, reason?: string }} input @param {string} reviewer the administrator's e-mail
 */
export async function administerProAccount(action, input, reviewer, db = defaultDb) {
  const id = String(input?.userId || '').trim();
  const reason = String(input?.reason || '').trim().slice(0, 1000);
  if (!['DISABLE_PRO_ACCOUNT', 'ERASE_PRO_ACCOUNT'].includes(action)) return bad('invalid_action', 'Action invalide.');
  if (!id) return bad('not_found', 'Compte introuvable.', 404);
  if (reason.length < 5) return bad('reason_required', 'Indiquez le motif (il est conservé dans le journal).');
  return db.transaction(async (tx) => {
    const [u] = (await tx.execute(sql`SELECT u.id, u.email, u.role, u.status, u."structureId" FROM "ProUser" u WHERE u.id = ${id} AND ${MEMBER_ROLES} FOR UPDATE`)).rows;
    if (!u || isErased(u.email)) return bad('not_found', 'Compte introuvable ou déjà effacé.', 404);
    const sid = String(u.structureId);
    if (action === 'DISABLE_PRO_ACCOUNT') {
      if (u.status === 'disabled') return bad('not_found', 'Ce compte est déjà désactivé.', 404);
      const holds = await holdsOf(tx, id, sid);
      if (Object.values(holds).some((n) => n > 0)) {
        return { ...bad('handover_required', 'Ce membre a encore des dossiers, des propositions, des rendez-vous ou des rôles de référent : l’administrateur de sa structure les confie d’abord à un autre membre (écran Équipe), ou la structure est fermée.', 409), holds };
      }
      await tx.execute(sql`UPDATE "ProUser" SET status = 'disabled', "sessionsValidAfter" = NOW(), "updatedAt" = NOW() WHERE id = ${id}`);
      const outlook = (await tx.execute(sql`DELETE FROM "ProOutlookToken" WHERE "userId" = ${id}`)).rowCount ?? 0;
      await tx.insert(AuditLog).values({ action: 'PRO_ACCOUNT_DISABLED', entity: 'ProUser', entity_id: id, actor: reviewer, actor_id: reviewer,
        details: { structureId: sid, role: String(u.role).toUpperCase(), reason, outlookLinksErased: outlook }, ip_hash: 'ADMIN_MFA' });
      return { ok: true, account: { id, status: 'disabled' } };
    }
    if (u.status !== 'disabled') return bad('pro_account_active', 'Ce compte est encore actif : il est d’abord désactivé (par sa structure, ou ici), puis effacé.', 409);
    // a legal hold on the organization (privacy console) blocks the erasure of its members' accounts as it blocks the closure (org-closure.js)
    if ((await tx.execute(sql`SELECT 1 FROM "LegalHold" WHERE status = 'ACTIVE' AND "dataCategory" = 'Structure' AND "recordId" = ${sid} LIMIT 1`)).rows.length) {
      return bad('legal_hold_active', 'Une conservation bloquée (gel) vise cette organisation : l’effacement attend sa levée.', 409);
    }
    const email = String(u.email).trim().toLowerCase();
    const n = async (q) => (await tx.execute(q)).rowCount ?? 0;
    const summary = {
      invitationsErased: await n(sql`DELETE FROM "Invitation" WHERE "structureId" = ${sid} AND lower(email) = ${email} AND used_at IS NULL`),
      invitationsAnonymized: await n(sql`UPDATE "Invitation" SET email = ${ERASED_EMAIL(id)} WHERE "structureId" = ${sid} AND lower(email) = ${email}`),
      notificationsErased: await n(sql`DELETE FROM "ProNotification" WHERE "userId" = ${id}`),
      outlookLinksErased: await n(sql`DELETE FROM "ProOutlookToken" WHERE "userId" = ${id}`),
      profileCleared: await n(sql`UPDATE "ProProfile" SET "displayName" = NULL, "jobTitle" = NULL, "descriptionPublic" = NULL, "photoUrl" = NULL, "isPubliclyVisible" = false, "updatedAt" = NOW() WHERE "proUserId" = ${id}`),
    };
    await tx.execute(sql`UPDATE "ProUser" SET email = ${ERASED_EMAIL(id)}, password_hash = ${'!closed:' + crypto.randomBytes(24).toString('hex')}, mfa_enabled = false, mfa_secret = NULL,
      "notificationEmailEnabled" = false, "notificationPrefs" = '{}'::jsonb, "sessionsValidAfter" = NOW(), "updatedAt" = NOW() WHERE id = ${id}`);
    await tx.insert(AuditLog).values({ action: 'PRO_ACCOUNT_ERASED', entity: 'ProUser', entity_id: id, actor: reviewer, actor_id: reviewer,
      details: { structureId: sid, role: String(u.role).toUpperCase(), reason, ...summary }, ip_hash: 'ADMIN_MFA' });
    return { ok: true, account: { id, status: 'disabled', erased: true }, summary };
  });
}
