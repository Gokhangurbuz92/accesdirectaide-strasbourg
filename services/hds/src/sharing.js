// @ts-check
/**
 * G14-R4 — shared dossiers (citizen.shared_dossier), organisation keys, referral payloads (pro.referrals, FA-D7 partner bridge) and appointment-conversation
 * attachments (messaging.attachments) in the HDS service. Same model as Mon Coffre (services/hds/DESIGN.md):
 *
 *   END-TO-END. Every content, file, file name, thread message and referral note is encrypted in the browser. The DOSSIER KEY (32 random bytes) never
 *   reaches this service in clear: it travels only (a) wrapped by the owner's vault key (`ownerKey`, a client box) and (b) wrapped for each recipient
 *   ORGANISATION with ECIES (ephemeral ECDH P-256 → HKDF-SHA256 → AES-256-GCM, src/lib/dossierCrypto.js) to that organisation's public key. An organisation's
 *   private key exists only wrapped for each of its members (ECIES to the member's own key pair), and a member's private key exists only wrapped by that
 *   member's passphrase. The service stores public keys and opaque boxes; it cannot open any of them.
 *   REVOCATION RE-WRAPS. Revoking an organisation bumps nothing by itself: the owner's browser then sends ONE atomic re-key (new dossier key, content
 *   re-encrypted, every file / message key re-wrapped, every remaining grant re-wrapped). Until it is done the dossier answers `rekeyRequired`. A revoked
 *   organisation keeps only what it may already have copied — stated honestly to the person.
 *   CONSENT, GRANTS, EXPIRY, AUDIT. A grant needs the person's explicit consent to the approved text version (HDS_SHARE_CONSENT_VERSION), may carry an
 *   expiry date, is refused after it; a referral proposes a PENDING grant that only the person activates. Every access is a content-free access_event.
 */
import crypto from 'node:crypto';
import { pgBlobStore } from './db.js';
import { sha256 } from './envelope.js';
import {
  B64, DOSSIER_MAX_CONTENT, DOSSIER_MAX_FILES, GCM_TAG, STRUCTURE, UUID, actorRef, boxBytes, bytesBox, checkBox, checkFileBoxes, event, fail, notFound,
  readContent, serverKeep, serverLayer, serverOpen, tx as rawTx, vaultList,
} from './service.js';

/** @typedef {import('./service.js').Principal} Principal */
/** @typedef {import('./service.js').Ctx} Ctx */
/** @typedef {import('./service.js').Out} Out */

export const MESSAGE_MAX_PLAIN = 8000;
export const THREAD_LIMIT = 200;
export const ATTACHMENT_MAX_FILE = 3 * 1024 * 1024;
export const PRO_EVENTS = Object.freeze(['DOSSIER_EXPORTED', 'ATTESTATION_PRINTED', 'SIAO_HANDOVER_PREPARED', 'DOSSIER_PRINTED']);
const B64URL = /^[A-Za-z0-9_-]{43}$/;
const KID = /^[A-Za-z0-9_-]{4,40}$/;
const MEMBER = /^[A-Za-z0-9_.:-]{1,128}$/;
const BINDING = /^rdvconv:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_.-]{1,64}):([A-Za-z0-9_-]{1,64})$/;

/** a transaction whose body may ABORT with an answer: everything written before is rolled back @template T @param {import('pg').Pool} pool @param {(c: import('pg').PoolClient) => Promise<T>} fn */
async function tx(pool, fn) {
  try { return await rawTx(pool, fn); } catch (e) { if (e && typeof e === 'object' && 'abortWith' in e) return /** @type {any} */ (e).abortWith; throw e; }
}
/** @param {Out} out @returns {never} */
const abort = (out) => { throw { abortWith: out }; };

// ───────────── formats
/** an EC P-256 public JWK { kty, crv, x, y } (nothing else), checked by the crypto library @param {unknown} v @returns {string | null} canonical JSON */
export function checkPublicJwk(v) {
  const j = /** @type {any} */ (v);
  if (!j || typeof j !== 'object' || j.kty !== 'EC' || j.crv !== 'P-256' || !B64URL.test(String(j.x)) || !B64URL.test(String(j.y)) || 'd' in j) return null;
  try {
    const k = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }, format: 'jwk' });
    if (k.asymmetricKeyType !== 'ec') return null;
  } catch { return null; }
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: j.x, y: j.y });
}

/** an ECIES envelope { v: 1, kid?, epk: <public JWK>, iv, ct } of at most maxPlain bytes @param {unknown} v @param {number} maxPlain */
export function checkEnvelope(v, maxPlain) {
  const e = /** @type {any} */ (v);
  if (!e || typeof e !== 'object' || Array.isArray(e) || e.v !== 1 || Object.keys(e).some((k) => !['v', 'kid', 'epk', 'iv', 'ct'].includes(k))) return null;
  if (e.kid !== undefined && !KID.test(String(e.kid))) return null;
  const epk = checkPublicJwk(e.epk);
  const box = checkBox({ iv: e.iv, ct: e.ct }, maxPlain);
  if (!epk || !box) return null;
  return { v: 1, ...(e.kid !== undefined ? { kid: String(e.kid) } : {}), epk: JSON.parse(epk), iv: box.iv, ct: box.ct };
}

/** a member keyring { v, kdf, iterations, salt, wrapped (the private JWK, ≤ 512 bytes), verifier } @param {unknown} v @param {number} minIter */
function checkMemberKeyring(v, minIter) {
  const k = /** @type {any} */ (v);
  if (!k || typeof k !== 'object' || k.v !== 1 || k.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(k.iterations) || k.iterations < minIter || k.iterations > 10000000) return null;
  if (typeof k.salt !== 'string' || !B64.test(k.salt) || Buffer.from(k.salt, 'base64').length !== 16) return null;
  const wrapped = checkBox(k.wrapped, 512); const verifier = checkBox(k.verifier, 128);
  return wrapped && verifier ? { v: 1, kdf: 'PBKDF2-SHA256', iterations: k.iterations, salt: k.salt, wrapped, verifier } : null;
}

/** a thread message / referral note: { dek (the message key wrapped by the dossier key), body } @param {unknown} v */
function checkMessageBoxes(v) {
  const m = /** @type {any} */ (v);
  const dek = checkBox(m?.dek, 64); const body = checkBox(m?.body, MESSAGE_MAX_PLAIN);
  return dek && body ? { dek, body } : null;
}

/** @param {unknown} v @returns {Date | null | undefined} undefined = invalid */
function optionalFuture(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return undefined;
  return d;
}

/** @param {Ctx} ctx @param {any} input */
function consentOk(ctx, input) {
  return Boolean(ctx.cfg.shareConsentVersion) && input?.consent?.explicit === true && input?.consent?.version === ctx.cfg.shareConsentVersion;
}
const consentRefusal = (/** @type {Ctx} */ ctx) => (ctx.cfg.shareConsentVersion
  ? fail(400, 'SHARE_CONSENT_REQUIRED', 'Votre accord explicite au texte de partage en vigueur est nécessaire.')
  : fail(422, 'SHARE_CONSENT_NOT_CONFIGURED', 'Le texte d’accord au partage n’est pas encore approuvé : le partage reste fermé.'));

const aadDossier = (/** @type {string} */ owner, /** @type {string} */ id) => `dossier:${owner}:${id}`;
const aadFile = (/** @type {string} */ dossierId, /** @type {string} */ fileId) => `dossier-file:${dossierId}:${fileId}`;
const aadMessage = (/** @type {string} */ dossierId, /** @type {string} */ id) => `dossier-message:${dossierId}:${id}`;
const aadAttachment = (/** @type {string} */ binding, /** @type {string} */ id) => `attachment:${binding}:${id}`;
const aadMember = (/** @type {string} */ member) => `member-keyring:${member}`;

// ───────────── reachability
const LIVE_DOSSIER = '(d.expires_at IS NULL OR d.expires_at > now())';
const LIVE_GRANT = "g.status = 'active' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())";

/**
 * the dossier, when the principal may see it: its owner; or a professional of a structure holding an ACTIVE, unexpired grant of an unexpired dossier
 * @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} [q]
 */
