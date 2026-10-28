// @ts-nocheck
/**
 * PKG-5 / A07 — versioning and rollback of published content (Aide, Demarche, Structure; PKG-11 / A02: Dispositif and Guide too).
 *   - snapshotRow(tx, type, id, reason, actor): the EXACT row (to_jsonb) is stored in EntityVersion inside the caller's transaction, before every content change
 *     (content verification, accepted structure proposal, organization suspension / reactivation, and a rollback itself).
 *   - rollbackTo(versionId, actor): restores that exact row with jsonb_populate_record (every column, types preserved) EXCEPT the D-5 verification projection
 *     (verification_status, verified_by, date_verification, territory_verified, launch_eligible, publication_hold, data_origin): verification is only ever written by
 *     the append-only ContentVerification ledger, so a rollback can never make a record claim a verification the ledger does not hold. The current row is
 *     snapshotted first, so a rollback is itself reversible. Audited.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, ContentVerification } from '../../src/db/schema.js';

export const VERSIONED = { aide: 'Aide', demarche: 'Demarche', structure: 'Structure', dispositif: 'Dispositif', guide: 'Guide' };
export const NEVER_ROLLED_BACK = ['id', 'verification_status', 'verified_by', 'date_verification', 'territory_verified', 'launch_eligible', 'publication_hold', 'data_origin'];
/** PKG-11 audit: a structure's activity (suspended / active, pro space on) belongs to the organization lifecycle (org-lifecycle.js, audited, with a reason), never to a content rollback. */
const LIFECYCLE_COLUMNS = { Structure: ['statut', 'is_pro_enabled', 'commentaire_statut'] };
/** A hold put by a content change on a VERIFIED record: only a fresh verification (VERIFY) lifts it — never a plain release (content-verification.js). */
export const EDIT_HOLD_PREFIX = 'Contenu modifié par l’administration';
/** Launch-readiness item 45: the same hold when an IMPORT changed the public content of a verified record (api/_services/source-updates.js). */
export const SOURCE_UPDATE_HOLD_PREFIX = 'Contenu mis à jour par l’import';
export const isEditHold = (/** @type {unknown} */ hold) => String(hold || '').startsWith(EDIT_HOLD_PREFIX) || String(hold || '').startsWith(SOURCE_UPDATE_HOLD_PREFIX);
const bad = (status, code, message) => ({ ok: false, status, code, message });
const tableOf = (type) => VERSIONED[String(type || '').toLowerCase()] || null;

export async function snapshotRow(tx, type, id, reason, actor) {
  const t = tableOf(type); if (!t) return null;
  if (typeof tx?.execute !== 'function') return null;   // unit-test doubles without SQL (a real drizzle transaction always has execute)
  const [r] = (await tx.execute(sql`INSERT INTO "EntityVersion" (id, entity_type, entity_id, snapshot_json, reason, actor_email, "createdAt")
    SELECT gen_random_uuid()::text, ${t}, x.id, to_jsonb(x), ${String(reason).slice(0, 300)}, ${actor || null}, NOW() FROM ${sql.raw(`"${t}"`)} x WHERE x.id = ${String(id)} RETURNING id`)).rows;
  return r?.id || null;
}

export async function listVersions(type, id, db = defaultDb) {
  const t = tableOf(type); if (!t) return bad(400, 'UNKNOWN_ENTITY_TYPE', 'Type de fiche inconnu : aide, démarche ou structure.');
  const rows = (await db.execute(sql`SELECT id, reason, actor_email AS actor, "createdAt" FROM "EntityVersion" WHERE entity_type = ${t} AND entity_id = ${String(id)} ORDER BY "createdAt" DESC, id DESC LIMIT 100`)).rows;
  return { ok: true, versions: rows };
}

/**
 * Owner LAB audit — what a rollback WOULD change, before it is done: every restorable field whose value differs between the current record and the version
 * (never the verification columns, the organization lifecycle or the search vectors, which a rollback does not touch either). The page shows it first.
 */
