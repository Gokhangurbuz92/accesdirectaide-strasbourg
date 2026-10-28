// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { db } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';
import { desc } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
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

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!(await verifyAdmin(req))) return res.status(401).json({ error: 'Unauthorized' });

    const url = new URL(req.url, `https://${req.headers.host}`);
    const entity = url.searchParams.get('entity');
    if (!entity) return res.status(400).json({ error: 'Missing entity parameter' });

    const modelName = entity.toLowerCase();
    const modelKey = Object.keys(schema).find(k => k.toLowerCase() === modelName);
    const model = modelKey ? schema[modelKey] : null;
    if (!model || !db.query[modelKey]) return res.status(400).json({ error: 'Invalid entity' });

    try {
        let query = db.select().from(model);
        if (model.updatedAt) {
             query = query.orderBy(desc(model.updatedAt));
        } else if (model.createdAt) {
             query = query.orderBy(desc(model.createdAt));
        }
        const items = await query;

        if (items.length === 0) {
             res.setHeader('Content-Type', 'text/csv');
             return res.send('');
        }

        const headers = Object.keys(items[0]);
        const csvRows = [headers.join(',')];

        for (const item of items) {
            const values = headers.map(header => {
                const val = item[header];
                if (val === null || val === undefined) return '';
                if (Array.isArray(val)) return `"${val.join(',')}"`;
                if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
                if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
                if (val instanceof Date) return val.toISOString();
                return val;
            });
            csvRows.push(values.join(','));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${entity}-${new Date().toISOString()}.csv"`);
        res.status(200).send(csvRows.join('\n'));

    } catch (e) {
        // @ts-ignore
        res.status(500).json({ error: 'Export failed', details: e.message });
    }
}