export async function reachableDossier(ctx, p, id, q = ctx.pool) {
  if (!UUID.test(id)) return null;
  if (p.typ === 'citizen') {
    const d = (await q.query('SELECT * FROM hds.dossier WHERE id = $1 AND owner_id = $2', [id, p.sub])).rows[0];
    return d ? { d, role: /** @type {'owner'} */ ('owner'), grant: null } : null;
  }
  if (p.typ === 'pro' && p.str) {
    const r = (await q.query(`SELECT d.*, g.wrapped_key AS g_wrapped, g.key_epoch AS g_epoch, g.expires_at AS g_expires, g.purposes AS g_purposes
      FROM hds.dossier d JOIN hds.dossier_grant g ON g.dossier_id = d.id AND g.structure_id = $2 WHERE d.id = $1 AND ${LIVE_GRANT} AND ${LIVE_DOSSIER}`, [id, p.str])).rows[0];
    return r ? { d: r, role: /** @type {'grantee'} */ ('grantee'), grant: { wrapped_key: r.g_wrapped, key_epoch: r.g_epoch, expires_at: r.g_expires, purposes: r.g_purposes } } : null;
  }
  return null;
}
/** a grant whose wrapped key predates the current dossier key is unusable: the owner must re-key first */
const rekeyPending = async (/** @type {any} */ q, /** @type {string} */ id, /** @type {number} */ epoch) => (await q.query(
  "SELECT 1 FROM hds.dossier_grant WHERE dossier_id = $1 AND status = 'active' AND key_epoch <> $2 LIMIT 1", [id, epoch])).rowCount > 0
  || (await q.query("SELECT 1 FROM hds.access_event WHERE object_id = $1 AND action = 'DOSSIER_REKEY_REQUIRED' AND at > coalesce((SELECT max(at) FROM hds.access_event WHERE object_id = $1 AND action = 'DOSSIER_REKEYED'), 'epoch') LIMIT 1", [id])).rowCount > 0;

