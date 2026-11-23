// @ts-nocheck
/**
 * G14-PS (owner decision 23/11/2026) — the SOCIAL referral (« orientation sociale »), the non-HDS cross-sector orientation (CCAS → association → housing
 * body…). Rules: api/lib/social-referral-policy.js (closed reasons, no free text, no document, NOT_ESSMS organisations only). Tables: "SocialReferral" and
 * its append-only "SocialReferralEvent" (migration drizzle/pending/0061_g14_ps_social_referrals.sql). Capability: `pro.referrals_social` (api/_utils/capabilities.js).
 * The HDS referral of a dossier (api/_services/referrals.js, `pro.referrals`) is a different processing and stays closed.
 *
 *   PENDING_CITIZEN ──person consents (Mon Espace, or on the professional's screen with re-authentication)──▶ SENT ──receiver──▶ ACCEPTED ──▶ COMPLETED
 *        │  └─person refuses / sender cancels──▶ CANCELLED                                │       └──▶ DECLINED (closed motive)
 *        └─code not used within CLAIM_CODE_DAYS──▶ EXPIRED              no answer: due + 14 days ──▶ EXPIRED        accepted, idle 180 days ──▶ CLOSED
 *   SENT / ACCEPTED ──person withdraws at any time──▶ WITHDRAWN
 *
 * Identification of the person WITHOUT the professional typing anything about them: the proposal yields a one-time code (10 characters, only its sha256 is
 * stored) that the professional gives to the person; the person enters it in Mon Espace (« Mes orientations sociales »), sees the sending and receiving
 * organisations and the reasons, and decides. Assisted mode: the person types their OWN e-mail and password on the professional's screen; the password is
 * verified and never stored or returned, nothing about the account is shown to the professional, and the event records the channel ASSISTED_ON_SCREEN.
 * What the receiving organisation sees: the reasons, the dates, the statuses, and — ONLY while the referral is SENT or ACCEPTED and only if the person ticked
 * it — the person's e-mail and / or phone. The sender sees statuses and reasons, never the contact. Every transition is ONE conditional UPDATE (status IN
 * allowed) recorded in SocialReferralEvent; consent and withdrawal are ConsentLog rows (purpose SOCIAL_REFERRAL); every professional action is audited.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, ConsentLog } from '../../src/db/schema.js';
import { activeMemberSql } from '../_utils/share-access.js';
import { notPutAsideAsDuplicateSql } from '../_utils/org-eligibility.js';
import { normalizeEmail, verifyPassword } from '../_utils/user-auth.js';
import {
  ACCEPTED_IDLE_CLOSE_DAYS, ANSWER_DAYS, CLAIM_CODE_DAYS, CODE_ALPHABET, EXPIRE_AFTER_DUE_DAYS, SOCIAL_REASON_CODES, SOCIAL_REFERRAL_CONSENT_PURPOSE,
  SOCIAL_REFERRAL_CONSENT_VERSION, WITHDRAWABLE, normaliseCode, socialReferralStructureClass,
} from '../lib/social-referral-policy.js';
import { logger } from '../lib/logger.js';

const day = 86400000;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const notFound = () => bad('not_found', 'Orientation introuvable.', 404);
const rowsOf = (r) => r?.rows || r || [];
export const hashCode = (code) => crypto.createHash('sha256').update(`ada-social-referral:${normaliseCode(code)}`, 'utf8').digest('hex');
/** 10 characters of the unambiguous alphabet (≈ 49 bits), grouped 5-5 for reading aloud */
export function newClaimCode() {
  const bytes = crypto.randomBytes(10);
  const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/* --------------------------------------------------------------------------------------------------------------- schema availability */
const schemaCache = new WeakMap();
/** does this database have migration 0061 (read at most once a minute per client; a failed read is not remembered) */
export async function socialReferralsAvailable(database = defaultDb) {
  const hit = schemaCache.get(database);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const value = Boolean(rowsOf(await database.execute(sql`SELECT to_regclass('"SocialReferral"') IS NOT NULL AND to_regclass('"SocialReferralEvent"') IS NOT NULL AS ok`))[0]?.ok);
    schemaCache.set(database, { at: Date.now(), value });
    return value;
  } catch { return false; }
}
export const forgetSocialReferralSchema = (database = defaultDb) => schemaCache.delete(database);
export const NOT_AVAILABLE = bad('SOCIAL_REFERRALS_NOT_AVAILABLE', 'L’orientation sociale n’est pas encore disponible sur ce service.', 503);

