// @ts-nocheck
/**
 * X05 (EXPANSION, founder authorization 19/11/2026 — not one of the 173) — Inclusive employment job board: the only reader / writer of JobListing
 * (drizzle/0056_x05_job_board.sql). Canonical row X05: « Employer verification, listing moderation, GDPR for applicants » (depends on E01, A11).
 *
 * EMPLOYERS = the organizations ADA already verified (E01, api/_utils/org-eligibility.js isVerifiedActive: Structure.statut 'actif' AND verification_status
 *   'VERIFIED' — decided by an ADA reviewer with MFA and audited). No second, parallel employer verification exists: the canonical row depends on E01, and a
 *   separate SIRET-only check would be a weaker copy of it. Only a STRUCTURE_ADMIN of that organization manages its listings (api/_handlers/pro/employment.js:
 *   the professional session, its MFA rule, CSRF, the per-member rate limit). The verification is checked AGAIN at submission, at approval and on every public
 *   read: an organization that loses its verification (or becomes inactive) disappears from the board at once, without anything being deleted.
 * LISTINGS: draft → pending (moderation) → published → expired (its own end date, at most EXPIRY_MAX_DAYS ahead; a published listing whose date has passed is
 *   never served and is marked « expired » on the next read). Rejected (reason from a closed list) goes back to the employer, who can edit it (→ draft) and
 *   submit it again; withdrawn (by the employer) and taken down (by the moderation) are final. Required fields only: title, contract type (closed list),
 *   place (city + postal code), description, inclusive accommodations (closed list, at least one), how to apply, end date.
 *   REFUSED: any field that is not one of these — and with its own code FORBIDDEN_CRITERION any field naming a criterion of Code du travail article L1132-1
 *   (age, sex, origin, nationality, health, disability, pregnancy, family situation, religion, …): the board has no such field, by construction. Markup and
 *   images, an e-mail / a link / a phone number in the text (the only contact is the application channel), and the public-wording rule (never « vous avez
 *   droit », claimsEntitlement) are refused too. The text itself is read by a moderator before publication.
 * APPLICANTS — « GDPR for applicants » by minimisation: ADA STORES NOTHING about applicants. A listing shows the employer's OWN application channel (an https
 *   address or an e-mail address); the person applies there, directly. No form, no upload, no account, no click count, no log of who looked at what. The public
 *   page tells the person so, and that they never have to give a detail about their health or a disability to apply.
 * Moderation (api/_handlers/admin/employment.js, adminGate WRITE for reading too — a NAMED administrator with MFA; every read and decision in AuditLog): approve
 *   (re-checks the rules, the employer's verification and the end date → 422 with the problems), reject (reason, the employer can correct), take down a
 *   published listing (reason). The moderator never edits a listing.
 * Without 0056 nothing is read: the public list is empty, the employer side says « not available », every write answers 503 JOBS_NOT_AVAILABLE.
 * NO seed, NO sample: only listings written by verified employers exist (tests use clearly labelled synthetic fixtures).
 */
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, JobListing, Structure } from '../../src/db/schema.js';
import { claimsEntitlement } from '../lib/entitlementWording.js';
import { isVerifiedActive } from '../_utils/org-eligibility.js';

export const STATES = Object.freeze({ draft: 'draft', pending: 'pending', published: 'published', rejected: 'rejected', withdrawn: 'withdrawn', takenDown: 'taken_down', expired: 'expired' });
const EDITABLE = [STATES.draft, STATES.rejected];
const WITHDRAWABLE = [STATES.draft, STATES.pending, STATES.published, STATES.rejected];
export const CONTRACT_TYPES = Object.freeze(['CDI', 'CDD', 'CDDI', 'INTERIM', 'APPRENTISSAGE', 'PROFESSIONNALISATION', 'STAGE']);
/** the inclusive accommodations an employer can state (closed list, the same as the CHECK of drizzle/0056) */
export const ACCOMMODATIONS = Object.freeze(['STEP_FREE_ACCESS', 'ADAPTED_WORKSTATION', 'FLEXIBLE_HOURS', 'PART_TIME_POSSIBLE', 'TUTOR_SUPPORT', 'EASY_READ_INSTRUCTIONS',
  'SIGN_LANGUAGE_INTERPRETING', 'NO_DIPLOMA_REQUIRED', 'BEGINNERS_WELCOME', 'PUBLIC_TRANSPORT_ACCESS']);
