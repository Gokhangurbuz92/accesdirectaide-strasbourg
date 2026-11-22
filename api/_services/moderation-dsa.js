// @ts-nocheck
/**
 * G14 (owner decisions 22/11/2026, formulaire G14 questions 10, 11, 20, 28–31) — moderation staffing and the DSA flows of the expansion content.
 * The only reader / writer of ModerationRole, ContentNotice, ModerationDecision, ModerationAppeal and ModerationSanction (drizzle/0059_g14_moderation_dsa.sql).
 * Regulation (EU) 2022/2065 (DSA), French text read on EUR-Lex 22/11/2026 (https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2065).
 *
 * NAMED ROLES — fail closed. A role is held by an EXISTING administrator account that is enabled, has MFA and carries the NAME of its holder
 * (AdminUser.displayName); the account that assigns it is a named MFA administrator too (adminGate write), and every change is audited.
 *   MODERATOR                 decides on X02 testimonials, X01 stories, X05 job listings, notices and appeals (and X03, with the safety officer)
 *   ENTRAIDE_SAFETY_OFFICER   « référent protection » of X03 (charter § 6–7): safety notices, suspensions for unsafe behaviour, their review
 * Without the role, the moderation actions refuse (403 MODERATOR_ROLE_REQUIRED); without an ACTIVE named holder at all, the functions that need one refuse
 * (503 MODERATION_NOT_STAFFED): X02 / X01 submissions, X05 submissions, the public notice form; X03 needs a safety officer AND two moderators (charter § 3:
 * the 24-hour safety delay needs two persons in rotation; owner decision 10). The capability gates (env) are NOT replaced: both must say yes.
 *
 * DSA FLOWS (micro / small enterprise: art. 19 excludes Section 3 — art. 20–28 except 24(3) — art. 15(1) does not apply either; the owner decided to apply
 * the internal complaint (art. 20) and the repeat-misuse measures (art. 23) anyway, decisions 30 and 31):
 *   art. 16  notice without an account (public form: the four elements of 16(2); name and e-mail optional only for CHILD_SAFETY), acknowledgement by e-mail
 *            (16(4)), decision notified with the redress (16(5)); in-app reports (existing tables) get the same decision notice by e-mail.
 *   art. 17  statement of reasons for every restriction (17(3) a–f), by e-mail when an address is known and in the person's space (17(2)).
 *   art. 18  a decision can record that the authorities were informed (the safety officer does it; nothing is sent automatically).
 *   art. 20  complaint by the author or the notifier, six months, free, electronic; reviewed by ANOTHER moderator when one exists, otherwise by the same
 *            one after 24 hours (charter § 5); reversal possible.
 *   art. 22  « trusted flaggers » are designated by the Digital Services Coordinator (Arcom); a notifier may DECLARE the status, the notice is then shown
 *            first; the moderator checks the published list (nothing is automatic).
 *   art. 23  warning first, then a time-limited suspension (publishing, or notices) — a suspension needs a prior warning of the same scope (server rule).
 * No automated decision exists: ModerationDecision.automated is false by CHECK. Nothing here reads or exposes who reported to the content's author.
 * Without 0059 nothing is read: the staffing state says « not available » and every staffed function refuses.
 */
import crypto from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, ContentNotice, ModerationAppeal, ModerationDecision, ModerationRole, ModerationSanction } from '../../src/db/schema.js';

export const ROLES = Object.freeze({ moderator: 'MODERATOR', safety: 'ENTRAIDE_SAFETY_OFFICER' });
/** the features whose functions need a named person */
export const FEATURES = Object.freeze(['testimonials', 'stories', 'employment', 'entraide', 'notices']);
/** X03: two moderators in rotation (charter § 3) and a named safety officer (charter § 6) */
export const ENTRAIDE_MIN_MODERATORS = 2;
export const APPEAL_MONTHS = 6;
export const SOLE_REVIEW_DELAY_MS = 24 * 3600 * 1000;
export const NOTICE_CATEGORIES = Object.freeze(['ILLEGAL_CONTENT', 'TERMS_VIOLATION', 'SAFETY_THREAT', 'CHILD_SAFETY']);
export const NOTICE_CONTENT_TYPES = Object.freeze(['testimonial', 'story', 'job_listing', 'entraide', 'other']);
export const DECISION_ACTIONS = Object.freeze(['rejected', 'taken_down', 'offer_closed', 'member_suspended', 'member_reinstated', 'reports_dismissed', 'notice_no_action']);
/** restrictions in the sense of DSA art. 17(1) — the author receives a statement of reasons */
export const RESTRICTIONS = Object.freeze(['rejected', 'taken_down', 'offer_closed', 'member_suspended']);
export const SANCTION_SCOPES = Object.freeze(['publishing', 'notices']);
/** a suspension lasts 1 to 180 days, chosen by the moderator case by case (art. 23(3)); the bounds are written in the terms (art. 23(4)) */
export const SUSPENSION_MIN_DAYS = 1;
export const SUSPENSION_MAX_DAYS = 180;
/** a warning counts for a suspension during 12 months */
export const WARNING_WINDOW_DAYS = 365;
export const FACTS_MIN = 10;
export const FACTS_MAX = 2000;
export const TERMS_CLAUSE = 'Charte de modération, § 2 (contenus refusés)';
const DAY = 86_400_000;

const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });
const refusal = (status, code, message) => ({ ok: false, status, code, message });
const isControl = (ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10) || c === 127; };
/** plain text, markup and control characters removed */
export const plain = (s, max = 4000) => [...String(s ?? '').replace(/<[^>]*>/g, '')].filter((ch) => !isControl(ch)).join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const addMonths = (d, n) => { const x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + n); return x; };

/* ----------------------------------------------------------------------------------------------------------------------------------- schema */

const schemaCache = new WeakMap();
/** does this database have migration 0059 (cached one minute per client; a failed read is not remembered) @param {any} database */
export async function moderationSchemaAvailable(database = defaultDb) {
  const hit = schemaCache.get(database);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const res = await database.execute(sql`SELECT to_regclass('"ModerationRole"') IS NOT NULL AND to_regclass('"ModerationDecision"') IS NOT NULL
      AND to_regclass('"ContentNotice"') IS NOT NULL AND to_regclass('"ModerationAppeal"') IS NOT NULL AND to_regclass('"ModerationSanction"') IS NOT NULL AS ok`);
    const value = Boolean((res?.rows || res || [])[0]?.ok);
    schemaCache.set(database, { at: Date.now(), value });
    return value;
  } catch { return false; }
}

/* ------------------------------------------------------------------------------------------------------------------------- roles, staffing */

/** the persons who hold a role NOW: an active assignment on an enabled, MFA, named administrator account @param {any} db */
export async function activeStaff(db = defaultDb) {
  if (!(await moderationSchemaAvailable(db))) return [];
  const res = await db.execute(sql`SELECT lower(a.email) AS email, a."displayName" AS name, r.role, r."assignedAt" AS "assignedAt"
    FROM "ModerationRole" r JOIN "AdminUser" a ON a.id = r."adminUserId"
    WHERE r."revokedAt" IS NULL AND a."disabledAt" IS NULL AND a."mfaEnabled" = true AND char_length(btrim(COALESCE(a."displayName", ''))) >= 2
    ORDER BY r."assignedAt"`);
  return (res?.rows || res || []).map((r) => ({ email: String(r.email), name: String(r.name), role: String(r.role), assignedAt: r.assignedAt }));
}

