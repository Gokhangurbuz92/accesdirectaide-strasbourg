// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { Aide, Structure, Demarche } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAdminAuth } from '../../_utils/auth.js';
import logger from '../../_utils/logger.js';
import { z } from 'zod';

const RequestSchema = z.object({
  entityId: z.string().uuid(),
  entityType: z.enum(['AIDE', 'STRUCTURE', 'DEMARCHE'])
});

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
  
  const { entityId, entityType } = parsed.data;
  
  try {
    const table = entityType === 'AIDE' ? Aide : (entityType === 'STRUCTURE' ? Structure : Demarche);
    await db.update(table).set({ updatedAt: new Date() }).where(eq(table.id, entityId));
    
    logger.info(`Entity manually marked as fresh`, { entityId, entityType, admin: req.user.id });
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('Failed to mark entity fresh', { error: err.message, entityId });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default requireAdminAuth(handler);