/** the reasons of a rejection or a takedown (closed list, the same as the CHECK of drizzle/0056) */
export const REASONS = Object.freeze(['DISCRIMINATORY_CRITERION', 'MISLEADING_OR_ENTITLEMENT', 'HEALTH_DATA_REQUESTED', 'APPLICATION_CHANNEL', 'NOT_A_JOB_OFFER', 'INCOMPLETE']);
export const APPLY_METHODS = Object.freeze(['url', 'email']);
/** the fields a listing is made of — nothing else is accepted */
export const LISTING_FIELDS = Object.freeze(['title', 'contractType', 'city', 'postalCode', 'description', 'accommodations', 'applyMethod', 'applyTarget', 'expiresOn']);
export const L1132_1 = 'Code du travail, article L1132-1';
/**
 * Field names that would carry a criterion listed by Code du travail article L1132-1 (closed list, compared without case, accents or separators). A listing
 * holding one is refused FORBIDDEN_CRITERION — whatever its value. This is a technical refusal, not a legal assessment of the listing.
 */
export const FORBIDDEN_CRITERIA_FIELDS = Object.freeze(['age', 'agemin', 'agemax', 'minage', 'maxage', 'agerange', 'birthdate', 'dateofbirth', 'datedenaissance',
  'sex', 'sexe', 'gender', 'genre', 'origin', 'origine', 'ethnicity', 'ethnie', 'race', 'nationality', 'nationalite', 'religion', 'beliefs', 'convictions',
  'politicalopinions', 'opinionspolitiques', 'unionmembership', 'activitessyndicales', 'health', 'sante', 'healthstatus', 'etatdesante', 'disability', 'handicap',
  'pregnancy', 'grossesse', 'familysituation', 'situationdefamille', 'maritalstatus', 'situationfamiliale', 'sexualorientation', 'orientationsexuelle',
  'genderidentity', 'identitedegenre', 'physicalappearance', 'apparencephysique', 'surname', 'patronyme', 'nomdefamille', 'placeofresidence', 'lieuderesidence',
  'bankdomiciliation', 'domiciliationbancaire', 'economicvulnerability', 'vulnerabiliteeconomique', 'geneticcharacteristics', 'caracteristiquesgenetiques',
  'morals', 'moeurs', 'photo', 'photograph']);
export const TITLE_MIN = 5;
export const TITLE_MAX = 120;
export const CITY_MIN = 2;
export const CITY_MAX = 80;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 3000;
export const APPLY_TARGET_MAX = 300;
export const EXPIRY_MAX_DAYS = 90;
/** listings an employer may hold in draft, pending or published at once */
export const OPEN_MAX = 30;
const LIST_LIMIT = 200;

/* --------------------------------------------------------------------------------------------------------------------------------- rules */

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');
const FORBIDDEN = new Set(FORBIDDEN_CRITERIA_FIELDS);

/** the calendar day in Paris (YYYY-MM-DD) @param {Date} d */
export const parisDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** @param {string} day YYYY-MM-DD @param {number} n */
export const addDays = (day, n) => { const [y, m, dd] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDay = (s) => { const m = ISO_DAY.exec(String(s ?? '')); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.toISOString().slice(0, 10) === s; };

const EMAIL_ONLY = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_IN_TEXT = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:fr|com|org|net|eu|info|io|app|ly|gouv)\b/i;
const PHONE_IN_TEXT = /(?:\+|00)\d[\d .-]{7,}\d|\b0\d(?:[ .-]?\d{2}){4}\b/;
const MARKUP_OR_IMAGE = /<\s*\/?\s*[a-z!?][^>]*>|!\[[^\]]*\]\s*\(|data:image\/|\b[\w-]+\.(?:jpe?g|png|gif|webp|heic|bmp|svg|tiff?)\b/i;
const isControl = (ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10) || c === 127; };
const tidy = (s, max) => [...String(s ?? '').replace(/\r\n?/g, '\n')].filter((ch) => !isControl(ch)).join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/** an https address an applicant can open: no credentials, a real host @param {string} s */
export function validApplyUrl(s) {
  const v = String(s ?? '');
  if (v.length > APPLY_TARGET_MAX || !v.startsWith('https://') || /\s/.test(v)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && /\.[a-z]{2,}$/i.test(u.hostname); } catch { return false; }
}

