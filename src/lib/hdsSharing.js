// @ts-check
/**
 * G14-R4 — the browser flows of shared dossiers, organisation keys, referral payloads and attachments at the HDS service: each function composes the
 * end-to-end crypto (src/lib/dossierCrypto.js, src/lib/vaultCrypto.js) with single-use tickets (src/lib/hdsClient.js). Keys come from src/lib/hdsKeys.js
 * (memory only). A function returns null when this environment has no HDS service (the legacy path stays). Nothing here sends a clear text anywhere.
 */
import * as dc from './dossierCrypto.js';
import * as vc from './vaultCrypto.js';
import { hdsRequest } from './hdsClient.js';
import * as keys from './hdsKeys.js';

const D = 'citizen.shared_dossier';
/** @param {string} code */
const err = (code) => Object.assign(new Error(code), { code, status: 0, serverMessage: '' });
const need = (/** @type {CryptoKey | null} */ k, /** @type {string} */ code) => { if (!k) throw err(code); return k; };
const pid = (/** @type {string} */ id) => encodeURIComponent(id);
/** @param {string} path @param {{ method?: string, body?: unknown }} [o] */
const cit = (path, o = {}) => hdsRequest(D, path, { ...o, side: 'citizen' });
/** @param {string} path @param {{ method?: string, body?: unknown }} [o] @param {string} [cap] */
const pro = (path, o = {}, cap = D) => hdsRequest(cap, path, { ...o, side: 'pro' });

// ───────────── citizen: unlock and keys
/** unlock Mon Coffre (same passphrase) and make sure the receiving key exists @param {string} passphrase @returns {Promise<boolean | null>} */
export async function unlockCitizen(passphrase) {
  const v = await hdsRequest('citizen.vault', '/v1/vault/documents', { side: 'citizen' });
  if (!v) return null;
  if (!v.keyring) throw err('KEYRING_REQUIRED');
  const vaultKey = await vc.unlockKeyring(v.keyring, passphrase);
  if (!vaultKey) return false;
  keys.setVaultKey(vaultKey);
  await ensureBoxKey(vaultKey);
  return true;
}
/** @param {CryptoKey} vaultKey */
export async function ensureBoxKey(vaultKey) {
  const cur = await cit('/v1/vault/box-key');
  if (!cur) return null;
  if (cur.boxKey) { keys.setBoxKey(await dc.openBoxKey(vaultKey, cur.boxKey.privateWrapped)); return cur.boxKey.publicJwk; }
  const b = await dc.createBoxKey(vaultKey);
  await cit('/v1/vault/box-key', { method: 'PUT', body: { publicJwk: b.publicJwk, privateWrapped: b.privateWrapped } });
  keys.setBoxKey(b.privateKey);
  return b.publicJwk;
}

// ───────────── citizen: dossiers
/** @returns {Promise<{ dossiers: any[], shareConsentVersion: string | null } | null>} */
export async function listOwn() { return cit('/v1/dossiers'); }

/** the dossier with its decrypted content, its key and its files' names @param {string} id */
export async function openOwn(id) {
  const vaultKey = need(keys.getVaultKey(), 'VAULT_LOCKED');
  const d = await cit(`/v1/dossiers/${pid(id)}`);
  if (!d) return null;
  const k = await dc.openOwnerKey(vaultKey, d.ownerKey);
  const content = await dc.decryptContent(k.key, d.content);
  const files = await Promise.all(d.files.map(async (/** @type {any} */ f) => ({ ...f, ...(await vc.openMeta(k.key, f)) })));
  return { ...d, decrypted: content, key: k.key, raw: k.raw, files };
}

/** @param {{ title: string, summary: string }} content @param {string} [expiresAt] */
export async function createOwn(content, expiresAt) {
  const vaultKey = need(keys.getVaultKey(), 'VAULT_LOCKED');
  const made = await dc.createDossier(vaultKey, { v: 1, title: String(content.title).slice(0, 200), summary: String(content.summary).slice(0, 20000), createdAt: new Date().toISOString() });
  return cit('/v1/dossiers', { method: 'POST', body: { ...made.body, ...(expiresAt ? { expiresAt } : {}) } });
}

