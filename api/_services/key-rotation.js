/**
 * Key rotation for server-side envelope encryption (api/lib/data-keys.ts).
 * Every record has its own data key (DEK); the master key only WRAPS DEKs. Rotation = promote a new primary ADA_ENCRYPTION_KEY, keep the old one in
 * ADA_ENCRYPTION_KEY_PREVIOUS (decrypt-only), re-wrap every DEK with the primary, check that NOTHING is still wrapped by the old key (rotationStatus), and only then
 * retire the old key. Payloads are never decrypted to disk nor re-encrypted.
 *
 * PKG-5 coverage (was: dossier-thread messages only):
 *   text columns  SharedDossierMessage.body, ProCaseNote.bodyEncrypted, Referral.messageEncrypted / responseMessageEncrypted, CitizenDocument.filenameEncrypted,
 *                 RdvMessageAttachment.filenameEncrypted, SharedDiagnostic.results._files[].filenameEncrypted, DSRRequest.reviewOutcome.extractEncrypted
 *   blobs         CitizenDocument (Mon Coffre), RdvMessageAttachment (message attachments), SharedDiagnostic.results._files[] (dossier documents)
 * Text: compare-and-set UPDATE on the old value (a concurrent writer or a second run cannot clobber data).
 * Blob: download -> rewrapBuffer -> upload as a NEW object -> compare-and-set the row's storage key -> delete the old object AFTER the switch. An interruption leaves
 *   either the old pointer (the old object is intact and still readable with the previous key) or the new pointer (the new object is complete); at worst an
 *   unreferenced object remains, reported in stats.orphans for cleanup. Re-running resumes: rows already on the primary key are skipped.
 * Dry-run by default; `apply` is explicit. Counters only — never a value, a key or a plaintext.
 *
 * Launch-readiness item 61: values and buffers of the older v1 format (api/lib/crypto.ts: the master key itself, no key id — appointment conversation messages,
 * appointment contact snapshots, dossier-thread messages and files written before RC5) were left out (« legacy »), so promoting a new key made them unreadable
 * while the status said « safe to retire ». They are now re-encrypted with the primary key in memory (same v1 format, compare-and-set) and counted: the old key
 * may be retired only when no v1 value or buffer still needs it. A v1 value no key of the ring opens is reported apart (unreadableLegacy): it was already
 * unreadable, retiring a key does not change it.
 */
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { SharedDiagnostic, SharedDossierMessage } from '../../src/db/schema.js';
import { isSealedJson } from '../../src/db/sealed-json.js';
import { SITUATION_SEAL } from '../lib/situation-codec.js';
import { currentKeyId, isPrimaryKeyId, keyIdOf, needsRewrap, rewrapBuffer, rewrapText } from '../lib/data-keys.js';
import { bufferKeyIndex, isV1Text, reencryptBuffer, reencryptV1, v1KeyIndex } from '../lib/crypto.js';
import { storage as defaultStorage } from '../lib/storage.js';

/** @param {{ apply?: boolean, batch?: number }} [options] */
export async function rewrapMessages({ apply = false, batch = 200 } = {}) {
  const stats = { primaryKeyId: currentKeyId(), scanned: 0, needing: 0, updated: 0, skippedConcurrent: 0, failed: 0, apply };
  let last = '';
  for (;;) {
    const rows = await defaultDb.select({ id: SharedDossierMessage.id, threadId: SharedDossierMessage.threadId, body: SharedDossierMessage.body })
      .from(SharedDossierMessage).where(gt(SharedDossierMessage.id, last)).orderBy(asc(SharedDossierMessage.id)).limit(batch);
    if (!rows.length) break;
    for (const row of rows) {
      last = row.id;
      stats.scanned += 1;
      if (!needsRewrap(row.body)) continue;
      stats.needing += 1;
      if (!apply) continue;
      try {
        const next = rewrapText(row.body, { purpose: 'dossier-message', context: `thread:${row.threadId}` });
        const done = await defaultDb.update(SharedDossierMessage).set({ body: next }).where(and(eq(SharedDossierMessage.id, row.id), eq(SharedDossierMessage.body, row.body))).returning({ id: SharedDossierMessage.id });
        if (done.length) stats.updated += 1; else stats.skippedConcurrent += 1;
      } catch {
        stats.failed += 1;                                   // never log the value
      }
    }
  }
  return stats;
}

