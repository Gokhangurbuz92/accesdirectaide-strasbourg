import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ProUser, Invitation } from '../../../src/db/schema.js';
import { eq, desc, isNull, sql, and } from 'drizzle-orm';
import { logProAudit } from '../../_utils/auth.js';
import { AUTH_ROLE, requireProRole, requireProStructureContext } from '../../_utils/auth.js';
import { createNotification } from './notifications.js';
import { invitationsWithRevokedSender } from '../../_utils/invite-token.js';
import { handOverAll, handoverNotice } from '../../_services/pro-cases.js';
import { clientIp } from '../../_utils/client-ip.js';
// PKG-4 / D3: a structure can only grant its own roles. SUPERADMIN is a platform role and is never assignable from a structure's team screen (privilege escalation).
const VALID_ROLES = ['PRO', 'STRUCTURE_ADMIN'];

/**
 * Team Management API (Admin-only)
 *
 * GET    /api/pro/team?page=1&limit=20 — List users + invitations (paginated)
 * PATCH  /api/pro/team                 — Update user role
 * DELETE /api/pro/team?userId=xxx      — Disable user
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { structureId, userId } = proCtx;

    try {
        // ── GET: List team with pagination ──
        if (req.method === 'GET') {
            const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
            const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
            const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
            const skip = (page - 1) * limit;

            const [users, totalRes] = await Promise.all([
                db.query.ProUser.findMany({
                    where: eq(ProUser.structureId, structureId),
                    columns: { id: true, email: true, role: true, status: true, canManageSchedule: true, createdAt: true },
                    orderBy: [desc(ProUser.createdAt)],
                    limit: limit,
                    offset: skip,
                }),
                db.select({ count: sql`count(*)` }).from(ProUser).where(eq(ProUser.structureId, structureId))
            ]);
            const total = Number(totalRes[0].count);

            const invitations = await db.query.Invitation.findMany({
                where: and(eq(Invitation.structureId, structureId), isNull(Invitation.used_at)),
                columns: {
                  id: true,
                  email: true,
                  role: true,
                  expires_at: true,
                  createdAt: true,
                },
                orderBy: [desc(Invitation.createdAt)],
                limit: 50,   // R18: older pending invitations stayed invisible (and uncancellable) beyond 10
            });
            // R20: an invitation whose sender is no longer an administrator cannot be redeemed; the page says so (« Relancer » by a current administrator revives it)
            const revoked = await invitationsWithRevokedSender(db, invitations.map((i) => i.id));

            return res.status(200).json({
                users,
                invitations: invitations.map((i) => ({ ...i, senderRevoked: revoked.has(i.id) })),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            });
        }

        // ── PATCH: Update user role ──
        if (req.method === 'PATCH' && req.body?.reactivate === true) {
            // PKG-4 / E03: bring back a disabled member of the same structure (role unchanged; cases are NOT given back automatically)
            const targetUserId = String(req.body?.targetUserId || '');
            const rows = await db.update(ProUser).set({ status: 'active' }).where(and(eq(ProUser.id, targetUserId), eq(ProUser.structureId, structureId), eq(ProUser.status, 'disabled'))).returning({ id: ProUser.id });
            if (!rows.length) return res.status(404).json({ error: 'Membre désactivé introuvable dans cette structure.' });
            await logProAudit('USER_REACTIVATED', userId, structureId, { targetUserId }, clientIp(req));
            return res.status(200).json({ ok: true });
        }

        if (req.method === 'PATCH' && typeof req.body?.canManageSchedule === 'boolean') {
            // R24 (owner decision R18.5): the administrator explicitly delegates (or withdraws) the structure's schedule — opening hours, closures, the other
            // members' absences — to an active member of the SAME structure. Administrators have it by their role; a platform account is never touched here.
            const targetUserId = String(req.body?.targetUserId || '');
            const grant = req.body.canManageSchedule;
            const rows = await db.update(ProUser).set({ canManageSchedule: grant })
                .where(and(eq(ProUser.id, targetUserId), eq(ProUser.structureId, structureId), eq(ProUser.role, 'PRO'), eq(ProUser.status, 'active')))
                .returning({ id: ProUser.id });
            if (!rows.length) return res.status(404).json({ error: 'Membre actif introuvable dans cette structure.' });
            await logProAudit(grant ? 'SCHEDULE_DELEGATION_GRANTED' : 'SCHEDULE_DELEGATION_WITHDRAWN', userId, structureId, { targetUserId }, clientIp(req));
            await createNotification({
                userId: targetUserId, structureId, type: 'team_role_change',
                title: grant ? 'Gestion du planning confiée' : 'Gestion du planning retirée',
                message: grant ? 'Vous pouvez désormais modifier les horaires d’ouverture de la structure et les absences de l’équipe.' : 'Vous ne gérez plus les horaires d’ouverture ni les absences de vos collègues ; vos propres absences restent modifiables.',
                metadata: { canManageSchedule: grant, changedBy: userId },
            }).catch(() => {});
            return res.status(200).json({ ok: true, canManageSchedule: grant });
        }

        if (req.method === 'PATCH') {
            const { targetUserId, role } = req.body || {};

            if (!targetUserId || !role) {
                return res.status(400).json({ error: 'targetUserId et role requis.' });
            }

            if (!VALID_ROLES.includes(role)) {
                return res.status(400).json({
                    error: `Rôle invalide. Valeurs acceptées: ${VALID_ROLES.join(', ')}`,
                });
            }

            if (targetUserId === userId) {
                return res.status(400).json({ error: 'Impossible de modifier son propre rôle.' });
            }

            // Verify target user belongs to same structure
            const targetUser = await db.query.ProUser.findFirst({
                where: and(eq(ProUser.id, targetUserId), eq(ProUser.structureId, structureId))
            });

            if (!targetUser) {
                return res.status(404).json({ error: 'Utilisateur introuvable dans cette structure.' });
            }
            if (!VALID_ROLES.includes(targetUser.role)) {
                return res.status(403).json({ error: 'Ce compte ne peut pas être modifié depuis l’équipe de la structure.' });
            }

            const previousRole = targetUser.role;

            await db.update(ProUser)
                .set({ role })
                .where(eq(ProUser.id, targetUserId));

            // Audit
            await logProAudit('USER_ROLE_CHANGED', userId, structureId, {
                targetUserId,
                previousRole,
                newRole: role,
            }, clientIp(req));

            // Notify target user
            await createNotification({
                userId: targetUserId,
                structureId,
                type: 'team_role_change',
                title: 'Votre rôle a été modifié',
                message: `Votre rôle a été changé de ${previousRole} à ${role}.`,
                metadata: { previousRole, newRole: role, changedBy: userId },
            });

            return res.status(200).json({
                ok: true,
                targetUserId,
                previousRole,
                newRole: role,
            });
        }

        // ── DELETE: Disable user ──
        if (req.method === 'DELETE') {
            const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
            const targetUserId = url.searchParams.get('userId') || req.query?.userId;

            if (!targetUserId) {
                return res.status(400).json({ error: 'userId requis.' });
            }

            if (targetUserId === userId) {
                return res.status(400).json({ error: 'Impossible de se désactiver soi-même.' });
            }

            const targetUser = await db.query.ProUser.findFirst({
                where: and(eq(ProUser.id, targetUserId), eq(ProUser.structureId, structureId))
            });

            if (!targetUser) {
                return res.status(404).json({ error: 'Utilisateur introuvable.' });
            }
            // R12 (E03): like the role change, only the structure's own roles are managed here (a platform account is never disabled from a team screen)
            if (!VALID_ROLES.includes(targetUser.role)) {
                return res.status(403).json({ error: 'Ce compte ne peut pas être modifié depuis l’équipe de la structure.' });
            }

            // PKG-4 / R12 E03: departure (or suspension) never orphans a case — open cases go to the named successor (an active member of the same structure) or back to the
            // team queue; the account loses access at once (requireProAuth re-reads the status on every request).
            const successorUserId = String(url.searchParams.get('successorUserId') || req.query?.successorUserId || '') || null;
            const badSuccessor = () => res.status(400).json({ error: 'Le successeur doit être un autre membre actif de la structure.' });
            if (successorUserId === targetUserId) return badSuccessor();
            // R12 (E03): disable + hand-over in ONE transaction — the successor is locked and re-checked inside it (a successor disabled at the same moment cannot
            // receive the cases), and a failure leaves the member active with their cases (never a disabled member still holding them)
            const movedCases = await db.transaction(async (tx) => {
                if (successorUserId) {
                    const [successor] = await tx.select({ id: ProUser.id }).from(ProUser)
                        .where(and(eq(ProUser.id, successorUserId), eq(ProUser.structureId, structureId), eq(ProUser.status, 'active'))).for('update');
                    if (!successor) return null;
                }
                // R18: the departure also ENDS the member's sessions — a later reactivation must not revive a token issued before it (8 h + refresh grace)
                await tx.update(ProUser).set({ status: 'disabled', sessionsValidAfter: sql`NOW()` }).where(and(eq(ProUser.id, targetUserId), eq(ProUser.structureId, structureId)));
                return handOverAll(targetUserId, successorUserId, { userId, structureId, role: req.user?.role }, /** @type {any} */ (tx), { notice: false });
            });
            if (movedCases === null) return badSuccessor();
            await handoverNotice(successorUserId, structureId, movedCases);

            await logProAudit('USER_DISABLED', userId, structureId, {
                targetUserId, successorUserId, movedCases,
            }, clientIp(req));

            return res.status(200).json({ ok: true, movedCases, successorUserId });
        }

        return res.status(405).json({ error: 'Méthode non autorisée' });
    } catch (error) {
        logger.error({ err: error }, '[Team] Erreur');
        return res.status(500).json({ error: 'Erreur interne.' });
    }
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