// ───────────── dossiers (owner side)
/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function dossierCreate(ctx, p, input) {
  const content = checkBox(input?.content, DOSSIER_MAX_CONTENT);
  if (!content) return fail(400, 'INVALID_CONTENT', 'Contenu chiffré du dossier manquant ou trop volumineux.');
  const ownerKey = input?.ownerKey === undefined ? null : checkBox(input.ownerKey, 64);
  if (input?.ownerKey !== undefined && !ownerKey) return fail(400, 'INVALID_ENVELOPE', 'Clé chiffrée du dossier invalide.');
  const kind = input?.kind === 'passport' ? 'passport' : 'dossier';
  const expiresAt = optionalFuture(input?.expiresAt);
  if (expiresAt === undefined) return fail(400, 'INVALID_DATE', 'Date de fin invalide (elle doit être future).');
  const id = crypto.randomUUID(); const L = serverLayer(ctx, aadDossier(p.sub, id));
  return tx(ctx.pool, async (c) => {
    await c.query('INSERT INTO hds.dossier (id, owner_id, kek_id, dek_wrapped, content_sealed, owner_key, kind, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, p.sub, L.kekId, L.wrapped, L.seal(boxBytes(content), 'content'), ownerKey ? JSON.stringify(ownerKey) : null, kind, expiresAt]);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_CREATED', objectType: 'dossier', objectId: id });
    return { status: 201, body: { id, keyEpoch: 1 } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} owner: replace the encrypted content (same dossier key) */
export async function dossierUpdate(ctx, p, id, input) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  const content = checkBox(input?.content, DOSSIER_MAX_CONTENT);
  if (!content || input?.keyEpoch !== hit.d.key_epoch) return fail(400, 'INVALID_CONTENT', 'Contenu chiffré invalide ou clé périmée.');
  const L = serverLayer(ctx, aadDossier(p.sub, id));
  return tx(ctx.pool, async (c) => {
    await c.query('UPDATE hds.dossier SET kek_id = $2, dek_wrapped = $3, content_sealed = $4, updated_at = now() WHERE id = $1', [id, L.kekId, L.wrapped, L.seal(boxBytes(content), 'content')]);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_UPDATED', objectType: 'dossier', objectId: id });
    return { status: 200, body: { id } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} */
export async function dossierListOwn(ctx, p) {
  const rows = (await ctx.pool.query(`SELECT d.id, d.kind, d.key_epoch, d.expires_at, d.created_at, d.updated_at, coalesce(json_agg(json_build_object('structureId', g.structure_id,
      'status', g.status, 'source', g.source, 'referralRef', g.referral_ref, 'proposedBy', g.proposed_by_structure, 'grantedAt', g.granted_at, 'revokedAt', g.revoked_at,
      'expiresAt', g.expires_at, 'keyEpoch', g.key_epoch)) FILTER (WHERE g.structure_id IS NOT NULL), '[]') AS grants
    FROM hds.dossier d LEFT JOIN hds.dossier_grant g ON g.dossier_id = d.id WHERE d.owner_id = $1 GROUP BY d.id ORDER BY d.created_at DESC`, [p.sub])).rows;
  return { status: 200, body: { shareConsentVersion: ctx.cfg.shareConsentVersion || null, dossiers: rows.map((r) => ({ id: r.id, kind: r.kind, keyEpoch: r.key_epoch, expiresAt: r.expires_at, createdAt: r.created_at, updatedAt: r.updated_at,
    expired: Boolean(r.expires_at && new Date(r.expires_at).getTime() <= Date.now()), grants: r.grants,
    rekeyRequired: r.grants.some((/** @type {any} */ g) => g.status === 'active' && g.keyEpoch !== r.key_epoch) })) } };
}

/** @param {Ctx} ctx @param {any} f */
function fileView(ctx, f) {
  const boxes = JSON.parse(serverOpen(ctx, f, aadFile(f.dossier_id, f.id))(f.boxes_sealed, 'boxes').toString('utf8'));
  return { id: f.id, meta: boxes.meta, dek: boxes.dek, byteLength: f.byte_length, addedBy: f.added_by, structureId: f.structure_id, keyEpoch: f.key_epoch, createdAt: f.created_at };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function dossierGet(ctx, p, id) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit) return notFound();
  const { d } = hit;
  const content = bytesBox(serverOpen(ctx, d, aadDossier(d.owner_id, d.id))(d.content_sealed, 'content'));
  const files = (await ctx.pool.query('SELECT * FROM hds.dossier_file WHERE dossier_id = $1 ORDER BY created_at', [d.id])).rows
    .filter((f) => hit.role === 'owner' || f.structure_id === null || f.structure_id === p.str)
    .map((f) => fileView(ctx, f));
  const base = { id: d.id, kind: d.kind, keyEpoch: d.key_epoch, expiresAt: d.expires_at, content, files };
  if (hit.role === 'grantee') {
    const g = /** @type {any} */ (hit.grant);
    if (g.key_epoch !== d.key_epoch) return fail(409, 'REKEY_PENDING', 'Ce dossier est en cours de re-chiffrement par la personne : réessayez plus tard.');
    await event(ctx, ctx.pool, { owner: d.owner_id, actor: p, action: 'DOSSIER_VIEWED', objectType: 'dossier', objectId: d.id, structureId: p.str });
    return { status: 200, body: { ...base, wrappedKey: g.wrapped_key ? JSON.parse(Buffer.from(g.wrapped_key).toString('utf8')) : null, grantExpiresAt: g.expires_at, purposes: g.purposes } };
  }
  const grants = (await ctx.pool.query('SELECT structure_id, status, source, referral_ref, proposed_by_structure, granted_at, revoked_at, expires_at, key_epoch FROM hds.dossier_grant WHERE dossier_id = $1 ORDER BY granted_at', [d.id])).rows
    .map((g) => ({ structureId: g.structure_id, status: g.status, source: g.source, referralRef: g.referral_ref, proposedBy: g.proposed_by_structure, grantedAt: g.granted_at, revokedAt: g.revoked_at, expiresAt: g.expires_at, keyEpoch: g.key_epoch }));
  return { status: 200, body: { ...base, ownerKey: d.owner_key ? JSON.parse(d.owner_key) : null, grants, rekeyRequired: await rekeyPending(ctx.pool, d.id, d.key_epoch) } };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function dossierDelete(ctx, p, id) {
  if (p.typ !== 'citizen' || !UUID.test(id)) return notFound();
  return tx(ctx.pool, async (c) => {
    const blobs = (await c.query('SELECT f.blob_id FROM hds.dossier_file f JOIN hds.dossier d ON d.id = f.dossier_id WHERE d.id = $1 AND d.owner_id = $2', [id, p.sub])).rows.map((r) => r.blob_id);
    const del = (await c.query('DELETE FROM hds.dossier WHERE id = $1 AND owner_id = $2 RETURNING id', [id, p.sub])).rows;
    if (!del.length) return notFound();
    await pgBlobStore(c).delete(blobs);
    await c.query("DELETE FROM hds.consent_record WHERE owner_id = $1 AND purpose = 'dossier_share' AND object_id = $2", [p.sub, id]);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_DELETED', objectType: 'dossier', objectId: id });
    return { status: 200, body: { deleted: true } };
  });
}

// ───────────── grants: consent, expiry, revocation, referral activation
/** @param {any} input @param {boolean} required */
function grantKey(input, required) {
  if (input?.wrappedKey === undefined) return required ? { ok: false } : { ok: true, value: null };
  const env = checkEnvelope(input.wrappedKey, 64);
  if (env) return { ok: true, value: env };
  const legacy = checkBox(input.wrappedKey, 512);   // R3 data-plane format, kept for continuity of the LAB rows
  return legacy && !required ? { ok: true, value: legacy } : { ok: false };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>} owner: share with an organisation (consent + wrapped key) */
export async function dossierGrant(ctx, p, id, input) {
  const structureId = String(input?.structureId || '');
  if (!STRUCTURE.test(structureId)) return fail(400, 'INVALID_STRUCTURE', 'Organisation inconnue.');
  const k = grantKey(input, true);
  if (!k.ok) return fail(400, 'INVALID_ENVELOPE', 'Clé chiffrée de l’organisation invalide.');
  if (!consentOk(ctx, input)) return consentRefusal(ctx);
  const expiresAt = optionalFuture(input?.expiresAt);
  if (expiresAt === undefined) return fail(400, 'INVALID_DATE', 'Date de fin invalide (elle doit être future).');
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  const kid = /** @type {any} */ (k.value)?.kid;
  const org = (await ctx.pool.query('SELECT kid FROM hds.org_key WHERE structure_id = $1 AND retired_at IS NULL', [structureId])).rows[0];
  if (!org) return fail(409, 'ORG_KEY_MISSING', 'Cette organisation ne peut pas encore recevoir de dossier chiffré (clé non créée).');
  if (kid !== org.kid) return fail(409, 'ORG_KEY_STALE', 'La clé de cette organisation a changé : rechargez la page.');
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dossier:${id}`]);
    const epoch = (await c.query('SELECT key_epoch FROM hds.dossier WHERE id = $1', [id])).rows[0].key_epoch;
    if (input?.keyEpoch !== epoch) return fail(409, 'KEY_EPOCH_STALE', 'Le dossier a été re-chiffré entre-temps : rechargez la page.');
    await c.query(`INSERT INTO hds.dossier_grant (dossier_id, structure_id, wrapped_key, status, source, expires_at, consent_version, key_epoch)
      VALUES ($1, $2, $3, 'active', 'citizen', $4, $5, $6)
      ON CONFLICT (dossier_id, structure_id) DO UPDATE SET status = 'active', source = 'citizen', revoked_at = NULL, granted_at = now(), wrapped_key = EXCLUDED.wrapped_key,
        expires_at = EXCLUDED.expires_at, consent_version = EXCLUDED.consent_version, key_epoch = EXCLUDED.key_epoch, purposes = 'PURP-06', referral_ref = NULL, proposed_by_structure = NULL`,
    [id, structureId, Buffer.from(JSON.stringify(k.value)), expiresAt, ctx.cfg.shareConsentVersion, epoch]);
    await c.query("INSERT INTO hds.consent_record (id, owner_id, purpose, text_version, object_id, structure_id) VALUES ($1, $2, 'dossier_share', $3, $4, $5)",
      [crypto.randomUUID(), p.sub, ctx.cfg.shareConsentVersion, id, structureId]);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_ACCESS_GRANTED', objectType: 'dossier', objectId: id, structureId });
    return { status: 200, body: { structureId, active: true, expiresAt } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>} owner: withdraw an organisation's access (then re-key) */
export async function dossierRevoke(ctx, p, id, input) {
  const structureId = String(input?.structureId || '');
  if (!STRUCTURE.test(structureId)) return fail(400, 'INVALID_STRUCTURE', 'Organisation inconnue.');
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  return tx(ctx.pool, async (c) => {
    const n = (await c.query("UPDATE hds.dossier_grant SET status = 'revoked', revoked_at = now(), wrapped_key = NULL WHERE dossier_id = $1 AND structure_id = $2 AND status IN ('active', 'pending_citizen')", [id, structureId])).rowCount;
    await c.query("UPDATE hds.consent_record SET withdrawn_at = now() WHERE owner_id = $1 AND purpose = 'dossier_share' AND object_id = $2 AND structure_id = $3 AND withdrawn_at IS NULL", [p.sub, id, structureId]);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_ACCESS_REVOKED', objectType: 'dossier', objectId: id, structureId });
    // the revoked organisation may hold the current dossier key: the owner's browser must re-key (signalled until DOSSIER_REKEYED)
    if (n) await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_REKEY_REQUIRED', objectType: 'dossier', objectId: id });
    return { status: 200, body: { structureId, active: false, rekeyRequired: n > 0, keyEpoch: hit.d.key_epoch } };
  });
}

/**
 * owner: ONE atomic re-key after a revocation. The browser sends the content under a NEW dossier key, the owner's copy of that key, a re-wrapped key box for
 * EVERY file and message, and a wrapped key for EVERY active grant (wrapped to the organisation's CURRENT key). Anything missing → refused, nothing changes.
 * @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>}
 */
export async function dossierRekey(ctx, p, id, input) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  const content = checkBox(input?.content, DOSSIER_MAX_CONTENT); const ownerKey = checkBox(input?.ownerKey, 64);
  if (!content || !ownerKey) return fail(400, 'INVALID_ENVELOPE', 'Re-chiffrement incomplet.');
  const files = Array.isArray(input?.files) ? input.files : []; const messages = Array.isArray(input?.messages) ? input.messages : []; const grants = Array.isArray(input?.grants) ? input.grants : [];
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dossier:${id}`]);
    const d = (await c.query('SELECT * FROM hds.dossier WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (input?.fromEpoch !== d.key_epoch) return fail(409, 'KEY_EPOCH_STALE', 'Le dossier a changé entre-temps : rechargez la page.');
    const fileRows = (await c.query('SELECT * FROM hds.dossier_file WHERE dossier_id = $1', [id])).rows;
    const msgRows = (await c.query('SELECT * FROM hds.dossier_message WHERE dossier_id = $1', [id])).rows;
    const grantRows = (await c.query("SELECT g.structure_id, o.kid FROM hds.dossier_grant g LEFT JOIN hds.org_key o ON o.structure_id = g.structure_id AND o.retired_at IS NULL WHERE g.dossier_id = $1 AND g.status IN ('active', 'pending_citizen')", [id])).rows;
    const byId = (/** @type {any[]} */ list) => new Map(list.map((x) => [String(x?.id ?? x?.structureId), x]));
    const fIn = byId(files); const mIn = byId(messages); const gIn = byId(grants);
    if (fIn.size !== fileRows.length || mIn.size !== msgRows.length || gIn.size !== grantRows.length) return fail(400, 'REKEY_INCOMPLETE', 'Chaque document, message et accès doit être re-chiffré.');
    const epoch = d.key_epoch + 1;
    for (const f of fileRows) {
      const dek = checkBox(fIn.get(f.id)?.dek, 64);
      if (!dek) abort(fail(400, 'REKEY_INCOMPLETE', 'Chaque document doit être re-chiffré.'));
      // the file BYTES keep their own file key (unchanged): only its wrapping by the dossier key changes (same server key, boxes re-sealed)
      const K = serverKeep(ctx, f, aadFile(id, f.id));
      const boxes = JSON.parse(K.open(f.boxes_sealed, 'boxes').toString('utf8'));
      await c.query('UPDATE hds.dossier_file SET boxes_sealed = $2, key_epoch = $3 WHERE id = $1', [f.id, K.seal(Buffer.from(JSON.stringify({ meta: boxes.meta, dek })), 'boxes'), epoch]);
    }
    for (const m of msgRows) {
      const dek = checkBox(mIn.get(m.id)?.dek, 64);
      if (!dek) abort(fail(400, 'REKEY_INCOMPLETE', 'Chaque message doit être re-chiffré.'));
      const K = serverKeep(ctx, m, aadMessage(id, m.id));
      const boxes = JSON.parse(K.open(m.body_sealed, 'body').toString('utf8'));
      await c.query('UPDATE hds.dossier_message SET body_sealed = $2, key_epoch = $3 WHERE id = $1', [m.id, K.seal(Buffer.from(JSON.stringify({ dek, body: boxes.body })), 'body'), epoch]);
    }
    for (const g of grantRows) {
      const env = checkEnvelope(gIn.get(g.structure_id)?.wrappedKey, 64);
      if (!env || !g.kid || env.kid !== g.kid) abort(fail(400, 'REKEY_INCOMPLETE', 'Chaque organisation qui garde l’accès doit recevoir la nouvelle clé (clé d’organisation à jour).'));
      await c.query('UPDATE hds.dossier_grant SET wrapped_key = $3, key_epoch = $4 WHERE dossier_id = $1 AND structure_id = $2', [id, g.structure_id, Buffer.from(JSON.stringify(env)), epoch]);
    }
    const L = serverLayer(ctx, aadDossier(d.owner_id, id));
    await c.query('UPDATE hds.dossier SET kek_id = $2, dek_wrapped = $3, content_sealed = $4, owner_key = $5, key_epoch = $6, updated_at = now() WHERE id = $1',
      [id, L.kekId, L.wrapped, L.seal(boxBytes(content), 'content'), JSON.stringify(ownerKey), epoch]);
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_REKEYED', objectType: 'dossier', objectId: id });
    return { status: 200, body: { id, keyEpoch: epoch } };
  });
}

/** owner: answer a referral's pending grant — activate (consent) or refuse @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @param {boolean} accept @returns {Promise<Out>} */
export async function dossierAnswerReferral(ctx, p, id, input, accept) {
  const structureId = String(input?.structureId || '');
  if (!STRUCTURE.test(structureId)) return fail(400, 'INVALID_STRUCTURE', 'Organisation inconnue.');
  if (accept && !consentOk(ctx, input)) return consentRefusal(ctx);
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  return tx(ctx.pool, async (c) => {
    const g = (await c.query("SELECT * FROM hds.dossier_grant WHERE dossier_id = $1 AND structure_id = $2 AND status = 'pending_citizen' FOR UPDATE", [id, structureId])).rows[0];
    if (!g) return fail(404, 'NO_PENDING_REFERRAL', 'Aucune proposition en attente pour cette organisation.');
    if (accept && g.key_epoch !== hit.d.key_epoch) return fail(409, 'REKEY_PENDING', 'La clé du dossier a changé depuis la proposition : demandez à la structure de la renouveler.');
    if (accept) {
      await c.query("UPDATE hds.dossier_grant SET status = 'active', granted_at = now(), consent_version = $3 WHERE dossier_id = $1 AND structure_id = $2", [id, structureId, ctx.cfg.shareConsentVersion]);
      await c.query("INSERT INTO hds.consent_record (id, owner_id, purpose, text_version, object_id, structure_id) VALUES ($1, $2, 'dossier_share', $3, $4, $5)",
        [crypto.randomUUID(), p.sub, ctx.cfg.shareConsentVersion, id, structureId]);
    } else {
      await c.query("UPDATE hds.dossier_grant SET status = 'refused', wrapped_key = NULL, revoked_at = now() WHERE dossier_id = $1 AND structure_id = $2", [id, structureId]);
      await c.query("DELETE FROM hds.dossier_message WHERE dossier_id = $1 AND structure_id = $2 AND kind = 'referral_note' AND referral_ref = $3", [id, structureId, g.referral_ref]);
    }
    await event(ctx, c, { owner: p.sub, actor: p, action: accept ? 'REFERRAL_ACCESS_ACCEPTED' : 'REFERRAL_ACCESS_REFUSED', objectType: 'dossier', objectId: id, structureId });
    return { status: 200, body: { structureId, status: accept ? 'active' : 'refused', referralRef: g.referral_ref } };
  });
}

// ───────────── files
/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>} */
export async function dossierAddFile(ctx, p, id, input) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit) return notFound();
  const f = checkFileBoxes(input);
  if (!f.ok) return /** @type {Out} */ (f.out);
  if (input?.keyEpoch !== undefined && input.keyEpoch !== hit.d.key_epoch) return fail(409, 'KEY_EPOCH_STALE', 'Le dossier a été re-chiffré entre-temps : rechargez la page.');
  let structureId = null;
  if (hit.role === 'grantee') {
    if (/** @type {any} */ (hit.grant).key_epoch !== hit.d.key_epoch) return fail(409, 'REKEY_PENDING', 'Ce dossier est en cours de re-chiffrement par la personne.');
    structureId = /** @type {string} */ (p.str);
  } else if (input?.structureId) {
    structureId = String(input.structureId);
    const g = (await ctx.pool.query(`SELECT 1 FROM hds.dossier_grant g WHERE g.dossier_id = $1 AND g.structure_id = $2 AND ${LIVE_GRANT}`, [id, structureId])).rows[0];
    if (!g) return fail(404, 'NO_ACTIVE_GRANT', 'Cette organisation n’a pas accès à ce dossier.');
  }
  const fileId = crypto.randomUUID(); const L = serverLayer(ctx, aadFile(id, fileId));
  const bytes = /** @type {Buffer} */ (f.bytes);
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dossier:${id}`]);
    const n = (await c.query('SELECT count(*)::int AS n FROM hds.dossier_file WHERE dossier_id = $1', [id])).rows[0].n;
    if (n >= DOSSIER_MAX_FILES) return fail(409, 'QUOTA_FILES', 'Ce dossier contient déjà le nombre maximal de documents.');
    const blobId = crypto.randomUUID(); const sealed = L.seal(bytes, 'content');
    await pgBlobStore(c).put(blobId, sealed, sha256(sealed));
    await c.query(`INSERT INTO hds.dossier_file (id, dossier_id, structure_id, added_by, kek_id, dek_wrapped, boxes_sealed, byte_length, cipher_sha256, blob_id, key_epoch)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [fileId, id, structureId, hit.role === 'owner' ? 'citizen' : 'pro', L.kekId, L.wrapped, L.seal(/** @type {Buffer} */ (f.boxes), 'boxes'), bytes.length, sha256(bytes), blobId, hit.d.key_epoch]);
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
  const content = await readContent(ctx, f, aadFile(id, fileId), ctx.pool);
  if (!content) return fail(500, 'INTEGRITY_ERROR', 'Le document stocké est altéré.');
  if (hit.role === 'grantee') await event(ctx, ctx.pool, { owner: hit.d.owner_id, actor: p, action: 'DOSSIER_FILE_DOWNLOADED', objectType: 'dossier_file', objectId: fileId, structureId: p.str });
  return { status: 200, body: { id: fileId, content } };
}

