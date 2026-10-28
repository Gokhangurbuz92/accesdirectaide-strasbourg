import crypto from 'node:crypto';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ConsentLog, SharedDiagnostic, SharedDossierGrant, SharedDossierInvite, Structure } from '../../../src/db/schema.js';
import { and, asc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { logProAudit } from '../../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { forgetSyntheses } from '../../_services/dossier-synthesis.js';
import { nextDecisionAt } from '../../lib/consent-ledger.js';   // PKG-6 / R17: AI drafts follow the citizen's decisions
import { holdsOwnership, isExpired, NOT_FOUND_BODY, ALL_PURPOSES, PURPOSE_SHARING, PURPOSE_AI, PURPOSE_SIAO, INVITE_TTL_HOURS } from '../../_utils/share-access.js';
import { isDossierRestricted } from '../../_services/processing-restriction.js';
import { clientIp } from '../../_utils/client-ip.js';

const MAX_PENDING_INVITES = 10;
const sha256 = (/** @type {string} */ v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

// PKG-11 / C22: a change of the owner's decision on a purpose (PURP-05 AI, PURP-07 SIAO) is also an append-only ConsentLog row, written in the SAME transaction
// as the grant — no proof, no change. Before: only the grant's current purposes (overwritten) and a best-effort audit line kept any trace.
const PURPOSE_POLICY_VERSION = 'pkg11-2026-10-22-dossier-purposes';
/** @param {string} shareId @param {string} structureId @param {string} purpose @param {boolean} decision */
const purposeDecision = (shareId, structureId, purpose, decision) => ({
  subject_type: 'SHARED_DOSSIER_GRANT', subject_id: `${shareId}:${structureId}`, purpose, decision, withdrawn_at: decision ? null : new Date(),
  policy_version: PURPOSE_POLICY_VERSION, policy_hash: sha256(`${PURPOSE_POLICY_VERSION}:${purpose}`), collection_channel: 'owner_link', guardian_involved: false, proof_level: 'OWNER_SECRET',
  created_at: nextDecisionAt('SHARED_DOSSIER_GRANT', `${shareId}:${structureId}`, purpose),
});

/**
 * Citizen (OWNER) management of who may work on the dossier.  One endpoint, distinct actions - the UI separates them in plain language:
 *   find_organizations {q}                      search verified organizations the owner can invite (active organization with at least one active member; 8 results)
 *   invite {structureId}                        invitation bound to ONE organization (immutable id): single use, 72 h (never longer than the dossier), purpose PURP-06
 *   list                                        who has access / pending invitations (+ purposes agreed per organization)
 *   revoke {structureId}                        REMOVE ONE organization's access (and its pending invitations); the dossier and the others are untouched
 *   revoke_invite {inviteId}                    cancel a pending invitation
 *   set_purposes {structureId, purposes[]}      agree / withdraw PURP-05 (AI / external provider) for ONE organization; PURP-06 (sharing) is implicit while the grant exists
 *   stop_sharing                                STOP sharing with everyone: every grant and pending invitation is revoked and the recipient links are invalidated; the dossier is kept
 * Erasure of the data is a different, explicit operation: POST /api/public/dossier-revoke.
 * Requires the OWNER secret (X-Share-Owner-Secret / body.rightsSecret).  Anything else: uniform 404 and nothing changes.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const shareId = String(req.body?.shareId || '').trim();
  const action = String(req.body?.action || '').trim();
  if (!shareId || !['find_organizations', 'invite', 'list', 'revoke', 'revoke_invite', 'set_purposes', 'set_siao', 'stop_sharing'].includes(action)) return res.status(404).json(NOT_FOUND_BODY);
  const ip = clientIp(req);
  try {
    const limit = await checkRateLimit('DOSSIER_GRANTS', `${shareId}:${getClientIp(req)}`);
    if (!limit.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limit))).json(/** @type {any} */ (limit).error || { error: 'Too many requests' });
    const shared = await db.query.SharedDiagnostic.findFirst({ where: eq(SharedDiagnostic.id, shareId), columns: { id: true, expiresAt: true, rightsSecretHash: true, shareTokenHash: true, ownerCitizenId: true } });
    if (!shared || !(await holdsOwnership(shared, req))) return res.status(404).json(NOT_FOUND_BODY);
    // PKG-11 / C21: while the person restricts processing (RGPD art. 18) nothing new is shared and no purpose is widened; revoking stays possible
    const widens = action === 'invite' || (action === 'set_purposes' && Array.isArray(req.body?.purposes) && req.body.purposes.map(String).includes(PURPOSE_AI)) || (action === 'set_siao' && req.body?.siao === true);
    if (widens && (await isDossierRestricted(shareId))) return res.status(409).json({ error: 'PROCESSING_RESTRICTED', message: 'Vous avez demandé la limitation du traitement de vos données : levez-la d’abord depuis « Mon compte » pour partager à nouveau.' });
    const structureId = String(req.body?.structureId || '').trim();

    if (action === 'find_organizations') {
      const q = String(req.body?.q || '').trim().slice(0, 80);
      if (q.length < 2) return res.status(200).json({ ok: true, organizations: [] });
      const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const rows = await db.select({ id: Structure.id, nom: Structure.nom, ville: Structure.ville, codePostal: Structure.code_postal })
        .from(Structure)
        // PKG-5 / E01 (owner decision 2026-10-20): only ACTIVE + identity-VERIFIED organizations with someone to receive (api/_utils/org-eligibility.js)
        .where(and(eq(Structure.statut, 'actif'), eq(Structure.verification_status, 'VERIFIED'), or(ilike(Structure.nom, like), ilike(Structure.ville, like)),
          sql`EXISTS (SELECT 1 FROM "ProUser" u WHERE u."structureId" = ${Structure.id} AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN'))`))
        .orderBy(asc(Structure.nom)).limit(8);
      return res.status(200).json({ ok: true, organizations: rows });
    }

    if (action === 'list') {
      const grants = await db.select({ structureId: SharedDossierGrant.structureId, structureName: Structure.nom, grantedAt: SharedDossierGrant.createdAt, revokedAt: SharedDossierGrant.revokedAt, purposes: SharedDossierGrant.purposes })
        .from(SharedDossierGrant).innerJoin(Structure, eq(Structure.id, SharedDossierGrant.structureId))
        .where(eq(SharedDossierGrant.sharedDiagnosticId, shareId)).orderBy(asc(SharedDossierGrant.createdAt)).limit(100);
      const invites = await db.select({ id: SharedDossierInvite.id, structureId: SharedDossierInvite.structureId, structureName: Structure.nom, createdAt: SharedDossierInvite.createdAt, expiresAt: SharedDossierInvite.expiresAt, usedAt: SharedDossierInvite.usedAt, revokedAt: SharedDossierInvite.revokedAt })
        .from(SharedDossierInvite).innerJoin(Structure, eq(Structure.id, SharedDossierInvite.structureId))
        .where(eq(SharedDossierInvite.sharedDiagnosticId, shareId)).orderBy(asc(SharedDossierInvite.createdAt)).limit(100);
      const now = Date.now();
      return res.status(200).json({
        ok: true,
        expiresAt: shared.expiresAt,
        grants: grants.map((g) => ({ structureId: g.structureId, structureName: g.structureName, grantedAt: g.grantedAt, revoked: !!g.revokedAt, purposes: String(g.purposes || PURPOSE_SHARING).split(',') })),
        invites: invites.filter((i) => !i.usedAt).map((i) => ({ id: i.id, structureId: i.structureId, structureName: i.structureName, createdAt: i.createdAt, expiresAt: i.expiresAt, status: i.revokedAt ? 'revoked' : (new Date(i.expiresAt).getTime() > now ? 'pending' : 'expired') })),
      });
    }

    if (action === 'invite') {
      if (isExpired(shared)) return res.status(410).json({ error: 'expired', message: 'Ce dossier a expiré.' });
      if (!structureId) return res.status(404).json(NOT_FOUND_BODY);
      const org = (await db.select({ id: Structure.id, nom: Structure.nom, ville: Structure.ville }).from(Structure).where(and(eq(Structure.id, structureId), eq(Structure.statut, 'actif'), eq(Structure.verification_status, 'VERIFIED'),   // E01: unknown / inactive / unverified = same 404
       
        sql`EXISTS (SELECT 1 FROM "ProUser" u WHERE u."structureId" = ${Structure.id} AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN'))`)).limit(1))[0];
      if (!org) return res.status(404).json(NOT_FOUND_BODY);                                              // unknown / not verified / nobody can receive it
      const active = (await db.select({ id: SharedDossierGrant.id }).from(SharedDossierGrant).where(and(eq(SharedDossierGrant.sharedDiagnosticId, shareId), eq(SharedDossierGrant.structureId, structureId), isNull(SharedDossierGrant.revokedAt))).limit(1))[0];
      if (active) return res.status(409).json({ error: 'already_shared', message: 'Ce dossier est déjà partagé avec cette structure.' });
      const pending = await db.select({ id: SharedDossierInvite.id }).from(SharedDossierInvite).where(and(eq(SharedDossierInvite.sharedDiagnosticId, shareId), isNull(SharedDossierInvite.usedAt), isNull(SharedDossierInvite.revokedAt), gt(SharedDossierInvite.expiresAt, new Date())));
      if (pending.length >= MAX_PENDING_INVITES) return res.status(429).json({ error: 'too_many_invites', message: 'Trop d\'invitations en attente. Annulez-en une avant d\'en créer une nouvelle.' });
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Math.min(Date.now() + INVITE_TTL_HOURS * 3600_000, new Date(shared.expiresAt).getTime()));
      const createInvite = () => db.transaction(async (tx) => {
        await tx.update(SharedDossierInvite).set({ revokedAt: new Date() })
          .where(and(eq(SharedDossierInvite.sharedDiagnosticId, shareId), eq(SharedDossierInvite.structureId, structureId), isNull(SharedDossierInvite.usedAt), isNull(SharedDossierInvite.revokedAt)));
        const [row] = await tx.insert(SharedDossierInvite).values({ sharedDiagnosticId: shareId, structureId, tokenHash: sha256(token), purpose: PURPOSE_SHARING, expiresAt }).returning({ id: SharedDossierInvite.id });
        return row;
      });
      // The database allows ONE pending invitation per (dossier, organization) (partial unique index): two concurrent requests cannot both succeed; the loser retries once and then reports a conflict.
      /** @param {any} e */
      const isUniqueViolation = (e) => (e?.code || e?.cause?.code) === '23505';
      /** @type {{ id: string } | undefined} */
      let invite;
      try { invite = await createInvite(); } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        try { invite = await createInvite(); } catch (e2) { if (!isUniqueViolation(e2)) throw e2; }
      }
      if (!invite) return res.status(409).json({ error: 'invite_conflict', message: 'Une autre invitation est en cours de création. Réessayez.' });
      await logProAudit('DOSSIER_INVITE_CREATED', 'citizen', structureId, { shareId, structureId, inviteId: invite.id, purpose: PURPOSE_SHARING }, ip).catch(() => { });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(201).json({ ok: true, inviteId: invite.id, inviteToken: token, expiresAt, organization: org, proUrl: `/pro/dossier/${encodeURIComponent(shareId)}#invite=${encodeURIComponent(token)}` });
    }

    if (action === 'revoke_invite') {
      const inviteId = String(req.body?.inviteId || '').trim();
      const done = inviteId ? await db.update(SharedDossierInvite).set({ revokedAt: new Date() })
        .where(and(eq(SharedDossierInvite.id, inviteId), eq(SharedDossierInvite.sharedDiagnosticId, shareId), isNull(SharedDossierInvite.usedAt), isNull(SharedDossierInvite.revokedAt))).returning({ id: SharedDossierInvite.id }) : [];
      if (!done.length) return res.status(404).json(NOT_FOUND_BODY);
      await logProAudit('DOSSIER_INVITE_REVOKED_BY_OWNER', 'citizen', '', { shareId, inviteId }, ip).catch(() => { });
      return res.status(200).json({ ok: true });
    }

    if (action === 'revoke') {
      if (!structureId) return res.status(404).json(NOT_FOUND_BODY);
      const done = await db.transaction(async (tx) => {
        await tx.update(SharedDossierInvite).set({ revokedAt: new Date() })
          .where(and(eq(SharedDossierInvite.sharedDiagnosticId, shareId), eq(SharedDossierInvite.structureId, structureId), isNull(SharedDossierInvite.usedAt), isNull(SharedDossierInvite.revokedAt)));
        return tx.update(SharedDossierGrant).set({ revokedAt: new Date() })
          .where(and(eq(SharedDossierGrant.sharedDiagnosticId, shareId), eq(SharedDossierGrant.structureId, structureId), isNull(SharedDossierGrant.revokedAt))).returning({ id: SharedDossierGrant.id });
      });
      if (!done.length) return res.status(404).json(NOT_FOUND_BODY);
      await forgetSyntheses(db, shareId, structureId);
      await logProAudit('DOSSIER_ACCESS_REVOKED_BY_OWNER', 'citizen', structureId, { shareId, structureId }, ip).catch(() => { });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_purposes') {
      const requested = Array.isArray(req.body?.purposes) ? [...new Set(req.body.purposes.map(String))] : [];
      if (!structureId || requested.some((/** @type {string} */ p) => !ALL_PURPOSES.includes(p))) return res.status(400).json({ error: 'purposes invalides.' });
      const [cur] = await db.select({ purposes: SharedDossierGrant.purposes }).from(SharedDossierGrant)
        .where(and(eq(SharedDossierGrant.sharedDiagnosticId, shareId), eq(SharedDossierGrant.structureId, structureId), isNull(SharedDossierGrant.revokedAt))).limit(1);
      const keepSiao = String(cur?.purposes || '').split(',').includes(PURPOSE_SIAO);   // PKG-5 / R22: the SIAO purpose has its own action and is kept here
      const purposes = [PURPOSE_SHARING, ...(requested.includes(PURPOSE_AI) ? [PURPOSE_AI] : []), ...(keepSiao ? [PURPOSE_SIAO] : [])].join(',');                // PURP-06 is implied by the grant itself; PURP-05 only when the owner says so
      const aiNow = requested.includes(PURPOSE_AI);
      const aiBefore = String(cur?.purposes || '').split(',').includes(PURPOSE_AI);
      const done = await db.transaction(async (tx) => {
        const rows = await tx.update(SharedDossierGrant).set({ purposes, purposesUpdatedAt: new Date() })
          .where(and(eq(SharedDossierGrant.sharedDiagnosticId, shareId), eq(SharedDossierGrant.structureId, structureId), isNull(SharedDossierGrant.revokedAt))).returning({ id: SharedDossierGrant.id });
        if (rows.length && aiNow !== aiBefore) await tx.insert(ConsentLog).values(purposeDecision(shareId, structureId, PURPOSE_AI, aiNow));
        return rows;
      });
      if (!done.length) return res.status(404).json(NOT_FOUND_BODY);
      if (!requested.includes(PURPOSE_AI)) await forgetSyntheses(db, shareId, structureId);   // AI consent withdrawn: its drafts are forgotten
      await logProAudit('DOSSIER_PURPOSES_CHANGED_BY_OWNER', 'citizen', structureId, { shareId, structureId, purposes }, ip).catch(() => { });
      return res.status(200).json({ ok: true, purposes: purposes.split(',') });
    }

    if (action === 'set_siao') {
      // PKG-5 / R22: the person allows (or withdraws) THIS organization to transmit the housing request to the SIAO operator (PURP-07). The transmission
      // itself stays off (SIAO_ENABLED) until the operator agreement; withdrawing is always possible.
      if (!structureId || typeof req.body?.siao !== 'boolean') return res.status(400).json({ error: 'siao invalide.' });
      const [cur] = await db.select({ purposes: SharedDossierGrant.purposes }).from(SharedDossierGrant)
        .where(and(eq(SharedDossierGrant.sharedDiagnosticId, shareId), eq(SharedDossierGrant.structureId, structureId), isNull(SharedDossierGrant.revokedAt))).limit(1);
      if (!cur) return res.status(404).json(NOT_FOUND_BODY);
      const others = String(cur.purposes || PURPOSE_SHARING).split(',').filter((p) => p && p !== PURPOSE_SIAO);
      const purposes = [...new Set([PURPOSE_SHARING, ...others, ...(req.body.siao ? [PURPOSE_SIAO] : [])])].join(',');
      const siaoBefore = String(cur.purposes || '').split(',').includes(PURPOSE_SIAO);
      const done = await db.transaction(async (tx) => {
        const rows = await tx.update(SharedDossierGrant).set({ purposes, purposesUpdatedAt: new Date() })
          .where(and(eq(SharedDossierGrant.sharedDiagnosticId, shareId), eq(SharedDossierGrant.structureId, structureId), isNull(SharedDossierGrant.revokedAt))).returning({ id: SharedDossierGrant.id });
        if (rows.length && req.body.siao !== siaoBefore) await tx.insert(ConsentLog).values(purposeDecision(shareId, structureId, PURPOSE_SIAO, req.body.siao));
        return rows;
      });
      if (!done.length) return res.status(404).json(NOT_FOUND_BODY);
      await logProAudit(req.body.siao ? 'DOSSIER_SIAO_CONSENT_GIVEN' : 'DOSSIER_SIAO_CONSENT_WITHDRAWN', 'citizen', structureId, { shareId, structureId, purposes }, ip).catch(() => { });
      return res.status(200).json({ ok: true, purposes: purposes.split(',') });
    }

    // stop_sharing: nobody keeps access, every recipient link dies, the data stays with its owner
    const stopped = await db.transaction(async (tx) => {
      const g = await tx.update(SharedDossierGrant).set({ revokedAt: new Date() }).where(and(eq(SharedDossierGrant.sharedDiagnosticId, shareId), isNull(SharedDossierGrant.revokedAt))).returning({ id: SharedDossierGrant.id });
      const i = await tx.update(SharedDossierInvite).set({ revokedAt: new Date() }).where(and(eq(SharedDossierInvite.sharedDiagnosticId, shareId), isNull(SharedDossierInvite.usedAt), isNull(SharedDossierInvite.revokedAt))).returning({ id: SharedDossierInvite.id });
      await tx.update(SharedDiagnostic).set({ shareTokenHash: sha256(crypto.randomBytes(32).toString('base64url')) }).where(eq(SharedDiagnostic.id, shareId));   // the old read link now matches nothing
      return { grants: g.length, invites: i.length };
    });
    await forgetSyntheses(db, shareId, null);
    await logProAudit('DOSSIER_SHARING_STOPPED_BY_OWNER', 'citizen', '', { shareId, ...stopped }, ip).catch(() => { });
    return res.status(200).json({ ok: true, ...stopped });
  } catch (error) {
    logger.error({ err: { name: /** @type {any} */ (error)?.name, message: /** @type {any} */ (error)?.message } }, '[Dossier Grants] Erreur');
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

