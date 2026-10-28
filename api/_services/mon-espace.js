// @ts-nocheck
/**
 * PKG-2 / K2 — Mon Espace: Mon Parcours (C07/C12), favourites (C10), opt-in history (C11), Mon Coffre (C09) and the dashboard summary (C13).
 * Principles (same as K0): everything is scoped to the verified session's account and enforced HERE (a UI control alone never counts); ADA never decides a right
 * (a Parcours status is the person's own tracking); a deadline exists only with its official source; history is opt-in and never feeds analytics;
 * Coffre bytes and file names are envelope-encrypted before storage, the type is checked from the content, and "not scanned" is said, never hidden.
 */
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { CitizenDocument, CitizenFavorite, CitizenHistoryEntry, CitizenProfile, ParcoursEvent, ParcoursItem, ProAppointment, SharedDiagnostic } from '../../src/db/schema.js';
import { buildActionPlan } from '../../src/lib/actionPlan.js';
import { decide } from '../lib/publicVisibility.js';
import { ENTITY_TABLES, evidenceUrlAllowed } from './content-verification.js';
import { storage as defaultStorage } from '../lib/storage.js';
import { openBuffer, openText, sealBuffer, sealText } from '../lib/data-keys.js';
import { isRestricted } from './processing-restriction.js';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const notFound = () => bad('NOT_FOUND', 'Élément introuvable.', 404);

// ───────────── Mon Parcours
export const PARCOURS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'READY', 'SUBMITTED', 'WAITING_ORGANIZATION', 'ADDITIONAL_INFORMATION', 'DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED'];
export const MAX_PARCOURS_ITEMS = 100;
const planKeyOf = (shareId, step) => crypto.createHash('sha256').update(JSON.stringify([shareId, step.kind, step.who || '', [...(step.itemCodes || [])].sort()])).digest('hex').slice(0, 40);
const itemView = (r) => ({ id: r.id, origin: r.origin, sourceShareId: r.sourceShareId, stepKind: r.stepKind, itemCodes: r.itemCodes, title: r.title, status: r.status,
  dueDate: r.dueDate, dueSourceUrl: r.dueSourceUrl, note: r.note, createdAt: r.createdAt, updatedAt: r.updatedAt });

async function event(db, item, kind, fromStatus = null, toStatus = null) {
  await db.insert(ParcoursEvent).values({ itemId: item.id, userId: item.userId, kind, fromStatus, toStatus });
}

export async function listParcours(userId, db = defaultDb) {
  const rows = await db.select().from(ParcoursItem).where(eq(ParcoursItem.userId, userId)).orderBy(asc(ParcoursItem.createdAt));
  return { ok: true, status: 200, items: rows.map(itemView) };
}

/** The steps of the account-free plan of a dossier the ACCOUNT owns become tracked items; re-importing the same plan adds nothing twice (planKey). */
export async function importPlan(userId, shareId, db = defaultDb) {
  const [shared] = await db.select({ id: SharedDiagnostic.id, results: SharedDiagnostic.results, ownerCitizenId: SharedDiagnostic.ownerCitizenId, expiresAt: SharedDiagnostic.expiresAt })
    .from(SharedDiagnostic).where(eq(SharedDiagnostic.id, String(shareId || ''))).limit(1);
  if (!shared || shared.ownerCitizenId !== userId) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  const plan = buildActionPlan(shared.results);
  if (!plan.steps.length) return bad('NO_PLAN', 'Ce dossier ne contient pas encore de plan d’action à suivre.', 409);
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "ParcoursItem" WHERE "userId" = ${userId}`)).rows;
  if (n + plan.steps.length > MAX_PARCOURS_ITEMS) return bad('PARCOURS_FULL', `Mon Parcours compte au plus ${MAX_PARCOURS_ITEMS} étapes.`, 409);
  let added = 0;
  for (const step of plan.steps) {
    const rows = await db.insert(ParcoursItem).values({ userId, origin: 'PLAN', sourceShareId: shared.id, planKey: planKeyOf(shared.id, step), stepKind: step.kind,
      itemCodes: step.itemCodes || [], title: String(step.title).slice(0, 300) }).onConflictDoNothing({ target: [ParcoursItem.userId, ParcoursItem.planKey] }).returning();
    if (rows.length) { added += 1; await event(db, rows[0], 'CREATED', null, 'NOT_STARTED'); }
  }
  return { ok: true, status: 200, added, ...(await listParcours(userId, db)) };
}

export async function addManualItem(userId, input, db = defaultDb) {
  const title = String(input?.title || '').trim();
  if (title.length < 3 || title.length > 200) return bad('INVALID_TITLE', 'Décrivez l’étape en 3 à 200 caractères.');
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "ParcoursItem" WHERE "userId" = ${userId}`)).rows;
  if (n >= MAX_PARCOURS_ITEMS) return bad('PARCOURS_FULL', `Mon Parcours compte au plus ${MAX_PARCOURS_ITEMS} étapes.`, 409);
  const [row] = await db.insert(ParcoursItem).values({ userId, origin: 'MANUAL', stepKind: 'custom', title }).returning();
  await event(db, row, 'CREATED', null, 'NOT_STARTED');
  return { ok: true, status: 201, item: itemView(row) };
}