/** owner: delete one file of the dossier @param {Ctx} ctx @param {Principal} p @param {string} id @param {string} fileId @returns {Promise<Out>} */
export async function dossierDeleteFile(ctx, p, id, fileId) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner' || !UUID.test(fileId)) return notFound();
  return tx(ctx.pool, async (c) => {
    const rows = (await c.query('DELETE FROM hds.dossier_file WHERE id = $1 AND dossier_id = $2 RETURNING blob_id', [fileId, id])).rows;
    if (!rows.length) return notFound();
    await pgBlobStore(c).delete(rows.map((r) => r.blob_id));
    await event(ctx, c, { owner: p.sub, actor: p, action: 'DOSSIER_FILE_DELETED', objectType: 'dossier_file', objectId: fileId });
    return { status: 200, body: { deleted: true } };
  });
}

// ───────────── thread (one per organisation) and professional events
/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {string} structureId @returns {Promise<Out>} */
export async function threadList(ctx, p, id, structureId) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || !STRUCTURE.test(structureId) || (hit.role === 'grantee' && structureId !== p.str)) return notFound();
  const rows = (await ctx.pool.query(`SELECT * FROM hds.dossier_message WHERE dossier_id = $1 AND structure_id = $2 ORDER BY created_at DESC LIMIT ${THREAD_LIMIT}`, [id, structureId])).rows.reverse();
  return { status: 200, body: { messages: rows.map((m) => {
    const b = JSON.parse(serverOpen(ctx, m, aadMessage(id, m.id))(m.body_sealed, 'body').toString('utf8'));
    return { id: m.id, author: m.author, kind: m.kind, referralRef: m.referral_ref, keyEpoch: m.key_epoch, dek: b.dek, body: b.body, createdAt: m.created_at };
  }) } };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {string} structureId @param {any} input @returns {Promise<Out>} */
