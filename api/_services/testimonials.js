// @ts-nocheck
/**
 * X02 (EXPANSION, founder authorization 19/11/2026 — not one of the 173) — Testimonials with consent and moderation: the only reader / writer of
 * Testimonial and TestimonialReport (drizzle/0054_x02_testimonials.sql).
 *
 * Citizen (api/_handlers/citizen/testimonials.js, citizenHandler: a verified citizen session, CSRF on writes):
 *   SUBMIT only for an ADULT account (api/_utils/age-policy.js isAdultAccount — the R42-A07 single entry point), with the explicit, never pre-ticked consent
 *   to publication (consent === true AND the consent wording version shown to the person = TESTIMONIAL_CONSENT_VERSION). The consent is ONE append-only
 *   ConsentLog row (purpose TESTIMONIAL_PUBLICATION, the testimonial id in policy_hash, proof EXPLICIT_CHECKBOX) written in the SAME transaction as the
 *   testimonial: without its proof nothing is kept (fail closed). Stored: the text (30–1500 characters, plain), the first name or pseudonym the person
 *   CHOSE (never prefilled, never the e-mail; one word with an optional initial « Marie D. » — no surname by default), the language, the times. At most one
 *   pending or published testimonial per account. No photo, no file.
 *   WITHDRAW at any time (pending or published): in one transaction the status becomes « withdrawn », the text and the name are ERASED (CHECK in the
 *   database), the open reports on it are deleted, and a ConsentLog row « decision false, withdrawn_at » is appended. The public list reads the table on
 *   every request (Cache-Control: no-store): the testimonial is gone from public view at once.
 *   REPORT a published testimonial (account needed — see below): ONE reason from a closed list, once per account and testimonial, at most
 *   REPORTS_PER_DAY reports per account in 24 h (plus the per-account write rate limit of citizenHandler). A report never hides a testimonial by itself:
 *   it puts it in the moderation queue.
 *   Why an account for reporting: an anonymous report form would need a new processing of IP addresses to be rate-limited, could be flooded to force
 *   takedowns, and no visitor loses anything (a person concerned by a testimonial can also write to the contact address of the legal notice).
 * Moderation (api/_handlers/admin/testimonials.js, adminGate WRITE for reading too: the queue holds unpublished texts — a NAMED administrator with MFA,
 *   every read and every decision audited): approve (re-checks everything here, never the form), reject, take down (a published one), dismiss the reports.
 *   Rejection and takedown ERASE the text and the name, with a reason from a closed list the person sees. The moderator sees the text, the chosen name,
 *   the language, the times and the COUNT of reports per reason — never the account, its e-mail, or who reported.
 * Public (api/_handlers/testimonials.js): published testimonials only — name, text, language, date, an opaque id (to report it). Nothing else.
 * Without 0054 (a database behind the code) nothing is read: the public list is empty, every write answers 503 TESTIMONIALS_NOT_AVAILABLE.
 * NO seed, NO sample: only real testimonials written by the persons themselves exist (tests use clearly labelled synthetic fixtures).
 */
import crypto from 'node:crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, ConsentLog, Testimonial, TestimonialReport } from '../../src/db/schema.js';
import { claimsEntitlement } from '../lib/entitlementWording.js';

export const STATES = Object.freeze({ pending: 'pending', published: 'published', rejected: 'rejected', withdrawn: 'withdrawn', takenDown: 'taken_down' });
const ACTIVE = [STATES.pending, STATES.published];
/** the reasons of a report, a rejection or a takedown (closed list, the same as the CHECKs of drizzle/0054) */
export const REASONS = Object.freeze(['HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC']);
export const LANGS = Object.freeze(['fr', 'en', 'de', 'tr', 'ar', 'uk']);
export const CONSENT_PURPOSE = 'TESTIMONIAL_PUBLICATION';
/** the version of the consent wording shown next to the box (src/lib/testimonials.js shows the same); a LAB proposal until the controller validates it */
export const TESTIMONIAL_CONSENT_VERSION = 'x02-v12-2026-11-23';
export const BODY_MIN = 30;
export const BODY_MAX = 1500;
export const REPORTS_PER_DAY = 5;
const LIST_LIMIT = 100;