/** what each feature needs and whether it has it, from a list of active staff (pure) @param {{ email: string, role: string }[]} staff @param {boolean} [available] */
export function staffingFromStaff(staff, available = true) {
  const moderators = new Set(staff.filter((s) => s.role === ROLES.moderator).map((s) => s.email));
  const safety = new Set(staff.filter((s) => s.role === ROLES.safety).map((s) => s.email));
  const ugc = !available ? 'MODERATION_NOT_AVAILABLE' : moderators.size >= 1 ? null : 'NO_NAMED_MODERATOR';
  const entraide = !available ? 'MODERATION_NOT_AVAILABLE' : safety.size < 1 ? 'NO_NAMED_SAFETY_OFFICER'
    : moderators.size < ENTRAIDE_MIN_MODERATORS ? 'FEWER_THAN_TWO_NAMED_MODERATORS' : null;
  const state = (reason) => ({ staffed: reason === null, reason });
  return { available, moderators: moderators.size, safetyOfficers: safety.size,
    features: { testimonials: state(ugc), stories: state(ugc), employment: state(ugc), notices: state(ugc), entraide: state(entraide), events: state(null) } };
}

/** the staffing state of every feature @param {any} db */
export async function staffingState(db = defaultDb) {
  const available = await moderationSchemaAvailable(db);
  return staffingFromStaff(available ? await activeStaff(db) : [], available);
}

const NOT_STAFFED_MESSAGE = {
  entraide: 'L’entraide n’est pas encore ouverte : une personne référente protection et deux modérateurs nommés sont nécessaires.',
  default: 'Cette fonction n’est pas encore ouverte : aucune personne nommée n’est chargée de la modération.',
};
/** null when the feature has its named persons, else the refusal (503, no data) @param {any} db @param {string} feature */
export async function requireFeatureStaffed(db, feature) {
  const s = await staffingState(db);
  const f = s.features[feature];
  if (f?.staffed) return null;
  return { ...refusal(503, 'MODERATION_NOT_STAFFED', NOT_STAFFED_MESSAGE[feature] || NOT_STAFFED_MESSAGE.default), reason: f?.reason || 'UNKNOWN_FEATURE' };
}

/** the roles this administrator holds now (named, MFA, enabled) @param {any} db @param {string} email */
export async function rolesOf(db, email) {
  const e = String(email || '').trim().toLowerCase();
  return new Set((await activeStaff(db)).filter((s) => s.email === e).map((s) => s.role));
}

/**
 * null when `email` may act on `feature`, else the refusal. X03 actions accept a moderator or the safety officer; `safetyOnly` (reinstating a member
 * suspended for unsafe behaviour or harassment, art. 18 records) needs the safety officer. The feature must also be staffed.
 * @param {any} db @param {string} email @param {string} feature @param {{ safetyOnly?: boolean }} [opts]
 */
export async function requireStaffRole(db, email, feature, opts = {}) {
  const staffed = await requireFeatureStaffed(db, feature);
  if (staffed) return staffed;
  const roles = await rolesOf(db, email);
  const ok = opts.safetyOnly ? roles.has(ROLES.safety) : feature === 'entraide' ? roles.has(ROLES.moderator) || roles.has(ROLES.safety) : roles.has(ROLES.moderator);
  if (ok) return null;
  return refusal(403, opts.safetyOnly ? 'SAFETY_OFFICER_ROLE_REQUIRED' : 'MODERATOR_ROLE_REQUIRED',
    opts.safetyOnly ? 'Cette décision revient à la personne référente protection nommée.' : 'Cette action est réservée aux modérateurs nommés.');
}

/** the role administration (an MFA administrator assigns a role to an EXISTING named MFA administrator account) @param {{ db?: any, now?: () => Date }} [deps] */
export function roleAdministration({ db = defaultDb, now = () => new Date() } = {}) {
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'ModerationRole', entity_id: id, details }).catch(() => {});
  const requireSchema = async () => { if (!(await moderationSchemaAvailable(db))) throw err('MODERATION_NOT_AVAILABLE', 503); };
  const findAdmin = async (email) => {
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e)) throw err('ADMIN_EMAIL_REQUIRED');
    const res = await db.execute(sql`SELECT id, lower(email) AS email, "displayName" AS name, "mfaEnabled" AS mfa, "disabledAt" AS disabled FROM "AdminUser" WHERE lower(email) = ${e} LIMIT 1`);
    const a = (res?.rows || res || [])[0];
    if (!a) throw err('ADMIN_NOT_FOUND', 404);
    return a;
  };
  return {
    /** every assignment (active and revoked) with the holder's name, and the staffing state */
    async list() {
      await requireSchema();
      const res = await db.execute(sql`SELECT r.id, lower(a.email) AS email, a."displayName" AS name, r.role, r."charterAcknowledgedAt", r."assignedBy", r."assignedAt", r."revokedAt", r."revokedBy",
        (a."disabledAt" IS NULL AND a."mfaEnabled" = true AND char_length(btrim(COALESCE(a."displayName", ''))) >= 2) AS eligible
        FROM "ModerationRole" r JOIN "AdminUser" a ON a.id = r."adminUserId" ORDER BY r."assignedAt" DESC LIMIT 200`);
      return { assignments: res?.rows || res || [], staffing: await staffingState(db) };
    },
    /** assign `role` to the administrator `email`; the holder attests having read the moderation charter (charter § 6) */
    async assign(actor, { email, role, charterAcknowledged } = {}) {
      await requireSchema();
      if (!Object.values(ROLES).includes(role)) throw err('UNKNOWN_ROLE');
      if (charterAcknowledged !== true) throw err('CHARTER_ACKNOWLEDGEMENT_REQUIRED');
      const a = await findAdmin(email);
      if (a.disabled) throw err('ADMIN_DISABLED', 409);
      if (a.mfa !== true) throw err('ADMIN_MFA_REQUIRED', 409);
      if (String(a.name || '').trim().length < 2) throw err('ADMIN_NAME_REQUIRED', 409);
      const at = now();
      const rows = await db.insert(ModerationRole).values({ id: crypto.randomUUID(), adminUserId: a.id, role, charterAcknowledgedAt: at, assignedBy: String(actor), assignedAt: at })
        .onConflictDoNothing().returning({ id: ModerationRole.id });
      if (!rows.length) throw err('ROLE_ALREADY_ASSIGNED', 409);
      await audit('MODERATION_ROLE_ASSIGN', actor, rows[0].id, { role, holder: a.email });
      return { id: rows[0].id, email: a.email, role, staffing: await staffingState(db) };
    },
    /** revoke an active role (the functions that need it close again at once) */
    async revoke(actor, { email, role } = {}) {
      await requireSchema();
      if (!Object.values(ROLES).includes(role)) throw err('UNKNOWN_ROLE');
      const a = await findAdmin(email);
      const at = now();
      const rows = await db.update(ModerationRole).set({ revokedAt: at, revokedBy: String(actor) })
        .where(and(eq(ModerationRole.adminUserId, a.id), eq(ModerationRole.role, role), isNull(ModerationRole.revokedAt))).returning({ id: ModerationRole.id });
      if (!rows.length) throw err('ROLE_NOT_ASSIGNED', 404);
      await audit('MODERATION_ROLE_REVOKE', actor, rows[0].id, { role, holder: a.email });
      return { id: rows[0].id, email: a.email, role, revoked: true, staffing: await staffingState(db) };
    },
  };
}

/* --------------------------------------------------------------------------------------------------------------------------------- sanctions */

/** the pseudonymous key of a notifier's address (HMAC, never the address) — null without a server key @param {unknown} email @param {Record<string, string | undefined>} [vars] */
export function notifierKey(email, vars = process.env) {
  const base = String(vars.ADA_ENCRYPTION_KEY || '').trim();
  const e = String(email || '').trim().toLowerCase();
  if (base.length < 32 || !EMAIL_RE.test(e)) return null;
  const key = crypto.createHmac('sha256', base).update('ada-content-notice-v1', 'utf8').digest();
  return crypto.createHmac('sha256', key).update(e, 'utf8').digest('hex');
}

