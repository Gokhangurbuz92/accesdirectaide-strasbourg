// @ts-nocheck
/**
 * X04 (EXPANSION, founder authorization 19/11/2026 — not one of the 173) — Academy and events: the only reader / writer of AcademyItem and
 * EventRegistration (drizzle/0053_x04_academy_events.sql).
 *
 * Editorial (api/_handlers/admin/events.js, adminGate: reading = an administrator session; every change = a NAMED administrator with MFA):
 *   draft → review → published, like the ADA articles (api/_services/news/editorial-workflow.js). An approval re-checks the whole content here (never the
 *   form): plain text, lengths, no entitlement wording (api/lib/entitlementWording.js), and for an EVENT: future start, end after start, capacity 1–5000,
 *   a public venue, an organizer name and the ACCESSIBILITY INFORMATION (features from a closed list and / or a note — « not accessible » must be said,
 *   never left blank). Optional four-eyes rule (ACADEMY_EDITORIAL_FOUR_EYES=on). A published EVENT can be cancelled (the registered persons are told in
 *   their notification centre), a published LESSON withdrawn (its address answers 410). Every step writes an AuditLog row (actor, item, step).
 * Citizen (api/_handlers/citizen/events.js, citizenHandler: a verified citizen session):
 *   registration ONLY for an adult account (api/_utils/age-policy.js isAdultAccount — the R42-A07 single entry point), to a published, future EVENT whose
 *   registration is not closed, within its capacity (row lock: two last-place requests cannot both pass). Stored: account id, event id, state, times and
 *   — only when the person explicitly chooses it AND ticks the separate, never pre-ticked agreement — ONE accessibility need from a closed list (no free
 *   text; it can reveal a disability: art. 9 RGPD, explicit choice, [REVUE DPO]). Cancelling clears the need. No anonymous registration exists.
 * Organizer side: COUNTS only (registered, remaining places, number of each accessibility need) — never a list of persons, never an e-mail, never an
 *   export of attendees: preparing the room, the interpreter or the printed material needs numbers, not identities (minimisation, art. 5(1)(c)).
 * Reminder: derived in the existing notification centre (api/_services/citizen-inbox.js, N03 pattern): EVENT_REMINDER from 48 h before the start of an
 *   event the person is registered to, EVENT_CANCELLED when the organizer cancelled it — kind, time and in-app link only (no title, no place, no need).
 * Without 0053 (a database behind the code) nothing is read: the public lists are empty, every write answers 503 ACADEMY_NOT_AVAILABLE.
 */
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AcademyItem, AuditLog, ConsentLog, EventRegistration } from '../../src/db/schema.js';
import { claimsEntitlement } from '../lib/entitlementWording.js';

export const KINDS = Object.freeze(['LESSON', 'EVENT']);
export const STATES = Object.freeze({ draft: 'draft', review: 'review', published: 'published', cancelled: 'cancelled', withdrawn: 'withdrawn' });
/** what the place / the event offers (public information about the event, no person) */
export const ACCESSIBILITY_FEATURES = Object.freeze(['STEP_FREE_ACCESS', 'ACCESSIBLE_TOILETS', 'LSF_INTERPRETATION', 'LIVE_CAPTIONS', 'HEARING_LOOP',
  'FALC_MATERIALS', 'LARGE_PRINT_MATERIALS', 'QUIET_SPACE', 'ASSISTANCE_ANIMALS_WELCOME']);
/** what ONE participant may ask for (closed list, same as the CHECK of drizzle/0053) */
export const ACCESSIBILITY_NEEDS = Object.freeze(['STEP_FREE_ACCESS', 'LSF_INTERPRETATION', 'LIVE_CAPTIONS', 'HEARING_LOOP', 'FALC_MATERIALS',
  'LARGE_PRINT_MATERIALS', 'QUIET_SPACE', 'ACCOMPANYING_PERSON']);
/** the languages a checked human translation may be given in (French is the canonical text) */
export const TRANSLATION_LANGS = Object.freeze(['en', 'de', 'tr', 'ar', 'uk']);
export const REMINDER_WINDOW_HOURS = 48;
export const MAX_CAPACITY = 5000;
export const MY_EVENTS_LINK = '/compte/evenements';
const LIST_LIMIT = 100;