/** plain text: markup removed, NUL and control characters removed (new lines kept), spaces tidied, trimmed */
const isControl = (ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10) || c === 127; };
export const plain = (s, max = 4000) => [...String(s ?? '').replace(/<[^>]*>/g, '')].filter((ch) => !isControl(ch)).join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
/** a first name or a pseudonym: one word (hyphens and apostrophes allowed), optionally followed by ONE initial (« Marie D. ») — letters only, no digits, no « @ » */
export const DISPLAY_NAME = /^\p{L}[\p{L}\p{M}'’-]{1,29}(?: \p{L}\.?)?$/u;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:fr|com|org|net|eu|info|io)\b/i;
const PHONE = /(?:\+|00)\d[\d .-]{7,}\d|\b0\d(?:[ .-]?\d{2}){4}\b/;

/**
 * what is wrong with a testimonial's content (empty = acceptable). The name is never prefilled by the service (not the e-mail, not the profile): the person
 * types it; DISPLAY_NAME refuses an e-mail address, digits and a full « first name + surname » (one word and at most an initial).
 * @returns {string[]}
 */
export function contentProblems({ displayName, body }) {
  const p = [];
  if (!DISPLAY_NAME.test(String(displayName ?? ''))) p.push('DISPLAY_NAME_INVALID');
  const text = String(body ?? '');
  if (text.length < BODY_MIN) p.push('BODY_TOO_SHORT');
  if (text.length > BODY_MAX) p.push('BODY_TOO_LONG');
  if (EMAIL.test(text) || URL_LIKE.test(text)) p.push('CONTACT_OR_LINK_IN_TEXT');
  if (PHONE.test(text)) p.push('PHONE_IN_TEXT');
  return p;
}
/** what the moderator must see before an approval: the content problems, plus the public-wording rule (never « vous avez droit ») */
export function approvalProblems(row) {
  const p = contentProblems(row);
  if (claimsEntitlement(row.body || '')) p.push('ENTITLEMENT_WORDING');
  return p;
}

const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });
const refusal = (status, code, message) => ({ ok: false, status, code, message });

/* ----------------------------------------------------------------------------------------------------------------------------------- schema */

const schemaCache = new WeakMap();
/** does this database have migration 0054 (read at most once a minute per client; a failed read is not remembered) @param {any} database */
export async function testimonialsSchemaAvailable(database = defaultDb) {
  const hit = schemaCache.get(database);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const res = await database.execute(sql`SELECT to_regclass('"Testimonial"') IS NOT NULL AND to_regclass('"TestimonialReport"') IS NOT NULL AS ok`);
    const value = Boolean((res?.rows || res || [])[0]?.ok);
    schemaCache.set(database, { at: Date.now(), value });
    return value;
  } catch { return false; }
}
const NOT_AVAILABLE = refusal(503, 'TESTIMONIALS_NOT_AVAILABLE', 'Les témoignages ne sont pas disponibles sur ce service.');

/** the consent ledger row of a decision on one testimonial @param {any} q @param {string} userId @param {string} testimonialId @param {boolean} decision */
async function consentRow(q, userId, testimonialId, decision) {
  await q.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER', subject_id: String(userId), purpose: CONSENT_PURPOSE, decision: decision === true,
    policy_version: TESTIMONIAL_CONSENT_VERSION, policy_hash: `${TESTIMONIAL_CONSENT_VERSION}:${CONSENT_PURPOSE}:${testimonialId}`,
    collection_channel: 'account', guardian_involved: false, proof_level: decision === true ? 'EXPLICIT_CHECKBOX' : 'AUTHENTICATED_SESSION',
    ...(decision === true ? {} : { withdrawn_at: new Date() }),
  });
}

/* ------------------------------------------------------------------------------------------------------------------------------ citizen */

/**
 * The citizen side. `isAdult(userId)` = api/_utils/age-policy.js isAdultAccount (injected for tests).
 * @param {{ db?: any, now?: () => Date, isAdult?: (userId: string) => Promise<boolean> }} [deps]
 */