/**
 * @typedef {import('../lib/data-keys.js').Purpose} Purpose
 * @typedef {{ table: string, idCol: string, col: string, purpose: Purpose, ctx: (row: any) => string, select: string }} TextColumn
 */
/** @type {TextColumn[]} */
const TEXT_COLUMNS = [
  { table: 'SharedDossierMessage', idCol: 'id', col: 'body', purpose: 'dossier-message', ctx: (r) => `thread:${r.threadId}`, select: '"threadId"' },
  { table: 'ProCaseNote', idCol: 'id', col: 'bodyEncrypted', purpose: 'case-note', ctx: (r) => `case:${r.caseId}`, select: '"caseId"' },
  { table: 'Referral', idCol: 'id', col: 'messageEncrypted', purpose: 'referral-message', ctx: (r) => `referral:${r.id}`, select: '1 AS one' },
  { table: 'Referral', idCol: 'id', col: 'responseMessageEncrypted', purpose: 'referral-message', ctx: (r) => `referral:${r.id}`, select: '1 AS one' },
  { table: 'CitizenDocument', idCol: 'id', col: 'filenameEncrypted', purpose: 'coffre-filename', ctx: (r) => `coffre:${r.userId}:${r.id}`, select: '"userId"' },
  { table: 'RdvMessageAttachment', idCol: 'id', col: 'filenameEncrypted', purpose: 'message-attachment-name', ctx: (r) => `rdvatt:${r.conversationId}:${r.id}`, select: '"conversationId"' },
  // PKG-5 batch 2: support requests (message + optional contact) and assisted ownership-recovery addresses
  { table: 'SupportRequest', idCol: 'id', col: 'messageEncrypted', purpose: 'support-request', ctx: (r) => `support:${r.id}`, select: '1 AS one' },
  { table: 'SupportRequest', idCol: 'id', col: 'contactEncrypted', purpose: 'support-request', ctx: (r) => `support-contact:${r.id}`, select: '1 AS one' },
  { table: 'OwnershipRecoveryCase', idCol: 'id', col: 'newEmailEncrypted', purpose: 'ownership-recovery', ctx: (r) => `recovery:${r.id}`, select: '1 AS one' },
  // launch-readiness item 66: the pending new address of an e-mail change
  { table: 'EmailChangeRequest', idCol: 'id', col: 'newEmailEncrypted', purpose: 'email-change', ctx: (r) => `email-change:${r.id}`, select: '1 AS one' },
  // R11 / N04: a browser's web push subscription (its push-service address and keys)
  { table: 'PushSubscription', idCol: 'id', col: 'subscriptionEncrypted', purpose: 'push-subscription', ctx: (r) => `push:${r.userId}:${r.id}`, select: '"userId"' },
  // R18 (R31): the label and reasons of a professional's orientation basket
  { table: 'ProOrientationBasket', idCol: 'id', col: 'privateEncrypted', purpose: 'orientation-basket', ctx: (r) => `basket:${r.id}`, select: '1 AS one' },
];
/** v1-only text columns (api/lib/crypto.ts encrypt): no envelope, re-encrypted with the primary key when a previous key wrote them */
const V1_TEXT_COLUMNS = [
  { table: 'RdvConversationMessage', idCol: 'id', col: 'body' },
  { table: 'ProAppointment', idCol: 'id', col: 'citizenEmailSnapshot' },
  { table: 'ProAppointment', idCol: 'id', col: 'beneficiaryName' },
  { table: 'ProAppointment', idCol: 'id', col: 'notes' },
];
/** @type {{ table: string, purpose: Purpose, ctx: (row: any) => string, select: string }[]} */
const BLOB_TABLES = [
  { table: 'CitizenDocument', purpose: 'coffre-file', ctx: (r) => `coffre:${r.userId}:${r.id}`, select: '"userId"' },
  { table: 'RdvMessageAttachment', purpose: 'message-attachment', ctx: (r) => `rdvatt:${r.conversationId}:${r.id}`, select: '"conversationId"' },
];
const q = (/** @type {string} */ name) => sql.raw(`"${name}"`);
/** 0: nothing to do (v2 on the primary, a v1 value of the primary key, or not a v1 value) · 1: needs work · -1: a v1 value no key of the ring opens */
const legacyState = (/** @type {unknown} */ v) => { if (!isV1Text(v)) return 0; const i = v1KeyIndex(/** @type {string} */ (v)); return i === 0 ? 0 : i > 0 ? 1 : -1; };
const newStats = (/** @type {boolean} */ apply) => ({ primaryKeyId: currentKeyId(), apply, scanned: 0, needing: 0, updated: 0, skippedConcurrent: 0, failed: 0, unreadableLegacy: 0, missingBlobs: 0, orphans: /** @type {string[]} */ ([]), byKind: /** @type {Record<string, { needing: number, updated: number, failed: number }>} */ ({}) });
/** @param {ReturnType<typeof newStats>} s @param {string} kind @param {'needing'|'updated'|'failed'} k */
const bump = (s, kind, k) => { (s.byKind[kind] = s.byKind[kind] || { needing: 0, updated: 0, failed: 0 })[k] += 1; };