async function ownedItem(userId, id, db) {
  const [row] = await db.select().from(ParcoursItem).where(and(eq(ParcoursItem.id, String(id || '')), eq(ParcoursItem.userId, userId))).limit(1);
  return row || null;
}

/** The person records where they are. Any status can follow any other (real procedures go back and forth); every change is kept in the append-only history. */
export async function setStatus(userId, id, status, db = defaultDb) {
  if (!PARCOURS_STATUSES.includes(status)) return bad('INVALID_STATUS', 'État inconnu.');
  const row = await ownedItem(userId, id, db); if (!row) return notFound();
  if (row.status === status) return { ok: true, status: 200, item: itemView(row) };
  const [up] = await db.update(ParcoursItem).set({ status }).where(and(eq(ParcoursItem.id, row.id), eq(ParcoursItem.userId, userId))).returning();
  await event(db, row, 'STATUS', row.status, status);
  return { ok: true, status: 200, item: itemView(up) };
}

/** A deadline only with its OFFICIAL source (the same allow-list as human verification); clearing it is always allowed. */
export async function setDeadline(userId, id, input, db = defaultDb) {
  const row = await ownedItem(userId, id, db); if (!row) return notFound();
  let dueDate = null; let dueSourceUrl = null;
  if (input?.dueDate != null) {
    dueDate = new Date(String(input.dueDate));
    if (Number.isNaN(dueDate.getTime())) return bad('INVALID_DATE', 'Date invalide.');
    dueSourceUrl = String(input.dueSourceUrl || '').trim();
    if (!evidenceUrlAllowed(dueSourceUrl)) return bad('DEADLINE_SOURCE_REQUIRED', 'Une échéance doit citer sa source officielle (adresse https d’un site public reconnu).');
  }
  const [up] = await db.update(ParcoursItem).set({ dueDate, dueSourceUrl }).where(and(eq(ParcoursItem.id, row.id), eq(ParcoursItem.userId, userId))).returning();
  // R12 (C08): a MOVED deadline is reminded again at its new J-7 / J-1 (the reminders already sent were for the former date and kept it from ever being re-sent)
  const moved = (row.dueDate ? new Date(row.dueDate).getTime() : null) !== (dueDate ? dueDate.getTime() : null);
  if (up && moved) await db.execute(sql`DELETE FROM "ParcoursReminder" WHERE "itemId" = ${row.id}`);
  await event(db, row, 'DEADLINE');
  return { ok: true, status: 200, item: itemView(up) };
}

export async function setNote(userId, id, note, db = defaultDb) {
  const row = await ownedItem(userId, id, db); if (!row) return notFound();
  const v = note == null ? null : String(note).trim().slice(0, 500) || null;
  const [up] = await db.update(ParcoursItem).set({ note: v }).where(and(eq(ParcoursItem.id, row.id), eq(ParcoursItem.userId, userId))).returning();
  await event(db, row, 'NOTE');
  return { ok: true, status: 200, item: itemView(up) };
}