export function citizenTestimonials({ db = defaultDb, now = () => new Date(), isAdult } = {}) {
  const adult = isAdult || (async (id) => (await import('../_utils/age-policy.js')).isAdultAccount(id, db));
  return {
    /** the person's own testimonials (all states: an erased one shows its state and reason, without text) and whether a new one can be written */
    async mine(userId) {
      if (!(await testimonialsSchemaAvailable(db))) return { ok: true, status: 200, available: false, testimonials: [], consentVersion: TESTIMONIAL_CONSENT_VERSION };
      const rows = await db.select({ id: Testimonial.id, status: Testimonial.status, displayName: Testimonial.displayName, body: Testimonial.body, lang: Testimonial.lang,
        moderationReason: Testimonial.moderationReason, submittedAt: Testimonial.submittedAt, publishedAt: Testimonial.publishedAt, withdrawnAt: Testimonial.withdrawnAt, moderatedAt: Testimonial.moderatedAt })
        .from(Testimonial).where(eq(Testimonial.citizenUserId, userId)).orderBy(desc(Testimonial.submittedAt)).limit(50);
      return { ok: true, status: 200, available: true, consentVersion: TESTIMONIAL_CONSENT_VERSION, canSubmit: !rows.some((r) => ACTIVE.includes(r.status)), testimonials: rows };
    },
    /** submit a testimonial (moderated before publication) with its explicit consent @param {{ id: string, email?: string }} citizen @param {any} body */
    async submit(citizen, body = {}) {
      if (!(await testimonialsSchemaAvailable(db))) return NOT_AVAILABLE;
      if (body.consent !== true || body.consentVersion !== TESTIMONIAL_CONSENT_VERSION) {
        return refusal(400, 'CONSENT_REQUIRED', 'Pour envoyer votre témoignage, cochez la case d’accord à la publication (version actuelle du texte).');
      }
      const lang = LANGS.includes(body.lang) ? body.lang : null;
      if (!lang) return refusal(400, 'LANG_REQUIRED', 'Langue du témoignage inconnue.');
      const content = { displayName: plain(body.displayName, 60), body: plain(body.body, BODY_MAX + 1) };
      const problems = contentProblems(content);
      if (problems.length) return { ...refusal(400, problems[0], 'Le témoignage ne peut pas être envoyé tel quel : vérifiez le prénom ou pseudonyme et le texte.'), problems };
      if (!(await adult(citizen.id))) return refusal(403, 'ADULT_ACCOUNT_REQUIRED', 'Les témoignages sont réservés aux comptes de personnes de 18 ans ou plus (déclaration dans votre compte).');
      const id = crypto.randomUUID();
      const at = now();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(Testimonial).values({ id, citizenUserId: citizen.id, status: STATES.pending, ...content, lang, consentVersion: TESTIMONIAL_CONSENT_VERSION, submittedAt: at, updatedAt: at });
          // the consent proof in the same transaction: without it, the testimonial is not kept
          await consentRow(tx, citizen.id, id, true);
        });
      } catch (e) {
        if (String(e?.cause?.code || e?.code) === '23505') return refusal(409, 'ALREADY_SUBMITTED', 'Vous avez déjà un témoignage en attente ou publié : retirez-le d’abord pour en écrire un autre.');
        throw e;
      }
      return { ok: true, status: 201, id, testimonialStatus: STATES.pending };
    },
    /** withdraw one's own testimonial at any time: out of public view at once, text and name erased, consent withdrawal recorded */
    async withdraw(userId, id) {
      if (!(await testimonialsSchemaAvailable(db))) return NOT_AVAILABLE;
      const at = now();
      const done = await db.transaction(async (tx) => {
        const rows = await tx.update(Testimonial).set({ status: STATES.withdrawn, body: null, displayName: null, withdrawnAt: at, updatedAt: at })
          .where(and(eq(Testimonial.id, String(id)), eq(Testimonial.citizenUserId, userId), inArray(Testimonial.status, ACTIVE))).returning({ id: Testimonial.id });
        if (!rows.length) return false;
        await tx.delete(TestimonialReport).where(eq(TestimonialReport.testimonialId, rows[0].id));
        await consentRow(tx, userId, rows[0].id, false);
        return true;
      });
      // the same 404 for someone else's testimonial, an unknown id and one already erased
      if (!done) return refusal(404, 'TESTIMONIAL_NOT_FOUND', 'Aucun témoignage en attente ou publié à retirer.');
      return { ok: true, status: 200, id: String(id), testimonialStatus: STATES.withdrawn, erased: true };
    },
    /** report a published testimonial (once per account and testimonial, REPORTS_PER_DAY a day); never one's own */
    async report(userId, id, reason) {
      if (!(await testimonialsSchemaAvailable(db))) return NOT_AVAILABLE;
      if (!REASONS.includes(reason)) return refusal(400, 'UNKNOWN_REASON', 'Motif inconnu : choisissez dans la liste proposée.');
      const [row] = await db.select({ id: Testimonial.id, citizenUserId: Testimonial.citizenUserId }).from(Testimonial)
        .where(and(eq(Testimonial.id, String(id)), eq(Testimonial.status, STATES.published))).limit(1);
      if (!row) return refusal(404, 'TESTIMONIAL_NOT_FOUND', 'Témoignage introuvable.');
      if (row.citizenUserId === userId) return refusal(409, 'OWN_TESTIMONIAL', 'Vous ne pouvez pas signaler votre propre témoignage : vous pouvez le retirer.');
      const at = now();
      const [{ n }] = (await db.select({ n: sql`count(*)::int` }).from(TestimonialReport)
        .where(and(eq(TestimonialReport.reporterUserId, userId), gt(TestimonialReport.createdAt, new Date(at.getTime() - 86400e3)))));
      if (Number(n) >= REPORTS_PER_DAY) return refusal(429, 'REPORT_LIMIT', 'Vous avez atteint le nombre de signalements possibles pour aujourd’hui.');
      const inserted = await db.insert(TestimonialReport).values({ id: crypto.randomUUID(), testimonialId: row.id, reporterUserId: userId, reason, createdAt: at })
        .onConflictDoNothing().returning({ id: TestimonialReport.id });
      if (!inserted.length) return refusal(409, 'ALREADY_REPORTED', 'Vous avez déjà signalé ce témoignage.');
      return { ok: true, status: 201, reported: true };
    },
  };
}

