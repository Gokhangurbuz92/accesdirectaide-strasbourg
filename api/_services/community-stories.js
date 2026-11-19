// @ts-nocheck
/**
 * X01 (EXPANSION, founder authorization 19/11/2026 — not one of the 173) — Community stories (« histoires ») with moderation: the only reader / writer of
 * CommunityMember, CommunityStory and CommunityStoryReport (drizzle/0055_x01_community_stories.sql). Canonical row X01: « Posting, reporting, moderation,
 * takedown; minors rules; no personal data leaks ». No comments or replies (not in the row).
 *
 * The PSEUDONYMOUS PRINCIPAL (R47 § 8 — « a new public principal so CitizenUser is never exposed »): an adult account JOINS the community by choosing a
 *   pseudonym (never prefilled, never derived from the e-mail; 3–24 letters / digits / « - » / « _ », no space, no « @ », not a run of 5 digits, not a
 *   reserved word such as « admin » or « modérateur », not the local part of the account's own e-mail; unique without regard to case; immutable). The member
 *   row has its own random id: the stories are keyed on it, not on the account. Everything public or shown to a moderator names the pseudonym only.
 *   LEAVE at any time: every pending or published story is withdrawn (text erased, withdrawal recorded in ConsentLog), then the member row is deleted with its
 *   stories and their reports (cascade).
 * Minors rule: accounts are adult-only (R42-A07); joining AND every submission re-check api/_utils/age-policy.js isAdultAccount (a missing declaration or the
 *   minor age band is refused 403). Nobody under 18 can post.
 * Citizen (api/_handlers/citizen/stories.js, citizenHandler: a verified citizen session, CSRF on writes, the per-account write rate limit):
 *   SUBMIT a story (title 5–120, text 50–3000 characters, language) with the explicit, never pre-ticked consent to publication (consent === true AND the
 *   consent wording version = STORY_CONSENT_VERSION). The consent is ONE append-only ConsentLog row (purpose COMMUNITY_STORY_PUBLICATION, the story id in
 *   policy_hash, proof EXPLICIT_CHECKBOX) written in the SAME transaction as the story: without its proof nothing is kept. REFUSED (not cleaned): markup or
 *   an image (HTML tag, Markdown image, data:image, an image file name), an e-mail address, a link or a web address, a social-media handle, a phone number.
 *   At most PENDING_MAX stories waiting for review and SUBMITS_PER_DAY submissions in 24 h per member. Nothing is public before a moderator approves it.
 *   WITHDRAW at any time (pending or published): the status becomes « withdrawn », the title and the text are ERASED (CHECK in the database), the reports on
 *   it are deleted, a ConsentLog row « decision false, withdrawn_at » is appended. The public list is read on every request (no-store): gone at once.
 *   REPORT a published story (account needed — same reasons as X02: an anonymous form would need IP processing and could be flooded to force takedowns):
 *   ONE reason from a closed list, once per account and story, never one's own, at most REPORTS_PER_DAY in 24 h. A report never hides a story by itself.
 * Moderation (api/_handlers/admin/stories.js, adminGate WRITE for reading too — a NAMED administrator with MFA; every read and decision audited): approve
 *   (re-checks the content rules, the pseudonym rules and the public-wording rule « vous avez droit » → 422), reject / take down (title and text ERASED,
 *   reason from a closed list the person sees), dismiss the reports. The moderator sees the title, the text, the pseudonym, the language, the times and
 *   the COUNT of reports per reason — never the account, its e-mail, the member id, or who reported. The moderator never edits a story.
 * Public (api/_handlers/stories.js): published stories only — { id, pseudonym, title, body, lang, publishedAt }. Nothing else.
 * Without 0055 nothing is read: the public list is empty, every write answers 503 STORIES_NOT_AVAILABLE, the export sections are empty.
 * NO seed, NO sample: only real stories written by the persons themselves exist (tests use clearly labelled synthetic fixtures).
 */
import crypto from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, CommunityMember, CommunityStory, CommunityStoryReport, ConsentLog } from '../../src/db/schema.js';
import { claimsEntitlement } from '../lib/entitlementWording.js';