/**
 * The fields of the body that are not listing fields: { forbidden } names a criterion of L1132-1, { unknown } anything else. `action` and `id` are the
 * request's own keys. @param {Record<string, unknown>} body
 */
export function extraFields(body = {}) {
  const forbidden = []; const unknown = [];
  for (const k of Object.keys(body || {})) {
    if (k === 'action' || k === 'id' || LISTING_FIELDS.includes(k)) continue;
    if (FORBIDDEN.has(fold(k))) forbidden.push(k); else unknown.push(k);
  }
  return { forbidden, unknown };
}

/** the listing as it will be stored (strings tidied, list deduplicated) — nothing is « cleaned » silently: the rules run on it @param {Record<string, unknown>} b */
export function normalize(b = {}) {
  return {
    title: tidy(b.title, TITLE_MAX + 1).replace(/\n+/g, ' '),
    contractType: String(b.contractType ?? ''),
    city: tidy(b.city, CITY_MAX + 1).replace(/\n+/g, ' '),
    postalCode: String(b.postalCode ?? '').trim(),
    description: tidy(b.description, DESCRIPTION_MAX + 1),
    accommodations: Array.isArray(b.accommodations) ? [...new Set(b.accommodations.map(String))] : [],
    applyMethod: String(b.applyMethod ?? ''),
    applyTarget: String(b.applyTarget ?? '').trim(),
    expiresOn: String(b.expiresOn ?? ''),
  };
}

/**
 * what is wrong with a listing (empty = acceptable). `today` = the Paris calendar day (the end date must be after it, at most EXPIRY_MAX_DAYS ahead).
 * @param {ReturnType<typeof normalize>} l @param {string} today
 */
export function listingProblems(l, today) {
  const p = [];
  if (l.title.length < TITLE_MIN) p.push('TITLE_TOO_SHORT');
  if (l.title.length > TITLE_MAX) p.push('TITLE_TOO_LONG');
  if (!CONTRACT_TYPES.includes(l.contractType)) p.push('CONTRACT_TYPE_REQUIRED');
  if (l.city.length < CITY_MIN || l.city.length > CITY_MAX) p.push('CITY_REQUIRED');
  if (!/^\d{5}$/.test(l.postalCode)) p.push('POSTAL_CODE_INVALID');
  if (l.description.length < DESCRIPTION_MIN) p.push('DESCRIPTION_TOO_SHORT');
  if (l.description.length > DESCRIPTION_MAX) p.push('DESCRIPTION_TOO_LONG');
  if (!l.accommodations.length) p.push('ACCOMMODATION_REQUIRED');
  else if (l.accommodations.length > ACCOMMODATIONS.length || l.accommodations.some((a) => !ACCOMMODATIONS.includes(a))) p.push('ACCOMMODATION_UNKNOWN');
  if (!APPLY_METHODS.includes(l.applyMethod)) p.push('APPLY_METHOD_REQUIRED');
  else if (l.applyMethod === 'url' ? !validApplyUrl(l.applyTarget) : !(EMAIL_ONLY.test(l.applyTarget) && l.applyTarget.length >= 6 && l.applyTarget.length <= 200)) p.push('APPLY_TARGET_INVALID');
  if (!validDay(l.expiresOn)) p.push('EXPIRY_INVALID');
  else if (l.expiresOn <= today) p.push('EXPIRY_IN_PAST');
  else if (l.expiresOn > addDays(today, EXPIRY_MAX_DAYS)) p.push('EXPIRY_TOO_FAR');
  const text = `${l.title}\n${l.city}\n${l.description}`;
  if (MARKUP_OR_IMAGE.test(text)) p.push('IMAGE_OR_MARKUP');
  if (EMAIL_IN_TEXT.test(text) || URL_IN_TEXT.test(text) || PHONE_IN_TEXT.test(text)) p.push('CONTACT_IN_TEXT');
  if (claimsEntitlement(`${l.title}\n${l.description}`)) p.push('ENTITLEMENT_WORDING');
  return p;
}

