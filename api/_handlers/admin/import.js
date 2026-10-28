// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { db } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import Busboy from 'busboy';
import { parse } from 'csv-parse/sync';
import { verifyAdmin } from '../../_utils/auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!(await verifyAdmin(req))) return res.status(401).json({ error: 'Unauthorized' });

    const busboy = Busboy({ headers: req.headers });
    /**
   * @type {Buffer<ArrayBuffer> | null}
   */
    let fileBuffer = null;
    /**
   * @type {string | null}
   */
    let entityType = null;

    return new Promise((resolve) => {
        busboy.on('field', (/** @type {string} */ fieldname, /** @type {string | null} */ val) => {
            if (fieldname === 'entity') entityType = val;
        });

        busboy.on('file', (/** @type {string} */ fieldname, file) => {
            if (fieldname === 'file') {
                 const chunks = [];
                 file.on('data', (/** @type {number} */ data) => chunks.push(data));
                 file.on('end', () => {
                     fileBuffer = Buffer.concat(chunks);
                 });
            } else {
                file.resume();
            }
        });

        busboy.on('finish', async () => {
            if (!fileBuffer || !entityType) {
                res.status(400).json({ error: 'File and entity field required' });
                return resolve();
            }

            const modelName = entityType.toLowerCase();
            const modelKey = Object.keys(schema).find(k => k.toLowerCase() === modelName);
            // @ts-ignore
            const model = modelKey ? schema[modelKey] : null;
            if (!model || !db.query[modelKey]) {
                res.status(400).json({ error: 'Invalid entity type' });
                return resolve();
            }

            try {
                const records = parse(fileBuffer, {
                    columns: true,
                    skip_empty_lines: true,
                    trim: true
                });

                const report = { total: records.length, created: 0, updated: 0, errors: [] };

                for (const [index, row] of records.entries()) {
                    try {
                        const data = { ...row };

                        // Cleanup and Type Conversion
                        Object.keys(data).forEach(k => {
                            if (data[k] === '') data[k] = null;
                        });

                        // Basic Type Inference
                        if (data.quality_score) data.quality_score = parseInt(data.quality_score);
                        if (data.est_urgent) data.est_urgent = data.est_urgent === 'true';
                        if (data.mots_cles && typeof data.mots_cles === 'string') data.mots_cles = data.mots_cles.split(',').map(/** @type {string} */ (/** @type {string} */ s)=>s.trim());
                        if (data.documents_necessaires && typeof data.documents_necessaires === 'string') data.documents_necessaires = data.documents_necessaires.split(',').map(/** @type {string} */ (/** @type {string} */ s)=>s.trim());

                        data.updatedBy = 'admin-import';

                        const whereClauses = [];
                        if (data.id) whereClauses.push(eq(model.id, data.id));
                        else if (data.slug) whereClauses.push(eq(model.slug, data.slug));

                        if (whereClauses.length > 0) {
                             const exists = await db.query[modelKey].findFirst({ where: whereClauses[0] });
                             if (exists) {
                                 delete data.id;
                                 await db.update(model).set(data).where(eq(model.id, exists.id));
                                 report.updated++;
                             } else {
                                 await db.insert(model).values(data);
                                 report.created++;
                             }
                        } else {
                             await db.insert(model).values(data);
                             report.created++;
                        }

                    } catch (e) {
                        // @ts-ignore
                        report.errors.push({ row: index + 1, error: e.message });
                    }
                }

                res.status(200).json(report);
                resolve();

            } catch (e) {
                // @ts-ignore
                res.status(500).json({ error: 'CSV Parsing failed', details: e.message });
                resolve();
            }
        });

        req.pipe(busboy);
    });
}