export const STATES = Object.freeze({ pending: 'pending', published: 'published', rejected: 'rejected', withdrawn: 'withdrawn', takenDown: 'taken_down' });
const ACTIVE = [STATES.pending, STATES.published];
/** the reasons of a report, a rejection or a takedown (closed list, the same as the CHECKs of drizzle/0055) */
export const REASONS = Object.freeze(['HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC']);
export const LANGS = Object.freeze(['fr', 'en', 'de', 'tr', 'ar', 'uk']);
export const CONSENT_PURPOSE = 'COMMUNITY_STORY_PUBLICATION';
/** the version of the consent wording shown next to the box (src/lib/communityStories.js shows the same); a LAB proposal until the controller validates it */
export const STORY_CONSENT_VERSION = 'x01-2026-11-19-lab-proposal';
export const TITLE_MIN = 5;
export const TITLE_MAX = 120;
export const BODY_MIN = 50;
export const BODY_MAX = 3000;
export const PENDING_MAX = 3;
export const SUBMITS_PER_DAY = 3;
export const REPORTS_PER_DAY = 5;
const LIST_LIMIT = 100;
const DAY = 86400e3;

/* --------------------------------------------------------------------------------------------------------------------------------- rules */

/** a pseudonym: 3–24 letters, digits, « - » or « _ », starting with a letter or a digit — no space (no « first name + surname »), no « @ », no dot */
export const PSEUDONYM = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]{2,23}$/u;
/** words a pseudonym may not contain: it would pass for the service, a moderator or an official body */
export const RESERVED = Object.freeze(['admin', 'moderat', 'modérat', 'accesdirectaide', 'support', 'staff', 'officiel', 'official', 'equipe', 'équipe']);
const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[._-]/g, '');

/**
 * what is wrong with a pseudonym (empty = acceptable). `email` (the account's own) refuses a pseudonym that IS its local part.
 * @param {string} pseudonym @param {string} [email] @returns {string[]}
 */
export function pseudonymProblems(pseudonym, email) {
  const p = String(pseudonym ?? '');
  if (!PSEUDONYM.test(p)) return ['PSEUDONYM_INVALID'];
  const out = [];
  // the most specific first: the code returned to the person is the first one
  const local = String(email || '').split('@')[0];
  if (local && fold(local) === fold(p)) out.push('PSEUDONYM_FROM_EMAIL');
  if (/\d{5,}/.test(p)) out.push('PSEUDONYM_LOOKS_LIKE_CONTACT');
  const low = p.toLowerCase();
  if (RESERVED.some((w) => low.includes(w))) out.push('PSEUDONYM_RESERVED');
  return out;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:fr|com|org|net|eu|info|io|app|ly|ua|gouv)\b/i;
const HANDLE = /(?:^|[\s(])@[\p{L}\p{N}_.]{2,}/u;
const PHONE = /(?:\+|00)\d[\d .-]{7,}\d|\b0\d(?:[ .-]?\d{2}){4}\b/;
/** markup or an image: an HTML tag, a Markdown image, a data: image, an image file name — refused, never silently cleaned */
const MARKUP_OR_IMAGE = /<\s*\/?\s*[a-z!?][^>]*>|!\[[^\]]*\]\s*\(|data:image\/|\b[\w-]+\.(?:jpe?g|png|gif|webp|heic|bmp|svg|tiff?)\b/i;

/** control characters removed (new lines kept), spaces tidied, trimmed — markup is REFUSED before this (contentProblems on the raw input) */
const isControl = (ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10) || c === 127; };
export const tidy = (s, max = 4000) => [...String(s ?? '').replace(/\r\n?/g, '\n')].filter((ch) => !isControl(ch)).join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/**
 * what is wrong with a story's content (empty = acceptable)
 * @param {{ title?: string, body?: string }} story @returns {string[]}
 */
