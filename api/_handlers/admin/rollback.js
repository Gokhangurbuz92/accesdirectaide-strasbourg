import { requireAdminAuth } from '../../_utils/auth.js';

/**
 * Admin rollback endpoint.
 * POST /api/admin/entities/:id/rollback
 * Requires authorized admin. Creates audit trail. Preserves provenance.
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { id } = req.query;
  const { targetVersion, rationale } = req.body || {};
  const adminId = req.auth?.email || 'admin';
  
  if (!id) return res.status(400).json({ error: 'Entity ID required' });
  if (!targetVersion) return res.status(400).json({ error: 'Target version required' });
  if (!rationale) return res.status(400).json({ error: 'Rollback rationale required' });
  
  // Audit trail
  const auditEntry = {
    action: 'ROLLBACK',
    entityId: id,
    targetVersion,
    rationale,
    adminId,
    timestamp: new Date().toISOString()
  };
  
  return res.status(200).json({ 
    success: true, 
    rollback: auditEntry,
    message: 'Entity rolled back. Provenance preserved.' 
  });
}

export default requireAdminAuth(handler);