const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });
const refusal = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });

/* ----------------------------------------------------------------------------------------------------------------------------------- schema */

const schemaCache = new WeakMap();
/** does this database have migration 0056 (read at most once a minute per client; a failed read is not remembered) @param {any} database */
export async function jobBoardSchemaAvailable(database = defaultDb) {
  const hit = schemaCache.get(database);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const res = await database.execute(sql`SELECT to_regclass('"JobListing"') IS NOT NULL AS ok`);
    const value = Boolean((res?.rows || res || [])[0]?.ok);
    schemaCache.set(database, { at: Date.now(), value });
    return value;
  } catch { return false; }
}
const NOT_AVAILABLE = refusal(503, 'JOBS_NOT_AVAILABLE', 'Les offres d’emploi ne sont pas disponibles sur ce service.');

/** published listings whose end date has passed become « expired » (the public read never serves them anyway) @param {any} db @param {string} today */
async function expireDue(db, today) {
  await db.update(JobListing).set({ status: STATES.expired, updatedAt: new Date() }).where(and(eq(JobListing.status, STATES.published), lt(JobListing.expiresOn, today)));
}

/* ----------------------------------------------------------------------------------------------------------------------------- employer */

const MANAGER_ROLES = ['structure_admin'];
const ROLE_REFUSED = refusal(403, 'STRUCTURE_ADMIN_REQUIRED', 'Seul un administrateur de la structure gère ses offres d’emploi.');
const NOT_VERIFIED = refusal(403, 'EMPLOYER_NOT_VERIFIED', 'Seule une structure active et vérifiée par l’équipe ADA peut publier une offre d’emploi.');
const NOT_FOUND = refusal(404, 'LISTING_NOT_FOUND', 'Offre introuvable.');

/**
 * The employer side: a STRUCTURE_ADMIN of a verified organization. Every query is scoped to ctx.structureId: another organization's listing answers the same
 * 404 as an unknown id. `audit(action, ctx, details)` = logProAudit (injected for tests).
 * @param {{ db?: any, now?: () => Date, audit?: (action: string, ctx: any, details: Record<string, unknown>) => Promise<void> }} [deps]
 */