export async function threadPost(ctx, p, id, structureId, input) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || !STRUCTURE.test(structureId) || (hit.role === 'grantee' && structureId !== p.str)) return notFound();
  if (hit.role === 'owner' && !(await ctx.pool.query(`SELECT 1 FROM hds.dossier_grant g WHERE g.dossier_id = $1 AND g.structure_id = $2 AND ${LIVE_GRANT}`, [id, structureId])).rowCount) return fail(404, 'NO_ACTIVE_GRANT', 'Cette organisation n’a pas accès à ce dossier.');
  const m = checkMessageBoxes(input);
  if (!m) return fail(400, 'INVALID_ENVELOPE', 'Message chiffré invalide (8 000 caractères au plus).');
  if (input?.keyEpoch !== hit.d.key_epoch) return fail(409, 'KEY_EPOCH_STALE', 'Le dossier a été re-chiffré entre-temps : rechargez la page.');
  const mid = crypto.randomUUID(); const L = serverLayer(ctx, aadMessage(id, mid));
  return tx(ctx.pool, async (c) => {
    const n = (await c.query('SELECT count(*)::int AS n FROM hds.dossier_message WHERE dossier_id = $1 AND structure_id = $2', [id, structureId])).rows[0].n;
    if (n >= 1000) return fail(409, 'QUOTA_MESSAGES', 'Cette conversation a atteint sa taille maximale.');
    await c.query(`INSERT INTO hds.dossier_message (id, dossier_id, structure_id, author, kind, key_epoch, kek_id, dek_wrapped, body_sealed) VALUES ($1, $2, $3, $4, 'message', $5, $6, $7, $8)`,
      [mid, id, structureId, hit.role === 'owner' ? 'citizen' : 'pro', hit.d.key_epoch, L.kekId, L.wrapped, L.seal(Buffer.from(JSON.stringify(m)), 'body')]);
    await event(ctx, c, { owner: hit.d.owner_id, actor: p, action: 'THREAD_MESSAGE_POSTED', objectType: 'dossier_message', objectId: mid, structureId });
    return { status: 201, body: { id: mid } };
  });
}

/** professional: record a content-free event the person sees (export, attestation, SIAO hand-over, print) @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>} */
export async function dossierProEvent(ctx, p, id, input) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'grantee') return notFound();
  const action = String(input?.action || '');
  if (!PRO_EVENTS.includes(action)) return fail(400, 'INVALID_ACTION', 'Action inconnue.');
  await event(ctx, ctx.pool, { owner: hit.d.owner_id, actor: p, action, objectType: 'dossier', objectId: id, structureId: p.str });
  return { status: 201, body: { recorded: action } };
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function dossierAccessLog(ctx, p, id) {
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'owner') return notFound();
  const rows = (await ctx.pool.query(`SELECT action, at, actor_type, structure_id FROM hds.access_event WHERE owner_id = $1 AND object_id IN (SELECT $2::uuid UNION SELECT id FROM hds.dossier_file WHERE dossier_id = $2
    UNION SELECT id FROM hds.dossier_message WHERE dossier_id = $2) ORDER BY at DESC LIMIT 200`, [p.sub, id])).rows;
  return { status: 200, body: { events: rows.map((r) => ({ action: r.action, at: r.at, actorType: r.actor_type, structureId: r.structure_id })) } };
}

// ───────────── professional side: dossiers of my organisation, my key, my organisation's keys
/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} */
export async function proDossiers(ctx, p) {
  const rows = (await ctx.pool.query(`SELECT d.id, d.kind, d.key_epoch, d.updated_at, g.granted_at, g.expires_at, g.source, g.referral_ref, g.key_epoch AS g_epoch, g.purposes
    FROM hds.dossier_grant g JOIN hds.dossier d ON d.id = g.dossier_id WHERE g.structure_id = $1 AND ${LIVE_GRANT} AND ${LIVE_DOSSIER} ORDER BY g.granted_at DESC LIMIT 500`, [p.str])).rows;
  return { status: 200, body: { dossiers: rows.map((r) => ({ id: r.id, kind: r.kind, updatedAt: r.updated_at, grantedAt: r.granted_at, expiresAt: r.expires_at, source: r.source,
    referralRef: r.referral_ref, purposes: r.purposes, rekeyPending: r.g_epoch !== r.key_epoch })) } };
}

/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} a professional's own key pair (private half wrapped by their passphrase) */
export async function memberKeySet(ctx, p, input) {
  const publicJwk = checkPublicJwk(input?.publicJwk);
  const keyring = checkMemberKeyring(input?.keyring, 600000);
  if (!publicJwk || !keyring || !MEMBER.test(p.sub)) return fail(400, 'INVALID_KEYRING', 'Clé personnelle invalide.');
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`member:${p.sub}`]);
    const prev = (await c.query('SELECT public_jwk FROM hds.member_key WHERE member_id = $1', [p.sub])).rows[0];
    if (prev && input?.replace !== true) return fail(409, 'KEYRING_EXISTS', 'Votre clé personnelle existe déjà.');
    const L = serverLayer(ctx, aadMember(p.sub));
    await c.query(`INSERT INTO hds.member_key (member_id, structure_id, public_jwk, keyring_sealed, kek_id, dek_wrapped) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (member_id) DO UPDATE SET structure_id = EXCLUDED.structure_id, public_jwk = EXCLUDED.public_jwk, keyring_sealed = EXCLUDED.keyring_sealed, kek_id = EXCLUDED.kek_id, dek_wrapped = EXCLUDED.dek_wrapped, updated_at = now()`,
    [p.sub, p.str, publicJwk, L.seal(Buffer.from(JSON.stringify(keyring)), 'keyring'), L.kekId, L.wrapped]);
    // a NEW key pair (forgotten passphrase) makes the old organisation wraps useless: they are dropped, an administrator wraps again
    if (prev && prev.public_jwk !== publicJwk) await c.query('DELETE FROM hds.org_key_member WHERE member_id = $1', [p.sub]);
    await event(ctx, c, { owner: `org:${p.str}`, actor: p, action: prev ? 'MEMBER_KEY_REPLACED' : 'MEMBER_KEY_CREATED', objectType: 'member_key', structureId: p.str });
    return { status: prev ? 200 : 201, body: { publicJwk: JSON.parse(publicJwk) } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} my key, my organisation's keys with MY wraps, and (administrators) the members still to wrap */
export async function orgKeysState(ctx, p) {
  const mine = (await ctx.pool.query('SELECT * FROM hds.member_key WHERE member_id = $1 AND structure_id = $2', [p.sub, p.str])).rows[0];
  const keyring = mine ? JSON.parse(serverOpen(ctx, mine, aadMember(p.sub))(mine.keyring_sealed, 'keyring').toString('utf8')) : null;
  const keys = (await ctx.pool.query(`SELECT k.kid, k.public_jwk, k.retired_at, k.created_at, m.wrapped_private FROM hds.org_key k
    LEFT JOIN hds.org_key_member m ON m.structure_id = k.structure_id AND m.kid = k.kid AND m.member_id = $2 WHERE k.structure_id = $1 ORDER BY k.created_at DESC`, [p.str, p.sub])).rows;
  const body = { memberRef: p.sub, structureId: p.str, role: p.role === 'STRUCTURE_ADMIN' ? 'STRUCTURE_ADMIN' : 'PRO', member: mine ? { publicJwk: JSON.parse(mine.public_jwk), keyring } : null,
    orgKeys: keys.map((k) => ({ kid: k.kid, publicJwk: JSON.parse(k.public_jwk), active: !k.retired_at, createdAt: k.created_at, wrappedPrivate: k.wrapped_private ? JSON.parse(k.wrapped_private) : null })),
    pendingMembers: /** @type {any[]} */ ([]) };
  if (p.role === 'STRUCTURE_ADMIN') {
    body.pendingMembers = (await ctx.pool.query(`SELECT m.member_id, m.public_jwk FROM hds.member_key m WHERE m.structure_id = $1 AND EXISTS (SELECT 1 FROM hds.org_key k WHERE k.structure_id = $1)
      AND NOT EXISTS (SELECT 1 FROM hds.org_key_member w JOIN hds.org_key k ON k.structure_id = w.structure_id AND k.kid = w.kid AND k.retired_at IS NULL WHERE w.structure_id = $1 AND w.member_id = m.member_id)`, [p.str])).rows
      .map((r) => ({ memberRef: r.member_id, publicJwk: JSON.parse(r.public_jwk) }));
  }
  return { status: 200, body };
}