const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });
/** plain text: markup removed, NUL removed, trimmed, bounded */
const plain = (s, max) => String(s ?? '').replace(/<[^>]*>/g, '').split('\u0000').join('').trim().slice(0, max);
const date = (v) => { if (v === null || v === undefined || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const slugify = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

/* ----------------------------------------------------------------------------------------------------------------------------------- schema */

const schemaCache = new WeakMap();
/** does this database have migration 0053 (read at most once a minute per client; a failed read is not remembered) @param {any} database */
export async function academySchemaAvailable(database = defaultDb) {
  const hit = schemaCache.get(database);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const res = await database.execute(sql`SELECT to_regclass('"AcademyItem"') IS NOT NULL AND to_regclass('"EventRegistration"') IS NOT NULL AS ok`);
    const value = Boolean((res?.rows || res || [])[0]?.ok);
    schemaCache.set(database, { at: Date.now(), value });
    return value;
  } catch { return false; }
}
/** @param {any} database */
async function requireSchema(database) {
  if (!(await academySchemaAvailable(database))) throw err('ACADEMY_NOT_AVAILABLE', 503);
}

/* ----------------------------------------------------------------------------------------------------------------------------- the content */

/** normalises what the editor sent; never trusts types @param {any} input @param {string} kind */
export function normaliseDraft(input, kind) {
  const i = input && typeof input === 'object' ? input : {};
  const translations = {};
  for (const lang of TRANSLATION_LANGS) {
    const tr = i.translations?.[lang];
    if (!tr || typeof tr !== 'object') continue;
    const x = { title: plain(tr.title, 200), summary: plain(tr.summary, 400), body: plain(tr.body, 20000) };
    if (x.title || x.summary || x.body) translations[lang] = x;
  }
  const d = { title: plain(i.title, 200), summary: plain(i.summary, 400), body: plain(i.body, 20000), translations };
  if (kind !== 'EVENT') return d;
  const cap = Number(i.capacity);
  return {
    ...d,
    organizerName: plain(i.organizerName, 160) || null,
    startsAt: date(i.startsAt), endsAt: date(i.endsAt), registrationClosesAt: date(i.registrationClosesAt),
    venueName: plain(i.venueName, 160) || null, venueAddress: plain(i.venueAddress, 300) || null, venueCommune: plain(i.venueCommune, 120) || null,
    capacity: Number.isInteger(cap) ? cap : null,
    accessibilityFeatures: [...new Set((Array.isArray(i.accessibilityFeatures) ? i.accessibilityFeatures : []).filter((f) => ACCESSIBILITY_FEATURES.includes(f)))],
    accessibilityNote: plain(i.accessibilityNote, 1000) || null,
  };
}

/**
 * What is missing before an approval (empty = can be published). @param {ReturnType<typeof normaliseDraft>} d @param {string} kind @param {Date} [now]
 * @returns {string[]}
 */
export function approvalProblems(d, kind, now = new Date()) {
  const p = [];
  if (d.title.length < 5) p.push('TITLE_TOO_SHORT');
  if (d.summary.length < 20) p.push('SUMMARY_TOO_SHORT');
  if (d.body.length < (kind === 'LESSON' ? 200 : 20)) p.push('BODY_TOO_SHORT');
  const texts = [d.title, d.summary, d.body, d.accessibilityNote || '', ...Object.values(d.translations).flatMap((x) => [x.title, x.summary, x.body])];
  if (texts.some((t) => t && claimsEntitlement(t))) p.push('ENTITLEMENT_WORDING');
  for (const [lang, x] of Object.entries(d.translations)) {
    if (x.title.length < 5 || x.summary.length < 20 || (kind === 'LESSON' && x.body.length < 200)) p.push(`TRANSLATION_INCOMPLETE_${lang.toUpperCase()}`);
  }
  if (kind === 'EVENT') {
    if (!d.startsAt) p.push('START_REQUIRED'); else if (d.startsAt <= now) p.push('START_IN_THE_PAST');
    if (!d.endsAt || (d.startsAt && d.endsAt <= d.startsAt)) p.push('END_AFTER_START_REQUIRED');
    if (d.registrationClosesAt && d.startsAt && d.registrationClosesAt > d.startsAt) p.push('REGISTRATION_CLOSES_AFTER_START');
    if (!Number.isInteger(d.capacity) || d.capacity < 1 || d.capacity > MAX_CAPACITY) p.push('CAPACITY_REQUIRED');
    if (!d.venueName || d.venueName.length < 3) p.push('VENUE_REQUIRED');
    if (!d.venueAddress || d.venueAddress.length < 5) p.push('VENUE_ADDRESS_REQUIRED');
    if (!d.venueCommune) p.push('VENUE_COMMUNE_REQUIRED');
    if (!d.organizerName || d.organizerName.length < 2) p.push('ORGANIZER_REQUIRED');
    // the accessibility information is part of the event: a list of what is offered and / or a note (« lieu non accessible en fauteuil » counts)
    if (!d.accessibilityFeatures.length && !(d.accessibilityNote && d.accessibilityNote.length >= 10)) p.push('ACCESSIBILITY_INFORMATION_REQUIRED');
  }
  return p;
}

const draftOfRow = (row) => normaliseDraft({ ...row, translations: row.translations || {} }, row.kind);

/* -------------------------------------------------------------------------------------------------------------------------- the editorial */

/** the editorial workflow @param {{ db?: any, now?: () => Date, env?: Record<string, string | undefined> }} [deps] */
export function academyEditorial({ db = defaultDb, now = () => new Date(), env = process.env } = {}) {
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'AcademyItem', entity_id: id, details }).catch(() => {});
  const getRow = async (id) => (await db.select().from(AcademyItem).where(eq(AcademyItem.id, String(id))).limit(1))[0] || null;
  const mustGet = async (id) => { const row = await getRow(id); if (!row) throw err('NOT_FOUND', 404); return row; };

  return {
    async list(status) {
      await requireSchema(db);
      const where = status ? eq(AcademyItem.status, status) : undefined;
      const rows = await db.select({ id: AcademyItem.id, kind: AcademyItem.kind, status: AcademyItem.status, slug: AcademyItem.slug, title: AcademyItem.title,
        startsAt: AcademyItem.startsAt, capacity: AcademyItem.capacity, updatedAt: AcademyItem.updatedAt }).from(AcademyItem).where(where).orderBy(desc(AcademyItem.updatedAt)).limit(200);
      const counts = await registrationCounts(db, rows.filter((r) => r.kind === 'EVENT').map((r) => r.id));
      return rows.map((r) => (r.kind === 'EVENT' ? { ...r, attendance: attendanceOf(r.capacity, counts.get(r.id)) } : r));
    },
    /** one item with everything the editor needs, the problems before approval and the organizer's counts (never a person) */
    async get(id) {
      await requireSchema(db);
      const row = await getRow(id); if (!row) return null;
      const out = { ...row, problems: approvalProblems(draftOfRow(row), row.kind, now()) };
      if (row.kind === 'EVENT') out.attendance = attendanceOf(row.capacity, (await registrationCounts(db, [row.id])).get(row.id));
      return out;
    },
    /** create (kind required) or update a draft; editing an item in review sends it back to draft */
    async save(actor, input, id = null) {
      await requireSchema(db);
      const at = now();
      if (id) {
        const row = await mustGet(id);
        if (![STATES.draft, STATES.review].includes(row.status)) throw err('PUBLISHED_ITEM_NOT_EDITABLE', 409);
        const d = normaliseDraft(input, row.kind);
        if (d.title.length < 3) throw err('TITLE_REQUIRED');
        await db.update(AcademyItem).set({ ...d, status: STATES.draft, updatedBy: actor, updatedAt: at }).where(eq(AcademyItem.id, row.id));
        await audit('ACADEMY_SAVE', actor, row.id, { kind: row.kind });
        return { id: row.id, status: STATES.draft, problems: approvalProblems(d, row.kind, at) };
      }
      const kind = KINDS.includes(input?.kind) ? input.kind : null;
      if (!kind) throw err('KIND_REQUIRED');
      const d = normaliseDraft(input, kind);
      if (d.title.length < 3) throw err('TITLE_REQUIRED');
      const newId = crypto.randomUUID();
      await db.insert(AcademyItem).values({ id: newId, kind, status: STATES.draft, ...d, createdBy: actor, updatedBy: actor, createdAt: at, updatedAt: at });
      await audit('ACADEMY_CREATE', actor, newId, { kind });
      return { id: newId, status: STATES.draft, problems: approvalProblems(d, kind, at) };
    },
    async submit(actor, id) {
      await requireSchema(db);
      const row = await mustGet(id);
      if (row.status !== STATES.draft) throw err('NOT_A_DRAFT', 409);
      await db.update(AcademyItem).set({ status: STATES.review, submittedBy: actor, updatedBy: actor, updatedAt: now() }).where(eq(AcademyItem.id, row.id));
      await audit('ACADEMY_SUBMIT', actor, row.id); return { id: row.id, status: STATES.review };
    },
    async reject(actor, id, note) {
      await requireSchema(db);
      const row = await mustGet(id);
      if (row.status !== STATES.review) throw err('NOT_IN_REVIEW', 409);
      await db.update(AcademyItem).set({ status: STATES.draft, reviewNote: plain(note, 500) || 'Renvoyé en rédaction', updatedBy: actor, updatedAt: now() }).where(eq(AcademyItem.id, row.id));
      await audit('ACADEMY_REJECT', actor, row.id); return { id: row.id, status: STATES.draft };
    },
    async approve(actor, id) {
      await requireSchema(db);
      const row = await mustGet(id);
      if (row.status !== STATES.review) throw err('NOT_IN_REVIEW', 409);
      const at = now();
      const problems = approvalProblems(draftOfRow(row), row.kind, at);
      if (env.ACADEMY_EDITORIAL_FOUR_EYES === 'on' && (row.createdBy === actor || row.submittedBy === actor)) problems.push('FOUR_EYES_APPROVER_IS_AUTHOR');
      if (problems.length) throw err('APPROVAL_REFUSED', 422, { problems });
      let slug = `${slugify(row.title) || (row.kind === 'EVENT' ? 'evenement' : 'academie')}-${String(row.id).slice(0, 6)}`;
      const clash = await db.select({ id: AcademyItem.id }).from(AcademyItem).where(eq(AcademyItem.slug, slug)).limit(1);
      if (clash[0] && clash[0].id !== row.id) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
      await db.update(AcademyItem).set({ status: STATES.published, slug: row.slug || slug, approvedBy: actor, approvedAt: at, publishedAt: at, updatedBy: actor, updatedAt: at })
        .where(eq(AcademyItem.id, row.id));
      await audit('ACADEMY_APPROVE', actor, row.id, { kind: row.kind });
      return { id: row.id, status: STATES.published, slug: row.slug || slug };
    },
    /** a published EVENT is cancelled: it stays listed as cancelled, registration stops, the registered persons see EVENT_CANCELLED in their centre */
    async cancel(actor, id, note) {
      await requireSchema(db);
      const row = await mustGet(id);
      if (row.kind !== 'EVENT' || row.status !== STATES.published) throw err('NOT_A_PUBLISHED_EVENT', 409);
      const n = plain(note, 500); if (n.length < 10) throw err('CANCELLATION_NOTE_REQUIRED');
      const at = now();
      await db.update(AcademyItem).set({ status: STATES.cancelled, statusNote: n, cancelledAt: at, updatedBy: actor, updatedAt: at }).where(eq(AcademyItem.id, row.id));
      await audit('ACADEMY_CANCEL', actor, row.id); return { id: row.id, status: STATES.cancelled };
    },
    /** a published LESSON is withdrawn: its address answers 410 (never silently deleted) */
    async withdraw(actor, id, note) {
      await requireSchema(db);
      const row = await mustGet(id);
      if (row.kind !== 'LESSON' || row.status !== STATES.published) throw err('NOT_A_PUBLISHED_LESSON', 409);
      const n = plain(note, 500); if (n.length < 10) throw err('WITHDRAWAL_NOTE_REQUIRED');
      await db.update(AcademyItem).set({ status: STATES.withdrawn, statusNote: n, updatedBy: actor, updatedAt: now() }).where(eq(AcademyItem.id, row.id));
      await audit('ACADEMY_WITHDRAW', actor, row.id); return { id: row.id, status: STATES.withdrawn };
    },
  };
}

