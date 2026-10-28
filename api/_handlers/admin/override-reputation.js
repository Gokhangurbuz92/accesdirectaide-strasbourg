// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { Source } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAdminAuth } from '../../_utils/auth.js';
import logger from '../../_utils/logger.js';
import { z } from 'zod';

const RequestSchema = z.object({
  sourceId: z.string().uuid(),
  trustLevel: z.enum(['HIGH', 'MEDIUM', 'LOW'])
});

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
  
  const { sourceId, trustLevel } = parsed.data;
  
  try {
    await db.update(Source).set({ trust_level: trustLevel }).where(eq(Source.id, sourceId));
    
    logger.info(`Source reputation manually overridden`, { sourceId, trustLevel, admin: req.user.id });
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('Failed to override reputation', { error: err.message, sourceId });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default requireAdminAuth(handler);
