import { getSource } from '../../lib/ingestion/SourceRegistry.js';
import { db } from '../../../src/db/index.js';
import { SyncRun } from '../../../src/db/schema.js';
import crypto from 'crypto';
import { requireAdminAuth } from '../../_utils/auth.js';

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { id } = req.query;
  const source = await getSource(id);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  // FR-015: Create a real pending sync run in the DB to be picked up by the background runner
  const runId = crypto.randomUUID();
  await db.insert(SyncRun).values({
    id: runId,
    source_id: String(id),
    status: 'PENDING',
    started_at: new Date(),
    ended_at: null,
    attempts: 0,
    stats: {
      totalItems: 0,
      addedItems: 0,
      updatedItems: 0,
      deletedItems: 0,
      errorCount: 0,
      errorMessage: null,
    },
  });

  return res.status(202).json({ 
    message: 'Sync job persisted and pending background execution', 
    sourceId: id, 
    syncRunId: runId,
    status: 'PENDING',
    triggeredAt: new Date() 
  });
}

export default requireAdminAuth(handler);