/** registered count and count per accessibility need, per event @param {any} db @param {string[]} ids @returns {Promise<Map<string, { registered: number, needs: Record<string, number> }>>} */
async function registrationCounts(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await db.select({ itemId: EventRegistration.itemId, need: EventRegistration.accessibilityNeed, n: sql`count(*)::int` }).from(EventRegistration)
    .where(and(inArray(EventRegistration.itemId, ids), eq(EventRegistration.status, 'REGISTERED'))).groupBy(EventRegistration.itemId, EventRegistration.accessibilityNeed);
  for (const r of rows) {
    const c = out.get(r.itemId) || { registered: 0, needs: {} };
    c.registered += Number(r.n);
    if (r.need) c.needs[r.need] = (c.needs[r.need] || 0) + Number(r.n);
    out.set(r.itemId, c);
  }
  return out;
}
/** the organizer's view of an event: numbers only @param {number | null} capacity @param {{ registered: number, needs: Record<string, number> } | undefined} c */
function attendanceOf(capacity, c) {
  const registered = c?.registered || 0;
  return { capacity, registered, remaining: Math.max(0, (capacity || 0) - registered), needs: c?.needs || {} };
}

/* ------------------------------------------------------------------------------------------------------------------------------- public */

/** the public fields of a published item (no editor, no reviewer, no note) @param {any} r @param {number} [registered] */
function publicItem(r, registered) {
  const base = { slug: r.slug, kind: r.kind, status: r.status, title: r.title, summary: r.summary, translations: r.translations || {}, publishedAt: r.publishedAt };
  if (r.kind !== 'EVENT') return base;
  return { ...base, organizerName: r.organizerName, startsAt: r.startsAt, endsAt: r.endsAt, registrationClosesAt: r.registrationClosesAt,
    venueName: r.venueName, venueAddress: r.venueAddress, venueCommune: r.venueCommune, capacity: r.capacity,
    remaining: r.status === STATES.published ? Math.max(0, r.capacity - (registered || 0)) : 0,
    accessibilityFeatures: r.accessibilityFeatures || [], accessibilityNote: r.accessibilityNote };
}