/**
 * the active suspension of a person (account) or a notifier (key) for a scope, or null. Fail-open on a missing 0059 only (no sanction can exist then).
 * @param {any} db @param {{ userId?: string | null, key?: string | null, scope: 'publishing' | 'notices', at?: Date }} q
 */
export async function activeSuspension(db, { userId = null, key = null, scope, at = new Date() }) {
  if ((!userId && !key) || !(await moderationSchemaAvailable(db))) return null;
  const [row] = await db.select({ id: ModerationSanction.id, endsAt: ModerationSanction.endsAt }).from(ModerationSanction)
    .where(and(userId ? eq(ModerationSanction.subjectUserId, String(userId)) : eq(ModerationSanction.notifierKey, String(key)), eq(ModerationSanction.scope, scope),
      eq(ModerationSanction.kind, 'suspension'), isNull(ModerationSanction.liftedAt), gt(ModerationSanction.endsAt, at))).orderBy(desc(ModerationSanction.endsAt)).limit(1);
  return row || null;
}

/** the refusal for a suspended person, or null — used by the submission paths of X02, X01, X03 and by every report path @param {any} db @param {string} userId @param {'publishing' | 'notices'} scope */
export async function suspensionRefusal(db, userId, scope) {
  const s = await activeSuspension(db, { userId, scope });
  if (!s) return null;
  return { ...refusal(403, 'ACCOUNT_RESTRICTED', scope === 'notices'
    ? 'Le traitement de vos signalements est suspendu jusqu’au ' + new Date(s.endsAt).toISOString().slice(0, 10) + ' (signalements manifestement infondés répétés).'
    : 'Vos publications sont suspendues jusqu’au ' + new Date(s.endsAt).toISOString().slice(0, 10) + ' (contenus manifestement illicites répétés).'), until: s.endsAt };
}

/* -------------------------------------------------------------------------------------------------------------------------------- statements */

const ACTION_FR = {
  rejected: 'n’a pas été publié(e)', taken_down: 'a été retiré(e)', offer_closed: 'a été fermée', member_suspended: 'votre participation est suspendue',
  member_reinstated: 'votre participation est rétablie', reports_dismissed: 'est maintenu(e) : les signalements ont été jugés non fondés', notice_no_action: 'aucune mesure n’a été prise',
};
const CONTENT_FR = { testimonial: 'témoignage', story: 'histoire', job_listing: 'offre d’emploi', entraide_member: 'participation à l’entraide', entraide_offer: 'offre d’entraide', notice: 'contenu signalé' };
const SOURCE_FR = { notice: 'à la suite d’un signalement', report: 'à la suite d’un signalement', own_initiative: 'à l’initiative de la modération', pre_publication_review: 'lors de la relecture avant publication' };

/**
 * The statement of reasons (DSA art. 17(3) a–f) or the decision notice (art. 16(5)), plain French text. No content is reproduced, no name of a notifier.
 * @param {any} d a ModerationDecision row @param {'author' | 'notifier'} to @param {{ appealHint?: string }} [o]
 */
export function statementText(d, to, o = {}) {
  const what = CONTENT_FR[d.contentType] || 'contenu';
  const day = new Date(d.decidedAt).toISOString().slice(0, 10);
  const until = new Date(d.appealUntil).toISOString().slice(0, 10);
  const lines = to === 'author'
    ? [`Décision de modération du ${day} concernant votre ${what} : ${ACTION_FR[d.action] || d.action}.`,
      d.restrictionEndsAt ? `Durée : jusqu’au ${new Date(d.restrictionEndsAt).toISOString().slice(0, 10)}. Portée : l’ensemble du service.` : 'Portée : l’ensemble du service.']
    : [`Décision du ${day} sur votre signalement concernant un ${what} : ${ACTION_FR[d.action] || d.action}.`];
  lines.push(`Faits et circonstances : ${d.facts} Décision prise ${SOURCE_FR[d.source] || ''}.`.trim());
  lines.push(`Règle appliquée : ${d.termsClause} — motif ${d.reasonCode}.`);
  if (d.legalGround) lines.push(`Fondement légal et raison de l’illicéité : ${d.legalGround}`);
  lines.push('Moyens automatisés : aucun. La décision a été prise par une personne.');
  lines.push(`Vos recours : vous pouvez contester cette décision gratuitement jusqu’au ${until} (six mois) ${o.appealHint || 'depuis votre espace (rubrique « Décisions de modération ») ou en répondant à l’adresse de contact indiquée dans les mentions légales'} ; une autre personne la réexamine lorsque c’est possible. Vous pouvez aussi saisir le juge compétent.`);
  return lines.join('\n\n');
}

/**
 * Record a decision (and deliver it). `subject` = the citizen author (statement in their space + e-mail) or the structure (e-mail to its administrators);
 * `notifierUserIds` = in-app reporters (decision notice by e-mail, never their identity to anyone); `noticeId` = an account-free notice (its notifier gets the
 * notice by e-mail, with an appeal code). Returns the decision row. Delivery failures never undo the decision: the row says whether a statement went out.
 * @param {{ db?: any, now?: () => Date, send?: (m: any) => Promise<any> }} [deps]
 */