/**
 * administrator: create (or rotate to) a new organisation key. The browser generated the pair, wrapped its private half for itself and for every member it
 * chose (ECIES to their public keys), and — on a rotation — re-wrapped the RETIRED private keys for those members too (so older grants stay readable by the
 * team that remains; a removed member is simply not re-wrapped).
 * @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>}
 */
export async function orgKeyCreate(ctx, p, input) {
  if (p.role !== 'STRUCTURE_ADMIN') return fail(403, 'ADMIN_ONLY', 'Réservé à l’administrateur de la structure.');
  const kid = String(input?.kid || ''); const publicJwk = checkPublicJwk(input?.publicJwk);
  if (!KID.test(kid) || !publicJwk) return fail(400, 'INVALID_KEY', 'Clé d’organisation invalide.');
  const wraps = Array.isArray(input?.wraps) ? input.wraps : [];
  const parsed = [];
  for (const w of wraps) {
    const env = checkEnvelope(w?.wrappedPrivate, 512); const member = String(w?.memberRef || ''); const forKid = String(w?.kid || kid);
    if (!env || !MEMBER.test(member) || !KID.test(forKid)) return fail(400, 'INVALID_ENVELOPE', 'Clé chiffrée d’un membre invalide.');
    parsed.push({ member, forKid, env });
  }
  if (!parsed.some((w) => w.member === p.sub && w.forKid === kid)) return fail(400, 'SELF_WRAP_REQUIRED', 'La nouvelle clé doit aussi être chiffrée pour vous.');
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`org:${p.str}`]);
    if ((await c.query('SELECT 1 FROM hds.org_key WHERE structure_id = $1 AND kid = $2', [p.str, kid])).rowCount) return fail(409, 'KID_EXISTS', 'Identifiant de clé déjà utilisé.');
    const members = new Set((await c.query('SELECT member_id FROM hds.member_key WHERE structure_id = $1', [p.str])).rows.map((r) => r.member_id));
    if (parsed.some((w) => !members.has(w.member))) return fail(400, 'UNKNOWN_MEMBER', 'Un membre n’a pas encore créé sa clé personnelle.');
    const rotated = (await c.query('UPDATE hds.org_key SET retired_at = now() WHERE structure_id = $1 AND retired_at IS NULL RETURNING kid', [p.str])).rowCount > 0;
    await c.query('INSERT INTO hds.org_key (structure_id, kid, public_jwk, created_by_ref) VALUES ($1, $2, $3, $4)', [p.str, kid, publicJwk, actorRef(p.sub)]);
    if (rotated) await c.query('DELETE FROM hds.org_key_member WHERE structure_id = $1', [p.str]);   // a rotation re-issues every wrap: whoever is left out loses access
    for (const w of parsed) {
      if (!(await c.query('SELECT 1 FROM hds.org_key WHERE structure_id = $1 AND kid = $2', [p.str, w.forKid])).rowCount) abort(fail(400, 'UNKNOWN_KID', 'Clé d’organisation inconnue.'));
      await c.query('INSERT INTO hds.org_key_member (structure_id, kid, member_id, wrapped_private) VALUES ($1, $2, $3, $4) ON CONFLICT (structure_id, kid, member_id) DO UPDATE SET wrapped_private = EXCLUDED.wrapped_private',
        [p.str, w.forKid, w.member, JSON.stringify(w.env)]);
    }
    await event(ctx, c, { owner: `org:${p.str}`, actor: p, action: rotated ? 'ORG_KEY_ROTATED' : 'ORG_KEY_CREATED', objectType: 'org_key', structureId: p.str });
    return { status: 201, body: { kid, rotated } };
  });
}

/** administrator: give a member access to the organisation keys (wraps made in the browser) @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function orgKeyAddMember(ctx, p, input) {
  if (p.role !== 'STRUCTURE_ADMIN') return fail(403, 'ADMIN_ONLY', 'Réservé à l’administrateur de la structure.');
  const member = String(input?.memberRef || '');
  const wraps = Array.isArray(input?.wraps) ? input.wraps : [];
  if (!MEMBER.test(member) || !wraps.length) return fail(400, 'INVALID_ENVELOPE', 'Clé chiffrée du membre invalide.');
  return tx(ctx.pool, async (c) => {
    if (!(await c.query('SELECT 1 FROM hds.member_key WHERE member_id = $1 AND structure_id = $2', [member, p.str])).rowCount) return fail(404, 'UNKNOWN_MEMBER', 'Ce membre n’a pas encore créé sa clé personnelle.');
    for (const w of wraps) {
      const env = checkEnvelope(w?.wrappedPrivate, 512); const kid = String(w?.kid || '');
      if (!env || !(await c.query('SELECT 1 FROM hds.org_key WHERE structure_id = $1 AND kid = $2', [p.str, kid])).rowCount) abort(fail(400, 'INVALID_ENVELOPE', 'Clé chiffrée du membre invalide.'));
      await c.query('INSERT INTO hds.org_key_member (structure_id, kid, member_id, wrapped_private) VALUES ($1, $2, $3, $4) ON CONFLICT (structure_id, kid, member_id) DO UPDATE SET wrapped_private = EXCLUDED.wrapped_private',
        [p.str, kid, member, JSON.stringify(env)]);
    }
    await event(ctx, c, { owner: `org:${p.str}`, actor: p, action: 'ORG_KEY_MEMBER_ADDED', objectType: 'org_key', structureId: p.str });
    return { status: 200, body: { memberRef: member } };
  });
}

/** administrator: withdraw a member's wraps (then ROTATE: the member may have kept the private key) @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function orgKeyRemoveMember(ctx, p, input) {
  if (p.role !== 'STRUCTURE_ADMIN') return fail(403, 'ADMIN_ONLY', 'Réservé à l’administrateur de la structure.');
  const member = String(input?.memberRef || '');
  if (!MEMBER.test(member) || member === p.sub) return fail(400, 'INVALID_MEMBER', 'Membre invalide.');
  return tx(ctx.pool, async (c) => {
    await c.query('DELETE FROM hds.org_key_member WHERE structure_id = $1 AND member_id = $2', [p.str, member]);
    await c.query('DELETE FROM hds.member_key WHERE structure_id = $1 AND member_id = $2', [p.str, member]);
    await event(ctx, c, { owner: `org:${p.str}`, actor: p, action: 'ORG_KEY_MEMBER_REMOVED', objectType: 'org_key', structureId: p.str });
    return { status: 200, body: { memberRef: member, rotateRecommended: true } };
  });
}

/** citizen or professional: the ACTIVE public key of an organisation (to wrap a dossier key, an attachment key) @param {Ctx} ctx @param {string} structureId @returns {Promise<Out>} */
export async function orgPublicKey(ctx, structureId) {
  if (!STRUCTURE.test(structureId)) return notFound();
  const k = (await ctx.pool.query('SELECT kid, public_jwk FROM hds.org_key WHERE structure_id = $1 AND retired_at IS NULL', [structureId])).rows[0];
  if (!k) return fail(404, 'ORG_KEY_MISSING', 'Cette organisation ne peut pas encore recevoir de document chiffré (clé non créée).');
  return { status: 200, body: { structureId, kid: k.kid, publicJwk: JSON.parse(k.public_jwk) } };
}

// ───────────── citizen box key (so an organisation can encrypt FOR the person)
/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function boxKeySet(ctx, p, input) {
  const publicJwk = checkPublicJwk(input?.publicJwk); const priv = checkBox(input?.privateWrapped, 512);
  if (!publicJwk || !priv) return fail(400, 'INVALID_KEY', 'Clé de réception invalide.');
  const prev = (await ctx.pool.query('SELECT 1 FROM hds.citizen_box_key WHERE owner_id = $1', [p.sub])).rowCount;
  if (prev && input?.replace !== true) return fail(409, 'BOX_KEY_EXISTS', 'Votre clé de réception existe déjà.');
  await ctx.pool.query(`INSERT INTO hds.citizen_box_key (owner_id, public_jwk, private_wrapped) VALUES ($1, $2, $3)
    ON CONFLICT (owner_id) DO UPDATE SET public_jwk = EXCLUDED.public_jwk, private_wrapped = EXCLUDED.private_wrapped, created_at = now()`, [p.sub, publicJwk, JSON.stringify(priv)]);
  await event(ctx, ctx.pool, { owner: p.sub, actor: p, action: prev ? 'BOX_KEY_REPLACED' : 'BOX_KEY_CREATED', objectType: 'box_key' });
  return { status: prev ? 200 : 201, body: { publicJwk: JSON.parse(publicJwk) } };
}
/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} */
export async function boxKeyGet(ctx, p) {
  const r = (await ctx.pool.query('SELECT public_jwk, private_wrapped FROM hds.citizen_box_key WHERE owner_id = $1', [p.sub])).rows[0];
  return { status: 200, body: { boxKey: r ? { publicJwk: JSON.parse(r.public_jwk), privateWrapped: JSON.parse(r.private_wrapped) } : null } };
}

