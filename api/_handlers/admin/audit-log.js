// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { search, exportCsv } from '../../_services/audit-search.js';

/** PKG-5 / A13 — GET /api/admin/audit-log?action=&actor=&entity=&entityId=&from=&to=&page= (MFA session) ; POST { format: 'csv', reason, ...filters } = scoped export (elevated, audited). */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const auth = await adminGate(req, res, { write: true }); if (!auth) return;   // reading the audit trail also needs MFA
      return res.status(200).json(await search(req.query || {}));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const auth = await adminGate(req, res, { elevated: true }); if (!auth) return;
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await exportCsv(b, { actor: auth.email, reason: b.reason });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="journal-audit.csv"');
    return res.status(200).send(out.csv);
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[AuditLog] failed');
    return res.status(500).json({ error: 'AUDIT_FAILED', message: 'Le journal n’a pas pu être lu. Réessayez.' });
  }
}