/** registration is possible now (published, not started, not closed) @param {any} r @param {Date} now */
export function registrationOpen(r, now = new Date()) {
  if (!r || r.kind !== 'EVENT' || r.status !== STATES.published || !r.startsAt) return false;
  const closes = r.registrationClosesAt ? new Date(r.registrationClosesAt) : new Date(r.startsAt);
  return now < closes && now < new Date(r.startsAt);
}

/**
 * The public list: published lessons; published or cancelled events that have not ended yet, soonest first. Empty on a database without 0053.
 * @param {'LESSON' | 'EVENT'} kind @param {{ db?: any, now?: Date }} [o]
 */
export async function publicList(kind, { db = defaultDb, now = new Date() } = {}) {
  if (!KINDS.includes(kind) || !(await academySchemaAvailable(db))) return [];
  if (kind === 'LESSON') {
    const rows = await db.select().from(AcademyItem).where(and(eq(AcademyItem.kind, 'LESSON'), eq(AcademyItem.status, STATES.published))).orderBy(desc(AcademyItem.publishedAt)).limit(LIST_LIMIT);
    return rows.map((r) => publicItem(r));
  }
  const rows = await db.select().from(AcademyItem).where(and(eq(AcademyItem.kind, 'EVENT'), inArray(AcademyItem.status, [STATES.published, STATES.cancelled]),
    sql`${AcademyItem.endsAt} > ${now}`)).orderBy(asc(AcademyItem.startsAt)).limit(LIST_LIMIT);
  const counts = await registrationCounts(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...publicItem(r, counts.get(r.id)?.registered), registrationOpen: registrationOpen(r, now) }));
}