export function contentProblems({ title, body }) {
  const p = [];
  const t = String(title ?? ''); const b = String(body ?? '');
  if (t.length < TITLE_MIN) p.push('TITLE_TOO_SHORT');
  if (t.length > TITLE_MAX) p.push('TITLE_TOO_LONG');
  if (b.length < BODY_MIN) p.push('BODY_TOO_SHORT');
  if (b.length > BODY_MAX) p.push('BODY_TOO_LONG');
  const all = `${t}\n${b}`;
  if (MARKUP_OR_IMAGE.test(all)) p.push('IMAGE_OR_MARKUP');
  if (EMAIL.test(all) || URL_LIKE.test(all) || HANDLE.test(all)) p.push('CONTACT_OR_LINK_IN_TEXT');
  if (PHONE.test(all)) p.push('PHONE_IN_TEXT');
  return p;
}
/** what blocks an approval: the content problems, the pseudonym rules, the public-wording rule (never « vous avez droit ») @param {{ title, body, pseudonym }} row */
export function approvalProblems(row) {
  const p = [...contentProblems(row), ...(row.pseudonym === undefined ? [] : pseudonymProblems(row.pseudonym))];
  if (claimsEntitlement(`${row.title || ''}\n${row.body || ''}`)) p.push('ENTITLEMENT_WORDING');
  return p;
}

const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });
const refusal = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });

/* ----------------------------------------------------------------------------------------------------------------------------------- schema */

const schemaCache = new WeakMap();
/** does this database have migration 0055 (read at most once a minute per client; a failed read is not remembered) @param {any} database */
export async function communitySchemaAvailable(database = defaultDb) {
  const hit = schemaCache.get(database);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const res = await database.execute(sql`SELECT to_regclass('"CommunityMember"') IS NOT NULL AND to_regclass('"CommunityStory"') IS NOT NULL AND to_regclass('"CommunityStoryReport"') IS NOT NULL AS ok`);
    const value = Boolean((res?.rows || res || [])[0]?.ok);
    schemaCache.set(database, { at: Date.now(), value });
    return value;
  } catch { return false; }
}
const NOT_AVAILABLE = refusal(503, 'STORIES_NOT_AVAILABLE', 'Les histoires de la communauté ne sont pas disponibles sur ce service.');
const ADULT_ONLY = refusal(403, 'ADULT_ACCOUNT_REQUIRED', 'La communauté est réservée aux comptes de personnes de 18 ans ou plus (déclaration dans votre compte).');

/** the consent ledger row of a decision on one story @param {any} q @param {string} userId @param {string} storyId @param {boolean} decision */
async function consentRow(q, userId, storyId, decision) {
  await q.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER', subject_id: String(userId), purpose: CONSENT_PURPOSE, decision: decision === true,
    policy_version: STORY_CONSENT_VERSION, policy_hash: `${STORY_CONSENT_VERSION}:${CONSENT_PURPOSE}:${storyId}`,
    collection_channel: 'account', guardian_involved: false, proof_level: decision === true ? 'EXPLICIT_CHECKBOX' : 'AUTHENTICATED_SESSION',
    ...(decision === true ? {} : { withdrawn_at: new Date() }),
  });
}