/** @param {string} id @param {{ title: string, summary: string }} content */
export async function updateOwn(id, content) {
  const d = await openOwn(id);
  if (!d) return null;
  const body = await dc.encryptContent(d.key, { ...d.decrypted, title: String(content.title).slice(0, 200), summary: String(content.summary).slice(0, 20000) });
  return cit(`/v1/dossiers/${pid(id)}`, { method: 'PUT', body: { content: body, keyEpoch: d.keyEpoch } });
}

/** share with an organisation: its CURRENT public key, the person's explicit consent to the approved text @param {string} id @param {string} structureId @param {string} consentVersion @param {string} [expiresAt] */
export async function shareWith(id, structureId, consentVersion, expiresAt) {
  const d = await openOwn(id);
  if (!d) return null;
  const org = await cit(`/v1/orgs/${pid(structureId)}/public-key`);
  const wrappedKey = await dc.wrapForOrg(d.raw, org);
  return cit(`/v1/dossiers/${pid(id)}/grants`, { method: 'POST', body: { structureId, wrappedKey, keyEpoch: d.keyEpoch, consent: { explicit: true, version: consentVersion }, ...(expiresAt ? { expiresAt } : {}) } });
}

/** the atomic re-key (after a revocation): content, file and message keys, every remaining organisation @param {string} id */
export async function rekey(id) {
  const vaultKey = need(keys.getVaultKey(), 'VAULT_LOCKED');
  const d = await cit(`/v1/dossiers/${pid(id)}`);
  const old = await dc.openOwnerKey(vaultKey, d.ownerKey);
  const structures = [...new Set(d.grants.map((/** @type {any} */ g) => g.structureId))];
  const messages = [];
  for (const s of structures) messages.push(...((await cit(`/v1/dossiers/${pid(id)}/threads/${pid(String(s))}`))?.messages || []));
  const keep = d.grants.filter((/** @type {any} */ g) => ['active', 'pending_citizen'].includes(g.status));
  const orgs = [];
  for (const g of keep) orgs.push({ structureId: g.structureId, ...(await cit(`/v1/orgs/${pid(g.structureId)}/public-key`)) });
  const rk = await dc.rekeyPayload({ vaultKey, oldKey: old.key, dossier: d, messages, orgs });
  return cit(`/v1/dossiers/${pid(id)}/rekey`, { method: 'POST', body: rk.payload });
}

/** withdraw an organisation's access, then re-key at once @param {string} id @param {string} structureId */
export async function revoke(id, structureId) {
  const out = await cit(`/v1/dossiers/${pid(id)}/grants`, { method: 'DELETE', body: { structureId } });
  if (out?.rekeyRequired) await rekey(id);
  return out;
}

/** @param {string} id @param {string} structureId @param {boolean} accept @param {string} [consentVersion] */
export async function answerReferral(id, structureId, accept, consentVersion) {
  return cit(`/v1/dossiers/${pid(id)}/referral-answer`, { method: 'POST', body: { structureId, accept, ...(accept ? { consent: { explicit: true, version: consentVersion } } : {}) } });
}

/** @param {string} id */
export const removeOwn = (id) => cit(`/v1/dossiers/${pid(id)}`, { method: 'DELETE' });
/** @param {string} id */
export const accessLog = (id) => cit(`/v1/dossiers/${pid(id)}/access-log`);

/** @param {'citizen' | 'pro'} side @param {CryptoKey} key @param {string} id @param {string} structureId */
export async function readThread(side, key, id, structureId) {
  const out = await (side === 'pro' ? pro : cit)(`/v1/dossiers/${pid(id)}/threads/${pid(structureId)}`);
  return Promise.all((out?.messages || []).map(async (/** @type {any} */ m) => ({ id: m.id, author: m.author, kind: m.kind, createdAt: m.createdAt, text: await dc.decryptMessage(key, m).catch(() => '') })));
}
/** @param {'citizen' | 'pro'} side @param {CryptoKey} key @param {number} keyEpoch @param {string} id @param {string} structureId @param {string} text */
export async function postThread(side, key, keyEpoch, id, structureId, text) {
  const m = await dc.encryptMessage(key, String(text).slice(0, 4000));
  return (side === 'pro' ? pro : cit)(`/v1/dossiers/${pid(id)}/threads/${pid(structureId)}`, { method: 'POST', body: { ...m, keyEpoch } });
}