export function decisionRecorder({ db = defaultDb, now = () => new Date(), send } = {}) {
  const mail = send || (async (m) => (await import('../_utils/mailer.js')).sendMail(m));
  const accepted = (out) => Boolean(out && (out.delivered || ['PROVIDER_ACCEPTED', 'TEST_RECORDED', 'SANDBOX_VALIDATED'].includes(out.outcome)));
  const emailsOfCitizens = async (ids) => {
    if (!ids.length) return [];
    const res = await db.execute(sql`SELECT id, email FROM "CitizenUser" WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) AND "emailVerifiedAt" IS NOT NULL`);
    return (res?.rows || res || []).map((r) => ({ id: String(r.id), email: String(r.email) }));
  };
  const structureAdmins = async (structureId) => {
    const res = await db.execute(sql`SELECT email FROM "ProUser" WHERE "structureId" = ${structureId} AND role = 'structure_admin' AND status = 'active'`);
    return (res?.rows || res || []).map((r) => String(r.email));
  };
  return {
    /**
     * @param {string} actor @param {{ contentType: string, contentId: string, action: string, reasonCode: string, facts?: string, legalGround?: string | null,
     *   source?: string, manifestlyIllegal?: boolean, restrictionEndsAt?: Date | null, subjectUserId?: string | null, subjectStructureId?: string | null,
     *   notifierUserIds?: string[], noticeId?: string | null }} d
     */
    async record(actor, d) {
      if (!(await moderationSchemaAvailable(db))) throw err('MODERATION_NOT_AVAILABLE', 503);
      if (!DECISION_ACTIONS.includes(d.action)) throw err('UNKNOWN_ACTION');
      const facts = plain(d.facts, FACTS_MAX + 1);
      if (facts.length < FACTS_MIN || facts.length > FACTS_MAX) throw err('FACTS_REQUIRED');
      const legalGround = d.legalGround ? plain(d.legalGround, 1001) : null;
      if (legalGround !== null && (legalGround.length < 3 || legalGround.length > 1000)) throw err('LEGAL_GROUND_INVALID');
      if (d.manifestlyIllegal === true && !legalGround) throw err('LEGAL_GROUND_REQUIRED');
      const at = now();
      const row = { id: crypto.randomUUID(), contentType: d.contentType, contentId: String(d.contentId), action: d.action, reasonCode: String(d.reasonCode || 'NONE'), facts, legalGround,
        termsClause: TERMS_CLAUSE, source: d.source || 'own_initiative', automated: false, manifestlyIllegal: d.manifestlyIllegal === true, restrictionEndsAt: d.restrictionEndsAt || null,
        subjectUserId: d.subjectUserId || null, subjectStructureId: d.subjectStructureId || null, notifierUserIds: [...new Set(d.notifierUserIds || [])].map(String),
        noticeId: d.noticeId || null, decidedBy: String(actor), decidedAt: at, appealUntil: addMonths(at, APPEAL_MONTHS), statementChannel: 'none', statementSentAt: null };
      await db.insert(ModerationDecision).values(row);
      await db.insert(AuditLog).values({ action: 'MODERATION_DECISION', actor, actor_id: actor, entity: 'ModerationDecision', entity_id: row.id,
        details: { contentType: row.contentType, action: row.action, reasonCode: row.reasonCode, source: row.source, notifiers: row.notifierUserIds.length, notice: Boolean(row.noticeId) } }).catch(() => {});
      // deliveries — the decision stands whatever the provider answers; the row records the channel actually used
      let channel = row.subjectUserId && RESTRICTIONS.concat(['member_reinstated']).includes(row.action) ? 'in_app' : 'none';
      const subject = RESTRICTIONS.includes(row.action) || row.action === 'member_reinstated';
      if (subject && row.subjectUserId) {
        const [p] = await emailsOfCitizens([row.subjectUserId]).catch(() => []);
        if (p && accepted(await mail({ to: p.email, category: 'moderation-statement', subject: 'Décision de modération — Accès Direct Aide', text: statementText(row, 'author') }).catch(() => null))) channel = 'email';
      } else if (subject && row.subjectStructureId) {
        const admins = await structureAdmins(row.subjectStructureId).catch(() => []);
        let any = false;
        for (const to of admins) any = accepted(await mail({ to, category: 'moderation-statement', subject: 'Décision de modération sur une offre d’emploi — Accès Direct Aide',
          text: statementText(row, 'author', { appealHint: 'en répondant à l’adresse de contact indiquée dans les mentions légales (référence ' + row.id + ')' }) }).catch(() => null)) || any;
        if (any) channel = 'email';
      }
      for (const p of await emailsOfCitizens(row.notifierUserIds).catch(() => [])) {
        await mail({ to: p.email, category: 'moderation-notice-decision', subject: 'Suite donnée à votre signalement — Accès Direct Aide', text: statementText(row, 'notifier') }).catch(() => null);
      }
      if (channel !== 'none') await db.update(ModerationDecision).set({ statementChannel: channel, statementSentAt: now() }).where(eq(ModerationDecision.id, row.id));
      return { ...row, statementChannel: channel };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------------- notices (art. 16) */

const URGENT = new Set(['SAFETY_THREAT', 'CHILD_SAFETY']);
export const NOTICES_PER_HOUR = 5;
/** what is wrong with a public notice (empty = acceptable) — the four elements of DSA art. 16(2) */
export function noticeProblems(n) {
  const p = [];
  if (!NOTICE_CONTENT_TYPES.includes(n.contentType)) p.push('CONTENT_TYPE_INVALID');
  if (!NOTICE_CATEGORIES.includes(n.category)) p.push('CATEGORY_INVALID');
  if (n.contentRef.length < 3 || n.contentRef.length > 500) p.push('CONTENT_REF_REQUIRED');
  if (n.explanation.length < 20 || n.explanation.length > 3000) p.push('EXPLANATION_REQUIRED');
  const identityOptional = n.category === 'CHILD_SAFETY';
  if (!identityOptional || n.notifierName || n.notifierEmail) {
    if (!n.notifierName || n.notifierName.length < 2 || n.notifierName.length > 120) p.push('NAME_REQUIRED');
    if (!n.notifierEmail || !EMAIL_RE.test(n.notifierEmail) || n.notifierEmail.length > 254) p.push('EMAIL_REQUIRED');
  }
  if (n.goodFaith !== true) p.push('GOOD_FAITH_REQUIRED');
  return p;
}

/** @param {{ db?: any, now?: () => Date, send?: (m: any) => Promise<any>, vars?: Record<string, string | undefined> }} [deps] */
export function contentNotices({ db = defaultDb, now = () => new Date(), send, vars = process.env } = {}) {
  const mail = send || (async (m) => (await import('../_utils/mailer.js')).sendMail(m));
  const recorder = decisionRecorder({ db, now, send: mail });
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'ContentNotice', entity_id: id, details }).catch(() => {});
  const normal = (b = {}) => ({
    contentType: String(b.contentType || ''), contentRef: plain(b.contentRef, 501), category: String(b.category || ''), explanation: plain(b.explanation, 3001),
    notifierName: plain(b.notifierName, 121) || null, notifierEmail: String(b.notifierEmail || '').trim().toLowerCase().slice(0, 255) || null,
    goodFaith: b.goodFaith === true, declaredTrustedFlagger: b.declaredTrustedFlagger === true,
  });
  const create = async (n, channel, actor = null) => {
    const key = n.notifierEmail ? notifierKey(n.notifierEmail, vars) : null;
    if (key && (await activeSuspension(db, { key, scope: 'notices', at: now() }))) {
      return refusal(403, 'NOTICES_SUSPENDED', 'Le traitement des signalements envoyés depuis cette adresse est suspendu pour un temps limité (signalements manifestement infondés répétés).');
    }
    const token = crypto.randomBytes(18).toString('base64url');
    const at = now();
    const row = { id: crypto.randomUUID(), channel, ...n, notifierKey: key, priority: URGENT.has(n.category) ? 'urgent' : n.declaredTrustedFlagger ? 'trusted' : 'ordinary',
      status: 'received', appealTokenHash: n.notifierEmail ? crypto.createHash('sha256').update(token).digest('hex') : null, createdAt: at, updatedAt: at };
    await db.insert(ContentNotice).values(row);
    await audit('CONTENT_NOTICE_RECEIVED', actor || 'public', row.id, { channel, category: row.category, contentType: row.contentType, priority: row.priority });
    // art. 16(4): acknowledgement without undue delay when an electronic address was given
    if (n.notifierEmail) {
      const out = await mail({ to: n.notifierEmail, category: 'moderation-notice-ack', subject: 'Nous avons reçu votre signalement — Accès Direct Aide',
        text: [`Nous avons bien reçu votre signalement (référence ${row.id}).`, 'Une personne de l’équipe de modération va l’examiner ; vous serez informé(e) de la décision et de vos recours.',
          `Si vous souhaitez contester la décision plus tard, gardez ce code : ${token}`,
          URGENT.has(n.category) ? 'En cas de danger immédiat, appelez le 112 (urgence européenne) ou le 17 (police) ; pour un enfant en danger, le 119.' : ''].filter(Boolean).join('\n\n') }).catch(() => null);
      if (out && (out.delivered || ['PROVIDER_ACCEPTED', 'TEST_RECORDED', 'SANDBOX_VALIDATED'].includes(out.outcome))) {
        await db.update(ContentNotice).set({ acknowledgedAt: now() }).where(eq(ContentNotice.id, row.id));
      }
    }
    return { ok: true, status: 201, id: row.id, priority: row.priority };
  };
  return {
    /** the public form (no account): art. 16(1)–(2) */
    async submit(body = {}) {
      if (!(await moderationSchemaAvailable(db))) return refusal(503, 'MODERATION_NOT_AVAILABLE', 'Le signalement n’est pas disponible sur ce service.');
      const n = normal(body);
      const problems = noticeProblems(n);
      if (problems.length) return { ...refusal(400, problems[0], 'Le signalement est incomplet : indiquez le contenu, pourquoi il pose problème, votre nom et votre adresse, et cochez la déclaration de bonne foi.'), problems };
      return create(n, 'public_form');
    },
    /** a notice received by e-mail at the contact address, recorded by a moderator (same elements) */
    async recordEmailNotice(actor, body = {}) {
      if (!(await moderationSchemaAvailable(db))) throw err('MODERATION_NOT_AVAILABLE', 503);
      const n = normal(body);
      const problems = noticeProblems(n);
      if (problems.length) throw err('NOTICE_INVALID', 400, { problems });
      return create(n, 'email', actor);
    },
    /** the queue: urgent first, then declared trusted flaggers, then the oldest (no notifier identity is shown, only whether an address exists) */
    async list(actor, status = 'received') {
      if (!(await moderationSchemaAvailable(db))) throw err('MODERATION_NOT_AVAILABLE', 503);
      const rows = await db.select({ id: ContentNotice.id, channel: ContentNotice.channel, contentType: ContentNotice.contentType, contentRef: ContentNotice.contentRef,
        category: ContentNotice.category, explanation: ContentNotice.explanation, declaredTrustedFlagger: ContentNotice.declaredTrustedFlagger, priority: ContentNotice.priority,
        status: ContentNotice.status, outcome: ContentNotice.outcome, acknowledgedAt: ContentNotice.acknowledgedAt, createdAt: ContentNotice.createdAt, decidedAt: ContentNotice.decidedAt,
        hasContact: sql`${ContentNotice.notifierEmail} IS NOT NULL` })
        .from(ContentNotice).where(eq(ContentNotice.status, status === 'decided' ? 'decided' : 'received'))
        .orderBy(sql`CASE ${ContentNotice.priority} WHEN 'urgent' THEN 0 WHEN 'trusted' THEN 1 ELSE 2 END`, asc(ContentNotice.createdAt)).limit(200);
      await audit('CONTENT_NOTICE_QUEUE_READ', actor, status, { count: rows.length });
      return rows;
    },
    /**
     * close a notice: `action_taken` links the decision the moderator recorded on the content (through the feature's own action with noticeId),
     * `no_action` records a decision (statement to the notifier), `not_processed` is the art. 23(2) suspension path (the notifier is suspended).
     */
    async close(actor, id, { outcome, facts, decisionId = null, reasonCode = 'NOT_ILLEGAL_NOR_CONTRARY_TO_TERMS' } = {}) {
      if (!(await moderationSchemaAvailable(db))) throw err('MODERATION_NOT_AVAILABLE', 503);
      const [n] = await db.select().from(ContentNotice).where(eq(ContentNotice.id, String(id))).limit(1);
      if (!n) throw err('NOT_FOUND', 404);
      if (n.status !== 'received') throw err('ALREADY_DECIDED', 409);
      let decision = decisionId;
      if (outcome === 'action_taken') {
        const [d] = await db.select({ id: ModerationDecision.id }).from(ModerationDecision).where(and(eq(ModerationDecision.id, String(decisionId || '')), eq(ModerationDecision.noticeId, n.id))).limit(1);
        if (!d) throw err('DECISION_REQUIRED');
      } else if (outcome === 'no_action') {
        decision = (await recorder.record(actor, { contentType: 'notice', contentId: n.id, action: 'notice_no_action', reasonCode, facts, source: 'notice', noticeId: n.id })).id;
        if (n.notifierEmail) {
          const [d] = await db.select().from(ModerationDecision).where(eq(ModerationDecision.id, decision)).limit(1);
          await mail({ to: n.notifierEmail, category: 'moderation-notice-decision', subject: 'Suite donnée à votre signalement — Accès Direct Aide',
            text: statementText(d, 'notifier', { appealHint: `en répondant à l’adresse de contact indiquée dans les mentions légales, avec la référence ${n.id} et le code reçu dans l’accusé de réception` }) }).catch(() => null);
        }
      } else if (outcome !== 'not_processed') throw err('UNKNOWN_OUTCOME');
      const at = now();
      const rows = await db.update(ContentNotice).set({ status: 'decided', outcome, decisionId: decision, decidedAt: at, decidedBy: String(actor), updatedAt: at })
        .where(and(eq(ContentNotice.id, n.id), eq(ContentNotice.status, 'received'))).returning({ id: ContentNotice.id });
      if (!rows.length) throw err('STATE_CHANGED', 409);
      await audit('CONTENT_NOTICE_CLOSE', actor, n.id, { outcome });
      return { id: n.id, status: 'decided', outcome, decisionId: decision };
    },
    /** notify the notifier of a decision taken on the content (action_taken path), with the appeal hint */
    async notifyNotifier(noticeId, decision) {
      const [n] = await db.select({ email: ContentNotice.notifierEmail, id: ContentNotice.id }).from(ContentNotice).where(eq(ContentNotice.id, String(noticeId))).limit(1);
      if (!n?.email) return false;
      const out = await mail({ to: n.email, category: 'moderation-notice-decision', subject: 'Suite donnée à votre signalement — Accès Direct Aide',
        text: statementText(decision, 'notifier', { appealHint: `en répondant à l’adresse de contact indiquée dans les mentions légales, avec la référence ${n.id} et le code reçu dans l’accusé de réception` }) }).catch(() => null);
      return Boolean(out);
    },
  };
}

/* ---------------------------------------------------------------------------------------------------- decisions, appeals (art. 17, 20) */

/** the person's side: the decisions about their content or their reports, and their appeals @param {{ db?: any, now?: () => Date }} [deps] */
export function citizenModeration({ db = defaultDb, now = () => new Date() } = {}) {
  const mine = (userId) => or(eq(ModerationDecision.subjectUserId, String(userId)), sql`${String(userId)} = ANY(${ModerationDecision.notifierUserIds})`);
  return {
    async list(userId) {
      if (!(await moderationSchemaAvailable(db))) return { ok: true, status: 200, available: false, decisions: [] };
      const rows = await db.select().from(ModerationDecision).where(mine(userId)).orderBy(desc(ModerationDecision.decidedAt)).limit(100);
      const appeals = rows.length ? await db.select({ decisionId: ModerationAppeal.decisionId, status: ModerationAppeal.status, response: ModerationAppeal.response, createdAt: ModerationAppeal.createdAt, reviewedAt: ModerationAppeal.reviewedAt })
        .from(ModerationAppeal).where(and(inArray(ModerationAppeal.decisionId, rows.map((r) => r.id)), eq(ModerationAppeal.appellantUserId, String(userId)))) : [];
      const byDecision = new Map(appeals.map((a) => [a.decisionId, a]));
      const at = now();
      return { ok: true, status: 200, available: true, decisions: rows.map((r) => {
        const role = r.subjectUserId === String(userId) ? 'author' : 'notifier';
        return { id: r.id, role, contentType: r.contentType, action: r.action, reasonCode: r.reasonCode, decidedAt: r.decidedAt, appealUntil: r.appealUntil,
          restrictionEndsAt: r.restrictionEndsAt, statement: statementText(r, role), appeal: byDecision.get(r.id) || null,
          canAppeal: !byDecision.has(r.id) && new Date(r.appealUntil) > at && r.action !== 'member_reinstated' };
      }) };
    },
    /** art. 20: an appeal by the author or a notifier, within six months, free; one per person and decision */
    async appeal(userId, decisionId, body) {
      if (!(await moderationSchemaAvailable(db))) return refusal(503, 'MODERATION_NOT_AVAILABLE', 'La contestation n’est pas disponible sur ce service.');
      const text = plain(body, 2001);
      if (text.length < 10 || text.length > 2000) return refusal(400, 'APPEAL_TEXT_REQUIRED', 'Expliquez en quelques mots pourquoi la décision devrait être revue (10 à 2000 caractères).');
      const [d] = await db.select().from(ModerationDecision).where(and(eq(ModerationDecision.id, String(decisionId)), mine(userId))).limit(1);
      if (!d) return refusal(404, 'DECISION_NOT_FOUND', 'Décision introuvable.');
      if (new Date(d.appealUntil) <= now()) return refusal(409, 'APPEAL_PERIOD_OVER', 'Le délai de six mois pour contester cette décision est dépassé ; vous pouvez saisir le juge.');
      const susp = await suspensionRefusal(db, userId, 'notices');
      if (susp) return susp;
      const rows = await db.insert(ModerationAppeal).values({ id: crypto.randomUUID(), decisionId: d.id, appellantKind: d.subjectUserId === String(userId) ? 'author' : 'notifier',
        appellantUserId: String(userId), body: text, status: 'open', createdAt: now() }).onConflictDoNothing().returning({ id: ModerationAppeal.id });
      if (!rows.length) return refusal(409, 'ALREADY_APPEALED', 'Vous avez déjà contesté cette décision.');
      return { ok: true, status: 201, id: rows[0].id };
    },
  };
}

/** an account-free notifier's appeal: the notice reference and the code of the acknowledgement e-mail @param {{ db?: any, now?: () => Date }} [deps] */
export async function noticeAppeal({ db = defaultDb, now = () => new Date() } = {}, { noticeId, code, body }) {
  if (!(await moderationSchemaAvailable(db))) return refusal(503, 'MODERATION_NOT_AVAILABLE', 'La contestation n’est pas disponible sur ce service.');
  const text = plain(body, 2001);
  if (text.length < 10 || text.length > 2000) return refusal(400, 'APPEAL_TEXT_REQUIRED', 'Expliquez en quelques mots pourquoi la décision devrait être revue (10 à 2000 caractères).');
  const hash = crypto.createHash('sha256').update(String(code || '')).digest('hex');
  const [n] = await db.select().from(ContentNotice).where(eq(ContentNotice.id, String(noticeId || ''))).limit(1);
  // the same answer for an unknown reference and a wrong code
  if (!n || !n.appealTokenHash || !crypto.timingSafeEqual(Buffer.from(n.appealTokenHash), Buffer.from(hash))) return refusal(404, 'NOTICE_NOT_FOUND', 'Référence ou code inconnu.');
  if (n.status !== 'decided' || !n.decisionId) return refusal(409, 'NOT_DECIDED', 'Ce signalement n’a pas encore reçu de décision.');
  const [d] = await db.select().from(ModerationDecision).where(eq(ModerationDecision.id, n.decisionId)).limit(1);
  if (!d) return refusal(404, 'DECISION_NOT_FOUND', 'Décision introuvable.');
  if (new Date(d.appealUntil) <= now()) return refusal(409, 'APPEAL_PERIOD_OVER', 'Le délai de six mois pour contester cette décision est dépassé ; vous pouvez saisir le juge.');
  if (n.notifierKey && (await activeSuspension(db, { key: n.notifierKey, scope: 'notices', at: now() }))) return refusal(403, 'NOTICES_SUSPENDED', 'Le traitement de vos signalements et contestations est suspendu pour un temps limité.');
  const rows = await db.insert(ModerationAppeal).values({ id: crypto.randomUUID(), decisionId: d.id, appellantKind: 'notifier', noticeId: n.id, body: text, status: 'open', createdAt: now() })
    .onConflictDoNothing().returning({ id: ModerationAppeal.id });
  if (!rows.length) return refusal(409, 'ALREADY_APPEALED', 'Cette décision a déjà été contestée pour ce signalement.');
  return { ok: true, status: 201, id: rows[0].id };
}

/** the moderator side: appeals, sanctions, art. 18 record, transparency counts @param {{ db?: any, now?: () => Date, send?: (m: any) => Promise<any> }} [deps] */
export function moderationDesk({ db = defaultDb, now = () => new Date(), send } = {}) {
  const mail = send || (async (m) => (await import('../_utils/mailer.js')).sendMail(m));
  const audit = (action, actor, entity, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity, entity_id: id, details }).catch(() => {});
  const requireSchema = async () => { if (!(await moderationSchemaAvailable(db))) throw err('MODERATION_NOT_AVAILABLE', 503); };
  return {
    async appeals(actor, status = 'open') {
      await requireSchema();
      const rows = await db.select({ id: ModerationAppeal.id, decisionId: ModerationAppeal.decisionId, appellantKind: ModerationAppeal.appellantKind, body: ModerationAppeal.body,
        status: ModerationAppeal.status, response: ModerationAppeal.response, createdAt: ModerationAppeal.createdAt, reviewedAt: ModerationAppeal.reviewedAt, reviewedBy: ModerationAppeal.reviewedBy,
        contentType: ModerationDecision.contentType, contentId: ModerationDecision.contentId, action: ModerationDecision.action, reasonCode: ModerationDecision.reasonCode,
        facts: ModerationDecision.facts, decidedBy: ModerationDecision.decidedBy, decidedAt: ModerationDecision.decidedAt })
        .from(ModerationAppeal).innerJoin(ModerationDecision, eq(ModerationDecision.id, ModerationAppeal.decisionId))
        .where(eq(ModerationAppeal.status, status === 'open' ? 'open' : status)).orderBy(asc(ModerationAppeal.createdAt)).limit(200);
      await audit('MODERATION_APPEAL_QUEUE_READ', actor, 'ModerationAppeal', status, { count: rows.length });
      return rows;
    },
    /**
     * art. 20(4)–(6): decide an appeal. Another named moderator than the decider when one exists; otherwise (sole moderator) the same person, only 24 h after
     * the appeal (charter § 5). `reversed` means the moderator undoes the measure through the feature's own action (republication needs the author's wish).
     */
    async reviewAppeal(actor, id, { outcome, response } = {}) {
      await requireSchema();
      if (!['upheld', 'reversed', 'modified'].includes(outcome)) throw err('UNKNOWN_OUTCOME');
      const text = plain(response, 2001);
      if (text.length < 10 || text.length > 2000) throw err('RESPONSE_REQUIRED');
      const [a] = await db.select().from(ModerationAppeal).where(eq(ModerationAppeal.id, String(id))).limit(1);
      if (!a) throw err('NOT_FOUND', 404);
      if (a.status !== 'open') throw err('ALREADY_REVIEWED', 409);
      const [d] = await db.select().from(ModerationDecision).where(eq(ModerationDecision.id, a.decisionId)).limit(1);
      const me = String(actor).trim().toLowerCase();
      let sole = false;
      if (String(d.decidedBy).trim().toLowerCase() === me) {
        const others = (await activeStaff(db)).filter((s) => s.email !== me && (s.role === ROLES.moderator || (d.contentType.startsWith('entraide') && s.role === ROLES.safety)));
        if (others.length) throw err('ANOTHER_MODERATOR_REQUIRED', 403);
        if (now().getTime() < new Date(a.createdAt).getTime() + SOLE_REVIEW_DELAY_MS) throw err('SOLE_MODERATOR_DELAY', 409, { reviewableFrom: new Date(new Date(a.createdAt).getTime() + SOLE_REVIEW_DELAY_MS).toISOString() });
        sole = true;
      }
      const at = now();
      const rows = await db.update(ModerationAppeal).set({ status: outcome, response: text, reviewedBy: String(actor), reviewedAt: at, soleModerator: sole })
        .where(and(eq(ModerationAppeal.id, a.id), eq(ModerationAppeal.status, 'open'))).returning({ id: ModerationAppeal.id });
      if (!rows.length) throw err('STATE_CHANGED', 409);
      await audit('MODERATION_APPEAL_REVIEW', actor, 'ModerationAppeal', a.id, { outcome, soleModerator: sole });
      // art. 20(5): the reasoned decision to the complainant, without undue delay
      const to = a.appellantUserId
        ? (await db.execute(sql`SELECT email FROM "CitizenUser" WHERE id = ${a.appellantUserId}`))?.rows?.[0]?.email
        : (await db.select({ email: ContentNotice.notifierEmail }).from(ContentNotice).where(eq(ContentNotice.id, String(a.noticeId))).limit(1))?.[0]?.email;
      const OUT_FR = { upheld: 'la décision est maintenue', reversed: 'la décision est annulée', modified: 'la décision est modifiée' };
      if (to) await mail({ to, category: 'moderation-appeal-decision', subject: 'Réponse à votre contestation — Accès Direct Aide',
        text: [`Votre contestation a été examinée${sole ? ' (par la même personne, après un délai de 24 heures : une seule personne assure la modération à ce jour)' : ' par une autre personne que celle qui avait décidé'} : ${OUT_FR[outcome]}.`,
          `Motifs : ${text}`, 'Vous pouvez saisir le juge compétent si vous restez en désaccord.'].join('\n\n') }).catch(() => null);
      return { id: a.id, status: outcome, soleModerator: sole };
    },
    /** art. 18: the safety officer records that the authorities were informed (the information itself is given by the person, outside this tool) */
    async recordAuthoritiesInformed(actor, decisionId) {
      await requireSchema();
      const rows = await db.update(ModerationDecision).set({ authoritiesInformedAt: now() }).where(and(eq(ModerationDecision.id, String(decisionId)), isNull(ModerationDecision.authoritiesInformedAt)))
        .returning({ id: ModerationDecision.id });
      if (!rows.length) throw err('NOT_FOUND', 404);
      await audit('MODERATION_AUTHORITIES_INFORMED', actor, 'ModerationDecision', rows[0].id);
      return { id: rows[0].id, authoritiesInformed: true };
    },
    /** art. 23: a warning (counts 12 months) — subject: an account (`userId`) or a notifier (`noticeId` → its key) */
    async sanction(actor, { kind, scope, userId = null, noticeId = null, reason, days } = {}) {
      await requireSchema();
      if (!['warning', 'suspension'].includes(kind)) throw err('UNKNOWN_KIND');
      if (!SANCTION_SCOPES.includes(scope)) throw err('UNKNOWN_SCOPE');
      const why = plain(reason, 1001);
      if (why.length < 10) throw err('REASON_REQUIRED');
      let key = null;
      if (!userId) {
        const [n] = await db.select({ key: ContentNotice.notifierKey }).from(ContentNotice).where(eq(ContentNotice.id, String(noticeId || ''))).limit(1);
        if (!n?.key) throw err('SUBJECT_REQUIRED');
        if (scope !== 'notices') throw err('SCOPE_NOT_APPLICABLE');
        key = n.key;
      }
      const at = now();
      const subject = userId ? eq(ModerationSanction.subjectUserId, String(userId)) : eq(ModerationSanction.notifierKey, key);
      let endsAt = null;
      if (kind === 'suspension') {
        const d = Number(days);
        if (!Number.isInteger(d) || d < SUSPENSION_MIN_DAYS || d > SUSPENSION_MAX_DAYS) throw err('DURATION_INVALID');
        // art. 23(1)–(2): « après avoir émis un avertissement préalable »
        const [w] = await db.select({ id: ModerationSanction.id }).from(ModerationSanction).where(and(subject, eq(ModerationSanction.scope, scope), eq(ModerationSanction.kind, 'warning'),
          isNull(ModerationSanction.liftedAt), gt(ModerationSanction.createdAt, new Date(at.getTime() - WARNING_WINDOW_DAYS * DAY)))).limit(1);
        if (!w) throw err('PRIOR_WARNING_REQUIRED', 409);
        endsAt = new Date(at.getTime() + d * DAY);
      }
      const id = crypto.randomUUID();
      await db.insert(ModerationSanction).values({ id, subjectUserId: userId ? String(userId) : null, notifierKey: key, scope, kind, reason: why, createdBy: String(actor), createdAt: at, endsAt });
      await audit('MODERATION_SANCTION', actor, 'ModerationSanction', id, { kind, scope, days: endsAt ? Number(days) : null, subject: userId ? 'account' : 'notifier' });
      // the person is told (warning and suspension alike)
      const to = userId ? (await db.execute(sql`SELECT email FROM "CitizenUser" WHERE id = ${String(userId)}`))?.rows?.[0]?.email
        : (await db.select({ email: ContentNotice.notifierEmail }).from(ContentNotice).where(eq(ContentNotice.id, String(noticeId))).limit(1))?.[0]?.email;
      const what = scope === 'notices' ? 'le traitement de vos signalements et contestations' : 'vos publications (témoignages, histoires, entraide)';
      if (to) await mail({ to, category: 'moderation-sanction', subject: kind === 'warning' ? 'Avertissement — Accès Direct Aide' : 'Suspension temporaire — Accès Direct Aide',
        text: [kind === 'warning' ? `Avertissement : si cela se reproduit, ${what} pourra être suspendu pour une durée limitée.` : `${what[0].toUpperCase()}${what.slice(1)} : suspension jusqu’au ${endsAt.toISOString().slice(0, 10)}.`,
          `Motifs : ${why}`, 'Décision prise par une personne. Vous pouvez la contester en répondant à l’adresse de contact indiquée dans les mentions légales, ou saisir le juge.'].join('\n\n') }).catch(() => null);
      return { id, kind, scope, endsAt };
    },
    async liftSanction(actor, id) {
      await requireSchema();
      const rows = await db.update(ModerationSanction).set({ liftedAt: now(), liftedBy: String(actor) }).where(and(eq(ModerationSanction.id, String(id)), isNull(ModerationSanction.liftedAt)))
        .returning({ id: ModerationSanction.id });
      if (!rows.length) throw err('NOT_FOUND', 404);
      await audit('MODERATION_SANCTION_LIFT', actor, 'ModerationSanction', rows[0].id);
      return { id: rows[0].id, lifted: true };
    },
    /** the history of misuse that art. 23(3) asks to weigh: counts only (decisions with « manifestly illegal », notices closed « not processed ») */
    async misuseCounts(userId) {
      await requireSchema();
      const r = (await db.execute(sql`SELECT
        (SELECT count(*)::int FROM "ModerationDecision" d WHERE d."subjectUserId" = ${String(userId)}) AS decisions,
        (SELECT count(*)::int FROM "ModerationDecision" d WHERE d."subjectUserId" = ${String(userId)} AND d."manifestlyIllegal") AS "manifestlyIllegal",
        (SELECT count(*)::int FROM "ModerationSanction" s WHERE s."subjectUserId" = ${String(userId)} AND s.kind = 'warning' AND s."liftedAt" IS NULL) AS warnings`))?.rows?.[0] || {};
      return { decisions: Number(r.decisions || 0), manifestlyIllegal: Number(r.manifestlyIllegal || 0), warnings: Number(r.warnings || 0) };
    },
    /** transparency counts (charter § 10): numbers only — never a name, a pseudonym or a text @param {Date} from @param {Date} to */
    async transparency(from, to) {
      await requireSchema();
      const q = async (s) => (await db.execute(s))?.rows || [];
      return {
        from: from.toISOString(), to: to.toISOString(),
        decisions: await q(sql`SELECT "contentType", action, source, count(*)::int AS n FROM "ModerationDecision" WHERE "decidedAt" >= ${from} AND "decidedAt" < ${to} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`),
        notices: await q(sql`SELECT channel, category, COALESCE(outcome, 'pending') AS outcome, count(*)::int AS n FROM "ContentNotice" WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`),
        appeals: await q(sql`SELECT "appellantKind", status, count(*)::int AS n FROM "ModerationAppeal" WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1, 2 ORDER BY 1, 2`),
        sanctions: await q(sql`SELECT scope, kind, count(*)::int AS n FROM "ModerationSanction" WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1, 2 ORDER BY 1, 2`),
        medianNoticeHours: Number((await q(sql`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("decidedAt" - "createdAt")) / 3600) AS h FROM "ContentNotice"
          WHERE "decidedAt" IS NOT NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}`))[0]?.h ?? 0) || null,
        automatedDecisions: 0,
      };
    },
  };
}

