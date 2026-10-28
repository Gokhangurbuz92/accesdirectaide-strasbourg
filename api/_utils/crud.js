// @ts-nocheck
import { eq } from 'drizzle-orm';
import { verifyAdmin } from './auth.js';
import { ZodError } from 'zod';

/** @typedef {import('./http-types').ApiRequest} ApiRequest */
/** @typedef {import('./http-types').ApiResponse} ApiResponse */

/**
 * Standardized CRUD operations for Admin.
 * Handles:
 * - Admin Verification
 * - Input Validation (Zod)
 * - Drizzle Operations (insert / update / delete)
 * - Standard Responses
 */

/** @param {any} d */
function identity(d) {
    return d;
}

/**
 * Create a new record via Drizzle insert.
 *
 * @param {ApiRequest} req
 * @param {ApiResponse} res
 * @param {import('drizzle-orm/pg-core').PgTable} table  – Drizzle table reference (e.g. schema.Actualite)
 * @param {object} db                                     – Drizzle db instance
 * @param {any=} schema                                   – Optional Zod schema for input validation
 * @param {(d: any) => any=} transformData                – Optional transform applied after validation
 */
export async function handleAdminCreate(req, res, table, db, schema, transformData = identity) {
    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const body = schema ? schema.parse(req.body) : req.body;
        const data = transformData(body);

        const [item] = await db.insert(table).values(data).returning();
        return res.status(201).json(item);
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ error: "Validation Error", details: error.issues });
        }
        throw error; // Let wrapper handle 500 / Drizzle errors
    }
}

/**
 * Update an existing record via Drizzle update.
 *
 * @param {ApiRequest} req
 * @param {ApiResponse} res
 * @param {import('drizzle-orm/pg-core').PgTable} table  – Drizzle table reference
 * @param {object} db                                     – Drizzle db instance
 * @param {string} id                                     – Record ID
 * @param {any=} schema                                   – Optional Zod schema for input validation
 * @param {(d: any) => any=} transformData                – Optional transform applied after validation
 */
export async function handleAdminUpdate(req, res, table, db, id, schema, transformData = identity) {
    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!id) return res.status(400).json({ error: "Missing ID" });

    try {
        const body = schema ? schema.parse(req.body) : req.body;
        const data = transformData(body);

        // @ts-ignore
        const [item] = await db.update(table).set(data).where(eq(table.id, id)).returning();
        return res.status(200).json(item);
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ error: "Validation Error", details: error.issues });
        }
        throw error;
    }
}

/**
 * Delete a record via Drizzle delete.
 *
 * @param {ApiRequest} req
 * @param {ApiResponse} res
 * @param {import('drizzle-orm/pg-core').PgTable} table  – Drizzle table reference
 * @param {object} db                                     – Drizzle db instance
 * @param {string} id                                     – Record ID
 */
export async function handleAdminDelete(req, res, table, db, id) {
    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!id) return res.status(400).json({ error: "Missing ID" });

    // @ts-ignore
    await db.delete(table).where(eq(table.id, id));
    return res.status(200).json({ success: true });
}