/** @param {'citizen' | 'pro'} side @param {CryptoKey} key @param {number} keyEpoch @param {string} id @param {File} file */
export async function addFile(side, key, keyEpoch, id, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = vc.sniffType(bytes);
  if (!type) throw err('UNSUPPORTED_TYPE');
  const boxes = await vc.encryptDocument(key, { bytes, name: file.name.slice(0, 200), category: 'autre', type });
  return (side === 'pro' ? pro : cit)(`/v1/dossiers/${pid(id)}/files`, { method: 'POST', body: { ...boxes, keyEpoch } });
}
/** @param {'citizen' | 'pro'} side @param {CryptoKey} key @param {string} id @param {{ id: string, dek: any, name?: string, type?: string }} f */
export async function readFile(side, key, id, f) {
  const out = await (side === 'pro' ? pro : cit)(`/v1/dossiers/${pid(id)}/files/${pid(f.id)}/content`);
  const meta = f.name ? { name: f.name, type: String(f.type) } : await vc.openMeta(key, /** @type {any} */ (f));
  return { bytes: await vc.openContent(key, /** @type {any} */ (f), out.content), name: meta.name, type: meta.type };
}

/** everything the person keeps at the HDS service, decrypted in this page (art. 15 / 20) */
export async function exportAll() {
  const vaultKey = need(keys.getVaultKey(), 'VAULT_LOCKED');
  const ex = await cit('/v1/vault/export');
  if (!ex) return null;
  const vault = await Promise.all((ex.vault?.documents || []).map(async (/** @type {any} */ d) => ({ id: d.id, createdAt: d.createdAt, expiresAt: d.expiresAt, ...(await vc.openMeta(vaultKey, d).catch(() => ({}))) })));
  const dossiers = [];
  for (const d of ex.dossiers || []) {
    const k = d.ownerKey ? await dc.openOwnerKey(vaultKey, d.ownerKey).catch(() => null) : null;
    dossiers.push({ id: d.id, kind: d.kind, expiresAt: d.expiresAt, grants: d.grants, content: k ? await dc.decryptContent(k.key, d.content).catch(() => null) : null,
      files: k ? await Promise.all(d.files.map(async (/** @type {any} */ f) => ({ id: f.id, addedBy: f.addedBy, createdAt: f.createdAt, ...(await vc.openMeta(k.key, f).catch(() => ({}))) }))) : [],
      threads: k ? await Promise.all((d.threads || []).map(async (/** @type {any} */ t) => ({ structureId: t.structureId, messages: await Promise.all(t.messages.map(async (/** @type {any} */ m) => ({ author: m.author, createdAt: m.createdAt, text: await dc.decryptMessage(k.key, m).catch(() => null) }))) }))) : [] });
  }
  return { format: 'ada-hds-export/1 (déchiffré dans votre navigateur)', exportedAt: ex.exportedAt, vault, dossiers, attachments: ex.attachments, consents: ex.consents, accessEvents: ex.accessEvents };
}

// ───────────── professional: keys
/** @returns {Promise<any | null>} */
export async function proKeys() { return pro('/v1/pro/keys'); }

/** create my personal key (first visit) @param {string} passphrase */
export async function proSetupMember(passphrase) {
  const m = await dc.createMemberKeyring(passphrase);
  await pro('/v1/pro/member-key', { method: 'PUT', body: { publicJwk: m.publicJwk, keyring: m.keyring } });
  keys.setMemberKey(m.privateKey);
  return true;
}