export async function previewRollback(versionId, db = defaultDb) {
  const [v] = (await db.execute(sql`SELECT id, entity_type AS t, entity_id AS eid, snapshot_json AS s, "createdAt" FROM "EntityVersion" WHERE id = ${String(versionId || '')}`)).rows;
  if (!v || !Object.values(VERSIONED).includes(v.t)) return bad(404, 'not_found', 'Version introuvable.');
  const [cur] = (await db.execute(sql`SELECT to_jsonb(x) AS j FROM ${sql.raw(`"${v.t}"`)} x WHERE x.id = ${v.eid}`)).rows;
  if (!cur) return bad(404, 'ENTITY_NOT_FOUND', 'La fiche n’existe plus.');
  const keep = new Set([...NEVER_ROLLED_BACK, ...(LIFECYCLE_COLUMNS[v.t] || []), 'updatedAt', 'createdAt', 'embedding', 'embedding_model', 'embedded_text_sha256', 'embedded_at']);
  const fields = [...new Set([...Object.keys(v.s || {}), ...Object.keys(cur.j || {})])].filter((c) => !keep.has(c));
  const changes = fields.filter((c) => JSON.stringify(v.s?.[c] ?? null) !== JSON.stringify(cur.j?.[c] ?? null)).map((c) => ({ field: c, current: cur.j?.[c] ?? null, restored: v.s?.[c] ?? null }));
  return { ok: true, versionId: v.id, entityType: v.t, entityId: v.eid, versionAt: v.createdAt, changes };
}

export async function rollbackTo(versionId, actor, db = defaultDb, reason = '') {
  return db.transaction(async (tx) => {
    const [v] = (await tx.execute(sql`SELECT id, entity_type AS t, entity_id AS eid FROM "EntityVersion" WHERE id = ${String(versionId)}`)).rows;
    if (!v || !Object.values(VERSIONED).includes(v.t)) return bad(404, 'not_found', 'Version introuvable.');
    const [cur] = (await tx.execute(sql`SELECT 1 AS x FROM ${sql.raw(`"${v.t}"`)} WHERE id = ${v.eid} FOR UPDATE`)).rows;
    if (!cur) return bad(404, 'ENTITY_NOT_FOUND', 'La fiche n’existe plus.');
    const keep = [...NEVER_ROLLED_BACK, ...(LIFECYCLE_COLUMNS[v.t] || [])];
    const cols = (await tx.execute(sql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${v.t} ORDER BY ordinal_position`)).rows
      .map((r) => r.c).filter((c) => !keep.includes(c));
    const [pre] = (await tx.execute(sql`SELECT to_jsonb(x) AS j FROM ${sql.raw(`"${v.t}"`)} x WHERE x.id = ${v.eid}`)).rows;
    const before = await snapshotRow(tx, v.t, v.eid, `before rollback to ${v.id}`, actor);
    const list = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
    await tx.execute(sql`UPDATE ${sql.raw(`"${v.t}"`)} SET (${sql.raw(list)}) = (SELECT ${sql.raw(list)} FROM jsonb_populate_record(NULL::${sql.raw(`"${v.t}"`)}, (SELECT snapshot_json FROM "EntityVersion" WHERE id = ${v.id}))) WHERE id = ${v.eid}`);
    // PKG-11 audit: the verification stays the ledger's, but text that the reviewer never saw must not go out under it — a VERIFIED record whose content the
    // rollback changed is held for re-verification, exactly like an administrator edit (admin-content.js).
    const [post] = (await tx.execute(sql`SELECT to_jsonb(x) AS j FROM ${sql.raw(`"${v.t}"`)} x WHERE x.id = ${v.eid}`)).rows;
    const contentChanged = cols.filter((c) => c !== 'updatedAt' && JSON.stringify(pre.j?.[c] ?? null) !== JSON.stringify(post.j?.[c] ?? null));
    let heldForReverification = false;
    if (post.j?.verification_status === 'VERIFIED' && contentChanged.length && !isEditHold(post.j?.publication_hold)) {   // pass 2: whatever hold already exists
      const holdReason = `${EDIT_HOLD_PREFIX} (retour à une version antérieure : ${contentChanged.slice(0, 8).join(', ')}) : à revérifier${post.j?.publication_hold ? ` · ${post.j.publication_hold}` : ''}`.slice(0, 500);
      await tx.execute(sql`UPDATE ${sql.raw(`"${v.t}"`)} SET publication_hold = ${holdReason} WHERE id = ${v.eid}`);
      await tx.insert(ContentVerification).values({ entityType: String(v.t).toLowerCase(), entityId: v.eid, outcome: 'HOLD', reviewerId: actor || 'unknown', reviewerRole: 'admin', sourceUrl: null, evidenceNote: holdReason, territoryConfirmed: false, verifiedAt: new Date() });
      heldForReverification = true;
    }
    await tx.insert(AuditLog).values({ action: 'CONTENT_ROLLED_BACK', actor, actor_id: actor, entity: v.t, entity_id: v.eid, details: { toVersion: v.id, snapshotOfPrevious: before, verificationUnchanged: true, heldForReverification, reason: String(reason).slice(0, 500) } });
    return { ok: true, entityType: v.t, entityId: v.eid, restoredVersion: v.id, previousStateVersion: before, heldForReverification };
  });
}