// ───────────── referral payload (pro.referrals): the sender wraps the dossier key for the receiver; the PERSON activates it
/** @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>} */
export async function referralPropose(ctx, p, id, input) {
  const toStructureId = String(input?.toStructureId || ''); const referralRef = String(input?.referralRef || '');
  if (!STRUCTURE.test(toStructureId) || toStructureId === p.str || !/^[A-Za-z0-9-]{8,80}$/.test(referralRef)) return fail(400, 'INVALID_REFERRAL', 'Orientation invalide.');
  const env = checkEnvelope(input?.wrappedKey, 64);
  if (!env) return fail(400, 'INVALID_ENVELOPE', 'Clé chiffrée de l’organisation destinataire invalide.');
  const note = input?.note === undefined ? null : checkMessageBoxes(input.note);
  if (input?.note !== undefined && !note) return fail(400, 'INVALID_ENVELOPE', 'Note chiffrée invalide.');
  const hit = await reachableDossier(ctx, p, id);
  if (!hit || hit.role !== 'grantee') return notFound();
  if (/** @type {any} */ (hit.grant).key_epoch !== hit.d.key_epoch || input?.keyEpoch !== hit.d.key_epoch) return fail(409, 'REKEY_PENDING', 'Ce dossier est en cours de re-chiffrement par la personne.');
  const org = (await ctx.pool.query('SELECT kid FROM hds.org_key WHERE structure_id = $1 AND retired_at IS NULL', [toStructureId])).rows[0];
  if (!org || env.kid !== org.kid) return fail(409, 'ORG_KEY_MISSING', 'L’organisation destinataire ne peut pas encore recevoir de dossier chiffré.');
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dossier:${id}`]);
    const existing = (await c.query('SELECT status FROM hds.dossier_grant WHERE dossier_id = $1 AND structure_id = $2', [id, toStructureId])).rows[0];
    if (existing && ['active', 'pending_citizen'].includes(existing.status)) return fail(409, 'ALREADY_SHARED', 'Cette organisation a déjà accès ou une proposition est en attente.');
    await c.query(`INSERT INTO hds.dossier_grant (dossier_id, structure_id, wrapped_key, status, source, referral_ref, proposed_by_structure, key_epoch, revoked_at)
      VALUES ($1, $2, $3, 'pending_citizen', 'referral', $4, $5, $6, NULL)
      ON CONFLICT (dossier_id, structure_id) DO UPDATE SET wrapped_key = EXCLUDED.wrapped_key, status = 'pending_citizen', source = 'referral', referral_ref = EXCLUDED.referral_ref,
        proposed_by_structure = EXCLUDED.proposed_by_structure, key_epoch = EXCLUDED.key_epoch, revoked_at = NULL, expires_at = NULL, purposes = 'PURP-06'`,
    [id, toStructureId, Buffer.from(JSON.stringify(env)), referralRef, p.str, hit.d.key_epoch]);
    if (note) {
      const mid = crypto.randomUUID(); const L = serverLayer(ctx, aadMessage(id, mid));
      await c.query(`INSERT INTO hds.dossier_message (id, dossier_id, structure_id, author, kind, referral_ref, key_epoch, kek_id, dek_wrapped, body_sealed) VALUES ($1, $2, $3, 'pro', 'referral_note', $4, $5, $6, $7, $8)`,
        [mid, id, toStructureId, referralRef, hit.d.key_epoch, L.kekId, L.wrapped, L.seal(Buffer.from(JSON.stringify(note)), 'body')]);
    }
    await event(ctx, c, { owner: hit.d.owner_id, actor: p, action: 'REFERRAL_ACCESS_PROPOSED', objectType: 'dossier', objectId: id, structureId: toStructureId });
    return { status: 201, body: { dossierId: id, toStructureId, status: 'pending_citizen' } };
  });
}

/** sender: withdraw ITS still-pending proposal (e.g. the main-side referral could not be created): the wrapped key and the note are erased
 * @param {Ctx} ctx @param {Principal} p @param {string} id @param {any} input @returns {Promise<Out>} */
export async function referralWithdraw(ctx, p, id, input) {
  const toStructureId = String(input?.toStructureId || '');
  if (!UUID.test(id) || !STRUCTURE.test(toStructureId)) return notFound();
  return tx(ctx.pool, async (c) => {
    const g = (await c.query("UPDATE hds.dossier_grant SET status = 'refused', wrapped_key = NULL, revoked_at = now() WHERE dossier_id = $1 AND structure_id = $2 AND status = 'pending_citizen' AND proposed_by_structure = $3 RETURNING referral_ref", [id, toStructureId, p.str])).rows[0];
    if (!g) return notFound();
    await c.query("DELETE FROM hds.dossier_message WHERE dossier_id = $1 AND structure_id = $2 AND kind = 'referral_note' AND referral_ref = $3", [id, toStructureId, g.referral_ref]);
    const owner = (await c.query('SELECT owner_id FROM hds.dossier WHERE id = $1', [id])).rows[0];
    await event(ctx, c, { owner: owner.owner_id, actor: p, action: 'REFERRAL_ACCESS_WITHDRAWN', objectType: 'dossier', objectId: id, structureId: toStructureId });
    return { status: 200, body: { withdrawn: true } };
  });
}

/**
 * system (main API): the content-free facts a referral needs on the main side — does `structureId` hold an active grant of dossier `dossierId`, whose
 * account owns it, and the grant state of `toStructureId`. Identifiers only.
 * @param {Ctx} ctx @param {any} input @returns {Promise<Out>}
 */
export async function internalDossierRef(ctx, input) {
  const dossierId = String(input?.dossierId || ''); const structureId = String(input?.structureId || ''); const to = input?.toStructureId ? String(input.toStructureId) : '';
  if (!UUID.test(dossierId) || !STRUCTURE.test(structureId) || (to && !STRUCTURE.test(to))) return fail(400, 'INVALID_INPUT', 'invalid');
  const d = (await ctx.pool.query(`SELECT d.owner_id, EXISTS (SELECT 1 FROM hds.dossier_grant g WHERE g.dossier_id = d.id AND g.structure_id = $2 AND ${LIVE_GRANT}) AS active,
      (SELECT g.status FROM hds.dossier_grant g WHERE g.dossier_id = d.id AND g.structure_id = $3) AS to_status FROM hds.dossier d WHERE d.id = $1 AND ${LIVE_DOSSIER}`, [dossierId, structureId, to || ''])).rows[0];
  if (!d) return { status: 200, body: { exists: false, active: false } };
  return { status: 200, body: { exists: true, active: Boolean(d.active), ownerId: d.owner_id, toStatus: to ? d.to_status || null : undefined } };
}

// ───────────── appointment-conversation attachments (messaging.attachments)
/** @param {Principal} p */
function bindingOf(p) {
  const m = BINDING.exec(String(p.obj || ''));
  if (!m) return null;
  const [, conversation, citizen, structure] = m;
  if (p.typ === 'citizen' && p.sub !== citizen) return null;
  if (p.typ === 'pro' && p.str !== structure) return null;
  return { binding: /** @type {string} */ (p.obj), conversation, citizen, structure };
}

/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} the two public keys an attachment must be wrapped for */
export async function attachmentKeys(ctx, p) {
  const b = bindingOf(p);
  if (!b) return fail(403, 'TICKET_SCOPE', 'Conversation non autorisée.');
  const cit = (await ctx.pool.query('SELECT public_jwk FROM hds.citizen_box_key WHERE owner_id = $1', [b.citizen])).rows[0];
  const org = (await ctx.pool.query('SELECT kid, public_jwk FROM hds.org_key WHERE structure_id = $1 AND retired_at IS NULL', [b.structure])).rows[0];
  return { status: 200, body: { citizen: cit ? { publicJwk: JSON.parse(cit.public_jwk) } : null, org: org ? { kid: org.kid, publicJwk: JSON.parse(org.public_jwk) } : null,
    ready: Boolean(cit && org) } };
}

/** @param {Ctx} ctx @param {Principal} p @param {any} input @returns {Promise<Out>} */
export async function attachmentUpload(ctx, p, input) {
  const b = bindingOf(p);
  if (!b) return fail(403, 'TICKET_SCOPE', 'Conversation non autorisée.');
  const rawCt = input?.content?.ct;
  if (typeof rawCt === 'string' && rawCt.length > Math.ceil((ATTACHMENT_MAX_FILE + GCM_TAG) * 4 / 3) + 4) return fail(413, 'FILE_TOO_LARGE', 'La pièce jointe dépasse 3 Mo.');
  const content = checkBox(input?.content, ATTACHMENT_MAX_FILE); const meta = checkBox(input?.meta, 2048);
  const keyCitizen = checkEnvelope(input?.keyCitizen, 64); const keyOrg = checkEnvelope(input?.keyOrg, 64);
  if (!content || !meta || !keyCitizen || !keyOrg) return fail(400, 'INVALID_ENVELOPE', 'Pièce jointe chiffrée incomplète.');
  const cit = (await ctx.pool.query('SELECT public_jwk FROM hds.citizen_box_key WHERE owner_id = $1', [b.citizen])).rows[0];
  const org = (await ctx.pool.query('SELECT kid FROM hds.org_key WHERE structure_id = $1 AND retired_at IS NULL', [b.structure])).rows[0];
  if (!cit || !org || keyOrg.kid !== org.kid) return fail(409, 'KEYS_NOT_READY', 'Les clés de chiffrement de la personne ou de la structure ne sont pas prêtes.');
  const id = crypto.randomUUID(); const L = serverLayer(ctx, aadAttachment(b.binding, id));
  const bytes = boxBytes(content);
  return tx(ctx.pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`att:${b.citizen}`]);
    const q = (await c.query('SELECT count(*)::int AS n, coalesce(sum(byte_length), 0)::bigint AS s FROM hds.message_attachment WHERE binding = $1', [b.binding])).rows[0];
    if (q.n >= 50 || Number(q.s) + bytes.length > 60 * 1024 * 1024) return fail(409, 'QUOTA', 'Cette conversation a atteint le nombre maximal de pièces jointes.');
    const blobId = crypto.randomUUID(); const sealed = L.seal(bytes, 'content');
    await pgBlobStore(c).put(blobId, sealed, sha256(sealed));
    await c.query(`INSERT INTO hds.message_attachment (id, binding, owner_id, structure_id, uploader, kek_id, dek_wrapped, boxes_sealed, byte_length, cipher_sha256, blob_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [id, b.binding, b.citizen, b.structure, p.typ, L.kekId, L.wrapped,
      L.seal(Buffer.from(JSON.stringify({ meta, keyCitizen, keyOrg })), 'boxes'), bytes.length, sha256(bytes), blobId]);
    await event(ctx, c, { owner: b.citizen, actor: p, action: 'ATTACHMENT_UPLOADED', objectType: 'message_attachment', objectId: id, structureId: b.structure });
    return { status: 201, body: { id, byteLength: bytes.length, sha256: sha256(bytes) } };
  });
}