/* --------------------------------------------------------------------------------------------------------------- helpers */
async function structureRow(db, id) {
  return rowsOf(await db.execute(sql`SELECT id, nom, ville, statut, verification_status, numero_finess, type_finess, type_structure FROM "Structure" WHERE id = ${String(id || '')}`))[0] || null;
}
/** the organisation of the caller qualifies (NOT_ESSMS, verified, active) and the caller is an active member with a second-factor session */
async function proGuard(db, ctx) {
  if (ctx.mfa !== true) return bad('MFA_REQUIRED', 'L’orientation sociale demande une connexion avec la double authentification.', 403);
  if (!rowsOf(await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).length) return bad('forbidden', 'Accès refusé.', 403);
  const own = socialReferralStructureClass(await structureRow(db, ctx.structureId));
  if (own.category !== 'NOT_ESSMS') return bad('STRUCTURE_NOT_ELIGIBLE', 'Votre structure ne peut pas utiliser l’orientation sociale (structure non vérifiée, établissement sanitaire ou médico-social, ou type de structure non revu).', 403);
  return null;
}
async function record(db, id, actorType, actorId, fromStatus, toStatus, channel = null) {
  await db.execute(sql`INSERT INTO "SocialReferralEvent" (id, "referralId", "actorType", "actorId", "fromStatus", "toStatus", channel)
    VALUES (${crypto.randomUUID()}, ${id}, ${actorType}, ${actorId || null}, ${fromStatus}, ${toStatus}, ${channel})`);
}
async function audit(db, action, actor, actorId, id, details = {}) {
  await db.insert(AuditLog).values({ action, actor, actor_id: actorId || null, entity: 'SocialReferral', entity_id: id, details }).catch(() => {});
}
/** one conditional transition; null when the referral was not in an allowed state (raced or replayed) */
async function transition(db, id, from, setSql, where = sql`TRUE`) {
  return rowsOf(await db.execute(sql`UPDATE "SocialReferral" SET ${setSql}, "updatedAt" = now() WHERE id = ${id} AND status IN (${sql.join(from.map((s) => sql`${s}`), sql`, `)}) AND ${where} RETURNING *`))[0] || null;
}
async function notifyOrg(structureId, message, deps) {
  try {
    const notify = deps.notify || (await import('./pro-notifications.js')).notify;
    await notify({ structureId, to: 'members', type: 'social_referral_update', title: 'Orientation sociale : nouvelle étape', message });
  } catch { /* best effort: the status is on the page */ }
}
async function consentRow(db, citizenId, referralId, decision, channel) {
  await db.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER', subject_id: String(citizenId), purpose: SOCIAL_REFERRAL_CONSENT_PURPOSE, decision,
    policy_version: SOCIAL_REFERRAL_CONSENT_VERSION, policy_hash: `${SOCIAL_REFERRAL_CONSENT_VERSION}:${SOCIAL_REFERRAL_CONSENT_PURPOSE}:${referralId}`,
    collection_channel: channel === 'ASSISTED_ON_SCREEN' ? 'assisted_on_screen' : 'account', guardian_involved: false,
    proof_level: channel === 'ASSISTED_ON_SCREEN' ? 'REAUTHENTICATED_PASSWORD' : 'AUTHENTICATED_SESSION', ...(decision ? {} : { withdrawn_at: new Date() }),
  });
}
const publicRow = (r) => ({ id: r.id, status: r.status, reasonCodes: r.reasonCodes, responseCode: r.responseCode || null, from: r.fromName, to: r.toName,
  createdAt: r.createdAt, sentAt: r.sentAt || null, dueAt: r.dueAt || null, respondedAt: r.respondedAt || null, closedAt: r.closedAt || null,
  consentChannel: r.consentChannel || null, claimExpiresAt: r.status === 'PENDING_CITIZEN' ? r.claimExpiresAt : null });

