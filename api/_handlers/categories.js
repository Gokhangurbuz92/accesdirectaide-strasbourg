import { db } from '../../src/db/index.js';
import { AidCategory } from '../../src/db/schema.js';
import { eq, asc, count } from 'drizzle-orm';
import { verifyAdmin } from '../_utils/auth.js';
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    const { id, slug, page = 1, pageSize = 50 } = req.query; // Larger page size for cats
    const PAGE_SIZE = Math.min(parseInt(pageSize) || 50, 100);
    const OFFSET = (parseInt(page) - 1) * PAGE_SIZE;

    await verifyAdmin(req);

    // CRUD (Write operations via Query Builder)
    if (req.method === 'POST') {
        if (!(await verifyAdmin(req))) return res.status(401).json({ error: "Unauthorized" });
        const [item] = await db.insert(AidCategory).values(req.body).returning();
        return res.status(201).json(item);
    }
    if (req.method === 'PUT') {
        if (!(await verifyAdmin(req))) return res.status(401).json({ error: "Unauthorized" });
        const { id: updateId, ...data } = req.body;
        if (!updateId) return res.status(400).json({ error: "Missing ID" });
        const [item] = await db.update(AidCategory).set(data).where(eq(AidCategory.id, updateId)).returning();
        return res.status(200).json(item);
    }
    if (req.method === 'DELETE') {
        if (!(await verifyAdmin(req))) return res.status(401).json({ error: "Unauthorized" });
        const deleteId = req.body?.id || req.query?.id;
        if (!deleteId) return res.status(400).json({ error: "Missing ID" });
        await db.delete(AidCategory).where(eq(AidCategory.id, deleteId));
        return res.status(200).json({ success: true });
    }

    // GET
    if (req.method === 'GET') {
        if (id || slug) {
            const item = await db.query.AidCategory.findFirst({
                 where: id
                    ? (t, { eq }) => eq(t.id, String(id))
                    : (t, { eq }) => eq(t.slug, String(slug)),
            });
            if (!item) return res.status(404).json({ error: "Not found" });
            return res.status(200).json(item);
        }

        const items = await db.query.AidCategory.findMany({
            orderBy: (t, { asc }) => [asc(t.label)],
            limit: PAGE_SIZE,
            offset: OFFSET,
        });

        const [{ value: total }] = await db.select({ value: count() }).from(AidCategory);

        return res.status(200).json({
            items,
            pagination: {
                total,
                page: parseInt(page),
                pageSize: PAGE_SIZE,
                totalPages: Math.ceil(total / PAGE_SIZE)
            }
        });
    }

    return res.status(405).json({ error: "Method not allowed" });
}