/** unlock my key and every organisation key wrapped for me @param {string} passphrase @returns {Promise<boolean>} */
export async function proUnlock(passphrase) {
  const st = await proKeys();
  if (!st?.member) throw err('MEMBER_KEY_MISSING');
  const k = await dc.unlockMemberKeyring(st.member.keyring, passphrase);
  if (!k) return false;
  keys.setMemberKey(k);
  await proOpenOrgKeys(st);
  return true;
}
/** @param {any} st */
async function proOpenOrgKeys(st) {
  const mk = need(keys.getMemberKey(), 'MEMBER_LOCKED');
  for (const o of st.orgKeys || []) if (o.wrappedPrivate && !keys.getOrgKey(o.kid)) keys.setOrgKey(o.kid, await dc.importPrivateJwk(await dc.openOrgPrivateJwk(mk, o.wrappedPrivate)));
}

/** administrator: create the organisation key, or ROTATE it (re-wraps the older keys for myself; then the team is re-wrapped with proWrapPending) */
export async function proCreateOrgKey() {
  const st = await proKeys();
  const mk = need(keys.getMemberKey(), 'MEMBER_LOCKED');
  const org = await dc.createOrgKey([{ memberRef: '__self__', publicJwk: st.member.publicJwk }]);
  const self = st.memberRef;
  const wraps = org.wraps.map((w) => ({ ...w, memberRef: self }));
  for (const o of st.orgKeys || []) {
    if (!o.wrappedPrivate) continue;
    const jwk = await dc.openOrgPrivateJwk(mk, o.wrappedPrivate);
    wraps.push({ memberRef: self, kid: o.kid, wrappedPrivate: await dc.wrapOrgPrivateFor(jwk, o.kid, st.member.publicJwk) });
  }
  await pro('/v1/pro/org-keys', { method: 'POST', body: { kid: org.kid, publicJwk: org.publicJwk, wraps } });
  keys.setOrgKey(org.kid, await dc.importPrivateJwk(org.privateJwk));
  return org.kid;
}

/**
 * administrator: give the members who created their key access to every organisation key I can open — ONLY the members whose ADA Pro account is ACTIVE
 * (`activeMemberRefs`, read from the team list of the main API). The HDS service does not know an account's status: a deactivated member keeps their
 * personal key there, so after « Changer la clé » they would be listed as « to wrap » again. Without that list nothing is wrapped (fail closed).
 * @param {ReadonlySet<string>} activeMemberRefs @returns {Promise<number>}
 */
export async function proWrapPending(activeMemberRefs) {
  if (!(activeMemberRefs instanceof Set)) throw err('ACTIVE_MEMBERS_UNKNOWN');
  const st = await proKeys();
  const mk = need(keys.getMemberKey(), 'MEMBER_LOCKED');
  let n = 0;
  for (const m of eligiblePending(st, activeMemberRefs)) {
    const wraps = [];
    for (const o of st.orgKeys || []) if (o.wrappedPrivate) wraps.push({ kid: o.kid, wrappedPrivate: await dc.wrapOrgPrivateFor(await dc.openOrgPrivateJwk(mk, o.wrappedPrivate), o.kid, m.publicJwk) });
    if (wraps.length) { await pro('/v1/pro/org-keys/members', { method: 'POST', body: { memberRef: m.memberRef, wraps } }); n += 1; }
  }
  return n;
}

/** the members still to wrap whose ADA Pro account is active (never myself) @param {any} st @param {ReadonlySet<string>} activeMemberRefs @returns {any[]} */
export function eligiblePending(st, activeMemberRefs) {
  return (st?.pendingMembers || []).filter((/** @type {any} */ m) => activeMemberRefs.has(String(m?.memberRef || '')) && m.memberRef !== st?.memberRef);
}

/**
 * administrator: withdraw a member's access to the organisation key (their wraps and their personal key are deleted at the HDS service; audited there as
 * ORG_KEY_MEMBER_REMOVED). They may have kept a copy of the key in their browser: « Changer la clé » afterwards is recommended.
 * @param {string} memberRef @returns {Promise<{ memberRef: string, removed?: boolean, rotateRecommended: boolean } | null>}
 */