/** one public item by its address: { item } | { gone: true } (withdrawn) | null @param {string} slug @param {{ db?: any, now?: Date }} [o] */
export async function publicDetail(slug, { db = defaultDb, now = new Date() } = {}) {
  if (!/^[a-z0-9-]{3,90}$/.test(String(slug || '')) || !(await academySchemaAvailable(db))) return null;
  const [r] = await db.select().from(AcademyItem).where(eq(AcademyItem.slug, String(slug))).limit(1);
  if (!r || [STATES.draft, STATES.review].includes(r.status)) return null;
  if (r.status === STATES.withdrawn) return { gone: true };
  const registered = r.kind === 'EVENT' ? (await registrationCounts(db, [r.id])).get(r.id)?.registered : undefined;
  return { item: { ...publicItem(r, registered), ...(r.kind === 'EVENT' ? { registrationOpen: registrationOpen(r, now), ended: new Date(r.endsAt) <= now } : {}), body: r.body,
    translations: r.translations || {} } };
}

/* ------------------------------------------------------------------------------------------------------------------------------ citizen */

/** the separate, never pre-ticked agreement that goes with an accessibility need: only the boolean true counts @param {unknown} v */
export const needConsentGiven = (v) => v === true;

/** @param {unknown} v @returns {{ ok: true, value: string | null } | { ok: false }} */
function needOf(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  return ACCESSIBILITY_NEEDS.includes(/** @type {string} */ (v)) ? { ok: true, value: /** @type {string} */ (v) } : { ok: false };
}