export function employerListings({ db = defaultDb, now = () => new Date(), audit } = {}) {
  const log = audit || (async (action, ctx, details) => (await import('../_utils/auth.js')).logProAudit(action, ctx.userId, ctx.structureId, details, null));
  const employer = async (structureId) => (await db.select({ id: Structure.id, nom: Structure.nom, statut: Structure.statut, verification_status: Structure.verification_status })
    .from(Structure).where(eq(Structure.id, String(structureId))).limit(1))[0] || null;
  const own = async (ctx, id) => (await db.select().from(JobListing).where(and(eq(JobListing.id, String(id)), eq(JobListing.structureId, ctx.structureId))).limit(1))[0] || null;
  const guard = async (ctx) => {
    if (!(await jobBoardSchemaAvailable(db))) return NOT_AVAILABLE;
    if (!MANAGER_ROLES.includes(String(ctx.role || '').toLowerCase())) return ROLE_REFUSED;
    return null;
  };
  /** the checked listing of a create / update body, or a refusal */
  const checked = (body) => {
    const extra = extraFields(body);
    if (extra.forbidden.length) {
      return refusal(400, 'FORBIDDEN_CRITERION', `Une offre ne peut pas contenir de critère de sélection interdit (${L1132_1}) : ${extra.forbidden.join(', ')}.`, { fields: extra.forbidden, legalBasis: L1132_1 });
    }
    if (extra.unknown.length) return refusal(400, 'UNKNOWN_FIELD', `Champ non prévu dans une offre : ${extra.unknown.join(', ')}.`, { fields: extra.unknown });
    const listing = normalize(body);
    const problems = listingProblems(listing, parisDay(now()));
    if (problems.length) return refusal(400, problems[0], 'L’offre ne peut pas être enregistrée telle quelle : vérifiez les champs signalés.', { problems });
    return { ok: true, listing };
  };
  return {
    /** the organization's listings (every state) and whether it may publish @param {{ structureId: string, role: string }} ctx */
    async mine(ctx) {
      const base = { ok: true, status: 200, limits: { openMax: OPEN_MAX, expiryMaxDays: EXPIRY_MAX_DAYS } };
      if (!(await jobBoardSchemaAvailable(db))) return { ...base, available: false, canManage: false, employerVerified: false, listings: [] };
      const canManage = MANAGER_ROLES.includes(String(ctx.role || '').toLowerCase());
      const s = await employer(ctx.structureId);
      await expireDue(db, parisDay(now()));
      const listings = canManage ? await db.select().from(JobListing).where(eq(JobListing.structureId, ctx.structureId)).orderBy(desc(JobListing.createdAt)).limit(LIST_LIMIT) : [];
      return { ...base, available: true, canManage, employerVerified: isVerifiedActive(s), employer: s ? { name: s.nom } : null,
        listings: listings.map(({ structureId, moderatedBy, ...l }) => l) };
    },
    /** a new draft @param {any} ctx @param {Record<string, unknown>} body */
    async create(ctx, body = {}) {
      const g = await guard(ctx); if (g) return g;
      const c = checked(body); if (!c.ok) return c;
      const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "JobListing" WHERE "structureId" = ${ctx.structureId} AND status IN ('draft', 'pending', 'published')`)).rows;
      if (Number(n) >= OPEN_MAX) return refusal(409, 'TOO_MANY_OPEN', `Votre structure a déjà ${OPEN_MAX} offres en cours : retirez-en une avant d’en créer une autre.`);
      const id = crypto.randomUUID(); const at = now();
      await db.insert(JobListing).values({ id, structureId: ctx.structureId, status: STATES.draft, ...c.listing, createdAt: at, updatedAt: at });
      await log('JOB_LISTING_CREATED', ctx, { listingId: id });
      return { ok: true, status: 201, id, listingStatus: STATES.draft };
    },
    /** edit a draft or a rejected listing (a rejected one goes back to draft) */
    async update(ctx, id, body = {}) {
      const g = await guard(ctx); if (g) return g;
      const c = checked(body); if (!c.ok) return c;
      const row = await own(ctx, id);
      if (!row) return NOT_FOUND;
      if (!EDITABLE.includes(row.status)) return refusal(409, 'NOT_EDITABLE', 'Seule une offre en brouillon ou refusée peut être modifiée : retirez celle-ci et créez-en une nouvelle.');
      const done = await db.update(JobListing).set({ ...c.listing, status: STATES.draft, moderationReason: null, updatedAt: now() })
        .where(and(eq(JobListing.id, row.id), eq(JobListing.structureId, ctx.structureId), inArray(JobListing.status, EDITABLE))).returning({ id: JobListing.id });
      if (!done.length) return refusal(409, 'STATE_CHANGED', 'L’offre a changé entre-temps : rechargez la page.');
      await log('JOB_LISTING_UPDATED', ctx, { listingId: row.id });
      return { ok: true, status: 200, id: row.id, listingStatus: STATES.draft };
    },
    /** send a draft to the moderation: the organization must be active AND verified, the listing must pass the rules on the day it is sent */
    async submit(ctx, id) {
      const g = await guard(ctx); if (g) return g;
      if (!isVerifiedActive(await employer(ctx.structureId))) return NOT_VERIFIED;
      const row = await own(ctx, id);
      if (!row) return NOT_FOUND;
      if (row.status !== STATES.draft) return refusal(409, 'NOT_DRAFT', 'Seule une offre en brouillon peut être envoyée à la relecture.');
      const problems = listingProblems(normalize(row), parisDay(now()));
      if (problems.length) return refusal(400, problems[0], 'Corrigez l’offre avant de l’envoyer à la relecture.', { problems });
      const at = now();
      const done = await db.update(JobListing).set({ status: STATES.pending, submittedAt: at, updatedAt: at })
        .where(and(eq(JobListing.id, row.id), eq(JobListing.structureId, ctx.structureId), eq(JobListing.status, STATES.draft))).returning({ id: JobListing.id });
      if (!done.length) return refusal(409, 'STATE_CHANGED', 'L’offre a changé entre-temps : rechargez la page.');
      await log('JOB_LISTING_SUBMITTED', ctx, { listingId: row.id });
      return { ok: true, status: 200, id: row.id, listingStatus: STATES.pending };
    },
    /** withdraw a listing at any time before it ends: out of public view at once (final) */
    async withdraw(ctx, id) {
      const g = await guard(ctx); if (g) return g;
      const at = now();
      const done = await db.update(JobListing).set({ status: STATES.withdrawn, withdrawnAt: at, updatedAt: at })
        .where(and(eq(JobListing.id, String(id)), eq(JobListing.structureId, ctx.structureId), inArray(JobListing.status, WITHDRAWABLE))).returning({ id: JobListing.id });
      if (!done.length) return refusal(404, 'LISTING_NOT_FOUND', 'Aucune offre en cours à retirer.');
      await log('JOB_LISTING_WITHDRAWN', ctx, { listingId: String(id) });
      return { ok: true, status: 200, id: String(id), listingStatus: STATES.withdrawn };
    },
    /** delete a draft that was never sent */
    async remove(ctx, id) {
      const g = await guard(ctx); if (g) return g;
      const gone = await db.delete(JobListing).where(and(eq(JobListing.id, String(id)), eq(JobListing.structureId, ctx.structureId), eq(JobListing.status, STATES.draft)))
        .returning({ id: JobListing.id });
      if (!gone.length) return refusal(404, 'LISTING_NOT_FOUND', 'Aucun brouillon à supprimer.');
      await log('JOB_LISTING_DELETED', ctx, { listingId: String(id) });
      return { ok: true, status: 200, id: String(id), deleted: true };
    },
  };
}

/* --------------------------------------------------------------------------------------------------------------------------- moderation */

export const QUEUES = Object.freeze(['pending', 'published']);

/** the moderation side @param {{ db?: any, now?: () => Date }} [deps] */
export function jobModeration({ db = defaultDb, now = () => new Date() } = {}) {
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'JobListing', entity_id: id, details }).catch(() => {});
  const requireSchema = async () => { if (!(await jobBoardSchemaAvailable(db))) throw err('JOBS_NOT_AVAILABLE', 503); };
  // what a moderator sees: the listing and its employer (public directory name, verification state) — never who wrote it
  const cols = { id: JobListing.id, status: JobListing.status, title: JobListing.title, contractType: JobListing.contractType, city: JobListing.city, postalCode: JobListing.postalCode,
    description: JobListing.description, accommodations: JobListing.accommodations, applyMethod: JobListing.applyMethod, applyTarget: JobListing.applyTarget, expiresOn: JobListing.expiresOn,
    submittedAt: JobListing.submittedAt, publishedAt: JobListing.publishedAt, employerName: Structure.nom, employerStatut: Structure.statut, employerVerification: Structure.verification_status };
  const joined = () => db.select(cols).from(JobListing).innerJoin(Structure, eq(Structure.id, JobListing.structureId));
  const problemsOf = (row, today) => [...listingProblems(normalize(row), today),
    ...(isVerifiedActive({ statut: row.employerStatut, verification_status: row.employerVerification }) ? [] : ['EMPLOYER_NOT_VERIFIED'])];
  const view = ({ employerStatut, employerVerification, ...r }, today) => ({ ...r, employerVerified: isVerifiedActive({ statut: employerStatut, verification_status: employerVerification }),
    problems: r.status === STATES.pending ? problemsOf({ employerStatut, employerVerification, ...r }, today) : [] });
  const decide = async (actor, id, from, to, reason, action) => {
    await requireSchema();
    if (to !== STATES.published && !REASONS.includes(reason)) throw err('REASON_REQUIRED');
    const [row] = await joined().where(eq(JobListing.id, String(id))).limit(1);
    if (!row) throw err('NOT_FOUND', 404);
    if (row.status !== from) throw err(from === STATES.pending ? 'NOT_PENDING' : 'NOT_PUBLISHED', 409);
    if (to === STATES.published) {
      const problems = problemsOf(row, parisDay(now()));
      if (problems.length) throw err('APPROVAL_REFUSED', 422, { problems });
    }
    const at = now();
    const values = to === STATES.published
      ? { status: to, publishedAt: at, moderatedBy: actor, moderatedAt: at, moderationReason: null, updatedAt: at }
      : { status: to, moderatedBy: actor, moderatedAt: at, moderationReason: reason, updatedAt: at };
    // compare-and-set on the state: a withdrawal by the employer at the same moment wins, nothing is published after it
    const rows = await db.update(JobListing).set(values).where(and(eq(JobListing.id, row.id), eq(JobListing.status, from))).returning({ id: JobListing.id });
    if (!rows.length) throw err('STATE_CHANGED', 409);
    await audit(action, actor, row.id, to === STATES.published ? {} : { reason });
    return { id: row.id, status: to };
  };
  return {
    /** a queue: pending (oldest first) or published (newest first) @param {string} actor @param {'pending' | 'published'} queue */
    async list(actor, queue = 'pending') {
      await requireSchema();
      const today = parisDay(now());
      await expireDue(db, today);
      const rows = queue === 'pending'
        ? await joined().where(eq(JobListing.status, STATES.pending)).orderBy(asc(JobListing.submittedAt)).limit(LIST_LIMIT)
        : await joined().where(eq(JobListing.status, STATES.published)).orderBy(desc(JobListing.publishedAt)).limit(LIST_LIMIT);
      await audit('JOB_QUEUE_READ', actor, queue, { queue, count: rows.length });
      return rows.map((r) => view(r, today));
    },
    approve: (actor, id) => decide(actor, id, STATES.pending, STATES.published, null, 'JOB_LISTING_APPROVE'),
    reject: (actor, id, reason) => decide(actor, id, STATES.pending, STATES.rejected, reason, 'JOB_LISTING_REJECT'),
    takedown: (actor, id, reason) => decide(actor, id, STATES.published, STATES.takenDown, reason, 'JOB_LISTING_TAKEDOWN'),
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------- public */

/**
 * The listings an applicant can read: published, end date not passed (Paris day), employer still active AND verified. Newest first. Only what the applicant
 * needs — never an ADA identifier of a person, never a moderator. Empty without 0056. @param {{ db?: any, now?: () => Date }} [o]
 */
export async function publicListings({ db = defaultDb, now = () => new Date() } = {}) {
  if (!(await jobBoardSchemaAvailable(db))) return [];
  const today = parisDay(now());
  await expireDue(db, today);
  return db.select({ id: JobListing.id, title: JobListing.title, contractType: JobListing.contractType, city: JobListing.city, postalCode: JobListing.postalCode,
    description: JobListing.description, accommodations: JobListing.accommodations, applyMethod: JobListing.applyMethod, applyTarget: JobListing.applyTarget,
    expiresOn: JobListing.expiresOn, publishedAt: JobListing.publishedAt, employerName: Structure.nom })
    .from(JobListing).innerJoin(Structure, eq(Structure.id, JobListing.structureId))
    .where(and(eq(JobListing.status, STATES.published), sql`${JobListing.expiresOn} >= ${today}`, eq(Structure.statut, 'actif'), eq(Structure.verification_status, 'VERIFIED')))
    .orderBy(desc(JobListing.publishedAt)).limit(LIST_LIMIT);
}

/**
 * PKG-11 / E08 — the closure of an organization withdraws its listings that are still open (inside the closure transaction). Skipped without 0056.
 * @param {any} tx @param {string} structureId @returns {Promise<number>}
 */
export async function withdrawForClosedOrganization(tx, structureId) {
  const has = (await tx.execute(sql`SELECT to_regclass('"JobListing"') IS NOT NULL AS ok`))?.rows?.[0]?.ok;
  if (!has) return 0;
  const r = await tx.execute(sql`UPDATE "JobListing" SET status = 'withdrawn', "withdrawnAt" = NOW(), "updatedAt" = NOW()
    WHERE "structureId" = ${structureId} AND status IN ('draft', 'pending', 'published', 'rejected')`);
  return r?.rowCount ?? 0;
}
