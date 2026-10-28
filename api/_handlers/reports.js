// @ts-nocheck
import logger from '../_utils/logger.js';
import crypto from 'node:crypto';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, desc, count } from 'drizzle-orm';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { adminGate } from '../_utils/admin-gate.js';
import { isFeatureOn } from '../_services/feature-flags.js';

// Valid content types and reasons (matching DB schema enums)
const VALID_CONTENT_TYPES = ['AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE'];
const VALID_REASONS = ['LIEN_MORT', 'HORAIRES_FAUX', 'INFO_FAUSSE', 'INFO_OBSOLETE', 'AUTRE'];
const VALID_STATUSES = ['NEW', 'IN_PROGRESS', 'FIXED', 'REJECTED'];

/**
 * POST /api/reports - Create a new content report
 * GET /api/reports - List reports (admin only)
 * PUT /api/reports/:id - Update report status (admin only)
 */
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const log = logger.child({ handler: 'reports' });

    try {
        // POST - Create new report (public endpoint)
        if (req.method === 'POST') {
            // PKG-5 / P19: abuse limits and the administrator kill switch apply to public reports
            if (!(await isFeatureOn('PUBLIC_FEEDBACK'))) return res.status(503).json({ error: 'FEATURE_DISABLED', message: 'Les signalements sont momentanément fermés.' });
            const rl = await checkRateLimit('FEEDBACK', getClientIp(req));
            if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Too many requests' });
            const { contentType, contentId, reason, message, pageUrl, reporterEmail } = req.body || {};

            // Validation
            if (!contentType || !VALID_CONTENT_TYPES.includes(contentType)) {
                return res.status(400).json({
                    error: 'Invalid or missing contentType',
                    validTypes: VALID_CONTENT_TYPES
                });
            }

            if (!contentId || typeof contentId !== 'string') {
                return res.status(400).json({ error: 'contentId is required and must be a string' });
            }

            if (!reason || !VALID_REASONS.includes(reason)) {
                return res.status(400).json({
                    error: 'Invalid or missing reason',
                    validReasons: VALID_REASONS
                });
            }

            // Optional fields validation
            if (message && typeof message !== 'string') {
                return res.status(400).json({ error: 'message must be a string' });
            }

            if (reporterEmail && typeof reporterEmail !== 'string') {
                return res.status(400).json({ error: 'reporterEmail must be a string' });
            }

            // Basic email validation if provided
            if (reporterEmail && !reporterEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                return res.status(400).json({ error: 'reporterEmail must be a valid email address' });
            }

            const [report] = await db.insert(schema.ContentReport).values({
                id: crypto.randomUUID(),
                contentType,
                contentId,
                reason,
                message: message || null,
                pageUrl: pageUrl || null,
                reporterEmail: reporterEmail || null,
                status: 'NEW'
            }).returning();

            log.info({
                msg: 'Content report created',
                reportId: report.id,
                contentType,
                contentId,
                reason
            });

            return res.status(201).json({
                success: true,
                reportId: report.id,
                message: 'Signalement enregistré avec succès'
            });
        }

        // GET - List reports (admin only)
        if (req.method === 'GET') {
            // PKG-5 / P19: triage is for named administrator sessions (req.user was never set: triage always answered 401)
            if (!(await adminGate(req, res))) return;

            const url = new URL(req.url, `https://${req.headers.host}`);
            const status = url.searchParams.get('status');
            const contentType = url.searchParams.get('contentType');
            const page = parseInt(url.searchParams.get('page') || '1', 10);
            const limit = parseInt(url.searchParams.get('limit') || '50', 10);

            // Build filters
            const where = {};
            if (status && VALID_STATUSES.includes(status)) {
                where.status = status;
            }
            if (contentType && VALID_CONTENT_TYPES.includes(contentType)) {
                where.contentType = contentType;
            }

            // Fetch reports with pagination
            let conditions = undefined;
            if (Object.keys(where).length > 0) {
               const conditionArr = [];
               if (where.status) conditionArr.push(eq(schema.ContentReport.status, where.status));
               if (where.contentType) conditionArr.push(eq(schema.ContentReport.contentType, where.contentType));
               
               if (conditionArr.length === 1) conditions = conditionArr[0];
               else {
                   const { and } = await import('drizzle-orm');
                   conditions = and(...conditionArr);
               }
            }

            const [reports, totalRes] = await Promise.all([
                db.query.ContentReport.findMany({
                    where: conditions,
                    orderBy: [desc(schema.ContentReport.createdAt)],
                    offset: (page - 1) * limit,
                    limit: limit
                }),
                db.select({ count: count() }).from(schema.ContentReport).where(conditions)
            ]);
            const total = Number(totalRes[0].count);

            return res.status(200).json({
                reports,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        }

        // PUT - Update report status (admin only)
        if (req.method === 'PUT') {
            const admin = await adminGate(req, res, { write: true });
            if (!admin) return;

            const url = new URL(req.url, `https://${req.headers.host}`);
            const reportId = url.searchParams.get('id');
            const { status } = req.body || {};

            if (!reportId) {
                return res.status(400).json({ error: 'Report ID is required' });
            }

            if (!status || !VALID_STATUSES.includes(status)) {
                return res.status(400).json({
                    error: 'Invalid or missing status',
                    validStatuses: VALID_STATUSES
                });
            }

            // Update the report — owner LAB audit: the triage decision is in the administration journal too, in the same transaction (it was only a log line)
            const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
            const report = await db.transaction(async (tx) => {
                const [before] = await tx.select({ status: schema.ContentReport.status }).from(schema.ContentReport).where(eq(schema.ContentReport.id, reportId)).for('update');
                if (!before) return null;
                const [row] = await tx.update(schema.ContentReport).set({ status }).where(eq(schema.ContentReport.id, reportId)).returning();
                await tx.insert(schema.AuditLog).values({ action: `CONTENT_REPORT_${status}`, actor: admin.email, actor_id: admin.email, entity: 'ContentReport', entity_id: reportId,
                    details: { from: before.status, to: status, contentType: row.contentType, contentId: row.contentId, ...(note ? { note } : {}) }, ip_hash: 'ADMIN_MFA' });
                return row;
            });
            if (!report) {
                 return res.status(404).json({ error: 'Report not found' });
            }

            log.info({
                msg: 'Content report updated',
                reportId: report.id,
                newStatus: status,
                updatedBy: admin.email
            });

            return res.status(200).json({
                success: true,
                report
            });
        }

        // Method not allowed
        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        // @ts-ignore
        log.error({ msg: 'Reports handler error', error: error.message, stack: error.stack });
        try {
           const Sentry = (await import('../_utils/sentry.js')).default;
           Sentry.captureException(error);
         } catch(_e) { /* Sentry may not be available in all environments */ }

        return res.status(500).json({
            error: 'Internal server error',
            // @ts-ignore
            message: process.env.NODE_ENV === 'production' ? 'An error occurred' : error.message
        });
    }
}
