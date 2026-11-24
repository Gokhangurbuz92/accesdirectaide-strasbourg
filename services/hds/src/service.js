// @ts-check
/**
 * G14-R3 — the data operations of the HDS service: Mon Coffre (C09, ported), the shared-dossier data plane (C14 / C17, partial port), erasure and
 * anti-resurrection.
 *
 * END-TO-END ENCRYPTION (owner 24/11/2026): the browser encrypts every document, its name, category and type, and every dossier content, with keys this
 * service never receives (src/lib/vaultCrypto.js: a vault key wrapped by a passphrase-derived key; a random key per document). What arrives here is a
 * set of « boxes » { iv, ct } (AES-256-GCM, base64). The service checks only sizes, quotas and ownership, then seals the boxes AGAIN with a per-object
 * data key wrapped by a KEK of HDS_DATA_KEYS (src/envelope.js) — so neither the host, nor the operator, nor a database dump can read a document.
 * Consequence stated honestly: no server-side type check or antivirus scan is possible (scanStatus NOT_SCANNED); the type check runs in the browser.
 */
import crypto from 'node:crypto';
import { newDataKey, open, seal, sha256, unwrapDataKey } from './envelope.js';
import { pgBlobStore } from './db.js';

export const COFFRE_MAX_FILE = 3 * 1024 * 1024;
export const COFFRE_MAX_FILES = 20;
export const COFFRE_MAX_TOTAL = 50 * 1024 * 1024;
export const DOSSIER_MAX_CONTENT = 1.5 * 1024 * 1024;
export const DOSSIER_MAX_FILES = 30;
export const KDF_MIN_ITERATIONS = 600000;
const GCM_TAG = 16;

/** @typedef {{ sub: string, typ: 'citizen' | 'pro' | 'system', caps: string[], str?: string }} Principal */
/** @typedef {{ pool: import('pg').Pool, cfg: ReturnType<typeof import('./config.js').loadConfig> }} Ctx */
/** @typedef {{ status: number, body?: any, bytes?: Buffer, headers?: Record<string, string> }} Out */
/** @typedef {{ iv: string, ct: string }} Box */

/** @param {number} status @param {string} code @param {string} message @returns {Out} */
const fail = (status, code, message) => ({ status, body: { error: code, message } });
const notFound = () => fail(404, 'not_found', 'Document ou dossier introuvable.');
/** @param {string} id */
export const actorRef = (id) => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
/** @param {string} id */
export const subjectHash = (id) => crypto.createHash('sha256').update(String(id)).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STRUCTURE = /^[A-Za-z0-9_-]{1,64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * a client box { iv, ct }: a 12-byte iv and a ciphertext of at most maxPlain bytes (+ the GCM tag); returns the canonical box or null
 * @param {unknown} v @param {number} maxPlain @returns {Box | null}
 */
export function checkBox(v, maxPlain) {
  const b = /** @type {any} */ (v);
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => k !== 'iv' && k !== 'ct')) return null;
  if (typeof b.iv !== 'string' || typeof b.ct !== 'string' || b.iv.length !== 16 || !B64.test(b.iv) || !b.ct || !B64.test(b.ct) || b.ct.length % 4 === 1) return null;
  if (b.ct.length > Math.ceil((maxPlain + GCM_TAG) * 4 / 3) + 4) return null;
  const ct = Buffer.from(b.ct, 'base64');
  if (Buffer.from(b.iv, 'base64').length !== 12 || ct.length <= GCM_TAG || ct.length > maxPlain + GCM_TAG) return null;
  return { iv: b.iv, ct: b.ct };
}
/** @param {Box} box */
const boxBytes = (box) => Buffer.concat([Buffer.from(box.iv, 'base64'), Buffer.from(box.ct, 'base64')]);
/** @param {Buffer} b @returns {Box} */
const bytesBox = (b) => ({ iv: b.subarray(0, 12).toString('base64'), ct: b.subarray(12).toString('base64') });