const refusal = (status, code, message) => ({ ok: false, status, code, message });
/** G14 (owner decision 22/11/2026, formulaire G14 question 3): the proof of the explicit consent (art. 7(1), art. 9(2)(a) RGPD) for an accessibility need —
 * one append-only ConsentLog row per decision (true when a need is given or changed, false when it is removed or the registration cancelled) */
export const NEED_CONSENT_PURPOSE = 'EVENT_ACCESSIBILITY_NEED';
export const NEED_CONSENT_VERSION = 'x04-need-2026-11-22';
/** @param {any} q @param {string} userId @param {string} registrationId @param {boolean} decision @param {Date} at */
async function needConsentRow(q, userId, registrationId, decision, at) {
  await q.insert(ConsentLog).values({ subject_type: 'CITIZEN_USER', subject_id: String(userId), purpose: NEED_CONSENT_PURPOSE, decision: decision === true,
    policy_version: NEED_CONSENT_VERSION, policy_hash: `${NEED_CONSENT_VERSION}:${NEED_CONSENT_PURPOSE}:${registrationId}`, collection_channel: 'account',
    guardian_involved: false, proof_level: decision === true ? 'EXPLICIT_CHECKBOX' : 'AUTHENTICATED_SESSION', created_at: at, ...(decision === true ? {} : { withdrawn_at: at }) });
}
const NEED_CONSENT_REFUSAL = refusal(400, 'NEED_CONSENT_REQUIRED', 'Pour transmettre votre besoin d’accessibilité à l’organisateur, cochez la case d’accord, ou choisissez « aucun » : l’inscription est possible sans besoin indiqué.');

/**
 * The citizen side. `isAdult(userId)` = api/_utils/age-policy.js isAdultAccount (injected for tests).
 * @param {{ db?: any, now?: () => Date, isAdult?: (userId: string) => Promise<boolean> }} [deps]
 */