/* ----------------------------------------------------------------------------------------------------------------------------------- DSR */

/** art. 15 export: the decisions about the person (statements), and their appeals @param {string} userId */
export function moderationDecisionsExportSql(userId) {
  return sql`SELECT d.id, d."contentType", d.action, d."reasonCode", d.facts, d."legalGround", d.source, d."decidedAt", d."appealUntil", d."restrictionEndsAt"
    FROM "ModerationDecision" d WHERE d."subjectUserId" = ${userId} ORDER BY d."decidedAt"`;
}
/** @param {string} userId */
export function moderationAppealsExportSql(userId) {
  return sql`SELECT a."decisionId", a."appellantKind", a.body, a.status, a.response, a."createdAt", a."reviewedAt" FROM "ModerationAppeal" a WHERE a."appellantUserId" = ${userId} ORDER BY a."createdAt"`;
}
/** @param {string} userId */
export function moderationSanctionsExportSql(userId) {
  return sql`SELECT s.scope, s.kind, s.reason, s."createdAt", s."endsAt", s."liftedAt" FROM "ModerationSanction" s WHERE s."subjectUserId" = ${userId} ORDER BY s."createdAt"`;
}

/* ------------------------------------------------------------------------------------------------------- the feature actions, wrapped */

/** the author (citizen account or structure) of a content, read BEFORE the decision erases anything @param {any} db @param {string} type @param {string} id */
export async function contentSubject(db, type, id) {
  const one = async (q) => ((await db.execute(q))?.rows || [])[0] || null;
  switch (type) {
    case 'testimonial': return { userId: (await one(sql`SELECT "citizenUserId" AS u FROM "Testimonial" WHERE id = ${id}`))?.u ?? null, structureId: null };
    case 'story': return { userId: (await one(sql`SELECT m."citizenUserId" AS u FROM "CommunityStory" s JOIN "CommunityMember" m ON m.id = s."memberId" WHERE s.id = ${id}`))?.u ?? null, structureId: null };
    case 'job_listing': return { userId: null, structureId: (await one(sql`SELECT "structureId" AS s FROM "JobListing" WHERE id = ${id}`))?.s ?? null };
    case 'entraide_member': return { userId: (await one(sql`SELECT "citizenUserId" AS u FROM "EntraideMember" WHERE lower(pseudonym) = lower(${id})`))?.u ?? null, structureId: null };
    case 'entraide_offer': return { userId: (await one(sql`SELECT m."citizenUserId" AS u FROM "EntraideOffer" o JOIN "EntraideMember" m ON m.id = o."memberId" WHERE o.id = ${id}`))?.u ?? null, structureId: null };
    default: return { userId: null, structureId: null };
  }
}