/* --------------------------------------------------------------------------------------------------------------------------- moderation */

/** report counts per testimonial and reason @param {any} db @param {string[]} ids @returns {Promise<Map<string, { total: number, reasons: Record<string, number> }>>} */
async function reportCounts(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await db.select({ id: TestimonialReport.testimonialId, reason: TestimonialReport.reason, n: sql`count(*)::int` }).from(TestimonialReport)
    .where(inArray(TestimonialReport.testimonialId, ids)).groupBy(TestimonialReport.testimonialId, TestimonialReport.reason);
  for (const r of rows) {
    const c = out.get(r.id) || { total: 0, reasons: {} };
    c.total += Number(r.n); c.reasons[r.reason] = Number(r.n);
    out.set(r.id, c);
  }
  return out;
}

export const QUEUES = Object.freeze(['pending', 'reported', 'published']);

/** the moderation side @param {{ db?: any, now?: () => Date }} [deps] */
export function testimonialModeration({ db = defaultDb, now = () => new Date() } = {}) {
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'Testimonial', entity_id: id, details }).catch(() => {});
  const requireSchema = async () => { if (!(await testimonialsSchemaAvailable(db))) throw err('TESTIMONIALS_NOT_AVAILABLE', 503); };
  const decide = async (actor, id, from, to, reason, action) => {
    await requireSchema();
    if (to !== STATES.published && !REASONS.includes(reason)) throw err('REASON_REQUIRED');
    const [row] = await db.select().from(Testimonial).where(eq(Testimonial.id, String(id))).limit(1);
    if (!row) throw err('NOT_FOUND', 404);
    if (row.status !== from) throw err(from === STATES.pending ? 'NOT_PENDING' : 'NOT_PUBLISHED', 409);
    const at = now();
    if (to === STATES.published) {
      const problems = approvalProblems(row);
      if (problems.length) throw err('APPROVAL_REFUSED', 422, { problems });
    }
    const values = to === STATES.published
      ? { status: to, publishedAt: at, moderatedBy: actor, moderatedAt: at, moderationReason: null, updatedAt: at }
      : { status: to, body: null, displayName: null, moderatedBy: actor, moderatedAt: at, moderationReason: reason, updatedAt: at };
    const done = await db.transaction(async (tx) => {
      // compare-and-set on the state: a withdrawal by the person at the same moment wins, nothing is published after it
      const rows = await tx.update(Testimonial).set(values).where(and(eq(Testimonial.id, row.id), eq(Testimonial.status, from))).returning({ id: Testimonial.id });
      if (rows.length && to !== STATES.published) await tx.delete(TestimonialReport).where(eq(TestimonialReport.testimonialId, row.id));
      return rows.length > 0;
    });
    if (!done) throw err('STATE_CHANGED', 409);
    await audit(action, actor, row.id, to === STATES.published ? {} : { reason });
    return { id: row.id, status: to };
  };
  return {
    /** a queue: pending (oldest first), reported (published with reports), published (newest first) @param {string} actor @param {'pending' | 'reported' | 'published'} queue */
    async list(actor, queue = 'pending') {
      await requireSchema();
      const cols = { id: Testimonial.id, status: Testimonial.status, displayName: Testimonial.displayName, body: Testimonial.body, lang: Testimonial.lang,
        submittedAt: Testimonial.submittedAt, publishedAt: Testimonial.publishedAt };
      let rows;
      if (queue === 'pending') rows = await db.select(cols).from(Testimonial).where(eq(Testimonial.status, STATES.pending)).orderBy(Testimonial.submittedAt).limit(200);
      else if (queue === 'reported') {
        rows = await db.select(cols).from(Testimonial).where(and(eq(Testimonial.status, STATES.published),
          sql`EXISTS (SELECT 1 FROM "TestimonialReport" r WHERE r."testimonialId" = ${Testimonial.id})`)).orderBy(desc(Testimonial.publishedAt)).limit(200);
      } else rows = await db.select(cols).from(Testimonial).where(eq(Testimonial.status, STATES.published)).orderBy(desc(Testimonial.publishedAt)).limit(200);
      const counts = await reportCounts(db, rows.map((r) => r.id));
      await audit('TESTIMONIAL_QUEUE_READ', actor, queue, { queue, count: rows.length });
      return rows.map((r) => ({ ...r, problems: r.status === STATES.pending ? approvalProblems(r) : [], reports: counts.get(r.id) || { total: 0, reasons: {} } }));
    },
    approve: (actor, id) => decide(actor, id, STATES.pending, STATES.published, null, 'TESTIMONIAL_APPROVE'),
    reject: (actor, id, reason) => decide(actor, id, STATES.pending, STATES.rejected, reason, 'TESTIMONIAL_REJECT'),
    takedown: (actor, id, reason) => decide(actor, id, STATES.published, STATES.takenDown, reason, 'TESTIMONIAL_TAKEDOWN'),
    /** the reports on a published testimonial are unfounded: they are deleted (the testimonial stays) */
    async dismissReports(actor, id) {
      await requireSchema();
      const [row] = await db.select({ id: Testimonial.id, status: Testimonial.status }).from(Testimonial).where(eq(Testimonial.id, String(id))).limit(1);
      if (!row) throw err('NOT_FOUND', 404);
      if (row.status !== STATES.published) throw err('NOT_PUBLISHED', 409);
      const gone = await db.delete(TestimonialReport).where(eq(TestimonialReport.testimonialId, row.id)).returning({ id: TestimonialReport.id });
      await audit('TESTIMONIAL_DISMISS_REPORTS', actor, row.id, { count: gone.length });
      return { id: row.id, status: row.status, dismissed: gone.length };
    },
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------- public */

/** the published testimonials, newest first: { id, displayName, body, lang, publishedAt } — nothing else. Empty without 0054. @param {{ db?: any }} [o] */
export async function publicTestimonials({ db = defaultDb } = {}) {
  if (!(await testimonialsSchemaAvailable(db))) return [];
  return db.select({ id: Testimonial.id, displayName: Testimonial.displayName, body: Testimonial.body, lang: Testimonial.lang, publishedAt: Testimonial.publishedAt })
    .from(Testimonial).where(eq(Testimonial.status, STATES.published)).orderBy(desc(Testimonial.publishedAt)).limit(LIST_LIMIT);
}

/* ----------------------------------------------------------------------------------------------------------------------------------- DSR */

/**
 * Art. 15 / 20 export sections (export-account-sections.js). The caller asks testimonialsSchemaAvailable() first (nothing without 0054, not a failed read).
 *   testimonials        the person's testimonials: state, chosen name and text while they exist, language, reason of a moderation decision, times
 *   testimonialReports  the reports the person made: which testimonial, the reason, the time (the reported text is not theirs: not included)
 * @param {string} userId
 */
export function testimonialsExportSql(userId) {
  return sql`SELECT t.id, t.status, t."displayName", t.body, t.lang, t."consentVersion", t."moderationReason", t."submittedAt", t."publishedAt", t."moderatedAt", t."withdrawnAt"
    FROM "Testimonial" t WHERE t."citizenUserId" = ${userId} ORDER BY t."submittedAt"`;
}
/** @param {string} userId */
export function testimonialReportsExportSql(userId) {
  return sql`SELECT r."testimonialId", r.reason, r."createdAt" FROM "TestimonialReport" r WHERE r."reporterUserId" = ${userId} ORDER BY r."createdAt"`;
}
