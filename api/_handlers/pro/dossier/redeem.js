import crypto from 'node:crypto';
import logger from '../../../_utils/logger.js';
import { db } from '../../../../src/db/index.js';
import { SharedDiagnostic, SharedDossierGrant, SharedDossierInvite, Structure } from '../../../../src/db/schema.js';
import { isVerifiedActive } from '../../../_utils/org-eligibility.js';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext, logProAudit } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../../_utils/rateLimit.js';
import { holdsShareToken, isLegacyShare, readInviteToken, readShareToken, isExpired, isActiveMember, findGrant, legacyShareReadEnabled, NOT_FOUND_BODY } from '../../../_utils/share-access.js';
import { isDossierRestricted } from '../../../_services/processing-restriction.js';
import { clientIp } from '../../../_utils/client-ip.js';

/**
 * POST /api/pro/dossier/redeem   body { shareId, inviteToken }   (or header X-Invite-Token)
 *
 * The ONLY way an organization obtains access to a shared dossier.  The invitation was issued by the CITIZEN (owner secret) for ONE organization
 * (immutable Structure.id), is single use, short lived and purpose bound (PURP-06).  Redemption requires a pro session of THAT organization AND active membership
 * (status active, role PRO | STRUCTURE_ADMIN, organization 'actif').  Unknown dossier / wrong or replayed token / other organization / revoked invite / non-member:
 * one indistinguishable 404.  Expired invite or dossier: 410.  A grant revoked by the owner is re-created only by an invitation issued AFTER the revocation.
 * A share link alone never authorizes an organization.  Pre-RC5 (legacy) dossiers keep a flag-gated transitional path (X-Share-Token) until the migration gate is run.
 *
 * @param {import('../../../_utils/http-types').ApiRequest} req @param {import('../../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const shareId = String(req.body?.shareId || '').trim();
  if (!shareId || shareId.length > 128) return res.status(404).json(NOT_FOUND_BODY);
  const ip = clientIp(req);
  try {
    const limit = await checkRateLimit('DOSSIER_REDEEM', `${ctx.userId}:${getClientIp(req)}`);
    if (!limit.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limit))).json(/** @type {any} */ (limit).error || { error: 'Too many requests' });
    const shared = await db.query.SharedDiagnostic.findFirst({ where: eq(SharedDiagnostic.id, shareId), columns: { id: true, expiresAt: true, rightsSecretHash: true, shareTokenHash: true } });
    if (!shared) return res.status(404).json(NOT_FOUND_BODY);
    if (await isDossierRestricted(shareId)) return res.status(404).json(NOT_FOUND_BODY);   // PKG-11 / C21: the owner restricted processing (art. 18): no new access

    const inviteToken = readInviteToken(req);
    if (inviteToken) {
      const hash = crypto.createHash('sha256').update(inviteToken, 'utf8').digest('hex');
      const invite = (await db.select().from(SharedDossierInvite).where(and(eq(SharedDossierInvite.tokenHash, hash), eq(SharedDossierInvite.sharedDiagnosticId, shareId))).limit(1))[0];
      if (!invite || invite.structureId !== ctx.structureId || invite.revokedAt) return res.status(404).json(NOT_FOUND_BODY);
      if (!(await isActiveMember(ctx)) || !(await isVerifiedOrganization(ctx.structureId))) return res.status(404).json(NOT_FOUND_BODY);   // PKG-5 / E01 (C24): checked again at redemption
      if (isExpired(shared)) return res.status(410).json({ error: 'expired', message: 'Ce dossier a expiré.' });
      const existing = await findGrant(shareId, ctx.structureId);
      // idempotent for the SAME organization (page reload, second colleague) while its grant is active and was created from this invitation
      if (existing && !existing.revokedAt && existing.inviteId === invite.id) return res.status(200).json({ ok: true, granted: true });
      if (invite.usedAt) return res.status(404).json(NOT_FOUND_BODY);                                      // replay
      if (!(new Date(invite.expiresAt).getTime() > Date.now())) return res.status(410).json({ error: 'invite_expired', message: 'Cette invitation a expiré. Demandez à l\'usager d\'en créer une nouvelle.' });
      if (existing && existing.revokedAt && !(new Date(invite.createdAt).getTime() > new Date(existing.revokedAt).getTime())) return res.status(404).json(NOT_FOUND_BODY);   // revoked AFTER this invitation was issued
      const done = await db.transaction(async (tx) => {
        const claimed = await tx.update(SharedDossierInvite).set({ usedAt: new Date(), usedByProUserId: ctx.userId })
          .where(and(eq(SharedDossierInvite.id, invite.id), isNull(SharedDossierInvite.usedAt), isNull(SharedDossierInvite.revokedAt), gt(SharedDossierInvite.expiresAt, new Date())))
          .returning({ id: SharedDossierInvite.id });
        if (!claimed.length) return false;                                                                  // lost the race: single use
        if (existing) {
          await tx.update(SharedDossierGrant).set({ revokedAt: null, grantedVia: 'invite', inviteId: invite.id, purposes: invite.purpose, purposesUpdatedAt: new Date(), grantedByProUserId: ctx.userId })
            .where(eq(SharedDossierGrant.id, existing.id));
        } else {
          await tx.insert(SharedDossierGrant).values({ sharedDiagnosticId: shareId, structureId: ctx.structureId, grantedByProUserId: ctx.userId, grantedVia: 'invite', inviteId: invite.id, purposes: invite.purpose });
        }
        return true;
      });
      if (!done) {
        await new Promise((r) => setTimeout(r, 200));                                                       // a concurrent redemption by the same organization may still be committing
        const again = await findGrant(shareId, ctx.structureId);
        if (again && !again.revokedAt && again.inviteId === invite.id) return res.status(200).json({ ok: true, granted: true });
        return res.status(404).json(NOT_FOUND_BODY);
      }
      await logProAudit('DOSSIER_ACCESS_GRANTED', ctx.userId, ctx.structureId, { shareId, via: 'invite', inviteId: invite.id }, ip).catch(() => { });
      return res.status(200).json({ ok: true, granted: true });
    }

    // ---- transitional path for dossiers created before RC5 only (flag ADA_LEGACY_SHARE_READ != '0'); NEVER for RC5 dossiers
    if (isLegacyShare(shared) && legacyShareReadEnabled() && holdsShareToken(shared, readShareToken(req))) {
      if (!(await isActiveMember(ctx)) || !(await isVerifiedOrganization(ctx.structureId))) return res.status(404).json(NOT_FOUND_BODY);   // PKG-5 / E01
      if (isExpired(shared)) return res.status(410).json({ error: 'expired', message: 'Ce lien de partage a expiré.' });
      const existing = await findGrant(shareId, ctx.structureId);
      if (existing?.revokedAt) return res.status(404).json(NOT_FOUND_BODY);
      if (!existing) {
        await db.insert(SharedDossierGrant).values({ sharedDiagnosticId: shareId, structureId: ctx.structureId, grantedByProUserId: ctx.userId, grantedVia: 'legacy_link' }).onConflictDoNothing();
        const again = await findGrant(shareId, ctx.structureId);
        if (!again || again.revokedAt) return res.status(404).json(NOT_FOUND_BODY);
        await logProAudit('DOSSIER_ACCESS_GRANTED', ctx.userId, ctx.structureId, { shareId, via: 'legacy_link' }, ip).catch(() => { });
      }
      return res.status(200).json({ ok: true, granted: true });
    }
    return res.status(404).json(NOT_FOUND_BODY);
  } catch (error) {
    logger.error({ err: { name: /** @type {any} */ (error)?.name, message: /** @type {any} */ (error)?.message } }, '[Dossier Redeem] Erreur');
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

/** PKG-5 / E01: a NEW access (redemption) needs an active, identity-verified organization (api/_utils/org-eligibility.js). @param {string} structureId */
async function isVerifiedOrganization(structureId) {
  const row = await db.query.Structure.findFirst({ where: eq(Structure.id, structureId), columns: { statut: true, verification_status: true } });
  return isVerifiedActive(row);
}

export default requireProAuth(handler);