/* --------------------------------------------------------------------------------------------------------------- professional side */

/** receiving organisations: verified, active, NOT_ESSMS (FINESS-free, reviewed kind), at least one active member, not the caller's, not put aside (D8) */
export async function eligibleReceivers(ctx, q = '', db = defaultDb, onlyId = null) {
  // « * » (or nothing) = every eligible receiver; the ILIKE wildcards typed by the user are taken literally (removed)
  const term = `%${String(q || '').replace(/[*%_\\]/g, '').trim().slice(0, 60)}%`;
  const rows = rowsOf(await db.execute(sql`SELECT s.id, s.nom, s.ville, s.statut, s.verification_status, s.numero_finess, s.type_finess, s.type_structure FROM "Structure" s
    WHERE s.statut = 'actif' AND s.verification_status = 'VERIFIED' AND s.id <> ${ctx.structureId} AND s.nom ILIKE ${term}
      AND COALESCE(s.numero_finess, '') = '' AND COALESCE(s.type_finess, '') = ''
      ${onlyId ? sql`AND s.id = ${String(onlyId)}` : sql``}
      AND EXISTS (SELECT 1 FROM "ProUser" u WHERE u."structureId" = s.id AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN'))
      AND ${notPutAsideAsDuplicateSql(sql`s.id`)}
    ORDER BY s.nom LIMIT 60`));
  return rows.filter((s) => socialReferralStructureClass(s).category === 'NOT_ESSMS').slice(0, 30).map((s) => ({ id: s.id, name: s.nom, city: s.ville }));
}