/** erase the active stories of a member inside a transaction (withdrawal by the person); returns their ids @param {any} tx @param {string} userId @param {any} where @param {Date} at */
async function eraseActive(tx, userId, where, at) {
  const rows = await tx.update(CommunityStory).set({ status: STATES.withdrawn, title: null, body: null, withdrawnAt: at, updatedAt: at })
    .where(and(where, inArray(CommunityStory.status, ACTIVE))).returning({ id: CommunityStory.id });
  if (rows.length) await tx.delete(CommunityStoryReport).where(inArray(CommunityStoryReport.storyId, rows.map((r) => r.id)));
  for (const r of rows) await consentRow(tx, userId, r.id, false);
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------------------------------------------------------------------ citizen */

/**
 * The citizen side. `isAdult(userId)` = api/_utils/age-policy.js isAdultAccount (injected for tests).
 * @param {{ db?: any, now?: () => Date, isAdult?: (userId: string) => Promise<boolean> }} [deps]
 */
export function citizenStories({ db = defaultDb, now = () => new Date(), isAdult } = {}) {
  const adult = isAdult || (async (id) => (await import('../_utils/age-policy.js')).isAdultAccount(id, db));
  const memberOf = async (userId) => (await db.select().from(CommunityMember).where(eq(CommunityMember.citizenUserId, String(userId))).limit(1))[0] || null;
  return {
    /** the person's pseudonym and own stories (all states: an erased one shows its state and reason, without text) */
    async mine(userId) {
      const base = { ok: true, status: 200, consentVersion: STORY_CONSENT_VERSION, limits: { pendingMax: PENDING_MAX, submitsPerDay: SUBMITS_PER_DAY } };
      if (!(await communitySchemaAvailable(db))) return { ...base, available: false, member: null, canSubmit: false, stories: [] };
      const member = await memberOf(userId);
      if (!member) return { ...base, available: true, member: null, canSubmit: false, stories: [] };
      const stories = await db.select({ id: CommunityStory.id, status: CommunityStory.status, title: CommunityStory.title, body: CommunityStory.body, lang: CommunityStory.lang,
        moderationReason: CommunityStory.moderationReason, submittedAt: CommunityStory.submittedAt, publishedAt: CommunityStory.publishedAt, withdrawnAt: CommunityStory.withdrawnAt,
        moderatedAt: CommunityStory.moderatedAt }).from(CommunityStory).where(eq(CommunityStory.memberId, member.id)).orderBy(desc(CommunityStory.submittedAt)).limit(100);
      const pending = stories.filter((s) => s.status === STATES.pending).length;
      return { ...base, available: true, member: { pseudonym: member.pseudonym, createdAt: member.createdAt }, canSubmit: pending < PENDING_MAX, stories };
    },
    /** join the community under a chosen pseudonym (adult accounts only) @param {{ id: string, email?: string }} citizen @param {any} body */
    async join(citizen, body = {}) {
      if (!(await communitySchemaAvailable(db))) return NOT_AVAILABLE;
      const pseudonym = String(body.pseudonym ?? '').normalize('NFC').trim();
      const problems = pseudonymProblems(pseudonym, citizen.email);
      if (problems.length) return refusal(400, problems[0], 'Ce pseudonyme ne peut pas être utilisé : 3 à 24 lettres ou chiffres, sans espace, sans « @ », sans lien avec votre adresse e-mail.', { problems });
      if (!(await adult(citizen.id))) return ADULT_ONLY;
      try {
        await db.insert(CommunityMember).values({ id: crypto.randomUUID(), citizenUserId: citizen.id, pseudonym, createdAt: now() });
      } catch (e) {
        if (String(e?.cause?.code || e?.code) === '23505') {
          const existing = await memberOf(citizen.id);
          return existing ? refusal(409, 'ALREADY_MEMBER', 'Vous avez déjà un pseudonyme dans la communauté.') : refusal(409, 'PSEUDONYM_TAKEN', 'Ce pseudonyme est déjà utilisé : choisissez-en un autre.');
        }
        throw e;
      }
      return { ok: true, status: 201, member: { pseudonym } };
    },
    /** leave the community: every active story withdrawn (text erased, withdrawal recorded), then the pseudonym and its stories deleted */
    async leave(userId) {
      if (!(await communitySchemaAvailable(db))) return NOT_AVAILABLE;
      const at = now();
      const out = await db.transaction(async (tx) => {
        const [member] = await tx.select().from(CommunityMember).where(eq(CommunityMember.citizenUserId, String(userId))).limit(1);
        if (!member) return null;
        const withdrawn = await eraseActive(tx, userId, eq(CommunityStory.memberId, member.id), at);
        await tx.delete(CommunityMember).where(eq(CommunityMember.id, member.id));
        return { withdrawn: withdrawn.length };
      });
      if (!out) return refusal(404, 'NOT_A_MEMBER', 'Vous n’avez pas de pseudonyme dans la communauté.');
      return { ok: true, status: 200, left: true, withdrawn: out.withdrawn };
    },
    /** submit a story (moderated before publication) with its explicit consent @param {{ id: string }} citizen @param {any} body */
    async submit(citizen, body = {}) {
      if (!(await communitySchemaAvailable(db))) return NOT_AVAILABLE;
      if (body.consent !== true || body.consentVersion !== STORY_CONSENT_VERSION) {
        return refusal(400, 'CONSENT_REQUIRED', 'Pour envoyer votre histoire, cochez la case d’accord à la publication (version actuelle du texte).');
      }
      const lang = LANGS.includes(body.lang) ? body.lang : null;
      if (!lang) return refusal(400, 'LANG_REQUIRED', 'Langue de l’histoire inconnue.');
      // tidy() removes control characters and extra spaces only: markup, an image, a link or a contact stays visible to the rules and is REFUSED
      const content = { title: tidy(body.title, TITLE_MAX + 1).replace(/\n+/g, ' '), body: tidy(body.body, BODY_MAX + 1) };
      const problems = contentProblems(content);
      if (problems.length) return refusal(400, problems[0], 'L’histoire ne peut pas être envoyée telle quelle : vérifiez le titre et le texte (sans image, lien ni coordonnées).', { problems });
      if (!(await adult(citizen.id))) return ADULT_ONLY;
      const member = await memberOf(citizen.id);
      if (!member) return refusal(409, 'PSEUDONYM_REQUIRED', 'Choisissez d’abord un pseudonyme pour la communauté.');
      const at = now();
      const [{ pending, recent }] = await db.select({
        pending: sql`count(*) FILTER (WHERE ${CommunityStory.status} = 'pending')::int`,
        recent: sql`count(*) FILTER (WHERE ${CommunityStory.submittedAt} > ${new Date(at.getTime() - DAY)})::int`,
      }).from(CommunityStory).where(eq(CommunityStory.memberId, member.id));
      if (Number(pending) >= PENDING_MAX) return refusal(409, 'TOO_MANY_PENDING', `Vous avez déjà ${PENDING_MAX} histoires en attente de relecture : attendez la décision avant d’en envoyer une autre.`);
      if (Number(recent) >= SUBMITS_PER_DAY) return refusal(429, 'SUBMIT_LIMIT', 'Vous avez atteint le nombre d’histoires possibles pour aujourd’hui.');
      const id = crypto.randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(CommunityStory).values({ id, memberId: member.id, status: STATES.pending, ...content, lang, consentVersion: STORY_CONSENT_VERSION, submittedAt: at, updatedAt: at });
        // the consent proof in the same transaction: without it, the story is not kept
        await consentRow(tx, citizen.id, id, true);
      });
      return { ok: true, status: 201, id, storyStatus: STATES.pending };
    },
    /** withdraw one's own story at any time: out of public view at once, title and text erased, consent withdrawal recorded */
    async withdraw(userId, id) {
      if (!(await communitySchemaAvailable(db))) return NOT_AVAILABLE;
      const at = now();
      const done = await db.transaction(async (tx) => {
        const [member] = await tx.select({ id: CommunityMember.id }).from(CommunityMember).where(eq(CommunityMember.citizenUserId, String(userId))).limit(1);
        if (!member) return [];
        return eraseActive(tx, userId, and(eq(CommunityStory.id, String(id)), eq(CommunityStory.memberId, member.id)), at);
      });
      // the same 404 for someone else's story, an unknown id and one already erased
      if (!done.length) return refusal(404, 'STORY_NOT_FOUND', 'Aucune histoire en attente ou publiée à retirer.');
      return { ok: true, status: 200, id: String(id), storyStatus: STATES.withdrawn, erased: true };
    },
    /** report a published story (once per account and story, REPORTS_PER_DAY a day); never one's own */
    async report(userId, id, reason) {
      if (!(await communitySchemaAvailable(db))) return NOT_AVAILABLE;
      if (!REASONS.includes(reason)) return refusal(400, 'UNKNOWN_REASON', 'Motif inconnu : choisissez dans la liste proposée.');
      const [row] = await db.select({ id: CommunityStory.id, ownerUserId: CommunityMember.citizenUserId }).from(CommunityStory)
        .innerJoin(CommunityMember, eq(CommunityMember.id, CommunityStory.memberId))
        .where(and(eq(CommunityStory.id, String(id)), eq(CommunityStory.status, STATES.published))).limit(1);
      if (!row) return refusal(404, 'STORY_NOT_FOUND', 'Histoire introuvable.');
      if (row.ownerUserId === userId) return refusal(409, 'OWN_STORY', 'Vous ne pouvez pas signaler votre propre histoire : vous pouvez la retirer.');
      const at = now();
      const [{ n }] = await db.select({ n: sql`count(*)::int` }).from(CommunityStoryReport)
        .where(and(eq(CommunityStoryReport.reporterUserId, userId), gt(CommunityStoryReport.createdAt, new Date(at.getTime() - DAY))));
      if (Number(n) >= REPORTS_PER_DAY) return refusal(429, 'REPORT_LIMIT', 'Vous avez atteint le nombre de signalements possibles pour aujourd’hui.');
      const inserted = await db.insert(CommunityStoryReport).values({ id: crypto.randomUUID(), storyId: row.id, reporterUserId: userId, reason, createdAt: at })
        .onConflictDoNothing().returning({ id: CommunityStoryReport.id });
      if (!inserted.length) return refusal(409, 'ALREADY_REPORTED', 'Vous avez déjà signalé cette histoire.');
      return { ok: true, status: 201, reported: true };
    },
  };
}