/** @param {Ctx} ctx @param {Principal} p @param {string} id @returns {Promise<Out>} */
export async function attachmentDownload(ctx, p, id) {
  const b = bindingOf(p);
  if (!b || !UUID.test(id)) return notFound();
  const r = (await ctx.pool.query('SELECT * FROM hds.message_attachment WHERE id = $1 AND binding = $2', [id, b.binding])).rows[0];
  if (!r) return notFound();
  const boxes = JSON.parse(serverOpen(ctx, r, aadAttachment(b.binding, id))(r.boxes_sealed, 'boxes').toString('utf8'));
  const content = await readContent(ctx, r, aadAttachment(b.binding, id), ctx.pool);
  if (!content) return fail(500, 'INTEGRITY_ERROR', 'La pièce jointe stockée est altérée.');
  if (p.typ === 'pro') await event(ctx, ctx.pool, { owner: b.citizen, actor: p, action: 'ATTACHMENT_DOWNLOADED', objectType: 'message_attachment', objectId: id, structureId: b.structure });
  return { status: 200, body: { id, content, meta: boxes.meta, key: p.typ === 'citizen' ? boxes.keyCitizen : boxes.keyOrg } };
}

/** system (main API): erase the attachments of a conversation (erasure of the conversation) @param {Ctx} ctx @param {any} input @returns {Promise<Out>} */
export async function internalEraseBinding(ctx, input) {
  const binding = String(input?.binding || '');
  if (!BINDING.test(binding)) return fail(400, 'INVALID_INPUT', 'invalid');
  return tx(ctx.pool, async (c) => {
    const rows = (await c.query('DELETE FROM hds.message_attachment WHERE binding = $1 RETURNING blob_id', [binding])).rows;
    await pgBlobStore(c).delete(rows.map((r) => r.blob_id));
    return { status: 200, body: { attachments: rows.length } };
  });
}

// ───────────── export (art. 15 / 20): everything the person owns, as stored (ciphertext); the browser decrypts and saves it
/** @param {Ctx} ctx @param {Principal} p @returns {Promise<Out>} */
export async function exportOwn(ctx, p) {
  const vault = (await vaultList(ctx, p)).body;
  const dossiers = [];
  for (const d of (await ctx.pool.query('SELECT id FROM hds.dossier WHERE owner_id = $1 ORDER BY created_at', [p.sub])).rows) {
    const full = (await dossierGet(ctx, p, d.id)).body;
    const threads = [];
    for (const g of full.grants || []) threads.push({ structureId: g.structureId, messages: (await threadList(ctx, p, d.id, g.structureId)).body.messages });
    dossiers.push({ ...full, threads });
  }
  const box = (await boxKeyGet(ctx, p)).body.boxKey;
  const attachments = (await ctx.pool.query('SELECT id, binding, uploader, byte_length, created_at FROM hds.message_attachment WHERE owner_id = $1 ORDER BY created_at', [p.sub])).rows
    .map((r) => ({ id: r.id, conversation: BINDING.exec(r.binding)?.[1] || null, uploader: r.uploader, byteLength: r.byte_length, createdAt: r.created_at }));
  const consents = (await ctx.pool.query('SELECT purpose, text_version, object_id, structure_id, given_at, withdrawn_at FROM hds.consent_record WHERE owner_id = $1 ORDER BY given_at', [p.sub])).rows
    .map((r) => ({ purpose: r.purpose, version: r.text_version, dossierId: r.object_id, structureId: r.structure_id, givenAt: r.given_at, withdrawnAt: r.withdrawn_at }));
  const events = (await ctx.pool.query('SELECT action, at, actor_type, structure_id, object_type, object_id FROM hds.access_event WHERE owner_id = $1 ORDER BY at DESC LIMIT 2000', [p.sub])).rows
    .map((r) => ({ action: r.action, at: r.at, actorType: r.actor_type, structureId: r.structure_id, objectType: r.object_type, objectId: r.object_id }));
  await event(ctx, ctx.pool, { owner: p.sub, actor: p, action: 'HDS_EXPORT', objectType: 'export' });
  return { status: 200, body: { format: 'ada-hds-export/1', exportedAt: new Date().toISOString(), vault, boxKey: box, dossiers, attachments, consents, accessEvents: events } };
}

// ───────────── retention: expired dossiers are erased (with their files, threads and grants) — run by scripts/maintenance.js
/** @param {import('pg').Pool} pool @param {{ graceDays?: number }} [o] */
export async function purgeExpired(pool, o = {}) {
  const grace = Math.max(0, Math.min(365, o.graceDays ?? 30));
  return tx(pool, async (c) => {
    const ids = (await c.query(`SELECT id FROM hds.dossier WHERE expires_at IS NOT NULL AND expires_at < now() - make_interval(days => $1)`, [grace])).rows.map((r) => r.id);
    const blobs = ids.length ? (await c.query('SELECT blob_id FROM hds.dossier_file WHERE dossier_id = ANY($1::uuid[])', [ids])).rows.map((r) => r.blob_id) : [];
    if (ids.length) await c.query('DELETE FROM hds.dossier WHERE id = ANY($1::uuid[])', [ids]);
    await pgBlobStore(c).delete(blobs);
    const grants = (await c.query("UPDATE hds.dossier_grant SET status = 'revoked', wrapped_key = NULL, revoked_at = coalesce(revoked_at, now()) WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now() RETURNING dossier_id")).rowCount;
    const tickets = (await c.query('DELETE FROM hds.ticket_use WHERE exp < now()')).rowCount;
    return { dossiersErased: ids.length, blobs: blobs.length, grantsExpired: grants, ticketsPurged: tickets };
  });
}
