// @ts-nocheck
import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ProAppointment, ProRdvService, RdvConversation, SharedDossierGrant, ProUser, RdvNotificationLog, ConversationLog } from '../../../src/db/schema.js';
import { eq, and, gte, ne, not, inArray, count, desc, asc, sql } from 'drizzle-orm';
import { AUTH_ROLE, requireProRole, requireProStructureContext } from '../../_utils/auth.js';
import { reportCsv } from '../../_services/org-stats.js';

/**
 * Impact Reports API
 *
 * GET /api/pro/reports?period=month|quarter|year
 *
 * Aggregates anonymized metrics from ProAppointment, SharedDiagnostic,
 * and AuditLog for the structure. No private data is exposed.
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { structureId } = proCtx;

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const period = url.searchParams.get('period') || 'month';

    // PKG-4 / E07: the same organization's indicators as CSV (measured values only, small outcome cells suppressed, no personal data)
    if ((url.searchParams.get('format') || req.query?.format) === 'csv') {
        const out = await reportCsv(proCtx, period);
        if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="indicateurs-${period}.csv"`);
        return res.status(200).send(out.csv);
    }

    try {
        const now = new Date();
        const startDate = new Date();

        switch (period) {
            case 'quarter':
                startDate.setMonth(now.getMonth() - 3);
                break;
            case 'year':
                startDate.setFullYear(now.getFullYear() - 1);
                break;
            default: // month
                startDate.setMonth(now.getMonth() - 1);
                break;
        }

        // 1. Total appointments in period
        const totalAppointmentsRes = await db.select({ count: count() }).from(ProAppointment).where(
            and(
                eq(ProAppointment.structureId, structureId),
                gte(ProAppointment.startAt, startDate)
            )
        );
        const totalAppointments = totalAppointmentsRes[0].count;

        // 2. Appointments by status
        const byStatus = await db.select({
            status: ProAppointment.status,
            _count: { id: count() }
        }).from(ProAppointment).where(
            and(
                eq(ProAppointment.structureId, structureId),
                gte(ProAppointment.startAt, startDate)
            )
        ).groupBy(ProAppointment.status);

        // 3. Daily activity (appointments per day)
        const appointments = await db.query.ProAppointment.findMany({
            where: and(
                eq(ProAppointment.structureId, structureId),
                gte(ProAppointment.startAt, startDate),
                not(eq(ProAppointment.status, 'cancelled')) // Handle status not cancelled properly
            ),
            columns: { startAt: true },
            orderBy: (pa, { asc }) => [asc(pa.startAt)],
        });

        // Group by day
        const dailyMap = {};
        for (const apt of appointments) {
            const day = apt.startAt.toISOString().split('T')[0];
            // @ts-ignore
            dailyMap[day] = (dailyMap[day] || 0) + 1;
        }
        const dailyActivity = Object.entries(dailyMap).map(([date, count]) => ({
            date,
            count,
        }));

        // 4. By service (themes)
        const byService = await db.select({
            serviceId: ProAppointment.serviceId,
            _count: { id: count() }
        }).from(ProAppointment).where(
            and(
                eq(ProAppointment.structureId, structureId),
                gte(ProAppointment.startAt, startDate),
                not(eq(ProAppointment.status, 'cancelled'))
            )
        ).groupBy(ProAppointment.serviceId);

        // Enrich service names
        const serviceIds = byService.map((s) => s.serviceId).filter(Boolean); // Filter nulls just in case
        const services = serviceIds.length > 0
            ? await db.query.ProRdvService.findMany({
                where: inArray(ProRdvService.id, serviceIds),
                columns: { id: true, name: true },
            })
            : [];

        const serviceMap = {};
        // @ts-ignore
        services.forEach((s) => { serviceMap[s.id] = s.name; });

        const themes = byService.map((s) => ({
            // @ts-ignore
            name: serviceMap[s.serviceId] || 'Autre',
            value: s._count.id,
        }));

        // 5. Conversations count
        const conversationsCountRes = await db.select({ count: count() }).from(RdvConversation).where(
            and(
                eq(RdvConversation.structureId, structureId),
                gte(RdvConversation.createdAt, startDate)
            )
        );
        const conversationsCount = conversationsCountRes[0].count;

        // 6. Shared diagnostics count
        // DTA S1D: scoped to THIS organization (dossiers shared with it through a grant in the period). Before S1D this counted every SharedDiagnostic row of the platform.
        const diagnosticsCountRes = await db.select({ count: sql`count(distinct ${SharedDossierGrant.sharedDiagnosticId})`.mapWith(Number) }).from(SharedDossierGrant).where(
            and(eq(SharedDossierGrant.structureId, structureId), gte(SharedDossierGrant.createdAt, startDate))
        );
        const diagnosticsCount = diagnosticsCountRes[0].count;

        // 7. Active team size
        const teamSizeRes = await db.select({ count: count() }).from(ProUser).where(
            and(eq(ProUser.structureId, structureId), eq(ProUser.status, 'active'))
        );
        const teamSize = teamSizeRes[0].count;

        // 8. Cancelled count
        const cancelledCount = byStatus.find((s) => s.status === 'cancelled')?._count?.id || 0;
        // PKG-11 audit: « honoured » = appointments already past that the team marked done (the former figure counted every non-cancelled booking, future
        // ones and no-shows included, under « Citoyens accompagnés »); the rate is over the past appointments that were not cancelled
        const past = (await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status <> 'cancelled')::int AS held
            FROM "ProAppointment" WHERE "structureId" = ${structureId} AND "startAt" >= ${startDate} AND "startAt" <= NOW()`)).rows[0] || {};
        const completedCount = past.done || 0;

        // 9. SMS reminders: the SMS notices of THIS organization's appointments that a provider ACCEPTED (PKG-11 audit: the former figure counted
        // RdvNotificationLog rows, which are chat e-mail records written before sending, and called them SMS reminders)
        const smsNotifications = (await db.execute(sql`SELECT count(*)::int AS n FROM "AppointmentNotice" n JOIN "ProAppointment" a ON a.id = n."appointmentId"
            WHERE a."structureId" = ${structureId} AND n.channel = 'sms' AND n.status = 'PROVIDER_ACCEPTED' AND n."createdAt" >= ${startDate}`)).rows[0]?.n || 0;
        
        // PKG-4 / D7: only MEASURED values of THIS organization. The former "avoided no-shows" (a flat 35 % of reminders) was an invented estimate and the
        // "compass sessions" counted the whole platform; both are removed. Absences are the appointments the team marked no_show (PKG-3).
        const noShowCount = byStatus.filter((s) => ['no_show', 'noshow', 'NOSHOW'].includes(s.status)).reduce((n, s) => n + (s._count?.id || 0), 0);

        // 10. PKG-4 / R19 — closed-loop activity of THIS organization; outcome counts below K_MIN are suppressed (small cells could single a person out).
        const K_MIN = 5;
        const loop = (await db.execute(sql`SELECT
            (SELECT count(*)::int FROM "Referral" WHERE "fromStructureId" = ${structureId} AND "createdAt" >= ${startDate}) AS "referralsSent",
            (SELECT count(*)::int FROM "Referral" WHERE "toStructureId" = ${structureId} AND "sentAt" IS NOT NULL AND "createdAt" >= ${startDate}) AS "referralsReceived",
            (SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${structureId} AND status = 'CLOSED' AND "closedAt" >= ${startDate}) AS "casesClosed"`)).rows[0] || {};
        const outcomeRows = (await db.execute(sql`SELECT outcome, count(*)::int AS n FROM "ProCase" WHERE "structureId" = ${structureId} AND status = 'CLOSED' AND "closedAt" >= ${startDate} GROUP BY outcome ORDER BY outcome`)).rows;
        const caseOutcomes = outcomeRows.map((r) => ({ outcome: r.outcome, count: r.n >= K_MIN ? r.n : null, suppressed: r.n < K_MIN }));
        // PKG-11 audit: the total of closed cases is the sum of the PUBLISHED outcome cells — the raw total minus the published cells gave back a masked one
        const casesClosedPublished = caseOutcomes.reduce((n, o) => n + (o.count || 0), 0);
        const casesClosedSuppressed = caseOutcomes.some((o) => o.suppressed);

        return res.status(200).json({
            ok: true,
            period,
            startDate: startDate.toISOString(),
            kpis: {
                totalAppointments,
                completedAppointments: completedCount,
                cancelledAppointments: cancelledCount,
                completionRate: past.held > 0
                    ? Math.round((completedCount / past.held) * 100)
                    : 0,
                conversations: conversationsCount,
                diagnosticsShared: diagnosticsCount,
                teamSize,
                // Phase 3 — SMS Impact
                smsNotifications,
                noShowCount,
                smsImpactRate: past.held > 0
                    ? Math.round((smsNotifications / past.held) * 100)
                    : 0,
                referralsSent: loop.referralsSent ?? 0,
                referralsReceived: loop.referralsReceived ?? 0,
                casesClosed: casesClosedPublished,
                casesClosedPartial: casesClosedSuppressed,   // true: some outcome cells are below the threshold and not counted
            },
            caseOutcomes,
            kAnonymityMin: K_MIN,
            dailyActivity,
            themes,
            byStatus: byStatus.map((s) => ({
                status: s.status,
                count: s._count.id,
            })),
        });
    } catch (error) {
        // @ts-ignore
        logger.error('[Reports] Erreur:', error.message);
        return res.status(500).json({ error: 'Impossible de générer le rapport.' });
    }
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