export async function removeItem(userId, id, db = defaultDb) {
  const rows = await db.delete(ParcoursItem).where(and(eq(ParcoursItem.id, String(id || '')), eq(ParcoursItem.userId, userId))).returning({ id: ParcoursItem.id });
  return rows.length ? { ok: true, status: 200 } : notFound();
}

export async function itemHistory(userId, id, db = defaultDb) {
  const row = await ownedItem(userId, id, db); if (!row) return notFound();
  const events = await db.select({ kind: ParcoursEvent.kind, fromStatus: ParcoursEvent.fromStatus, toStatus: ParcoursEvent.toStatus, createdAt: ParcoursEvent.createdAt })
    .from(ParcoursEvent).where(eq(ParcoursEvent.itemId, row.id)).orderBy(asc(ParcoursEvent.createdAt));
  return { ok: true, status: 200, events };
}

// ───────────── favourites (published records only)
export const FAVORITE_TYPES = ['aide', 'demarche', 'structure'];
const titleOf = (type, r) => (type === 'structure' ? r.nom : r.titre) || null;

async function loadEntity(type, idOrSlug, db) {
  const T = ENTITY_TABLES[type]; if (!T) return null;
  const key = String(idOrSlug || '');
  const [r] = await db.select().from(T).where(T.slug ? or(eq(T.id, key), eq(T.slug, key)) : eq(T.id, key)).limit(1);
  return r || null;
}

export async function addFavorite(userId, input, db = defaultDb) {
  const type = String(input?.entityType || '');
  if (!FAVORITE_TYPES.includes(type)) return bad('INVALID_TYPE', 'Type inconnu.');
  const r = await loadEntity(type, input?.entityId, db);
  if (!r || !decide(r, type).visible) return bad('NOT_FOUND', 'Cette fiche n’est pas publiée.', 404);   // D-5: nothing hidden can be bookmarked (no existence oracle either)
  await db.insert(CitizenFavorite).values({ userId, entityType: type, entityId: r.id }).onConflictDoNothing();
  return { ok: true, status: 200 };
}

export async function removeFavorite(userId, input, db = defaultDb) {
  const type = String(input?.entityType || ''); const id = String(input?.entityId || '');
  await db.delete(CitizenFavorite).where(and(eq(CitizenFavorite.userId, userId), eq(CitizenFavorite.entityType, type), eq(CitizenFavorite.entityId, id)));
  return { ok: true, status: 200 };
}

/** A favourite whose record is no longer public stays listed WITHOUT its content ("n'est plus publiée"), so the person understands why it disappeared. */
export async function listFavorites(userId, db = defaultDb) {
  const favs = await db.select().from(CitizenFavorite).where(eq(CitizenFavorite.userId, userId)).orderBy(desc(CitizenFavorite.createdAt));
  const out = [];
  for (const type of FAVORITE_TYPES) {
    const ids = favs.filter((f) => f.entityType === type).map((f) => f.entityId); if (!ids.length) continue;
    const T = ENTITY_TABLES[type];
    const rows = await db.select().from(T).where(inArray(T.id, ids));
    for (const f of favs.filter((x) => x.entityType === type)) {
      const r = rows.find((x) => x.id === f.entityId);
      const visible = Boolean(r && decide(r, type).visible);
      out.push({ entityType: type, entityId: f.entityId, createdAt: f.createdAt, available: visible, title: visible ? titleOf(type, r) : null, slug: visible ? (r.slug || r.id) : null });
    }
  }
  out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { ok: true, status: 200, favorites: out };
}

// ───────────── opt-in history
export const HISTORY_KINDS = ['search', 'aide', 'demarche', 'structure', 'diagnostic', 'plan'];
export const MAX_HISTORY = 200;

