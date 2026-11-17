// @ts-nocheck
/**
 * Legal v6 / owner decision C6 (17/11/2026) — a Mailjet contact deletion that failed for good is RECORDED, never reported as done, and never kept as an
 * address: one AuditLog row per failure (action MAIL_CONTACT_ERASURE_FAILED), flagged « intervention humaine requise », shown on the admin privacy screen
 * (/admin, Vie privée → « Suppressions chez Mailjet à vérifier ») and counted in « À traiter » until an MFA administrator records what was done
 * (MAIL_CONTACT_ERASURE_RESOLVED, with a note). What the row holds: the reason (account_erasure | unverified_account_purge | email_change), the step that
 * failed (lookup | delete | internal), the HTTP status, a count, the DSR request id when there is one — never the address, never the Mailjet contact id,
 * never the account id.
 *
 * The human step (docs/rgpd.md, « Contact Mailjet ») does not need the address from us: in Mailjet → Contacts, the operator deletes the contacts whose address
 * is no longer the address of an account (or asks Mailjet support), then records it here.
 */
import { sql } from 'drizzle-orm';
import { AuditLog } from '../../src/db/schema.js';

/** the process database, loaded only when no database is given (privacy.js imports this module in scripts that run without the server environment) */
const processDb = async (db) => db || (await import('../../src/db/index.js')).db;

export const MAIL_CONTACT_FAILED = 'MAIL_CONTACT_ERASURE_FAILED';
export const MAIL_CONTACT_RESOLVED = 'MAIL_CONTACT_ERASURE_RESOLVED';
export const HUMAN_INTERVENTION_LABEL = 'intervention humaine requise';
const REASONS = new Set(['account_erasure', 'unverified_account_purge', 'email_change']);
const STEPS = new Set(['lookup', 'delete', 'internal']);

/**
 * @param {any} db
 * @param {{ reason: string, step?: string, status?: number | null, count?: number, requestId?: string | null, attempts?: number }} f
 * @returns {Promise<boolean>} false when the record could not be written (the caller reports it; it never throws)
 */
export async function recordMailContactFailure(db, f) {
  try {
    const reason = REASONS.has(String(f?.reason)) ? String(f.reason) : 'account_erasure';
    const details = {
      reason,
      step: STEPS.has(String(f?.step)) ? String(f.step) : 'internal',
      status: Number.isInteger(f?.status) ? f.status : null,
      count: Math.max(1, Number(f?.count) || 1),
      attempts: Math.max(1, Number(f?.attempts) || 1),
      requestId: f?.requestId ? String(f.requestId) : null,
      humanInterventionRequired: true,
      label: HUMAN_INTERVENTION_LABEL,
    };
    await db.insert(AuditLog).values({ action: MAIL_CONTACT_FAILED, actor: 'system', actor_id: 'system', entity: 'MAIL_CONTACT', entity_id: details.requestId, details, ip_hash: 'SYSTEM' });
    return true;
  } catch { return false; }
}

/** open failures (no resolution recorded yet), oldest first — counts and labels only */
export async function listMailContactFailures(given) {
  const db = await processDb(given);
  const rows = (await db.execute(sql`SELECT f.id, f.timestamp, f.details FROM "AuditLog" f
      WHERE f.action = ${MAIL_CONTACT_FAILED}
        AND NOT EXISTS (SELECT 1 FROM "AuditLog" r WHERE r.action = ${MAIL_CONTACT_RESOLVED} AND r.details->>'failureId' = f.id)
      ORDER BY f.timestamp LIMIT 100`)).rows;
  return { ok: true, failures: rows.map((r) => ({ id: r.id, at: r.timestamp, reason: r.details?.reason ?? null, step: r.details?.step ?? null, status: r.details?.status ?? null,
    count: r.details?.count ?? 1, attempts: r.details?.attempts ?? 1, requestId: r.details?.requestId ?? null, label: HUMAN_INTERVENTION_LABEL })) };
}

/** An MFA administrator records what was done (deleted by hand in Mailjet, support ticket…). The failure row itself is never edited. */
export async function resolveMailContactFailure(id, input, reviewer, given) {
  const db = await processDb(given);
  const note = String(input?.note || '').trim().slice(0, 2000);
  if (note.length < 5) return { ok: false, status: 400, code: 'note_required', message: 'Indiquez ce qui a été fait chez Mailjet (sans recopier d’adresse).' };
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(note)) return { ok: false, status: 400, code: 'address_in_note', message: 'La note ne doit pas contenir d’adresse électronique.' };
  const open = (await listMailContactFailures(db)).failures.find((f) => f.id === String(id || ''));
  if (!open) return { ok: false, status: 404, code: 'not_found', message: 'Signalement introuvable ou déjà traité.' };
  await db.insert(AuditLog).values({ action: MAIL_CONTACT_RESOLVED, actor: 'admin', actor_id: reviewer, entity: 'MAIL_CONTACT', entity_id: open.requestId,
    details: { failureId: open.id, note }, ip_hash: 'ADMIN_MFA' });
  return { ok: true, resolved: open.id };
}