export function socialReferralsPro(deps = {}) {
  const db = deps.db || defaultDb;
  const now = deps.now || (() => new Date());
  return {
    async receivers(ctx, q) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      return { ok: true, status: 200, receivers: await eligibleReceivers(ctx, q, db) };
    },
    /** inbox (received, sent to us after the person's consent) or outbox (proposed by us) */
    async list(ctx, box) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      const inbox = box !== 'outbox';
      const rows = rowsOf(await db.execute(sql`SELECT r.*, sf.nom AS "fromName", st.nom AS "toName" FROM "SocialReferral" r
        JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId"
        WHERE ${inbox ? sql`r."toStructureId" = ${ctx.structureId} AND r."sentAt" IS NOT NULL` : sql`r."fromStructureId" = ${ctx.structureId}`}
        ORDER BY r."createdAt" DESC LIMIT 100`));
      return { ok: true, status: 200, box: inbox ? 'inbox' : 'outbox', referrals: rows.map(publicRow) };
    },
    /** one referral, as the sender or the receiver sees it (the receiver also gets the contact the person chose to share, while live) */
    async get(ctx, id) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      const [r] = rowsOf(await db.execute(sql`SELECT r.*, sf.nom AS "fromName", st.nom AS "toName", u.email AS "citizenEmail", u.phone AS "citizenPhone" FROM "SocialReferral" r
        JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId" LEFT JOIN "CitizenUser" u ON u.id = r."citizenId"
        WHERE r.id = ${String(id)} AND (r."fromStructureId" = ${ctx.structureId} OR (r."toStructureId" = ${ctx.structureId} AND r."sentAt" IS NOT NULL))`));
      if (!r) return notFound();
      const receiver = r.toStructureId === ctx.structureId;
      const live = ['SENT', 'ACCEPTED'].includes(r.status);
      const contact = receiver && live ? { email: r.shareEmail ? r.citizenEmail || null : null, phone: r.sharePhone ? r.citizenPhone || null : null } : null;
      const events = rowsOf(await db.execute(sql`SELECT "actorType", "fromStatus", "toStatus", channel, "createdAt" FROM "SocialReferralEvent" WHERE "referralId" = ${r.id} ORDER BY "createdAt", id`));
      return { ok: true, status: 200, side: receiver ? 'receiver' : 'sender', referral: { ...publicRow(r), contact }, events };
    },
    /** sender: propose (waits for the person; nothing about the person is typed or stored); returns the one-time code to give to the person */
    async propose(ctx, input) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      const reasonCodes = [...new Set(input.reasonCodes)].filter((c) => SOCIAL_REASON_CODES.includes(c));
      const toStructureId = String(input.toStructureId || '');
      if (toStructureId === ctx.structureId) return bad('INVALID_RECEIVER', 'Choisissez une autre structure que la vôtre.');
      const target = await structureRow(db, toStructureId);
      const cls = socialReferralStructureClass(target);
      if (cls.category !== 'NOT_ESSMS') {
        await audit(db, 'SOCIAL_REFERRAL_RECEIVER_REFUSED', 'pro', ctx.userId, null, { reason: cls.reason, category: cls.category });
        return bad('RECEIVER_NOT_ELIGIBLE', 'Cette structure ne peut pas recevoir d’orientation sociale (structure non vérifiée ou inactive, établissement sanitaire ou médico-social, ou type de structure non revu).', 422);
      }
      if (!(await eligibleReceivers(ctx, '', db, toStructureId)).length) return bad('RECEIVER_NOT_ELIGIBLE', 'Cette structure ne peut pas recevoir d’orientation sociale (aucune équipe active).', 422);
      const key = input.idempotencyKey ? String(input.idempotencyKey) : null;
      if (key) {
        const [replay] = rowsOf(await db.execute(sql`SELECT id, status FROM "SocialReferral" WHERE "fromStructureId" = ${ctx.structureId} AND "idempotencyKey" = ${key}`));
        if (replay) return { ok: true, status: 200, referral: { id: replay.id, status: replay.status }, code: null, replay: true };
      }
      const id = crypto.randomUUID(); const code = newClaimCode(); const t = now();
      const [row] = rowsOf(await db.execute(sql`INSERT INTO "SocialReferral" (id, "fromStructureId", "toStructureId", "createdByProUserId", status, "reasonCodes", "claimCodeHash", "claimExpiresAt", "idempotencyKey", "createdAt", "updatedAt")
        VALUES (${id}, ${ctx.structureId}, ${toStructureId}, ${ctx.userId}, 'PENDING_CITIZEN', ${`{${reasonCodes.join(',')}}`}::text[], ${hashCode(code)}, ${new Date(t.getTime() + CLAIM_CODE_DAYS * day)}, ${key}, ${t}, ${t})
        ON CONFLICT DO NOTHING RETURNING id`));
      if (!row) return bad('CONFLICT', 'Cette orientation existe déjà.', 409);
      await record(db, id, 'SENDER', ctx.userId, null, 'PENDING_CITIZEN');
      await audit(db, 'SOCIAL_REFERRAL_PROPOSED', 'pro', ctx.userId, id, { toStructureId, reasonCount: reasonCodes.length });
      return { ok: true, status: 201, referral: { id, status: 'PENDING_CITIZEN', to: target.nom, reasonCodes, claimExpiresAt: new Date(t.getTime() + CLAIM_CODE_DAYS * day) }, code };
    },
    /** sender: a new code for a proposal the person has not answered (the previous code stops working) */
    async newCode(ctx, id) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      const code = newClaimCode(); const t = now();
      const r = await transition(db, String(id), ['PENDING_CITIZEN'], sql`"claimCodeHash" = ${hashCode(code)}, "claimExpiresAt" = ${new Date(t.getTime() + CLAIM_CODE_DAYS * day)}, "citizenId" = NULL`,
        sql`"fromStructureId" = ${ctx.structureId}`);
      if (!r) return notFound();
      await audit(db, 'SOCIAL_REFERRAL_CODE_RENEWED', 'pro', ctx.userId, r.id);
      return { ok: true, status: 200, referral: { id: r.id, status: r.status, claimExpiresAt: r.claimExpiresAt }, code };
    },
    /** sender: cancel before the receiver answered */
    async cancel(ctx, id) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      const [cur] = rowsOf(await db.execute(sql`SELECT status FROM "SocialReferral" WHERE id = ${String(id)} AND "fromStructureId" = ${ctx.structureId}`));
      if (!cur) return notFound();
      const r = await transition(db, String(id), ['PENDING_CITIZEN', 'SENT'], sql`status = 'CANCELLED', "closedAt" = now(), "claimCodeHash" = NULL`, sql`"fromStructureId" = ${ctx.structureId}`);
      if (!r) return bad('INVALID_STATE', 'Cette orientation ne peut plus être annulée.', 409);
      await record(db, r.id, 'SENDER', ctx.userId, cur.status, 'CANCELLED');
      await audit(db, 'SOCIAL_REFERRAL_CANCELLED', 'pro', ctx.userId, r.id);
      if (cur.status === 'SENT') await notifyOrg(r.toStructureId, 'Une orientation sociale reçue a été annulée par la structure qui l’a proposée.', deps);
      return { ok: true, status: 200, referral: { id: r.id, status: 'CANCELLED' } };
    },
    /** receiver: accept / decline (closed motive) / complete */
    async answer(ctx, id, action, responseCode = null) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      const mine = sql`"toStructureId" = ${ctx.structureId}`;
      const steps = {
        accept: { from: ['SENT'], set: sql`status = 'ACCEPTED', "respondedAt" = now()`, to: 'ACCEPTED', msg: 'Une orientation sociale que vous avez proposée a été acceptée.' },
        decline: { from: ['SENT'], set: sql`status = 'DECLINED', "responseCode" = ${responseCode}, "respondedAt" = now(), "closedAt" = now()`, to: 'DECLINED', msg: 'Une orientation sociale que vous avez proposée a été déclinée.' },
        complete: { from: ['ACCEPTED'], set: sql`status = 'COMPLETED', "closedAt" = now()`, to: 'COMPLETED', msg: 'Une orientation sociale que vous avez proposée est terminée.' },
      };
      const step = steps[action];
      if (!step) return bad('INVALID_ACTION', 'Action inconnue.');
      const [cur] = rowsOf(await db.execute(sql`SELECT status FROM "SocialReferral" WHERE id = ${String(id)} AND ${mine} AND "sentAt" IS NOT NULL`));
      if (!cur) return notFound();
      const r = await transition(db, String(id), step.from, step.set, mine);
      if (!r) return bad('INVALID_STATE', 'Cette étape n’est plus possible pour cette orientation.', 409);
      await record(db, r.id, 'RECEIVER', ctx.userId, cur.status, step.to);
      await audit(db, `SOCIAL_REFERRAL_${step.to}`, 'pro', ctx.userId, r.id, responseCode ? { responseCode } : {});
      await notifyOrg(r.fromStructureId, step.msg, deps);
      return { ok: true, status: 200, referral: { id: r.id, status: step.to } };
    },
    /**
     * assisted consent: the PERSON types their own e-mail and password on the professional's screen. Generic refusal on any mismatch (no account oracle);
     * the password is verified, never stored, never logged; nothing about the account is returned. Rate-limited by the handler.
     */
    async assistedConsent(ctx, input) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const g = await proGuard(db, ctx); if (g) return g;
      const refused = bad('INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe incorrect, ou orientation qui n’attend plus d’accord.', 403);
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM "SocialReferral" WHERE id = ${String(input.id)} AND "fromStructureId" = ${ctx.structureId}`));
      if (!r || r.status !== 'PENDING_CITIZEN') return refused;
      const email = normalizeEmail(String(input.email || ''));
      const [u] = rowsOf(await db.execute(sql`SELECT id, "passwordHash", "emailVerifiedAt" FROM "CitizenUser" WHERE email = ${email}`));
      const ok = u && u.emailVerifiedAt && (await (deps.verifyPassword || verifyPassword)(String(input.password || ''), u.passwordHash).catch(() => false));
      await audit(db, 'SOCIAL_REFERRAL_ASSISTED_REAUTH', 'pro', ctx.userId, r.id, { outcome: ok ? 'VERIFIED' : 'REFUSED' });
      if (!ok) return refused;
      if (r.citizenId && r.citizenId !== u.id) return refused;
      return decideAs(db, u.id, r.id, input.decision === 'accept', { shareEmail: input.shareEmail === true, sharePhone: input.sharePhone === true }, 'ASSISTED_ON_SCREEN', now, deps);
    },
  };
}

/* --------------------------------------------------------------------------------------------------------------- person side */

/** the person's decision on a PENDING_CITIZEN referral (consent → SENT with a due date; refusal → CANCELLED). Both organisations must still qualify. */
async function decideAs(db, citizenId, id, accept, share, channel, now, deps) {
  const [r] = rowsOf(await db.execute(sql`SELECT * FROM "SocialReferral" WHERE id = ${id} AND status = 'PENDING_CITIZEN' AND ("citizenId" = ${citizenId} OR ("citizenId" IS NULL AND ${channel} = 'ASSISTED_ON_SCREEN'))`));
  if (!r) return bad('ALREADY_DECIDED', 'Cette proposition n’attend plus votre réponse.', 409);
  const t = now();
  if (r.claimExpiresAt && new Date(r.claimExpiresAt) < t) return bad('EXPIRED', 'Cette proposition n’est plus valable. Demandez un nouveau code à la structure.', 410);
  if (!accept) {
    const done = await transition(db, id, ['PENDING_CITIZEN'], sql`status = 'CANCELLED', "citizenId" = ${citizenId}, "citizenDecisionAt" = ${t}, "consentChannel" = ${channel}, "closedAt" = ${t}, "claimCodeHash" = NULL`);
    if (!done) return bad('ALREADY_DECIDED', 'Cette proposition n’attend plus votre réponse.', 409);
    await record(db, id, 'CITIZEN', citizenId, 'PENDING_CITIZEN', 'CANCELLED', channel);
    await consentRow(db, citizenId, id, false, channel);
    await notifyOrg(r.fromStructureId, 'La personne n’a pas souhaité donner suite à une orientation sociale.', deps);
    return { ok: true, status: 200, referral: { id, status: 'CANCELLED' } };
  }
  for (const sid of [r.fromStructureId, r.toStructureId]) {
    if (socialReferralStructureClass(await structureRow(db, sid)).category !== 'NOT_ESSMS') return bad('STRUCTURE_NOT_ELIGIBLE', 'Une des structures ne peut plus utiliser l’orientation sociale : rien n’a été transmis.', 409);
  }
  return db.transaction(async (tx) => {
    const done = await transition(tx, id, ['PENDING_CITIZEN'], sql`status = 'SENT', "citizenId" = ${citizenId}, "citizenDecisionAt" = ${t}, "consentChannel" = ${channel},
      "sentAt" = ${t}, "dueAt" = ${new Date(t.getTime() + ANSWER_DAYS * day)}, "shareEmail" = ${share.shareEmail === true}, "sharePhone" = ${share.sharePhone === true}, "claimCodeHash" = NULL`);
    if (!done) throw Object.assign(new Error('raced'), { code: 'ALREADY_DECIDED' });
    await record(tx, id, 'CITIZEN', citizenId, 'PENDING_CITIZEN', 'SENT', channel);
    await consentRow(tx, citizenId, id, true, channel);
    return { ok: true, status: 200, referral: { id, status: 'SENT' } };
  }).then(async (out) => {
    await notifyOrg(r.toStructureId, 'Une orientation sociale attend votre réponse.', deps);
    await notifyOrg(r.fromStructureId, 'La personne a donné son accord à une orientation sociale.', deps);
    return out;
  }).catch((e) => (e.code === 'ALREADY_DECIDED' ? bad('ALREADY_DECIDED', 'Cette proposition n’attend plus votre réponse.', 409) : Promise.reject(e)));
}

export function socialReferralsCitizen(deps = {}) {
  const db = deps.db || defaultDb;
  const now = deps.now || (() => new Date());
  return {
    async list(citizenId) {
      if (!(await socialReferralsAvailable(db))) return { ok: true, status: 200, available: false, referrals: [] };
      const rows = rowsOf(await db.execute(sql`SELECT r.*, sf.nom AS "fromName", st.nom AS "toName" FROM "SocialReferral" r
        JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId"
        WHERE r."citizenId" = ${citizenId} ORDER BY r."createdAt" DESC LIMIT 100`));
      return { ok: true, status: 200, available: true, referrals: rows.map((r) => ({ ...publicRow(r), shareEmail: r.shareEmail, sharePhone: r.sharePhone, canWithdraw: WITHDRAWABLE.includes(r.status) })) };
    },
    /** the person enters the code the professional gave them: the proposal is attached to their account (nothing is shared yet) */
    async claim(citizenId, code) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const [row] = rowsOf(await db.execute(sql`UPDATE "SocialReferral" SET "citizenId" = ${citizenId}, "updatedAt" = now()
        WHERE "claimCodeHash" = ${hashCode(code)} AND status = 'PENDING_CITIZEN' AND "claimExpiresAt" > ${now()} AND ("citizenId" IS NULL OR "citizenId" = ${citizenId})
        RETURNING id`));
      if (!row) return bad('INVALID_CODE', 'Code inconnu ou expiré. Vérifiez-le ou demandez un nouveau code à la structure.', 404);
      return { ok: true, status: 200, referral: { id: row.id } };
    },
    async decide(citizenId, input) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      return decideAs(db, citizenId, String(input.id), input.decision === 'accept', { shareEmail: input.shareEmail === true, sharePhone: input.sharePhone === true }, 'MON_ESPACE', now, deps);
    },
    /** withdrawal at any time after consent: the receiver no longer sees the contact; both organisations are told */
    async withdraw(citizenId, id) {
      if (!(await socialReferralsAvailable(db))) return NOT_AVAILABLE;
      const [cur] = rowsOf(await db.execute(sql`SELECT status FROM "SocialReferral" WHERE id = ${String(id)} AND "citizenId" = ${citizenId}`));
      if (!cur) return notFound();
      const r = await transition(db, String(id), [...WITHDRAWABLE], sql`status = 'WITHDRAWN', "closedAt" = now()`, sql`"citizenId" = ${citizenId}`);
      if (!r) return bad('INVALID_STATE', 'Cette orientation est déjà terminée.', 409);
      await record(db, r.id, 'CITIZEN', citizenId, cur.status, 'WITHDRAWN');
      await consentRow(db, citizenId, r.id, false, 'MON_ESPACE');
      for (const sid of [r.toStructureId, r.fromStructureId]) await notifyOrg(sid, 'La personne a retiré son accord à une orientation sociale.', deps);
      return { ok: true, status: 200, referral: { id: r.id, status: 'WITHDRAWN' } };
    },
  };
}

/* --------------------------------------------------------------------------------------------------------------- timeouts (cron referral-timeouts) */

/**
 * Called by the existing referral-timeouts job (api/_handlers/cron/referral-timeouts.js). Counts only. Skipped on a database without 0061.
 *   1. a proposal whose code expired unused → EXPIRED (nothing was shared);
 *   2. SENT past its due date → ONE in-app reminder to the receiver (overdueNotifiedAt claim);
 *   3. SENT 14 days past its due date → EXPIRED (the receiver no longer sees the contact), the sender is told;
 *   4. ACCEPTED with nothing recorded for 180 days → CLOSED (no outcome is claimed).
 */
export async function runSocialReferralTimeouts({ now = new Date(), notify = null } = {}, db = defaultDb) {
  const summary = { socialCodeExpired: 0, socialOverdueNotified: 0, socialExpired: 0, socialIdleClosed: 0 };
  if (!(await socialReferralsAvailable(db))) return { ...summary, socialSkipped: 'SCHEMA_ABSENT' };
  const deps = notify ? { notify } : {};
  const expire = async (whereSql, to, fromList) => {
    const rows = rowsOf(await db.execute(sql`UPDATE "SocialReferral" SET status = ${to}, "closedAt" = ${now}, "claimCodeHash" = NULL, "updatedAt" = now()
      WHERE status IN (${sql.join(fromList.map((s) => sql`${s}`), sql`, `)}) AND ${whereSql} RETURNING id, status, "fromStructureId", "toStructureId"`));
    return rows;
  };
  for (const r of await expire(sql`"claimExpiresAt" < ${now}`, 'EXPIRED', ['PENDING_CITIZEN'])) {
    await record(db, r.id, 'SYSTEM', null, 'PENDING_CITIZEN', 'EXPIRED'); summary.socialCodeExpired += 1;
  }
  const due = rowsOf(await db.execute(sql`UPDATE "SocialReferral" SET "overdueNotifiedAt" = ${now}, "updatedAt" = now()
    WHERE status = 'SENT' AND "dueAt" < ${now} AND "overdueNotifiedAt" IS NULL RETURNING id, "toStructureId"`));
  for (const r of due) { await notifyOrg(r.toStructureId, 'Une orientation sociale attend toujours votre réponse.', deps); summary.socialOverdueNotified += 1; }
  for (const r of await expire(sql`"dueAt" < ${new Date(now.getTime() - EXPIRE_AFTER_DUE_DAYS * day)}`, 'EXPIRED', ['SENT'])) {
    await record(db, r.id, 'SYSTEM', null, 'SENT', 'EXPIRED'); summary.socialExpired += 1;
    await notifyOrg(r.fromStructureId, 'Une orientation sociale n’a pas reçu de réponse et a expiré.', deps);
  }
  for (const r of await expire(sql`"respondedAt" < ${new Date(now.getTime() - ACCEPTED_IDLE_CLOSE_DAYS * day)}`, 'CLOSED', ['ACCEPTED'])) {
    await record(db, r.id, 'SYSTEM', null, 'ACCEPTED', 'CLOSED'); summary.socialIdleClosed += 1;
  }
  if (summary.socialExpired || summary.socialCodeExpired) logger.info(summary, '[social-referrals] timeouts');
  return summary;
}

/** the person's data export (GDPR art. 15/20): their social referrals (no other organisation's internal data) @param {string} citizenId */
export const socialReferralsExportSql = (citizenId) => sql`SELECT r.id, r.status, r."reasonCodes", r."responseCode", sf.nom AS "from", st.nom AS "to", r."shareEmail", r."sharePhone",
  r."consentChannel", r."citizenDecisionAt", r."sentAt", r."respondedAt", r."closedAt", r."createdAt" FROM "SocialReferral" r
  JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId" WHERE r."citizenId" = ${citizenId} ORDER BY r."createdAt"`;
