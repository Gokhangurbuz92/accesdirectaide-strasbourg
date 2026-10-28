// @ts-nocheck
/**
 * PKG-5 / A13 — AuditLog search and scoped export for administrators.
 *   - search: filters (action prefix, actor, entity, entityId, period) with paging; the raw IP is never returned (only the existing ip_hash).
 *   - exportCsv: the SAME filters, at most 5000 rows, mandatory reason; the export itself is audited (AUDIT_EXPORTED with filters and row count);
 *     cells are protected against spreadsheet formula injection. Reading needs an MFA session, exporting needs an elevated session (handler).
 *   - Retention: AuditLog rows are deleted after 365 days by cron/gdpr-purge while the privacy registry marks AUDIT_LOG "automated deletion disabled pending
 *     legal review": that contradiction is shown in the privacy console and listed for the owner's legal decision (not changed here).
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';

const MAX_EXPORT = 5000;
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
function where(f) {
  const parts = [sql`TRUE`];
  if (f.action) parts.push(sql`action LIKE ${String(f.action).replace(/[%_]/g, '') + '%'}`);
  if (f.actor) parts.push(sql`(actor = ${String(f.actor)} OR actor_id = ${String(f.actor)})`);
  if (f.entity) parts.push(sql`entity = ${String(f.entity)}`);
  if (f.entityId) parts.push(sql`entity_id = ${String(f.entityId)}`);
  if (day(f.from)) parts.push(sql`timestamp >= ${day(f.from)}::date`);
  if (day(f.to)) parts.push(sql`timestamp < ${day(f.to)}::date + interval '1 day'`);
  return sql.join(parts, sql` AND `);
}
const view = (r) => ({ id: r.id, at: r.timestamp, action: r.action, actor: r.actor || r.actor_id || null, entity: r.entity, entityId: r.entity_id, target: r.target, details: r.details, ipHash: r.ip_hash || null });

export async function search(filters = {}, db = defaultDb) {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1); const size = 50;
  const rows = (await db.execute(sql`SELECT id, timestamp, action, actor, actor_id, entity, entity_id, target, details, ip_hash FROM "AuditLog" WHERE ${where(filters)} ORDER BY timestamp DESC, id DESC LIMIT ${size + 1} OFFSET ${(page - 1) * size}`)).rows;
  return { ok: true, page, hasMore: rows.length > size, items: rows.slice(0, size).map(view) };
}

const cell = (v) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n;\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

export async function exportCsv(filters = {}, { actor, reason }, db = defaultDb) {
  const why = String(reason || '').trim();
  if (why.length < 10) return { ok: false, status: 400, code: 'REASON_REQUIRED', message: 'Indiquez le motif de l’export (au moins 10 caractères).' };
  const rows = (await db.execute(sql`SELECT id, timestamp, action, actor, actor_id, entity, entity_id, target, details, ip_hash FROM "AuditLog" WHERE ${where(filters)} ORDER BY timestamp, id LIMIT ${MAX_EXPORT + 1}`)).rows;
  const truncated = rows.length > MAX_EXPORT; const items = rows.slice(0, MAX_EXPORT).map(view);
  const scope = { action: filters.action || null, actor: filters.actor || null, entity: filters.entity || null, entityId: filters.entityId || null, from: day(filters.from), to: day(filters.to) };
  await db.insert(AuditLog).values({ action: 'AUDIT_EXPORTED', actor, actor_id: actor, entity: 'AuditLog', details: { scope, rows: items.length, truncated, reason: why.slice(0, 500) } });
  const head = ['id', 'at', 'action', 'actor', 'entity', 'entityId', 'target', 'details', 'ipHash'];
  const csv = '﻿' + [head, ...items.map((i) => [i.id, new Date(i.at).toISOString(), i.action, i.actor, i.entity, i.entityId, i.target, i.details, i.ipHash])].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return { ok: true, csv, rows: items.length, truncated };
}
