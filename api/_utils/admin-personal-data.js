// @ts-nocheck
import { db } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';

/**
 * R40 — administrator reads of personal data (conversation logs, application logs, administrator sessions) need an MFA session (verifyAdmin with
 * { personalData: true }); this is the refusal those routes answer when the session is valid but password-only.
 * @param {{ status: (code: number) => { json: (body: unknown) => unknown } }} res
 */
export function refuseWithoutAdminMfa(res) {
  return res.status(403).json({ error: 'MFA required', mfa_required: true, code: 'ADMIN_MFA_REQUIRED', message: 'Ces données personnelles demandent une session administrateur avec MFA.' });
}

/**
 * R40 — an export of personal data leaves an AuditLog row BEFORE the file is sent (who, what, filters, row count — never the content). Returns false when
 * the row could not be written: the caller then refuses the export (fail-closed).
 * @param {any} req @param {string} what @param {Record<string, unknown>} details
 */
export async function auditAdminExport(req, what, details = {}) {
  const actor = req?.auth?.email || null;
  try {
    await db.insert(AuditLog).values({ action: 'ADMIN_PERSONAL_DATA_EXPORT', actor, actor_id: actor, entity: 'AdminExport', entity_id: what, details });
    return true;
  } catch {
    return false;
  }
}

// R40 — one CSV cell (quoted, formula starters prefixed with « ' »); R41-K F5: the same helper serves the browser exports
export { csvCell } from '../../src/lib/csv.js';