async function historyEnabled(userId, db) {
  const [p] = await db.select({ h: CitizenProfile.historyEnabled }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  return Boolean(p && p.h);
}

/** Switching history OFF erases every entry at once (not only hides them). */
export async function setHistoryEnabled(userId, enabled, db = defaultDb) {
  if (typeof enabled !== 'boolean') return bad('INVALID_INPUT', 'enabled doit être vrai ou faux.');
  const [existing] = await db.select({ userId: CitizenProfile.userId }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  if (existing) await db.update(CitizenProfile).set({ historyEnabled: enabled }).where(eq(CitizenProfile.userId, userId));
  else await db.insert(CitizenProfile).values({ userId, historyEnabled: enabled });
  let erased = 0;
  if (!enabled) erased = (await db.delete(CitizenHistoryEntry).where(eq(CitizenHistoryEntry.userId, userId)).returning({ id: CitizenHistoryEntry.id })).length;
  return { ok: true, status: 200, enabled, erased };
}

export async function addHistory(userId, input, db = defaultDb) {
  if (!(await historyEnabled(userId, db))) return { ok: true, status: 202, recorded: false };   // not an error: the person did not opt in, nothing is kept
  const kind = String(input?.kind || ''); const label = String(input?.label || '').trim().slice(0, 120); const ref = input?.ref == null ? null : String(input.ref).slice(0, 200);
  if (!HISTORY_KINDS.includes(kind) || !label) return bad('INVALID_INPUT', 'Entrée d’historique invalide.');
  await db.insert(CitizenHistoryEntry).values({ userId, kind, label, ref });
  await db.execute(sql`DELETE FROM "CitizenHistoryEntry" WHERE "userId" = ${userId} AND id NOT IN (SELECT id FROM "CitizenHistoryEntry" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT ${MAX_HISTORY})`);
  return { ok: true, status: 201, recorded: true };
}

export async function listHistory(userId, db = defaultDb) {
  const enabled = await historyEnabled(userId, db);
  const entries = enabled ? await db.select({ id: CitizenHistoryEntry.id, kind: CitizenHistoryEntry.kind, label: CitizenHistoryEntry.label, ref: CitizenHistoryEntry.ref, createdAt: CitizenHistoryEntry.createdAt })
    .from(CitizenHistoryEntry).where(eq(CitizenHistoryEntry.userId, userId)).orderBy(desc(CitizenHistoryEntry.createdAt)).limit(MAX_HISTORY) : [];
  return { ok: true, status: 200, enabled, entries };
}

export async function removeHistory(userId, id, db = defaultDb) {
  const q = id ? and(eq(CitizenHistoryEntry.userId, userId), eq(CitizenHistoryEntry.id, String(id))) : eq(CitizenHistoryEntry.userId, userId);
  const n = (await db.delete(CitizenHistoryEntry).where(q).returning({ id: CitizenHistoryEntry.id })).length;
  return { ok: true, status: 200, erased: n };
}

// ───────────── Mon Coffre
export const COFFRE_CATEGORIES = ['identite', 'revenus', 'logement', 'famille', 'sante', 'emploi', 'autre'];
// R15 (HDS, dossier 27/10 ASSO-056 / ASSO-066): no qualified health-data hosting exists and ADA's own HDS role is not qualified, so the vault refuses the
// « Santé » category (fail-closed). Documents already filed under it stay listed, downloadable and erasable. Only an HDS decision changes this, in a versioned change.
export const COFFRE_HEALTH_DOCUMENTS_ACCEPTED = false;
export const COFFRE_UPLOAD_CATEGORIES = COFFRE_CATEGORIES.filter((c) => COFFRE_HEALTH_DOCUMENTS_ACCEPTED || c !== 'sante');
export const COFFRE_MAX_FILE = 3 * 1024 * 1024;   // PKG-11 audit: what a JSON upload can really carry (src/lib/fileVaultLimits.js)
export const COFFRE_MAX_FILES = 20;
export const COFFRE_MAX_TOTAL = 50 * 1024 * 1024;
const coffreCtx = (userId, docId) => `coffre:${userId}:${docId}`;

/** The type comes from the CONTENT (magic bytes), never from the declared name or MIME alone. */
export function sniffType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

function decodeBase64(value) {
  if (typeof value !== 'string') return null;
  let raw = value.trim(); const comma = raw.indexOf(',');
  if (/^data:/i.test(raw) && comma >= 0) raw = raw.slice(comma + 1);
  raw = raw.replace(/\s+/g, '');
  if (!raw || raw.length > Math.ceil(COFFRE_MAX_FILE * 4 / 3) + 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 === 1) return null;
  try { return Buffer.from(raw, 'base64'); } catch { return null; }
}

const docView = (r) => {
  const name = openText(r.filenameEncrypted, { purpose: 'coffre-filename', context: coffreCtx(r.userId, r.id) });
  return { id: r.id, category: r.category, name: name || 'Document', mimeType: r.mimeType, byteLength: r.byteLength, scanStatus: r.scanStatus, expiresAt: r.expiresAt, createdAt: r.createdAt,
    expired: Boolean(r.expiresAt && new Date(r.expiresAt).getTime() <= Date.now()) };
};

export async function listCoffre(userId, db = defaultDb) {
  const rows = await db.select().from(CitizenDocument).where(eq(CitizenDocument.userId, userId)).orderBy(desc(CitizenDocument.createdAt));
  const used = rows.reduce((s, r) => s + r.byteLength, 0);
  return { ok: true, status: 200, documents: rows.map(docView), quota: { files: rows.length, maxFiles: COFFRE_MAX_FILES, bytes: used, maxBytes: COFFRE_MAX_TOTAL } };
}

export async function uploadCoffre(userId, input, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const category = String(input?.category || '');
  if (!COFFRE_CATEGORIES.includes(category)) return bad('INVALID_CATEGORY', 'Catégorie inconnue.');
  if (!COFFRE_UPLOAD_CATEGORIES.includes(category)) return bad('HEALTH_DOCUMENTS_NOT_ACCEPTED', 'Mon Coffre n’accepte pas les documents de santé : leur hébergement demande un hébergeur agréé (HDS), qui n’est pas encore en place.', 422);
  const originalName = [...String(input?.originalName || '')].filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join('').trim().slice(0, 200);
  if (!originalName) return bad('INVALID_NAME', 'Nom de fichier manquant.');
  const buf = decodeBase64(input?.fileBase64);
  if (!buf || !buf.length) return bad('INVALID_FILE', 'Fichier illisible ou vide.');
  if (buf.length > COFFRE_MAX_FILE) return bad('FILE_TOO_LARGE', 'Fichier trop volumineux (3 Mo au plus).', 413);
  const sniffed = sniffType(buf);
  if (!sniffed) return bad('UNSUPPORTED_TYPE', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.', 415);
  if (input?.mimeType && String(input.mimeType) !== sniffed) return bad('TYPE_MISMATCH', 'Le contenu du fichier ne correspond pas à son type déclaré.', 415);
  let expiresAt = null;
  if (input?.expiresAt) { expiresAt = new Date(String(input.expiresAt)); if (Number.isNaN(expiresAt.getTime())) return bad('INVALID_DATE', 'Date d’expiration invalide.'); }
  const q = (await listCoffre(userId, db)).quota;
  if (q.files >= COFFRE_MAX_FILES) return bad('QUOTA_FILES', `Mon Coffre contient au plus ${COFFRE_MAX_FILES} documents.`, 409);
  if (q.bytes + buf.length > COFFRE_MAX_TOTAL) return bad('QUOTA_BYTES', 'Espace de Mon Coffre insuffisant (50 Mo au total).', 409);
  const id = crypto.randomUUID(); const ctx = coffreCtx(userId, id);
  const key = await storage.upload(sealBuffer(buf, { purpose: 'coffre-file', context: ctx }), 'application/octet-stream');
  try {
    const [row] = await db.insert(CitizenDocument).values({ id, userId, category, filenameEncrypted: sealText(originalName, { purpose: 'coffre-filename', context: ctx }), mimeType: sniffed,
      byteLength: buf.length, checksumSha256: crypto.createHash('sha256').update(buf).digest('hex'), storageKey: key, expiresAt }).returning();
    return { ok: true, status: 201, document: docView(row) };
  } catch (e) {
    await storage.delete(key).catch(() => {});   // never leave an orphan encrypted blob
    throw e;
  }
}

export async function downloadCoffre(userId, id, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const [row] = await db.select().from(CitizenDocument).where(and(eq(CitizenDocument.id, String(id || '')), eq(CitizenDocument.userId, userId))).limit(1);
  if (!row) return notFound();
  const bytes = openBuffer(await storage.download(row.storageKey), { purpose: 'coffre-file', context: coffreCtx(userId, row.id) });
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.checksumSha256) return bad('INTEGRITY_ERROR', 'Le document stocké est altéré.', 500);
  return { ok: true, status: 200, bytes, mimeType: row.mimeType, name: docView(row).name };
}

export async function deleteCoffre(userId, id, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const rows = await db.delete(CitizenDocument).where(and(eq(CitizenDocument.id, String(id || '')), eq(CitizenDocument.userId, userId))).returning({ storageKey: CitizenDocument.storageKey });
  if (!rows.length) return notFound();
  await storage.delete(rows[0].storageKey).catch(() => {});   // the row is gone first (the document is unreachable); a failed blob delete is retried by erasure jobs
  return { ok: true, status: 200 };
}

/** Every Coffre blob of an account (account erasure / DSR purge). */
export async function coffreStorageKeys(userId, db = defaultDb) {
  return (await db.select({ k: CitizenDocument.storageKey }).from(CitizenDocument).where(eq(CitizenDocument.userId, userId))).map((r) => r.k);
}

// ───────────── Mon Espace summary (C13)
export async function espaceSummary(userId, db = defaultDb) {
  const parcours = (await listParcours(userId, db)).items;
  const open = parcours.filter((i) => !['CLOSED', 'DECISION_POSITIVE', 'DECISION_NEGATIVE'].includes(i.status));
  const nextDue = open.filter((i) => i.dueDate && new Date(i.dueDate).getTime() > Date.now()).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] || null;
  const coffre = (await listCoffre(userId, db)).quota;
  const [{ f }] = (await db.execute(sql`SELECT count(*)::int AS f FROM "CitizenFavorite" WHERE "userId" = ${userId}`)).rows;
  const [{ s }] = (await db.execute(sql`SELECT count(*)::int AS s FROM "SharedDiagnostic" WHERE "ownerCitizenId" = ${userId}`)).rows;
  const appts = await db.select({ id: ProAppointment.id, startAt: ProAppointment.startAt, status: ProAppointment.status }).from(ProAppointment)
    .where(and(eq(ProAppointment.citizenUserId, userId), sql`${ProAppointment.startAt} > NOW()`, sql`${ProAppointment.status} <> 'cancelled'`)).orderBy(asc(ProAppointment.startAt)).limit(1);
  // C13: the message state of the account (no read markers exist, so no « unread » count is invented): how many conversations, when the latest message was
  // written and whether the structure wrote last (= the person may have something to read or answer). Message bodies are never read here.
  const [m] = (await db.execute(sql`SELECT count(DISTINCT c.id)::int AS conversations, max(msg."createdAt") AS "lastAt",
      (SELECT x."senderType" FROM "RdvConversationMessage" x JOIN "RdvConversation" y ON y.id = x."conversationId" WHERE y."citizenUserId" = ${userId} ORDER BY x."createdAt" DESC LIMIT 1) AS "lastSender"
    FROM "RdvConversation" c LEFT JOIN "RdvConversationMessage" msg ON msg."conversationId" = c.id WHERE c."citizenUserId" = ${userId}`)).rows;
  const messages = { conversations: m?.conversations || 0, lastMessageAt: m?.lastAt || null, lastFromStructure: m?.lastSender ? m.lastSender !== 'USER' : false };
  return { ok: true, status: 200, summary: { parcours: { total: parcours.length, open: open.length, nextDue: nextDue ? { id: nextDue.id, title: nextDue.title, dueDate: nextDue.dueDate } : null },
    documents: coffre.files, favorites: f, dossiers: s, nextAppointment: appts[0] || null, messages } };
}

// ───────────── R16 / C17 — transparency on a dossier the ACCOUNT owns
const ACCESS_LABELS = Object.freeze({
  DOSSIER_ACCESS_GRANTED: 'a ouvert l’accès au dossier', DOSSIER_VIEWED: 'a consulté le dossier', DOSSIER_EXPORTED: 'a exporté le dossier',
  DOSSIER_STATUS_UPDATED: 'a mis à jour le suivi', ATTESTATION_VIEWED: 'a consulté l’attestation', FILE_UPLOADED: 'a ajouté un document',
  DOSSIER_FILE_DOWNLOADED: 'a téléchargé un document', DOSSIER_SYNTHESIS_DRAFTED: 'a fait rédiger une synthèse automatique',
  DOSSIER_SYNTHESIS_APPROVED: 'a validé une synthèse automatique',
});

async function ownedDossier(userId, shareId, db) {
  const [s] = await db.select({ id: SharedDiagnostic.id, ownerCitizenId: SharedDiagnostic.ownerCitizenId, results: SharedDiagnostic.results })
    .from(SharedDiagnostic).where(eq(SharedDiagnostic.id, String(shareId || ''))).limit(1);
  return s && s.ownerCitizenId === userId ? s : null;
}
async function structureNames(ids, db) {
  const uniq = [...new Set(ids.filter(Boolean))]; if (!uniq.length) return {};
  const { Structure } = await import('../../src/db/schema.js');
  const rows = await db.select({ id: Structure.id, nom: Structure.nom }).from(Structure).where(inArray(Structure.id, uniq));
  return Object.fromEntries(rows.map((r) => [r.id, r.nom]));
}

/** R16: who did what with the dossier, by ORGANISATION (no staff identifier, no IP), newest first. */
export async function dossierAccessLog(userId, shareId, db = defaultDb) {
  const s = await ownedDossier(userId, shareId, db);
  if (!s) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  const rows = (await db.execute(sql`SELECT action, "timestamp" AS at, details->>'structureId' AS sid FROM "AuditLog"
    WHERE details->>'shareId' = ${s.id} AND action IN (${sql.join(Object.keys(ACCESS_LABELS).map((a) => sql`${a}`), sql`, `)}) ORDER BY "timestamp" DESC LIMIT 200`)).rows;
  const names = await structureNames(rows.map((r) => r.sid), db);
  return { ok: true, status: 200, events: rows.map((r) => ({ action: r.action, label: ACCESS_LABELS[r.action], at: r.at, organization: names[r.sid] || 'Organisation' })) };
}

const fileCtx = (shareId, fileId) => `file:${shareId}:${fileId}`;
/** C17: the documents organisations attached to the person's dossier — listed with their organisation, downloadable, removable by the person. */
export async function dossierDocuments(userId, shareId, db = defaultDb) {
  const s = await ownedDossier(userId, shareId, db);
  if (!s) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  const files = Array.isArray(s.results?._files) ? s.results._files : [];
  const names = await structureNames(files.map((f) => f.structureId), db);
  return { ok: true, status: 200, documents: files.map((f) => ({ id: f.id, name: (f.filenameEncrypted && openText(f.filenameEncrypted, { purpose: 'dossier-filename', context: fileCtx(s.id, f.id) })) || 'Document',
    mimeType: f.mimeType, byteLength: f.byteLength, uploadedAt: f.uploadedAt, organization: names[f.structureId] || 'Organisation' })) };
}

export async function downloadDossierDocument(userId, shareId, fileId, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const s = await ownedDossier(userId, shareId, db); if (!s) return notFound();
  const f = (Array.isArray(s.results?._files) ? s.results._files : []).find((x) => x && x.id === String(fileId || ''));
  if (!f) return notFound();
  const bytes = openBuffer(await storage.download(f.storageKey), { purpose: 'dossier-file', context: fileCtx(s.id, f.id) });
  if (f.checksumSha256 && crypto.createHash('sha256').update(bytes).digest('hex') !== f.checksumSha256) return bad('INTEGRITY_ERROR', 'Le document stocké est altéré.', 500);
  return { ok: true, status: 200, bytes, mimeType: f.mimeType || 'application/octet-stream', name: openText(f.filenameEncrypted, { purpose: 'dossier-filename', context: fileCtx(s.id, f.id) }) || 'document' };
}

/** The person removes a document from THEIR dossier: atomic JSON removal (concurrent uploads are kept), then the encrypted blob is purged. */
export async function removeDossierDocument(userId, shareId, fileId, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const s = await ownedDossier(userId, shareId, db); if (!s) return notFound();
  const id = String(fileId || '');
  const f = (Array.isArray(s.results?._files) ? s.results._files : []).find((x) => x && x.id === id);
  if (!f) return notFound();
  const rows = (await db.execute(sql`UPDATE "SharedDiagnostic" SET results = jsonb_set(results, '{_files}', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(results->'_files') e WHERE e->>'id' <> ${id}), '[]'::jsonb))
    WHERE id = ${s.id} AND "ownerCitizenId" = ${userId} AND jsonb_typeof(results->'_files') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(results->'_files') e WHERE e->>'id' = ${id})
    RETURNING id`)).rows;
  if (!rows.length) return notFound();
  if (f.storageKey) await storage.delete(f.storageKey).catch(() => {});
  return { ok: true, status: 200 };
}

/**
 * Share-from-Coffre: the person sends ONE of their Coffre documents to ONE organisation that holds an active grant on ONE of their dossiers. The bytes are re-encrypted for that
 * dossier and organisation (dossier-file purpose); the projection only shows an entry to the organisation it names, so no other grantee sees it. Removal = C17 removeDossierDocument.
 */
export async function shareFromCoffre(userId, input, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const s = await ownedDossier(userId, input?.shareId, db);
  if (!s) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  // PKG-11 audit: nothing new is shared while the person restricts processing (art. 18)
  if (await isRestricted(userId, db)) return bad('PROCESSING_RESTRICTED', 'Vous avez demandé la limitation du traitement : levez-la avant de transmettre un document.', 409);
  const structureId = String(input?.structureId || '');
  const [{ g }] = (await db.execute(sql`SELECT count(*)::int AS g FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${s.id} AND "structureId" = ${structureId} AND "revokedAt" IS NULL`)).rows;
  if (!g) return bad('NO_ACTIVE_GRANT', 'Cette organisation n’a pas accès à ce dossier.', 404);
  const [doc] = await db.select().from(CitizenDocument).where(and(eq(CitizenDocument.id, String(input?.documentId || '')), eq(CitizenDocument.userId, userId))).limit(1);
  if (!doc) return notFound();
  // R15 (HDS, fail-closed): a document filed under « Santé » before R15 stays the person's (list, download, erase) but is never copied to an organisation's dossier
  if (!COFFRE_UPLOAD_CATEGORIES.includes(doc.category)) return bad('HEALTH_DOCUMENTS_NOT_ACCEPTED', 'Les documents de santé ne peuvent pas être transmis depuis Mon Coffre : leur hébergement demande un hébergeur agréé (HDS), qui n’est pas encore en place.', 422);
  const plain = openBuffer(await storage.download(doc.storageKey), { purpose: 'coffre-file', context: coffreCtx(userId, doc.id) });
  const name = openText(doc.filenameEncrypted, { purpose: 'coffre-filename', context: coffreCtx(userId, doc.id) }) || 'document';
  const fileId = crypto.randomUUID(); const ctx = fileCtx(s.id, fileId);
  const key = await storage.upload(sealBuffer(plain, { purpose: 'dossier-file', context: ctx }), 'application/octet-stream');
  const entry = { id: fileId, structureId, storageKey: key, filenameEncrypted: sealText(name, { purpose: 'dossier-filename', context: ctx }), mimeType: doc.mimeType, uploadedAt: new Date().toISOString(),
    byteLength: plain.length, checksumSha256: doc.checksumSha256, encrypted: true, source: 'CITIZEN_COFFRE' };
  const rows = (await db.execute(sql`UPDATE "SharedDiagnostic" SET results = jsonb_set(coalesce(results, '{}'::jsonb), '{_files}', (CASE WHEN jsonb_typeof(results->'_files') = 'array' THEN results->'_files' ELSE '[]'::jsonb END) || ${JSON.stringify([entry])}::jsonb)
    WHERE id = ${s.id} AND "ownerCitizenId" = ${userId} AND EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = ${s.id} AND g."structureId" = ${structureId} AND g."revokedAt" IS NULL) RETURNING id`)).rows;
  if (!rows.length) { await storage.delete(key).catch(() => {}); return bad('NO_ACTIVE_GRANT', 'Cette organisation n’a plus accès à ce dossier.', 409); }
  await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details, "timestamp") VALUES (${crypto.randomUUID()}, 'CITIZEN_DOCUMENT_SHARED', 'citizen', ${userId}, 'SharedDiagnostic', ${s.id}, ${JSON.stringify({ shareId: s.id, structureId, fileId })}::jsonb, NOW())`).catch(() => {});
  return { ok: true, status: 201, fileId };
}