/**
 * Re-wrap EVERY encrypted value and blob still wrapped by a non-primary key.
 * @param {{ apply?: boolean, batch?: number, db?: any, storage?: any, stopAfter?: number }} [options]  stopAfter: test hook simulating an interruption after N writes
 */
export async function rewrapAll({ apply = false, batch = 200, db = defaultDb, storage = defaultStorage, stopAfter = Infinity } = {}) {
  const s = newStats(apply); let writes = 0;
  const interrupted = () => writes >= stopAfter;
  for (const c of TEXT_COLUMNS) {
    const kind = `${c.table}.${c.col}`; let last = '';
    for (;;) {
      if (interrupted()) return { ...s, interrupted: true };
      const rows = (await db.execute(sql`SELECT ${q(c.idCol)} AS id, ${q(c.col)} AS v, ${sql.raw(c.select)} FROM ${q(c.table)} WHERE ${q(c.idCol)} > ${last} AND ${q(c.col)} IS NOT NULL ORDER BY ${q(c.idCol)} LIMIT ${batch}`)).rows;
      if (!rows.length) break;
      for (const r of rows) {
        last = r.id; s.scanned += 1;
        const legacy = legacyState(r.v);
        if (legacy < 0) { s.unreadableLegacy += 1; continue; }
        if (!legacy && !needsRewrap(r.v)) continue;
        s.needing += 1; bump(s, kind, 'needing');
        if (!apply) continue;
        if (interrupted()) return { ...s, interrupted: true };
        try {
          const next = legacy ? reencryptV1(r.v) : rewrapText(r.v, { purpose: c.purpose, context: c.ctx(r) });
          const done = (await db.execute(sql`UPDATE ${q(c.table)} SET ${q(c.col)} = ${next} WHERE ${q(c.idCol)} = ${r.id} AND ${q(c.col)} = ${r.v} RETURNING ${q(c.idCol)}`)).rows;
          if (done.length) { s.updated += 1; bump(s, kind, 'updated'); writes += 1; } else s.skippedConcurrent += 1;
        } catch { s.failed += 1; bump(s, kind, 'failed'); }
      }
    }
  }
  // v1-only text columns
  for (const c of V1_TEXT_COLUMNS) {
    const kind = `${c.table}.${c.col}`; let last = '';
    for (;;) {
      if (interrupted()) return { ...s, interrupted: true };
      const rows = (await db.execute(sql`SELECT ${q(c.idCol)} AS id, ${q(c.col)} AS v FROM ${q(c.table)} WHERE ${q(c.idCol)} > ${last} AND ${q(c.col)} IS NOT NULL ORDER BY ${q(c.idCol)} LIMIT ${batch}`)).rows;
      if (!rows.length) break;
      for (const r of rows) {
        last = r.id;
        if (!isV1Text(r.v)) continue;   // plain values (« Particulier », « [anonymisé] »…) are not encrypted: nothing depends on a key
        s.scanned += 1;
        const legacy = legacyState(r.v);
        if (legacy < 0) { s.unreadableLegacy += 1; continue; }
        if (!legacy) continue;
        s.needing += 1; bump(s, kind, 'needing');
        if (!apply) continue;
        if (interrupted()) return { ...s, interrupted: true };
        try {
          const next = reencryptV1(r.v);
          const done = (await db.execute(sql`UPDATE ${q(c.table)} SET ${q(c.col)} = ${next} WHERE ${q(c.idCol)} = ${r.id} AND ${q(c.col)} = ${r.v} RETURNING ${q(c.idCol)}`)).rows;
          if (done.length) { s.updated += 1; bump(s, kind, 'updated'); writes += 1; } else s.skippedConcurrent += 1;
        } catch { s.failed += 1; bump(s, kind, 'failed'); }
      }
    }
  }
  // blobs referenced by a row with a storageKey column
  for (const b of BLOB_TABLES) {
    const kind = `${b.table}.blob`; let last = '';
    for (;;) {
      if (interrupted()) return { ...s, interrupted: true };
      const rows = (await db.execute(sql`SELECT id, "storageKey" AS k, ${sql.raw(b.select)} FROM ${q(b.table)} WHERE id > ${last} ORDER BY id LIMIT ${batch}`)).rows;
      if (!rows.length) break;
      for (const r of rows) {
        last = r.id; s.scanned += 1;
        let blob;
        try { blob = await storage.download(r.k); } catch { s.missingBlobs += 1; continue; }   // nothing stored = nothing to re-wrap (reported apart from failures)
        const legacyBlob = keyIdOf(blob) === 'legacy';
        const legacyIdx = legacyBlob ? bufferKeyIndex(blob) : 0;
        if (legacyBlob && legacyIdx < 0) { s.unreadableLegacy += 1; continue; }
        if (legacyBlob ? legacyIdx === 0 : isPrimaryKeyId(keyIdOf(blob))) continue;
        s.needing += 1; bump(s, kind, 'needing');
        if (!apply) continue;
        if (interrupted()) return { ...s, interrupted: true };
        /** @type {string | null} */ let newKey = null;
        try {
          newKey = await storage.upload(legacyBlob ? reencryptBuffer(blob) : rewrapBuffer(blob, { purpose: b.purpose, context: b.ctx(r) }), 'application/octet-stream');
          const done = (await db.execute(sql`UPDATE ${q(b.table)} SET "storageKey" = ${newKey} WHERE id = ${r.id} AND "storageKey" = ${r.k} RETURNING id`)).rows;
          if (done.length) { await storage.delete(r.k).catch(() => { s.orphans.push(r.k); }); s.updated += 1; bump(s, kind, 'updated'); writes += 1; }
          else { await storage.delete(newKey).catch(() => { s.orphans.push(String(newKey)); }); s.skippedConcurrent += 1; }
        } catch { if (newKey) s.orphans.push(newKey); s.failed += 1; bump(s, kind, 'failed'); }
      }
    }
  }
  // dossier documents and names inside SharedDiagnostic.results._files (one row = many files; compare-and-set on the whole _files array)
  {
    const kind = 'SharedDiagnostic._files'; let last = '';
    for (;;) {
      if (interrupted()) return { ...s, interrupted: true };
      const rows = (await db.execute(sql`SELECT id, results->'_files' AS files FROM "SharedDiagnostic" WHERE id > ${last} AND jsonb_typeof(results->'_files') = 'array' ORDER BY id LIMIT ${batch}`)).rows;
      if (!rows.length) break;
      for (const r of rows) {
        last = r.id;
        const files = Array.isArray(r.files) ? r.files : [];
        const next = []; let changed = false; const created = []; const replaced = [];
        try {
          for (const f of files) {
            s.scanned += 1;
            const ctx = `file:${r.id}:${f.id}`; const out = { ...f };
            const nameLegacy = legacyState(f.filenameEncrypted) > 0;
            const nameStale = typeof f.filenameEncrypted === 'string' && (nameLegacy || needsRewrap(f.filenameEncrypted));
            let blob = null;
            if (f.storageKey && f.encrypted === true) { try { blob = await storage.download(f.storageKey); } catch { s.missingBlobs += 1; } }
            const blobLegacy = Boolean(blob) && keyIdOf(blob) === 'legacy' && bufferKeyIndex(blob) > 0;
            const blobStale = blob && (blobLegacy || (keyIdOf(blob) !== 'legacy' && !isPrimaryKeyId(keyIdOf(blob))));
            if (!nameStale && !blobStale) { next.push(f); continue; }
            s.needing += 1; bump(s, kind, 'needing');
            if (!apply) { next.push(f); continue; }
            if (nameStale) out.filenameEncrypted = nameLegacy ? reencryptV1(f.filenameEncrypted) : rewrapText(f.filenameEncrypted, { purpose: 'dossier-filename', context: ctx });
            if (blobStale && blob) { const k = await storage.upload(blobLegacy ? reencryptBuffer(blob) : rewrapBuffer(blob, { purpose: 'dossier-file', context: ctx }), 'application/octet-stream'); created.push(k); replaced.push(f.storageKey); out.storageKey = k; }
            next.push(out); changed = true;
          }
          if (!changed) continue;
          if (interrupted()) { for (const k of created) await storage.delete(k).catch(() => s.orphans.push(k)); return { ...s, interrupted: true }; }
          const done = (await db.execute(sql`UPDATE "SharedDiagnostic" SET results = jsonb_set(results, '{_files}', ${JSON.stringify(next)}::jsonb) WHERE id = ${r.id} AND results->'_files' = ${JSON.stringify(files)}::jsonb RETURNING id`)).rows;
          if (done.length) { for (const k of replaced) await storage.delete(k).catch(() => s.orphans.push(k)); s.updated += 1; bump(s, kind, 'updated'); writes += 1; }
          else { for (const k of created) await storage.delete(k).catch(() => s.orphans.push(k)); s.skippedConcurrent += 1; }
        } catch { for (const k of created) s.orphans.push(k); s.failed += 1; bump(s, kind, 'failed'); }
      }
    }
  }
  // launch-readiness item 60: the encrypted answers of a shared dossier (SharedDiagnostic.situation = { enc: "v2:…" })
  {
    const kind = 'SharedDiagnostic.situation'; let last = '';
    for (;;) {
      if (interrupted()) return { ...s, interrupted: true };
      const rows = (await db.execute(sql`SELECT id, situation->>'enc' AS v FROM "SharedDiagnostic" WHERE id > ${last} AND jsonb_typeof(situation) = 'object' AND situation ? 'enc' ORDER BY id LIMIT ${batch}`)).rows;
      if (!rows.length) break;
      for (const r of rows) {
        last = r.id; s.scanned += 1;
        if (!needsRewrap(r.v)) continue;
        s.needing += 1; bump(s, kind, 'needing');
        if (!apply) continue;
        if (interrupted()) return { ...s, interrupted: true };
        try {
          const next = rewrapText(r.v, SITUATION_SEAL);
          const done = (await db.execute(sql`UPDATE "SharedDiagnostic" SET situation = jsonb_build_object('enc', ${next}::text) WHERE id = ${r.id} AND situation->>'enc' = ${r.v} RETURNING id`)).rows;
          if (done.length) { s.updated += 1; bump(s, kind, 'updated'); writes += 1; } else s.skippedConcurrent += 1;
        } catch { s.failed += 1; bump(s, kind, 'failed'); }
      }
    }
  }
  // the reviewer's released DSR extract (inside DSRRequest.reviewOutcome)
  {
    const kind = 'DSRRequest.reviewOutcome';
    const rows = (await db.execute(sql`SELECT id, "reviewOutcome" AS o FROM "DSRRequest" WHERE "reviewOutcome" ? 'extractEncrypted' OR "reviewOutcome"->'proposal' ? 'extractEncrypted'`)).rows;
    for (const r of rows) {
      s.scanned += 1;
      const inProposal = !r.o.extractEncrypted && r.o.proposal?.extractEncrypted;   // PKG-5: a proposed (not yet confirmed) extract
      const value = inProposal ? r.o.proposal.extractEncrypted : r.o.extractEncrypted;
      const legacy = legacyState(value);
      if (legacy < 0) { s.unreadableLegacy += 1; continue; }
      if (!legacy && !needsRewrap(value)) continue;
      s.needing += 1; bump(s, kind, 'needing');
      if (!apply) continue;
      try {
        const next = legacy ? reencryptV1(value) : rewrapText(value, { purpose: 'case-note', context: `dsr:${r.id}` });
        const o2 = inProposal ? { ...r.o, proposal: { ...r.o.proposal, extractEncrypted: next } } : { ...r.o, extractEncrypted: next };
        const done = (await db.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = ${JSON.stringify(o2)}::jsonb WHERE id = ${r.id} AND "reviewOutcome" = ${JSON.stringify(r.o)}::jsonb RETURNING id`)).rows;
        if (done.length) { s.updated += 1; bump(s, kind, 'updated'); writes += 1; } else s.skippedConcurrent += 1;
      } catch { s.failed += 1; bump(s, kind, 'failed'); }
    }
  }
  return { ...s, interrupted: false };
}

/**
 * Launch-readiness item 60: the answers of shared dossiers stored in clear before the encryption existed, re-saved through the codec (src/db/sealed-json.ts).
 * Dry run by default; compare-and-set on the stored value; counters only.
 * @param {{ apply?: boolean, batch?: number, db?: any, idPrefix?: string }} [options] idPrefix: only the dossiers whose id starts with it (tests)
 */
export async function sealPlainSituations({ apply = false, batch = 200, db = defaultDb, idPrefix = '' } = {}) {
  const stats = { apply, scanned: 0, plain: 0, sealed: 0, skippedConcurrent: 0, failed: 0 };
  let last = '';
  for (;;) {
    const rows = (await db.execute(sql`SELECT id, situation AS v FROM "SharedDiagnostic" WHERE id > ${last} AND id LIKE ${`${idPrefix}%`} ORDER BY id LIMIT ${batch}`)).rows;
    if (!rows.length) break;
    for (const r of rows) {
      last = r.id; stats.scanned += 1;
      if (isSealedJson(r.v)) continue;
      stats.plain += 1;
      if (!apply) continue;
      try {
        const done = await db.update(SharedDiagnostic).set({ situation: r.v })
          .where(and(eq(SharedDiagnostic.id, r.id), sql`${SharedDiagnostic.situation} = ${JSON.stringify(r.v)}::jsonb`)).returning({ id: SharedDiagnostic.id });
        if (done.length) stats.sealed += 1; else stats.skippedConcurrent += 1;
      } catch { stats.failed += 1; }
    }
  }
  return stats;
}

/** Readiness to retire old keys: how many values / blobs are still wrapped by each non-primary key id. The old key may be retired only when this is empty. */
export async function rotationStatus(options = {}) {
  const dry = await rewrapAll({ ...options, apply: false });
  return { primaryKeyId: dry.primaryKeyId, stillOnOldKeys: dry.needing, failedToRead: dry.failed, unreadableLegacy: dry.unreadableLegacy, missingBlobs: dry.missingBlobs, byKind: dry.byKind,
    safeToRetireOldKeys: dry.needing === 0 && dry.failed === 0 };
}
