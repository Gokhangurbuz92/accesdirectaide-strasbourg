// @ts-nocheck
/**
 * PKG-5 / A12 — privacy console (DPO / administrators with MFA). Every action is written to AuditLog; destructive or protection-removing actions need TWO people.
 *   - overview: open access requests (the existing two-person DSR review), active legal holds, retention rules with their known conflicts, recovery cases.
 *   - legal hold: placing a hold protects a record from automated deletion at once (one MFA administrator, reason); RELEASING it re-enables deletion, so one
 *     administrator proposes with a reason and a DIFFERENT one confirms (also enforced by a database CHECK).
 *   - assisted ownership recovery (the person lost access to their e-mail): one administrator proposes the new address with the identity evidence checked in
 *     person; a DIFFERENT administrator approves or rejects. Approval changes the account address (unverified), makes the old password unusable and removes
 *     pending e-mail tokens; the person then sets a password through "mot de passe oublié" on the new address. No dossier content is shown.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { RETENTION_POLICY_REGISTRY } from './privacy.js';
import { RETENTION } from '../_handlers/cron/gdpr-purge.js';
import { listOpen } from './dsr-review.js';
import { listOpenErasures } from './dsr-erasure-review.js';
import { listOpenClosures } from './org-closure.js';
import { sealText, openText } from '../lib/data-keys.js';
import { retentionReport } from './retention.js';
import { buildAppUrl, generateAuthToken, hashAuthToken, isValidEmail, normalizeEmail, unsetPasswordHash } from '../_utils/user-auth.js';
import { sendMail as defaultSendMail, mailLedgerStatus } from '../_utils/mailer.js';

export const HOLD_CATEGORIES = { SharedDiagnostic: 'SharedDiagnostic', CitizenUser: 'CitizenUser', ProCase: 'ProCase', Structure: 'Structure' };   // PKG-11 / E08: a hold on an organization blocks its closure
const bad = (status, code, message) => ({ ok: false, status, code, message });
const audit = (db, action, actor, entity, entityId, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity, entity_id: entityId, details });

export function retentionView() {
  // PKG-5: conflicts are COMPUTED (registry duration vs the purge job), so a future divergence shows up here instead of being hidden
  const conflicts = [];
  const pairs = [['AUDIT_LOG', 'AuditLog', RETENTION.AUDIT_LOG_DAYS], ['CONSENT_LOG', 'ConsentLog', RETENTION.CONSENT_LOG_DAYS]];
  for (const [key, data, days] of pairs) {
    const r = RETENTION_POLICY_REGISTRY[key];
    if (!r || r.durationDays !== days || r.action !== 'DELETE') conflicts.push({ data, registry: r ? `${r.action} ${r.durationDays ?? '—'} j` : 'absent', purge: `supprimé après ${days} jours par cron/gdpr-purge`, decision: 'DPO / juriste' });
  }
  const pendingReview = Object.entries(RETENTION_POLICY_REGISTRY).filter(([, r]) => r.requiresReview).map(([k, r]) => ({ key: k, durationDays: r.durationDays, note: r.note || null }));
  const notImplemented = Object.entries(RETENTION_POLICY_REGISTRY).filter(([, r]) => r.implementedBy === null).map(([k]) => k);
  return { registry: RETENTION_POLICY_REGISTRY, purgeDays: RETENTION, conflicts, pendingReview, notImplemented, legalHoldRespectedBy: ['cron/gdpr-purge (dossiers partagés)', 'suppression de compte (privacy.js)'] };
}

export async function overview(db = defaultDb) {
  const holds = (await db.execute(sql`SELECT id, "dataCategory", "recordId", "reasonCode", "createdBy", "createdAt", "releaseProposedBy", "releaseProposedAt", "releaseReason" FROM "LegalHold" WHERE status = 'ACTIVE' ORDER BY "createdAt" DESC LIMIT 200`)).rows;
  const recovery = (await db.execute(sql`SELECT id, "citizenUserId", "evidenceNote", status, "proposedBy", "proposedAt" FROM "OwnershipRecoveryCase" WHERE status = 'PROPOSED' ORDER BY "proposedAt" LIMIT 100`)).rows;
  return { ok: true, accessRequests: await listOpen(db), erasureRequests: await listOpenErasures(db), organizationClosures: await listOpenClosures(db), legalHolds: holds, recoveryCases: recovery, retention: retentionView(),
    retentionReport: await retentionReport(db).catch(() => null) };   // launch-readiness item 62: counts only, nothing deleted
}

export async function placeHold({ dataCategory, recordId, reasonCode }, actor, db = defaultDb) {
  const cat = HOLD_CATEGORIES[String(dataCategory || '')]; const id = String(recordId || '').trim(); const why = String(reasonCode || '').trim();
  if (!cat) return bad(400, 'UNKNOWN_CATEGORY', 'Catégorie inconnue (SharedDiagnostic, CitizenUser, ProCase).');
  if (why.length < 10) return bad(400, 'REASON_REQUIRED', 'Indiquez le fondement (au moins 10 caractères).');
  const [exists] = (await db.execute(sql`SELECT 1 AS x FROM ${sql.raw(`"${cat}"`)} WHERE id = ${id} LIMIT 1`)).rows;
  if (!exists) return bad(404, 'not_found', 'Enregistrement introuvable.');
  const [dup] = (await db.execute(sql`SELECT id FROM "LegalHold" WHERE status = 'ACTIVE' AND "dataCategory" = ${cat} AND "recordId" = ${id} LIMIT 1`)).rows;
  if (dup) return bad(409, 'already_held', 'Une conservation est déjà active pour cet enregistrement.');
  const hid = crypto.randomUUID();
  await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES (${hid}, ${cat}, ${id}, ${why.slice(0, 500)}, ${actor}, 'ACTIVE', NOW())`);
  await audit(db, 'LEGAL_HOLD_PLACED', actor, 'LegalHold', hid, { dataCategory: cat });
  return { ok: true, id: hid };
}

export async function proposeRelease(id, reason, actor, db = defaultDb) {
  const why = String(reason || '').trim();
  if (why.length < 10) return bad(400, 'REASON_REQUIRED', 'Indiquez pourquoi la conservation peut cesser (au moins 10 caractères).');
  const rows = (await db.execute(sql`UPDATE "LegalHold" SET "releaseProposedBy" = ${actor}, "releaseProposedAt" = NOW(), "releaseReason" = ${why.slice(0, 500)} WHERE id = ${String(id || '')} AND status = 'ACTIVE' AND "releaseProposedBy" IS NULL RETURNING id`)).rows;   // PKG-6 / D22: a pending proposal is never overwritten
  if (!rows.length) return bad(404, 'not_found', 'Conservation introuvable, déjà levée ou levée déjà proposée.');
  await audit(db, 'LEGAL_HOLD_RELEASE_PROPOSED', actor, 'LegalHold', rows[0].id, {});
  return { ok: true };
}

export async function confirmRelease(id, actor, db = defaultDb, seenProposedAt = undefined) {
  const [h] = (await db.execute(sql`SELECT "releaseProposedBy" AS p, "releaseProposedAt" AS at FROM "LegalHold" WHERE id = ${String(id || '')} AND status = 'ACTIVE'`)).rows;
  if (!h) return bad(404, 'not_found', 'Conservation introuvable ou déjà levée.');
  if (!h.p) return bad(409, 'NO_PROPOSAL', 'La levée doit d’abord être proposée.');
  if (String(h.p).toLowerCase() === String(actor).toLowerCase()) return bad(403, 'TWO_PERSON_RULE', 'La levée doit être confirmée par un autre administrateur.');
  if (!seenProposedAt || new Date(seenProposedAt).getTime() !== new Date(h.at).getTime()) return bad(409, 'VERSION_CHANGED', 'La proposition de levée a changé depuis votre lecture : rechargez et relisez-la.');   // bound to the proposal read
  await db.execute(sql`UPDATE "LegalHold" SET status = 'RELEASED', "releasedAt" = NOW(), "releasedBy" = ${actor} WHERE id = ${String(id)} AND status = 'ACTIVE'`);
  await audit(db, 'LEGAL_HOLD_RELEASED', actor, 'LegalHold', String(id), { proposedBy: h.p });
  return { ok: true };
}

export async function proposeRecovery({ currentEmail, newEmail, evidenceNote }, actor, db = defaultDb) {
  const cur = normalizeEmail(currentEmail); const next = normalizeEmail(newEmail); const ev = String(evidenceNote || '').trim();
  if (!isValidEmail(next)) return bad(400, 'INVALID_EMAIL', 'Nouvelle adresse invalide.');
  if (ev.length < 30) return bad(400, 'EVIDENCE_REQUIRED', 'Décrivez la vérification d’identité faite (au moins 30 caractères, sans copier de pièce).');
  const [u] = (await db.execute(sql`SELECT id FROM "CitizenUser" WHERE email = ${cur} LIMIT 1`)).rows;
  if (!u) return bad(404, 'not_found', 'Compte introuvable.');
  const [taken] = (await db.execute(sql`SELECT 1 AS x FROM "CitizenUser" WHERE email = ${next} LIMIT 1`)).rows;
  if (taken) return bad(409, 'EMAIL_IN_USE', 'Cette adresse est déjà utilisée par un autre compte.');
  const cid = crypto.randomUUID();
  await db.execute(sql`INSERT INTO "OwnershipRecoveryCase" (id, "citizenUserId", "newEmailEncrypted", "evidenceNote", status, "proposedBy", "proposedAt")
    VALUES (${cid}, ${u.id}, ${sealText(next, { purpose: 'ownership-recovery', context: `recovery:${cid}` })}, ${ev.slice(0, 1000)}, 'PROPOSED', ${actor}, NOW())`);
  await audit(db, 'OWNERSHIP_RECOVERY_PROPOSED', actor, 'OwnershipRecoveryCase', cid, {});
  return { ok: true, id: cid };
}

export async function decideRecovery(id, { decision, note }, actor, db = defaultDb, { sendMail = defaultSendMail } = {}) {
  const d = String(decision || '').toUpperCase();
  if (!['APPROVE', 'REJECT'].includes(d)) return bad(400, 'invalid_decision', 'Décision invalide.');
  if (String(note || '').trim().length < 10) return bad(400, 'NOTE_REQUIRED', 'Motivez la décision (au moins 10 caractères).');
  let mails = null;
  const out = await db.transaction(async (tx) => {
    const [c] = (await tx.execute(sql`SELECT id, "citizenUserId" AS uid, "newEmailEncrypted" AS enc, "proposedBy" AS p FROM "OwnershipRecoveryCase" WHERE id = ${String(id || '')} AND status = 'PROPOSED' FOR UPDATE`)).rows;
    if (!c) return bad(404, 'not_found', 'Demande introuvable ou déjà décidée.');
    if (String(c.p).toLowerCase() === String(actor).toLowerCase()) return bad(403, 'TWO_PERSON_RULE', 'La décision doit être prise par un autre administrateur.');
    if (d === 'APPROVE') {
      const next = openText(c.enc, { purpose: 'ownership-recovery', context: `recovery:${c.id}` });
      if (!next) return bad(409, 'UNREADABLE', 'Adresse illisible (clé de chiffrement).');
      const [taken] = (await tx.execute(sql`SELECT 1 AS x FROM "CitizenUser" WHERE email = ${next} AND id <> ${c.uid} LIMIT 1`)).rows;
      if (taken) return bad(409, 'EMAIL_IN_USE', 'Cette adresse est désormais utilisée par un autre compte.');
      const [prev] = (await tx.execute(sql`SELECT email FROM "CitizenUser" WHERE id = ${c.uid}`)).rows;
      const unusable = unsetPasswordHash();   // PKG-11 audit pass 2: chosen by whoever proves the new mailbox (verify-email → choose the password), never by a sign-up
      await tx.execute(sql`UPDATE "CitizenUser" SET email = ${next}, "emailVerifiedAt" = NULL, "passwordHash" = ${unusable}, "failedLoginAttempts" = 0, "lockoutUntil" = NULL, "sessionsValidAfter" = NOW(), "updatedAt" = NOW() WHERE id = ${c.uid}`);   // PKG-11 audit: old sessions end at once
      await tx.execute(sql`DELETE FROM "AuthToken" WHERE "userId" = ${c.uid}`);
      // R12 (C25): the new address receives the link that proves it and lets the person choose a password; the former address is told — both after COMMIT
      const raw = generateAuthToken();
      await tx.execute(sql`INSERT INTO "AuthToken" (id, "userId", type, "tokenHash", "expiresAt") VALUES (${crypto.randomUUID()}, ${c.uid}, 'EMAIL_VERIFY', ${hashAuthToken(raw)}, NOW() + interval '2 hours')`);
      mails = { next, previous: prev?.email || null, link: buildAppUrl(`/api/auth/verify-email?token=${encodeURIComponent(raw)}&next=${encodeURIComponent('/compte')}`) };
    }
    await tx.execute(sql`UPDATE "OwnershipRecoveryCase" SET status = ${d === 'APPROVE' ? 'APPROVED' : 'REJECTED'}, "decidedBy" = ${actor}, "decidedAt" = NOW(), "decisionNote" = ${String(note).trim().slice(0, 1000)} WHERE id = ${c.id}`);
    await tx.insert(AuditLog).values({ action: d === 'APPROVE' ? 'OWNERSHIP_RECOVERY_APPROVED' : 'OWNERSHIP_RECOVERY_REJECTED', actor, actor_id: actor, entity: 'OwnershipRecoveryCase', entity_id: c.id, details: { proposedBy: c.p } });
    return { ok: true };
  });
  if (!out.ok || !mails) return out;
  const sent = await sendMail({ to: mails.next, subject: 'Récupération de votre compte Accès Direct Aide', category: 'ownership_recovery',
    text: `Notre équipe a rattaché votre compte à cette adresse après vérification de votre identité.\nConfirmez l’adresse et choisissez votre mot de passe (lien valable 2 heures ; ensuite, « Renvoyer un email de vérification » depuis la page de connexion) : ${mails.link}\nSi vous n’êtes pas à l’origine de cette demande, contactez-nous.` }).catch(() => null);
  let previousNotice = null;
  if (mails.previous && normalizeEmail(mails.previous) !== normalizeEmail(mails.next)) {
    previousNotice = await sendMail({ to: mails.previous, subject: 'L’adresse de votre compte a été changée', category: 'ownership_recovery_notice',
      text: 'L’adresse e-mail de votre compte Accès Direct Aide a été remplacée à la suite d’une demande de récupération vérifiée par notre équipe. Si ce n’est pas vous, contactez-nous sans attendre.' }).catch(() => null);
  }
  // the administrator sees what really happened to each message (never « sent » when no provider took it)
  return { ok: true, linkSent: mailLedgerStatus(sent), previousNotified: previousNotice ? mailLedgerStatus(previousNotice) : 'NO_PREVIOUS_ADDRESS' };
}
