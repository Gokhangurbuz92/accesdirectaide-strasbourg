/**
 * Launch-readiness item 45 — an import (Aides-territoires, Service-Public démarches, FINESS / RNA directory) changes an existing record the way an
 * administrator's edit does, never behind the verification:
 *  - the exact prior row is versioned first (EntityVersion, restorable);
 *  - an import never publishes or unpublishes: `statut` is not touched (an archived or withdrawn record stays so);
 *  - the verification columns are never written here (only content-verification.js writes them);
 *  - a VERIFIED record whose public content changed is held for re-verification: the automatic veille (owner decision D-5 v2) checks the new content
 *    against the official source and lifts the hold with a new VERIFY. Until then the old verification no longer covers the new text, so the record
 *    is not shown as verified — no human review is required for that.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ENTITY_TABLES, REVIEW_FIELDS, holdForReverification } from './content-verification.js';
import { SOURCE_UPDATE_HOLD_PREFIX, snapshotRow } from './content-versions.js';

const NOT_FROM_IMPORTS = ['id', 'statut', 'verification_status', 'verified_by', 'date_verification', 'territory_verified', 'launch_eligible', 'publication_hold', 'data_origin'];

/** Comparable form of a column value (numeric columns come back as strings, timestamps as Date). */
const norm = (/** @type {unknown} */ v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return /^-?\d+(\.\d+)?$/.test(String(v)) ? String(Number(v)) : String(v);
};

/** The public fields an import would change on this row. @param {Record<string, any> | null | undefined} row @param {Record<string, any>} patch */
export function changedReviewFields(row, patch) {
  return REVIEW_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(patch, f) && norm(row?.[f]) !== norm(patch[f]));
}

/**
 * @param {{ kind: 'aide' | 'demarche' | 'structure' | 'dispositif', id: string, patch: Record<string, any>, source: string }} input
 * @returns {Promise<{ ok: true, fields: string[], held: boolean } | { ok: false, code: string }>}
 */
export async function applySourceUpdate({ kind, id, patch, source }, db = defaultDb) {
  const table = ENTITY_TABLES[kind];
  if (!table) return { ok: false, code: 'UNKNOWN_ENTITY_TYPE' };
  const actor = `import:${String(source || 'inconnu').slice(0, 60)}`;
  const set = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => !NOT_FROM_IMPORTS.includes(k)));
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(table).where(eq(table.id, String(id))).for('update');
    if (!row) return { ok: false, code: 'ENTITY_NOT_FOUND' };
    const fields = changedReviewFields(row, set);
    await snapshotRow(tx, kind, row.id, `before import ${source}${fields.length ? ` (${fields.join(', ')})` : ''}`, actor);
    await tx.update(table).set(set).where(eq(table.id, row.id));
    const held = await holdForReverification(tx, kind, row, fields, actor, { role: 'system', prefix: SOURCE_UPDATE_HOLD_PREFIX });
    return { ok: true, fields, held };
  });
}