/** the server layer: a fresh data key per object (wrapped by the active KEK) sealing the client bytes @param {Ctx} ctx @param {string} aad */
function serverLayer(ctx, aad) {
  const k = newDataKey(ctx.cfg.keyring, aad);
  return { kekId: k.kekId, wrapped: k.wrapped, /** @param {Buffer} b @param {string} field */ seal: (b, field) => seal(k.dek, b, `${aad}:${field}`) };
}
/** @param {Ctx} ctx @param {{ kek_id: string, dek_wrapped: Buffer }} r @param {string} aad */
function serverOpen(ctx, r, aad) {
  const dek = unwrapDataKey(ctx.cfg.keyring, r.kek_id, r.dek_wrapped, aad);
  return (/** @type {Buffer} */ b, /** @type {string} */ field) => open(dek, b, `${aad}:${field}`);
}

/** @param {Ctx} ctx @param {any} q @param {{ owner: string, actor: Principal, action: string, objectType: string, objectId?: string | null, structureId?: string | null }} e */
async function event(ctx, q, e) {
  await q.query('INSERT INTO hds.access_event (owner_id, actor_type, actor_ref, structure_id, action, object_type, object_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [e.owner, e.actor.typ, actorRef(e.actor.sub), e.structureId || null, e.action, e.objectType, e.objectId || null]);
}

/** @template T @param {import('pg').Pool} pool @param {(c: import('pg').PoolClient) => Promise<T>} fn @returns {Promise<T>} */
export async function tx(pool, fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

/** the three boxes of an encrypted file (content, meta = {name, category, type}, dek = the file key wrapped by the vault / dossier key) @param {any} input */
function checkFileBoxes(input) {
  const rawCt = /** @type {any} */ (input)?.content?.ct;
  if (typeof rawCt === 'string' && rawCt.length > Math.ceil((COFFRE_MAX_FILE + GCM_TAG) * 4 / 3) + 4) return { ok: false, out: fail(413, 'FILE_TOO_LARGE', 'Fichier trop volumineux (3 Mo au plus).') };
  const content = checkBox(input?.content, COFFRE_MAX_FILE);
  if (!content) return { ok: false, out: fail(400, 'INVALID_FILE', 'Fichier chiffré illisible, vide ou trop volumineux (3 Mo au plus).') };
  const meta = checkBox(input?.meta, 2048); const dek = checkBox(input?.dek, 64);
  if (!meta || !dek) return { ok: false, out: fail(400, 'INVALID_ENVELOPE', 'Enveloppe chiffrée incomplète.') };
  const bytes = boxBytes(content);
  return { ok: true, content, bytes, boxes: Buffer.from(JSON.stringify({ meta, dek })) };
}

// ───────────── Mon Coffre (C09)
const vaultAad = (/** @type {string} */ owner, /** @type {string} */ id) => `vault:${owner}:${id}`;
const keyringAad = (/** @type {string} */ owner) => `vault-keyring:${owner}`;

/** @param {unknown} v */
function checkKeyring(v) {
  const k = /** @type {any} */ (v);
  if (!k || typeof k !== 'object' || k.v !== 1 || k.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(k.iterations) || k.iterations < KDF_MIN_ITERATIONS || k.iterations > 10000000) return null;
  if (typeof k.salt !== 'string' || !B64.test(k.salt) || Buffer.from(k.salt, 'base64').length !== 16) return null;
  const wrapped = checkBox(k.wrapped, 64); const verifier = checkBox(k.verifier, 128);
  return wrapped && verifier ? { v: 1, kdf: 'PBKDF2-SHA256', iterations: k.iterations, salt: k.salt, wrapped, verifier } : null;
}

/** @param {Ctx} ctx @param {any} q @param {string} owner */
async function readKeyring(ctx, q, owner) {
  const r = (await q.query('SELECT * FROM hds.vault_keyring WHERE owner_id = $1', [owner])).rows[0];
  return r ? JSON.parse(serverOpen(ctx, r, keyringAad(owner))(r.keyring_sealed, 'keyring').toString('utf8')) : null;
}

/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function vaultSetKeyring(ctx, p, input) {
  const keyring = checkKeyring(input?.keyring);
  if (!keyring) return fail(400, 'INVALID_KEYRING', 'Trousseau de Mon Coffre invalide.');
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vault:${p.sub}`]);
    const exists = (await c.query('SELECT 1 FROM hds.vault_keyring WHERE owner_id = $1', [p.sub])).rowCount;
    // a passphrase change re-wraps the SAME vault key (the browser proves it opened the old one); never a silent replacement
    if (exists && input?.replace !== true) return fail(409, 'KEYRING_EXISTS', 'Mon Coffre est déjà protégé par une phrase secrète.');
    const L = serverLayer(ctx, keyringAad(p.sub));
    await c.query(`INSERT INTO hds.vault_keyring (owner_id, kek_id, dek_wrapped, keyring_sealed) VALUES ($1, $2, $3, $4)
      ON CONFLICT (owner_id) DO UPDATE SET kek_id = EXCLUDED.kek_id, dek_wrapped = EXCLUDED.dek_wrapped, keyring_sealed = EXCLUDED.keyring_sealed, updated_at = now()`,
    [p.sub, L.kekId, L.wrapped, L.seal(Buffer.from(JSON.stringify(keyring)), 'keyring')]);
    await event(ctx, c, { owner: p.sub, actor: p, action: exists ? 'VAULT_KEYRING_CHANGED' : 'VAULT_KEYRING_CREATED', objectType: 'vault_keyring' });
    return { status: exists ? 200 : 201, body: { keyring } };
  });
}

/** @param {Ctx} ctx @param {any} r */
function vaultView(ctx, r) {
  const boxes = JSON.parse(serverOpen(ctx, r, vaultAad(r.owner_id, r.id))(r.boxes_sealed, 'boxes').toString('utf8'));
  return { id: r.id, meta: boxes.meta, dek: boxes.dek, byteLength: r.byte_length, scanStatus: r.scan_status, expiresAt: r.expires_at, createdAt: r.created_at,
    expired: Boolean(r.expires_at && new Date(r.expires_at).getTime() <= Date.now()) };
}

/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} */
export async function vaultList(ctx, p) {
  const rows = (await ctx.pool.query('SELECT * FROM hds.vault_document WHERE owner_id = $1 ORDER BY created_at DESC', [p.sub])).rows;
  const used = rows.reduce((s, r) => s + r.byte_length, 0);
  const consent = (await ctx.pool.query("SELECT text_version FROM hds.consent_record WHERE owner_id = $1 AND purpose = 'vault_health_documents' AND withdrawn_at IS NULL ORDER BY given_at DESC LIMIT 1", [p.sub])).rows[0];
  return { status: 200, body: { keyring: await readKeyring(ctx, ctx.pool, p.sub), healthConsent: consent ? consent.text_version : null,
    documents: rows.map((r) => vaultView(ctx, r)), quota: { files: rows.length, maxFiles: COFFRE_MAX_FILES, bytes: used, maxBytes: COFFRE_MAX_TOTAL } } };
}

/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function vaultUpload(ctx, p, input) {
  // the main API grants « vault.write » only when its age policy allows storing documents (C05; api/_services/citizen-account.js ageGate)
  if (!p.caps.includes('vault.write')) return fail(409, 'AGE_POLICY_PENDING', 'Cette fonction nécessite le consentement d’un représentant légal vérifié.');
  const f = checkFileBoxes(input);
  if (!f.ok) return /** @type {Out} */ (f.out);
  let expiresAt = null;
  if (input?.expiresAt) { expiresAt = new Date(String(input.expiresAt)); if (Number.isNaN(expiresAt.getTime())) return fail(400, 'INVALID_DATE', 'Date d’expiration invalide.'); }
  const id = crypto.randomUUID(); const L = serverLayer(ctx, vaultAad(p.sub, id));
  const bytes = /** @type {Buffer} */ (f.bytes);
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vault:${p.sub}`]);   // quota checked and written under one lock per person
    if (!(await c.query('SELECT 1 FROM hds.vault_keyring WHERE owner_id = $1', [p.sub])).rowCount) return fail(409, 'KEYRING_REQUIRED', 'Protégez d’abord Mon Coffre par une phrase secrète.');
    const q = (await c.query('SELECT count(*)::int AS n, coalesce(sum(byte_length), 0)::bigint AS b FROM hds.vault_document WHERE owner_id = $1', [p.sub])).rows[0];
    if (q.n >= COFFRE_MAX_FILES) return fail(409, 'QUOTA_FILES', `Mon Coffre contient au plus ${COFFRE_MAX_FILES} documents.`);
    if (Number(q.b) + bytes.length > COFFRE_MAX_TOTAL) return fail(409, 'QUOTA_BYTES', 'Espace de Mon Coffre insuffisant (50 Mo au total).');
    const blobId = crypto.randomUUID(); const sealed = L.seal(bytes, 'content');
    await pgBlobStore(c).put(blobId, sealed, sha256(sealed));
    const row = (await c.query(`INSERT INTO hds.vault_document (id, owner_id, kek_id, dek_wrapped, boxes_sealed, byte_length, cipher_sha256, blob_id, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [id, p.sub, L.kekId, L.wrapped, L.seal(/** @type {Buffer} */ (f.boxes), 'boxes'), bytes.length, sha256(bytes), blobId, expiresAt])).rows[0];
    await event(ctx, c, { owner: p.sub, actor: p, action: 'VAULT_DOCUMENT_ADDED', objectType: 'vault_document', objectId: id });
    return { status: 201, body: { document: vaultView(ctx, row) } };
  });
}

/** the client box of a stored file, after both integrity checks @param {Ctx} ctx @param {any} r @param {string} aad @param {any} q @returns {Promise<Box | null>} */
async function readContent(ctx, r, aad, q) {
  const blob = await pgBlobStore(q).get(r.blob_id);
  if (!blob || sha256(blob.bytes) !== blob.sha256) return null;
  const bytes = serverOpen(ctx, r, aad)(blob.bytes, 'content');
  return sha256(bytes) === r.cipher_sha256 ? bytesBox(bytes) : null;
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function vaultDownload(ctx, p, id) {
  if (!UUID.test(id)) return notFound();
  const r = (await ctx.pool.query('SELECT * FROM hds.vault_document WHERE id = $1 AND owner_id = $2', [id, p.sub])).rows[0];
  if (!r) return notFound();
  const content = await readContent(ctx, r, vaultAad(p.sub, id), ctx.pool);
  if (!content) return fail(500, 'INTEGRITY_ERROR', 'Le document stocké est altéré.');
  return { status: 200, body: { id, content } };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function vaultDelete(ctx, p, id) {
  if (!UUID.test(id)) return notFound();
  return tx(ctx.pool, async (c) => {
    const rows = (await c.query('DELETE FROM hds.vault_document WHERE id = $1 AND owner_id = $2 RETURNING blob_id', [id, p.sub])).rows;
    if (!rows.length) return notFound();
    await pgBlobStore(c).delete(rows.map((r) => r.blob_id));
    await event(ctx, c, { owner: p.sub, actor: p, action: 'VAULT_DOCUMENT_DELETED', objectType: 'vault_document', objectId: id });
    return { status: 200, body: { deleted: true } };
  });
}

/** explicit consent (art. 9.2.a) to keep health documents, of the approved text version only @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function vaultHealthConsent(ctx, p, input) {
  if (!ctx.cfg.healthEnabled) return fail(422, 'HEALTH_DOCUMENTS_NOT_ACCEPTED', 'Les documents de santé ne sont pas encore acceptés dans Mon Coffre.');
  if (input?.explicit !== true || input?.version !== ctx.cfg.healthConsentVersion) return fail(400, 'HEALTH_CONSENT_INVALID', 'Consentement explicite à la version en vigueur requis.');
  await ctx.pool.query(`INSERT INTO hds.consent_record (id, owner_id, purpose, text_version) SELECT $1, $2, 'vault_health_documents', $3
    WHERE NOT EXISTS (SELECT 1 FROM hds.consent_record WHERE owner_id = $2 AND purpose = 'vault_health_documents' AND text_version = $3 AND withdrawn_at IS NULL)`, [crypto.randomUUID(), p.sub, ctx.cfg.healthConsentVersion]);
  await event(ctx, ctx.pool, { owner: p.sub, actor: p, action: 'HEALTH_CONSENT_GIVEN', objectType: 'consent' });
  return { status: 201, body: { healthConsent: ctx.cfg.healthConsentVersion } };
}

/** withdrawal (art. 7.3): recorded; the person then deletes what they want (nothing is erased behind their back) @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} */
export async function vaultHealthConsentWithdraw(ctx, p) {
  const n = (await ctx.pool.query("UPDATE hds.consent_record SET withdrawn_at = now() WHERE owner_id = $1 AND purpose = 'vault_health_documents' AND withdrawn_at IS NULL", [p.sub])).rowCount;
  if (n) await event(ctx, ctx.pool, { owner: p.sub, actor: p, action: 'HEALTH_CONSENT_WITHDRAWN', objectType: 'consent' });
  return { status: 200, body: { healthConsent: null } };
}

// ───────────── shared dossier — data plane (the capability stays closed until the whole module is ported, organisation keys included)
const dossierAad = (/** @type {string} */ owner, /** @type {string} */ id) => `dossier:${owner}:${id}`;
const fileAad = (/** @type {string} */ dossierId, /** @type {string} */ fileId) => `dossier-file:${dossierId}:${fileId}`;

/** the dossier, when the principal may see it: its owner, or a professional of a structure with an active grant @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} [q] */
async function reachableDossier(ctx, p, id, q = ctx.pool) {
  if (!UUID.test(id)) return null;
  const d = (await q.query('SELECT * FROM hds.dossier WHERE id = $1', [id])).rows[0];
  if (!d) return null;
  if (p.typ === 'citizen') return d.owner_id === p.sub ? { d, role: 'owner', grant: null } : null;
  if (p.typ === 'pro' && p.str) {
    const g = (await q.query('SELECT wrapped_key FROM hds.dossier_grant WHERE dossier_id = $1 AND structure_id = $2 AND revoked_at IS NULL', [id, p.str])).rows[0];
    return g ? { d, role: 'grantee', grant: g } : null;
  }
  return null;
}

/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function dossierCreate(ctx, p, input) {
  const content = checkBox(input?.content, DOSSIER_MAX_CONTENT);
  if (!content) return fail(400, 'INVALID_CONTENT', 'Contenu chiffré du dossier manquant ou trop volumineux.');
  const id = crypto.randomUUID(); const L = serverLayer(ctx, dossierAad(p.sub, id));
  return tx(ctx.pool, async (c) => {
    await c.query('INSERT INTO hds.dossier (id, owner_id, kek_id, dek_wrapped, content_sealed) VALUES ($1, $2, $3, $4, $5)', [id, p.sub, L.kekId, L.wrapped, L.seal(boxBytes(content), 'content')]);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_CREATED', objectType: 'dossier', objectId: id });
    return { status: 201, body: { id } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} */
export async function dossierListOwn(ctx, p) {
  const rows = (await ctx.pool.query(`SELECT d.id, d.created_at, d.updated_at, coalesce(json_agg(json_build_object('structureId', g.structure_id, 'grantedAt', g.granted_at, 'revokedAt', g.revoked_at))
    FILTER (WHERE g.structure_id IS NOT NULL), '[]') AS grants FROM hds.dossier d LEFT JOIN hds.dossier_grant g ON g.dossier_id = d.id WHERE d.owner_id = $1 GROUP BY d.id ORDER BY d.created_at DESC`, [p.sub])).rows;
  return { status: 200, body: { dossiers: rows.map((r) => ({ id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, grants: r.grants })) } };
}

/** @param {Ctx} ctx @param {any} f */
function fileView(ctx, f) {
  const boxes = JSON.parse(serverOpen(ctx, f, fileAad(f.dossier_id, f.id))(f.boxes_sealed, 'boxes').toString('utf8'));
  return { id: f.id, meta: boxes.meta, dek: boxes.dek, byteLength: f.byte_length, addedBy: f.added_by, structureId: f.structure_id, createdAt: f.created_at };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function dossierGet(ctx, p, id) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit) return notFound();
  const { d } = hit;
  const content = bytesBox(serverOpen(ctx, d, dossierAad(d.owner_id, d.id))(d.content_sealed, 'content'));
  const files = (await ctx.pool.query('SELECT * FROM hds.dossier_file WHERE dossier_id = $1 ORDER BY created_at', [d.id])).rows
    .filter((f) => hit.role === 'owner' || f.structure_id === null || f.structure_id === p.str)
    .map((f) => fileView(ctx, f));
  if (hit.role === 'grantee') await event(ctx, ctx.pool, { owner: d.owner_id, actor: p, action: 'DOSSIER_VIEWED', objectType: 'dossier', objectId: d.id, structureId: p.str });
  const wrappedKey = hit.grant?.wrapped_key ? JSON.parse(Buffer.from(hit.grant.wrapped_key).toString('utf8')) : null;
  return { status: 200, body: { id: d.id, content, files, wrappedKey } };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function dossierDelete(ctx, p, id) {
  if (p.typ !== 'citizen' || !UUID.test(id)) return notFound();
  return tx(ctx.pool, async (c) => {
    const blobs = (await c.query('SELECT f.blob_id FROM hds.dossier_file f JOIN hds.dossier d ON d.id = f.dossier_id WHERE d.id = $1 AND d.owner_id = $2', [id, p.sub])).rows.map((r) => r.blob_id);
    const del = (await c.query('DELETE FROM hds.dossier WHERE id = $1 AND owner_id = $2 RETURNING id', [id, p.sub])).rows;
    if (!del.length) return notFound();
    await pgBlobStore(c).delete(blobs);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_DELETED', objectType: 'dossier', objectId: id });
    return { status: 200, body: { deleted: true } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @param {boolean} granted @returns {Promise<Out>} */
export async function dossierSetGrant(ctx, p, id, input, granted) {
  const structureId = String(input?.structureId || '');
  if (!STRUCTURE.test(structureId)) return fail(400, 'INVALID_STRUCTURE', 'Organisation inconnue.');
  const wrappedKey = input?.wrappedKey === undefined ? null : checkBox(input.wrappedKey, 512);
  if (granted && input?.wrappedKey !== undefined && !wrappedKey) return fail(400, 'INVALID_ENVELOPE', 'Clé chiffrée de l’organisation invalide.');
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  return tx(ctx.pool, async (c) => {
    if (granted) {
      await c.query(`INSERT INTO hds.dossier_grant (dossier_id, structure_id, wrapped_key) VALUES ($1, $2, $3)
        ON CONFLICT (dossier_id, structure_id) DO UPDATE SET revoked_at = NULL, granted_at = now(), wrapped_key = EXCLUDED.wrapped_key`, [id, structureId, wrappedKey ? Buffer.from(JSON.stringify(wrappedKey)) : null]);
    } else await c.query('UPDATE hds.dossier_grant SET revoked_at = now(), wrapped_key = NULL WHERE dossier_id = $1 AND structure_id = $2 AND revoked_at IS NULL', [id, structureId]);
    await event(ctx, c, { owner: p.sub, actor: p, action: granted ? 'DOSSIER_ACCESS_GRANTED' : 'DOSSIER_ACCESS_REVOKED', objectType: 'dossier', objectId: id, structureId });
    return { status: 200, body: { structureId, active: granted } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>} */
export async function dossierAddFile(ctx, p, id, input) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit) return notFound();
  const f = checkFileBoxes(input);
  if (!f.ok) return /** @type {Out} */ (f.out);
  let structureId = null;
  if (hit.role === 'grantee') structureId = /** @type {string} */ (p.str);
  else if (input?.structureId) {
    structureId = String(input.structureId);
    const g = (await ctx.pool.query('SELECT 1 FROM hds.dossier_grant WHERE dossier_id = $1 AND structure_id = $2 AND revoked_at IS NULL', [id, structureId])).rows[0];
    if (!g) return fail(404, 'NO_ACTIVE_GRANT', 'Cette organisation n’a pas accès à ce dossier.');
  }
  const fileId = crypto.randomUUID(); const L = serverLayer(ctx, fileAad(id, fileId));
  const bytes = /** @type {Buffer} */ (f.bytes);
  return tx(ctx.pool, async (c) => {
    const n = (await c.query('SELECT count(*)::int AS n FROM hds.dossier_file WHERE dossier_id = $1', [id])).rows[0].n;
    if (n >= DOSSIER_MAX_FILES) return fail(409, 'QUOTA_FILES', 'Ce dossier contient déjà le nombre maximal de documents.');
    const blobId = crypto.randomUUID(); const sealed = L.seal(bytes, 'content');
    await pgBlobStore(c).put(blobId, sealed, sha256(sealed));
    await c.query(`INSERT INTO hds.dossier_file (id, dossier_id, structure_id, added_by, kek_id, dek_wrapped, boxes_sealed, byte_length, cipher_sha256, blob_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [fileId, id, structureId, hit.role === 'owner' ? 'citizen' : 'pro', L.kekId, L.wrapped, L.seal(/** @type {Buffer} */ (f.boxes), 'boxes'), bytes.length, sha256(bytes), blobId]);
    await c.query('UPDATE hds.dossier SET updated_at = now() WHERE id = $1', [id]);
    await event(ctx, c, { owner: hit.d.owner_id, actor: p, action: 'FILE_UPLOADED', objectType: 'dossier_file', objectId: fileId, structureId });
    return { status: 201, body: { fileId } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {string} fileId @returns {Promise<Out>} */
export async function dossierDownloadFile(ctx, p, id, fileId) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || !UUID.test(fileId)) return notFound();
  const f = (await ctx.pool.query('SELECT * FROM hds.dossier_file WHERE id = $1 AND dossier_id = $2', [fileId, id])).rows[0];
  if (!f || (hit.role === 'grantee' && f.structure_id !== null && f.structure_id !== p.str)) return notFound();
  const content = await readContent(ctx, f, fileAad(id, fileId), ctx.pool);
  if (!content) return fail(500, 'INTEGRITY_ERROR', 'Le document stocké est altéré.');
  if (hit.role === 'grantee') await event(ctx, ctx.pool, { owner: hit.d.owner_id, actor: p, action: 'DOSSIER_FILE_DOWNLOADED', objectType: 'dossier_file', objectId: fileId, structureId: p.str });
  return { status: 200, body: { id: fileId, content } };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function dossierAccessLog(ctx, p, id) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  const rows = (await ctx.pool.query(`SELECT action, at, actor_type, structure_id FROM hds.access_event WHERE owner_id = $1 AND object_id IN (SELECT $2::uuid UNION SELECT id FROM hds.dossier_file WHERE dossier_id = $2)
    ORDER BY at DESC LIMIT 200`, [p.sub, id])).rows;
  return { status: 200, body: { events: rows.map((r) => ({ action: r.action, at: r.at, actorType: r.actor_type, structureId: r.structure_id })) } };
}

// ───────────── erasure (art. 17) and anti-resurrection
/** erase every HDS object of a subject, write the tombstone; idempotent @param {import('pg').Pool} pool @param {string} subjectId */
export async function eraseSubject(pool, subjectId) {
  return tx(pool, async (c) => {
    const blobs = (await c.query(`SELECT blob_id FROM hds.vault_document WHERE owner_id = $1 UNION ALL
      SELECT f.blob_id FROM hds.dossier_file f JOIN hds.dossier d ON d.id = f.dossier_id WHERE d.owner_id = $1`, [subjectId])).rows.map((r) => r.blob_id);
    const vault = (await c.query('DELETE FROM hds.vault_document WHERE owner_id = $1', [subjectId])).rowCount;
    const dossiers = (await c.query('DELETE FROM hds.dossier WHERE owner_id = $1', [subjectId])).rowCount;
    await pgBlobStore(c).delete(blobs);
    await c.query('DELETE FROM hds.vault_keyring WHERE owner_id = $1', [subjectId]);
    await c.query('DELETE FROM hds.consent_record WHERE owner_id = $1', [subjectId]);
    await c.query('DELETE FROM hds.access_event WHERE owner_id = $1', [subjectId]);
    await c.query('INSERT INTO hds.erasure_tombstone (subject_hash) VALUES ($1) ON CONFLICT DO NOTHING', [subjectHash(subjectId)]);
    return { vaultDocuments: vault, dossiers, blobs: blobs.length };
  });
}

/** the tombstones, content-free (hashes + dates), for export outside the HDS database @param {import('pg').Pool} pool */
export async function exportTombstones(pool) {
  return (await pool.query('SELECT subject_hash, erased_at FROM hds.erasure_tombstone ORDER BY erased_at')).rows.map((r) => ({ subjectHash: r.subject_hash, erasedAt: r.erased_at }));
}

/** after a restore: erase again every subject whose hash is in the list (and re-record its tombstone) @param {import('pg').Pool} pool @param {string[]} hashes */
export async function reapplyTombstones(pool, hashes) {
  const list = hashes.filter((h) => /^[0-9a-f]{64}$/.test(h));
  const owners = (await pool.query(`SELECT DISTINCT owner_id FROM (SELECT owner_id FROM hds.vault_document UNION SELECT owner_id FROM hds.vault_keyring UNION SELECT owner_id FROM hds.dossier UNION SELECT owner_id FROM hds.consent_record
    UNION SELECT owner_id FROM hds.access_event) o WHERE encode(sha256(convert_to(owner_id, 'UTF8')), 'hex') = ANY($1::text[])`, [list])).rows.map((r) => r.owner_id);
  let erased = 0;
  for (const o of owners) { await eraseSubject(pool, o); erased += 1; }
  for (const h of list) await pool.query('INSERT INTO hds.erasure_tombstone (subject_hash) VALUES ($1) ON CONFLICT DO NOTHING', [h]);
  return { subjectsErasedAgain: erased, tombstones: list.length };
}