/* --------------------------------------------------------------------------------------------------------------------------- moderation */

/** report counts per story and reason @param {any} db @param {string[]} ids @returns {Promise<Map<string, { total: number, reasons: Record<string, number> }>>} */
async function reportCounts(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await db.select({ id: CommunityStoryReport.storyId, reason: CommunityStoryReport.reason, n: sql`count(*)::int` }).from(CommunityStoryReport)
    .where(inArray(CommunityStoryReport.storyId, ids)).groupBy(CommunityStoryReport.storyId, CommunityStoryReport.reason);
  for (const r of rows) {
    const c = out.get(r.id) || { total: 0, reasons: {} };
    c.total += Number(r.n); c.reasons[r.reason] = Number(r.n);
    out.set(r.id, c);
  }
  return out;
}

export const QUEUES = Object.freeze(['pending', 'reported', 'published']);

/** the moderation side @param {{ db?: any, now?: () => Date }} [deps] */
export function storyModeration({ db = defaultDb, now = () => new Date() } = {}) {
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'CommunityStory', entity_id: id, details }).catch(() => {});
  const requireSchema = async () => { if (!(await communitySchemaAvailable(db))) throw err('STORIES_NOT_AVAILABLE', 503); };
  // what a moderator sees: never the account, its e-mail or the member id
  const cols = { id: CommunityStory.id, status: CommunityStory.status, title: CommunityStory.title, body: CommunityStory.body, lang: CommunityStory.lang,
    pseudonym: CommunityMember.pseudonym, submittedAt: CommunityStory.submittedAt, publishedAt: CommunityStory.publishedAt };
  const joined = () => db.select(cols).from(CommunityStory).innerJoin(CommunityMember, eq(CommunityMember.id, CommunityStory.memberId));
  const decide = async (actor, id, from, to, reason, action) => {
    await requireSchema();
    if (to !== STATES.published && !REASONS.includes(reason)) throw err('REASON_REQUIRED');
    const [row] = await joined().where(eq(CommunityStory.id, String(id))).limit(1);
    if (!row) throw err('NOT_FOUND', 404);
    if (row.status !== from) throw err(from === STATES.pending ? 'NOT_PENDING' : 'NOT_PUBLISHED', 409);
    if (to === STATES.published) {
      const problems = approvalProblems(row);
      if (problems.length) throw err('APPROVAL_REFUSED', 422, { problems });
    }
    const at = now();
    const values = to === STATES.published
      ? { status: to, publishedAt: at, moderatedBy: actor, moderatedAt: at, moderationReason: null, updatedAt: at }
      : { status: to, title: null, body: null, moderatedBy: actor, moderatedAt: at, moderationReason: reason, updatedAt: at };
    const done = await db.transaction(async (tx) => {
      // compare-and-set on the state: a withdrawal by the person at the same moment wins, nothing is published after it
      const rows = await tx.update(CommunityStory).set(values).where(and(eq(CommunityStory.id, row.id), eq(CommunityStory.status, from))).returning({ id: CommunityStory.id });
      if (rows.length && to !== STATES.published) await tx.delete(CommunityStoryReport).where(eq(CommunityStoryReport.storyId, row.id));
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
      let rows;
      if (queue === 'pending') rows = await joined().where(eq(CommunityStory.status, STATES.pending)).orderBy(asc(CommunityStory.submittedAt)).limit(200);
      else if (queue === 'reported') {
        rows = await joined().where(and(eq(CommunityStory.status, STATES.published),
          sql`EXISTS (SELECT 1 FROM "CommunityStoryReport" r WHERE r."storyId" = ${CommunityStory.id})`)).orderBy(desc(CommunityStory.publishedAt)).limit(200);
      } else rows = await joined().where(eq(CommunityStory.status, STATES.published)).orderBy(desc(CommunityStory.publishedAt)).limit(200);
      const counts = await reportCounts(db, rows.map((r) => r.id));
      await audit('STORY_QUEUE_READ', actor, queue, { queue, count: rows.length });
      return rows.map((r) => ({ ...r, problems: r.status === STATES.pending ? approvalProblems(r) : [], reports: counts.get(r.id) || { total: 0, reasons: {} } }));
    },
    approve: (actor, id) => decide(actor, id, STATES.pending, STATES.published, null, 'STORY_APPROVE'),
    reject: (actor, id, reason) => decide(actor, id, STATES.pending, STATES.rejected, reason, 'STORY_REJECT'),
    takedown: (actor, id, reason) => decide(actor, id, STATES.published, STATES.takenDown, reason, 'STORY_TAKEDOWN'),
    /** the reports on a published story are unfounded: they are deleted (the story stays) */
    async dismissReports(actor, id) {
      await requireSchema();
      const [row] = await db.select({ id: CommunityStory.id, status: CommunityStory.status }).from(CommunityStory).where(eq(CommunityStory.id, String(id))).limit(1);
      if (!row) throw err('NOT_FOUND', 404);
      if (row.status !== STATES.published) throw err('NOT_PUBLISHED', 409);
      const gone = await db.delete(CommunityStoryReport).where(eq(CommunityStoryReport.storyId, row.id)).returning({ id: CommunityStoryReport.id });
      await audit('STORY_DISMISS_REPORTS', actor, row.id, { count: gone.length });
      return { id: row.id, status: row.status, dismissed: gone.length };
    },
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------- public */

/** the published stories, newest first: { id, pseudonym, title, body, lang, publishedAt } — nothing else. Empty without 0055. @param {{ db?: any }} [o] */
export async function publicStories({ db = defaultDb } = {}) {
  if (!(await communitySchemaAvailable(db))) return [];
  return db.select({ id: CommunityStory.id, pseudonym: CommunityMember.pseudonym, title: CommunityStory.title, body: CommunityStory.body, lang: CommunityStory.lang,
    publishedAt: CommunityStory.publishedAt }).from(CommunityStory).innerJoin(CommunityMember, eq(CommunityMember.id, CommunityStory.memberId))
    .where(eq(CommunityStory.status, STATES.published)).orderBy(desc(CommunityStory.publishedAt)).limit(LIST_LIMIT);
}

/* ----------------------------------------------------------------------------------------------------------------------------------- DSR */

/**
 * Art. 15 / 20 export sections (export-account-sections.js). The caller asks communitySchemaAvailable() first (nothing without 0055, not a failed read).
 *   communityMember        the pseudonym and the date the person joined
 *   communityStories       the person's stories: state, title and text while they exist, language, reason of a moderation decision, times
 *   communityStoryReports  the reports the person made: which story, the reason, the time (the reported text is not theirs: not included)
 * @param {string} userId
 */
export function communityMemberExportSql(userId) {
  return sql`SELECT m.pseudonym, m."createdAt" FROM "CommunityMember" m WHERE m."citizenUserId" = ${userId}`;
}
/** @param {string} userId */
export function communityStoriesExportSql(userId) {
  return sql`SELECT s.id, s.status, s.title, s.body, s.lang, s."consentVersion", s."moderationReason", s."submittedAt", s."publishedAt", s."moderatedAt", s."withdrawnAt"
    FROM "CommunityStory" s JOIN "CommunityMember" m ON m.id = s."memberId" WHERE m."citizenUserId" = ${userId} ORDER BY s."submittedAt"`;
}
/** @param {string} userId */
export function communityStoryReportsExportSql(userId) {
  return sql`SELECT r."storyId", r.reason, r."createdAt" FROM "CommunityStoryReport" r WHERE r."reporterUserId" = ${userId} ORDER BY r."createdAt"`;
}