/** the citizen accounts that reported a content in the app (read BEFORE the decision deletes the reports) @param {any} db @param {string} type @param {string} id */
export async function contentReporters(db, type, id) {
  const ids = async (q) => ((await db.execute(q))?.rows || []).map((r) => String(r.u));
  switch (type) {
    case 'testimonial': return ids(sql`SELECT "reporterUserId" AS u FROM "TestimonialReport" WHERE "testimonialId" = ${id}`);
    case 'story': return ids(sql`SELECT "reporterUserId" AS u FROM "CommunityStoryReport" WHERE "storyId" = ${id}`);
    case 'entraide_member': return ids(sql`SELECT m."citizenUserId" AS u FROM "EntraideReport" r JOIN "EntraideMember" m ON m.id = r."reporterId"
      JOIN "EntraideMember" t ON t.id = r."targetId" WHERE lower(t.pseudonym) = lower(${id})`);
    default: return [];
  }
}

/**
 * Run one moderation action of a feature with its DSA record. The statement elements are checked BEFORE the action (a restriction without its facts is
 * refused: art. 17(2) « au plus tard au moment où la restriction est imposée »); the author and the reporters are read before (the action erases the text
 * and deletes the reports); the decision is recorded and delivered after. `decisionAction` null = no decision (an approval publishes; nothing to state).
 * @param {{ db?: any, now?: () => Date, send?: (m: any) => Promise<any> }} deps
 * @param {{ actor: string, contentType: string, contentId: string, decisionAction: string | null, reasonCode?: string | null, body?: any, restrictionEndsAt?: Date | null, run: () => Promise<any> }} a
 */