export async function proRemoveMember(memberRef) {
  return pro('/v1/pro/org-keys/members', { method: 'DELETE', body: { memberRef } });
}

// ───────────── professional: dossiers
export async function proList() { return pro('/v1/pro/dossiers'); }
/** @param {string} id */
export async function proOpen(id) {
  const d = await pro(`/v1/dossiers/${pid(id)}`);
  if (!d) return null;
  const orgKey = need(keys.getOrgKey(String(d.wrappedKey?.kid || '')), 'ORG_KEY_LOCKED');
  const k = await dc.openGrantKey(orgKey, d.wrappedKey);
  const content = await dc.decryptContent(k.key, d.content);
  const files = await Promise.all(d.files.map(async (/** @type {any} */ f) => ({ ...f, ...(await vc.openMeta(k.key, f)) })));
  return { ...d, decrypted: content, key: k.key, raw: k.raw, files };
}
/** a content-free event the person sees (export, attestation, SIAO sheet, print) @param {string} id @param {string} action */
export const proEvent = (id, action) => pro(`/v1/dossiers/${pid(id)}/events`, { method: 'POST', body: { action } });

/**
 * referral payload: wrap the dossier key for the receiving organisation and leave an encrypted note; the PERSON then decides. Returns the referral ref the
 * main-side referral must carry (idempotencyKey). On a main-side failure call proWithdrawReferral.
 * @param {string} id @param {string} toStructureId @param {string} note
 */
export async function proPrepareReferral(id, toStructureId, note) {
  const d = await proOpen(id);
  if (!d) return null;
  const to = await pro(`/v1/orgs/${pid(toStructureId)}/public-key`, {}, 'pro.referrals');
  const referralRef = globalThis.crypto.randomUUID();
  const body = { toStructureId, referralRef, keyEpoch: d.keyEpoch, wrappedKey: await dc.wrapForOrg(d.raw, to), ...(note.trim() ? { note: await dc.encryptMessage(d.key, note.slice(0, 4000)) } : {}) };
  await pro(`/v1/dossiers/${pid(id)}/referrals`, { method: 'POST', body }, 'pro.referrals');
  return referralRef;
}
/** @param {string} id @param {string} toStructureId */
export const proWithdrawReferral = (id, toStructureId) => pro(`/v1/dossiers/${pid(id)}/referrals`, { method: 'DELETE', body: { toStructureId } }, 'pro.referrals');

// ───────────── attachments of an appointment conversation
/** @param {'citizen' | 'pro'} side @param {string} conversation @param {File} file @returns {Promise<{ hdsAttachmentId: string, byteLength: number, sha256: string } | null>} */
export async function uploadAttachment(side, conversation, file) {
  const ks = await hdsRequest('messaging.attachments', '/v1/attachments/keys', { side, conversation });
  if (!ks) return null;
  if (!ks.ready) throw err(ks.citizen ? 'ORG_KEY_MISSING' : 'CITIZEN_KEY_MISSING');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = vc.sniffType(bytes);
  if (!type) throw err('UNSUPPORTED_TYPE');
  const box = await dc.encryptAttachment({ bytes, name: file.name.slice(0, 120), type }, ks);
  const up = await hdsRequest('messaging.attachments', '/v1/attachments', { side, conversation, method: 'POST', body: box });
  return { hdsAttachmentId: up.id, byteLength: up.byteLength, sha256: up.sha256 };
}
/** @param {'citizen' | 'pro'} side @param {string} conversation @param {string} attachmentId */
export async function downloadAttachment(side, conversation, attachmentId) {
  const a = await hdsRequest('messaging.attachments', `/v1/attachments/${pid(attachmentId)}`, { side, conversation });
  if (!a) return null;
  const key = side === 'citizen' ? need(keys.getBoxKey(), 'VAULT_LOCKED') : need(keys.getOrgKey(String(a.key?.kid || '')), 'ORG_KEY_LOCKED');
  return dc.decryptAttachment(key, a);
}