export function eventRegistrations({ db = defaultDb, now = () => new Date(), isAdult } = {}) {
  const adult = isAdult || (async (id) => (await import('../_utils/age-policy.js')).isAdultAccount(id, db));
  const itemOf = async (q, itemId) => (await q.select().from(AcademyItem).where(eq(AcademyItem.id, String(itemId || ''))).limit(1))[0] || null;
  const regOf = async (q, userId, itemId) => (await q.select().from(EventRegistration)
    .where(and(eq(EventRegistration.citizenUserId, userId), eq(EventRegistration.itemId, String(itemId || '')))).limit(1))[0] || null;

  return {
    /** the person's own registrations (also cancelled ones and cancelled events), with what they need to find the event again */
    async mine(userId) {
      if (!(await academySchemaAvailable(db))) return { ok: true, status: 200, available: false, registrations: [] };
      const rows = await db.select({ itemId: EventRegistration.itemId, status: EventRegistration.status, accessibilityNeed: EventRegistration.accessibilityNeed,
        createdAt: EventRegistration.createdAt, cancelledAt: EventRegistration.cancelledAt, slug: AcademyItem.slug, title: AcademyItem.title, translations: AcademyItem.translations,
        eventStatus: AcademyItem.status, startsAt: AcademyItem.startsAt, endsAt: AcademyItem.endsAt, venueName: AcademyItem.venueName, venueCommune: AcademyItem.venueCommune })
        .from(EventRegistration).innerJoin(AcademyItem, eq(AcademyItem.id, EventRegistration.itemId)).where(eq(EventRegistration.citizenUserId, userId))
        .orderBy(asc(AcademyItem.startsAt)).limit(200);
      return { ok: true, status: 200, available: true, registrations: rows.map(({ translations, ...r }) => ({ ...r, titles: Object.fromEntries(Object.entries(translations || {}).map(([l, x]) => [l, x.title])) })) };
    },
    /** register (or register again after a cancellation) within the capacity; the event by its id or its public address @param {string} userId @param {{ itemId?: string, slug?: string, accessibilityNeed?: unknown, accessibilityNeedConsent?: unknown }} body */
    async register(userId, body = {}) {
      if (!(await academySchemaAvailable(db))) return refusal(503, 'ACADEMY_NOT_AVAILABLE', 'Les inscriptions aux événements ne sont pas disponibles sur ce service.');
      const need = needOf(body.accessibilityNeed);
      if (!need.ok) return refusal(400, 'UNKNOWN_ACCESSIBILITY_NEED', 'Besoin d’accessibilité inconnu : choisissez dans la liste proposée.');
      if (need.value && !needConsentGiven(body.accessibilityNeedConsent)) return NEED_CONSENT_REFUSAL;
      if (!(await adult(userId))) return refusal(403, 'ADULT_ACCOUNT_REQUIRED', 'L’inscription en ligne aux événements est réservée aux comptes de personnes de 18 ans ou plus (déclaration dans votre compte).');
      const at = now();
      return db.transaction(async (tx) => {
        // the event row is locked: two requests for the last place are served one after the other (the public page knows the event by its address)
        const [locked] = (await tx.execute(body.slug
          ? sql`SELECT id FROM "AcademyItem" WHERE slug = ${String(body.slug)} FOR UPDATE`
          : sql`SELECT id FROM "AcademyItem" WHERE id = ${String(body.itemId || '')} FOR UPDATE`)).rows;
        const item = locked ? await itemOf(tx, locked.id) : null;
        if (!item || item.kind !== 'EVENT' || [STATES.draft, STATES.review, STATES.withdrawn].includes(item.status)) return refusal(404, 'EVENT_NOT_FOUND', 'Événement introuvable.');
        if (!registrationOpen(item, at)) return refusal(409, 'REGISTRATION_CLOSED', 'Les inscriptions à cet événement sont closes (événement annulé, commencé ou date limite passée).');
        const existing = await regOf(tx, userId, item.id);
        if (existing?.status === 'REGISTERED') return refusal(409, 'ALREADY_REGISTERED', 'Vous êtes déjà inscrit ou inscrite à cet événement.');
        const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM "EventRegistration" WHERE "itemId" = ${item.id} AND status = 'REGISTERED'`)).rows;
        if (Number(n) >= item.capacity) return refusal(409, 'EVENT_FULL', 'Cet événement est complet.');
        const values = { status: 'REGISTERED', accessibilityNeed: need.value, accessibilityNeedAt: need.value ? at : null, cancelledAt: null, updatedAt: at };
        const regId = existing ? existing.id : crypto.randomUUID();
        if (existing) await tx.update(EventRegistration).set(values).where(eq(EventRegistration.id, existing.id));
        else await tx.insert(EventRegistration).values({ id: regId, itemId: item.id, citizenUserId: userId, createdAt: at, ...values });
        // G14 q3: the explicit consent to the need is proven in the same transaction (no proof, no need kept)
        if (need.value) await needConsentRow(tx, userId, regId, true, at);
        return { ok: true, status: existing ? 200 : 201, registered: true, itemId: item.id, accessibilityNeed: need.value };
      });
    },
    /** cancel the person's registration (the accessibility need is erased with it) */
    async cancel(userId, itemId) {
      if (!(await academySchemaAvailable(db))) return refusal(503, 'ACADEMY_NOT_AVAILABLE', 'Les inscriptions aux événements ne sont pas disponibles sur ce service.');
      const reg = await regOf(db, userId, itemId);
      if (!reg || reg.status !== 'REGISTERED') return refusal(404, 'REGISTRATION_NOT_FOUND', 'Aucune inscription en cours à cet événement.');
      const at = now();
      await db.transaction(async (tx) => {
        await tx.update(EventRegistration).set({ status: 'CANCELLED', accessibilityNeed: null, accessibilityNeedAt: null, cancelledAt: at, updatedAt: at })
          .where(and(eq(EventRegistration.id, reg.id), eq(EventRegistration.citizenUserId, userId)));
        if (reg.accessibilityNeed) await needConsentRow(tx, userId, reg.id, false, at);   // G14 q3: the need goes, its withdrawal is recorded
      });
      return { ok: true, status: 200, cancelled: true, itemId: reg.itemId };
    },
    /** change or remove the accessibility need of a current registration (a need again needs the agreement) */
    async setNeed(userId, itemId, needValue, consent) {
      if (!(await academySchemaAvailable(db))) return refusal(503, 'ACADEMY_NOT_AVAILABLE', 'Les inscriptions aux événements ne sont pas disponibles sur ce service.');
      const need = needOf(needValue);
      if (!need.ok) return refusal(400, 'UNKNOWN_ACCESSIBILITY_NEED', 'Besoin d’accessibilité inconnu : choisissez dans la liste proposée.');
      if (need.value && !needConsentGiven(consent)) return NEED_CONSENT_REFUSAL;
      const reg = await regOf(db, userId, itemId);
      if (!reg || reg.status !== 'REGISTERED') return refusal(404, 'REGISTRATION_NOT_FOUND', 'Aucune inscription en cours à cet événement.');
      const at = now();
      await db.transaction(async (tx) => {
        await tx.update(EventRegistration).set({ accessibilityNeed: need.value, accessibilityNeedAt: need.value ? at : null, updatedAt: at })
          .where(and(eq(EventRegistration.id, reg.id), eq(EventRegistration.citizenUserId, userId)));
        // G14 q3: a new or changed need = a new consent; a removed need = its withdrawal
        if (need.value && need.value !== reg.accessibilityNeed) await needConsentRow(tx, userId, reg.id, true, at);
        else if (!need.value && reg.accessibilityNeed) await needConsentRow(tx, userId, reg.id, false, at);
      });
      return { ok: true, status: 200, itemId: reg.itemId, accessibilityNeed: need.value };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------- notification centre, DSR */

/**
 * The person's event notices for the notification centre (citizen-inbox.js): { ref, kind, at, link } — never a title, a place or a need.
 *   EVENT_REMINDER   a current registration to a published event that starts within REMINDER_WINDOW_HOURS (time = the window's start)
 *   EVENT_CANCELLED  a current registration to an event the organizer cancelled (time = the cancellation), until the event's planned end
 * @param {string} userId @param {{ db?: any, now?: Date, limit?: number }} [o]
 */
export async function eventInboxItems(userId, { db = defaultDb, now = new Date(), limit = 50 } = {}) {
  if (!(await academySchemaAvailable(db))) return [];
  const w = REMINDER_WINDOW_HOURS * 3600e3;
  const res = await db.execute(sql`SELECT r.id, i.status, i."startsAt" AS starts, i."cancelledAt" AS cancelled FROM "EventRegistration" r JOIN "AcademyItem" i ON i.id = r."itemId"
    WHERE r."citizenUserId" = ${userId} AND r.status = 'REGISTERED' AND i.kind = 'EVENT' AND (
      (i.status = 'published' AND i."startsAt" > ${now} AND i."startsAt" <= ${new Date(now.getTime() + w)})
      OR (i.status = 'cancelled' AND i."endsAt" > ${now})) LIMIT ${limit}`);
  return (res.rows || []).map((r) => (r.status === 'cancelled'
    ? { ref: `ec:${r.id}`, kind: 'EVENT_CANCELLED', at: r.cancelled, link: MY_EVENTS_LINK }
    : { ref: `er:${r.id}:${new Date(r.starts).getTime()}`, kind: 'EVENT_REMINDER', at: new Date(new Date(r.starts).getTime() - w), link: MY_EVENTS_LINK }));
}

/**
 * Art. 15 / 20 export section (export-account-sections.js): the person's registrations — the event, the state, the times and the accessibility need they
 * chose. The caller asks academySchemaAvailable() first (nothing on a database without 0053, not a failed read). @param {string} userId
 */
export function eventRegistrationsExportSql(userId) {
  return sql`SELECT r."itemId", i.title AS event, i."startsAt", i.status AS "eventStatus", r.status, r."accessibilityNeed", r."accessibilityNeedAt", r."createdAt", r."cancelledAt"
    FROM "EventRegistration" r JOIN "AcademyItem" i ON i.id = r."itemId" WHERE r."citizenUserId" = ${userId} ORDER BY r."createdAt"`;
}