export async function moderatedAction(deps, a) {
  const db = deps.db || defaultDb;
  if (!a.decisionAction) return a.run();
  if (!(await moderationSchemaAvailable(db))) throw err('MODERATION_NOT_AVAILABLE', 503);
  const b = a.body && typeof a.body === 'object' ? a.body : {};
  const facts = plain(b.facts, FACTS_MAX + 1);
  if (facts.length < FACTS_MIN || facts.length > FACTS_MAX) throw err('FACTS_REQUIRED');
  if (b.manifestlyIllegal === true && plain(b.legalGround, 1001).length < 3) throw err('LEGAL_GROUND_REQUIRED');
  let noticeId = null;
  if (b.noticeId !== undefined && b.noticeId !== null && b.noticeId !== '') {
    const [n] = await db.select({ id: ContentNotice.id, status: ContentNotice.status }).from(ContentNotice).where(eq(ContentNotice.id, String(b.noticeId))).limit(1);
    if (!n) throw err('NOTICE_NOT_FOUND', 404);
    if (n.status !== 'received') throw err('NOTICE_ALREADY_DECIDED', 409);
    noticeId = n.id;
  }
  const subject = await contentSubject(db, a.contentType, a.contentId);
  const reporters = await contentReporters(db, a.contentType, a.contentId);
  const out = await a.run();
  const source = noticeId ? 'notice' : reporters.length ? 'report' : a.decisionAction === 'rejected' ? 'pre_publication_review' : 'own_initiative';
  const recorder = decisionRecorder(deps);
  const decision = await recorder.record(a.actor, { contentType: a.contentType, contentId: a.contentId, action: a.decisionAction, reasonCode: a.reasonCode || 'NONE', facts,
    legalGround: b.legalGround || null, manifestlyIllegal: b.manifestlyIllegal === true, source, restrictionEndsAt: a.restrictionEndsAt || null,
    subjectUserId: subject.userId, subjectStructureId: subject.structureId, notifierUserIds: reporters, noticeId });
  if (noticeId) {
    const notices = contentNotices(deps);
    await notices.close(a.actor, noticeId, { outcome: 'action_taken', decisionId: decision.id }).catch(() => null);
    await notices.notifyNotifier(noticeId, decision).catch(() => null);
  }
  return { ...(out && typeof out === 'object' ? out : { result: out }), decisionId: decision.id, statementChannel: decision.statementChannel };
}
