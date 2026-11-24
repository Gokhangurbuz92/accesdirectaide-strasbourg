// @ts-nocheck
/**
 * G14-R3G (owner 24/11/2026, release-3 package) — « représentant légal d'un majeur protégé ».
 *
 * A link between the account of a protected adult (the PERSON) and the account of the person the court named to protect them (the REPRESENTATIVE):
 * a relative (tuteur, curateur, personne habilitée, mandataire spécial) or a mandataire judiciaire à la protection des majeurs (MJPM, CASF L471-1 ss),
 * optionally linked to an ADA Pro structure (service mandataire) by its SIRET. Legal analysis, sources (read 24/11/2026) and the points to validate:
 * CONTROL/master/completion/R3_KORUMA_TEMSIL_FR.md. Nothing here states what a person is entitled to; the court decision is the only authority.
 *
 * Fail-closed lifecycle:
 *   DECLARED   the representative declares the decision (court, date, measure, scope personne / biens, end date, an optional case number kept only as an
 *              HMAC) with their password. NO effect: no view, no action. The person sees the declaration in « Protection juridique » and can say they do
 *              not recognise it (the administrator sees that).
 *   VERIFIED   an administrator (named session with MFA, /admin/protection-juridique) EXAMINED the decision outside the platform — the platform never
 *              receives, stores or sends the decision, a medical certificate or their text (no AI either) — and recorded the facts it confirms, the platform
 *              areas it covers (RDV, PARCOURS), how it was examined and a short note. Only then do powers exist, and only until validUntil.
 *   SUSPENDED  the person contested a verified link: every power stops at once until the administrator reviews it (reinstated or ended).
 *   REJECTED / ENDED  no effect; the representative renounces, or the administrator ends it (mainlevée, change of measure, contest upheld, death…).
 *   EXPIRED    (computed) validUntil reached: the end date of the measure (art. 441, 442, 494-6, 439), or, for a habilitation familiale spéciale, which has
 *              no term, SPECIAL_REVIEW_DAYS after the verification (PROPOSED). Expiry ends every power by itself; a renewal is a new declaration.
 *
 * Powers (always within the verified areas; never Mon Coffre, never the account's security, export, deletion, delegations; never a login as the person):
 *   ACT      tutelle, habilitation familiale générale en représentation (art. 473, 494-1, 494-6): the representative views the covered parts and acts
 *            (closed list: cancel an appointment, change the state of a Mon Parcours step) — the person is informed of every view and action.
 *   CONFIRM  curatelle (simple, renforcée, aménagée: assistance, art. 467, 471, 472), habilitation familiale en assistance or spéciale, mandat spécial of a
 *            sauvegarde de justice (the person keeps the exercise of their rights): the representative views and ASKS; nothing is done until the PERSON
 *            confirms that one request (48 h, single use) — the platform image of a co-signature.
 *   The person keeps their own account in every case (art. 415, 459: personal decisions are the person's as far as their state allows) — the platform
 *   never restricts it. Personal health information is never shown (G8: sensitive steps stay hidden), and a processing restriction (art. 18) stops all.
 *
 * Gate: capability citizen.legal_protection (closed by default; ACCOUNTS_EXTRAS legal_protection; preflight legal.r3_legal_protection).
 * Storage: "LegalProtectionMandate" (migration 0064, journal idx 64; raw presence check); history in "AuditLog" (entity CitizenUser = the person, so the person's
 * history shows it); pending requests = AuthToken rows of the person (type LEGAL_REP_ACTION, « lprq: » + sha-256(id): never a usable token) with their
 * content in the AuditLog row « lprq:<id> », as G14-AID does.
 */
import crypto from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, AuthToken, CitizenUser, ParcoursItem, ProAppointment, Structure } from '../../src/db/schema.js';
import { LegalProtectionMandate as T } from './legal-protection-table.js';
import { isAdultAccount } from '../_utils/age-policy.js';
import { isUnsetPassword, normalizeEmail, verifyPassword } from '../_utils/user-auth.js';
import { isRestricted } from './processing-restriction.js';
import { validSiret } from '../_utils/siret.js';
import { capabilityOpen } from '../_utils/capabilities.js';
import { env } from '../_utils/env.js';

export const LP_CAPABILITY = 'citizen.legal_protection';
export const REPRESENTATIVE_KINDS = Object.freeze(['FAMILLE', 'MJPM']);
/** CASF L471-2: the three categories of the préfet's list (1° services L312-1 I 14°, 2° persons approved L472-1, 3° persons declared L472-6) */
export const MJPM_FORMS = Object.freeze(['SERVICE', 'INDIVIDUEL', 'PREPOSE']);
export const MODES = Object.freeze(['REPRESENTATION', 'ASSISTANCE']);
export const AREAS = Object.freeze(['RDV', 'PARCOURS']);
export const VERIFICATION_METHODS = Object.freeze(['ORIGINAL_SHOWN', 'CERTIFIED_COPY_EXAMINED', 'COURT_CONFIRMATION']);
export const ADMIN_END_REASONS = Object.freeze(['MAINLEVEE', 'MEASURE_CHANGED', 'CONTEST_UPHELD', 'DECEASED', 'OTHER']);
const LIVE = ['DECLARED', 'VERIFIED', 'SUSPENDED'];
/**
 * The measures, what the law allows for each (read 24/11/2026 on Légifrance, version in force at 23/11/2026 — references in R3_KORUMA_TEMSIL_FR.md):
 *   modes      the platform modes a decision of that measure can carry
 *   kinds      who can hold it (art. 494-1: the habilitation familiale only for relatives; CASF L471-1: an MJPM holds mandat spécial, curatelle, tutelle)
 *   maxYears   the longest an end date may be after the decision date: tutelle / curatelle 5 years, 10 if no improvement, renewal up to 20 (art. 441,
 *              442); habilitation familiale générale 10, renewal up to 20 (art. 494-6); sauvegarde de justice 1 year, renewable once (art. 439, F2075)
 *   term       false: no end date (habilitation familiale spéciale ends with the acts it covers, art. 494-6 / 494-11 4°)
 */
export const MEASURES = Object.freeze({
  TUTELLE: Object.freeze({ modes: ['REPRESENTATION'], kinds: ['FAMILLE', 'MJPM'], maxYears: 20, term: true, refs: 'C. civ. art. 440 al. 3, 441, 442, 473' }),
  CURATELLE_SIMPLE: Object.freeze({ modes: ['ASSISTANCE'], kinds: ['FAMILLE', 'MJPM'], maxYears: 20, term: true, refs: 'C. civ. art. 440 al. 1, 441, 442, 467' }),
  CURATELLE_RENFORCEE: Object.freeze({ modes: ['ASSISTANCE'], kinds: ['FAMILLE', 'MJPM'], maxYears: 20, term: true, refs: 'C. civ. art. 440, 467, 472' }),
  CURATELLE_AMENAGEE: Object.freeze({ modes: ['ASSISTANCE'], kinds: ['FAMILLE', 'MJPM'], maxYears: 20, term: true, refs: 'C. civ. art. 440, 467, 471' }),
  HABILITATION_FAMILIALE_GENERALE: Object.freeze({ modes: ['REPRESENTATION', 'ASSISTANCE'], kinds: ['FAMILLE'], maxYears: 20, term: true, refs: 'C. civ. art. 494-1, 494-6, 494-8' }),
  HABILITATION_FAMILIALE_SPECIALE: Object.freeze({ modes: ['REPRESENTATION', 'ASSISTANCE'], kinds: ['FAMILLE'], maxYears: 0, term: false, refs: 'C. civ. art. 494-1, 494-6, 494-11 4°' }),
  SAUVEGARDE_MANDAT_SPECIAL: Object.freeze({ modes: ['REPRESENTATION', 'ASSISTANCE'], kinds: ['FAMILLE', 'MJPM'], maxYears: 1, term: true, refs: 'C. civ. art. 433 à 439 ; CASF L471-1' }),
});
/** PROPOSED (« à approuver »): how long a verified habilitation familiale spéciale (no term) stays effective before a new verification */
export const SPECIAL_REVIEW_DAYS = 365;
export const MAX_LIVE_PER_PERSON = 3;
export const REQUEST_TOKEN_TYPE = 'LEGAL_REP_ACTION';
export const REQUEST_HOURS = 48;
export const MAX_PENDING_PER_MANDATE = 10;
/** the closed list of actions (the same as G14-AID's: api/_services/delegation-actions.js) and the area each belongs to */
export const ACTIONS = Object.freeze({ RDV_CANCEL: 'RDV', PARCOURS_STATUS: 'PARCOURS' });
/** the capability scope of delegation.js openScopes() that each area follows (A-18: a part closed on this service is closed to the representative too) */
const AREA_SCOPE = Object.freeze({ RDV: 'RDV_READ', PARCOURS: 'PARCOURS_READ' });
const VIEW_ACTION = Object.freeze({ RDV: 'LEGAL_REP_VIEWED_RDV', PARCOURS: 'LEGAL_REP_VIEWED_PARCOURS' });

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
export const requestTokenHash = (rid) => `lprq:${sha(rid)}`;
const payloadId = (rid) => `lprq:${rid}`;
const clean = (v, max) => [...String(v ?? '').normalize('NFC')].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '<' || c === '>' ? ' ' : c)).join('')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => DATE.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const addYears = (s, y) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + y); return d.toISOString().slice(0, 10); };
const addDays = (s, n) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
/** the calendar date in Strasbourg (a measure ends at the start of its end date, French civil calendar) @param {number} [now] */
export const parisToday = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

const NOT_INSTALLED = Object.freeze(bad('LEGAL_PROTECTION_NOT_INSTALLED', 'La protection juridique n’est pas encore disponible sur ce service : aucune donnée n’a été lue ni enregistrée.', 503));
const NOT_OPEN = Object.freeze(bad('CAPABILITY_NOT_OPEN', 'Cette fonction n’est pas ouverte sur ce service.', 404));

// ───────────── presence of the (pending) table
const presence = new WeakMap();
const PRESENCE_TTL_MS = 60_000;
/** does this database have "LegalProtectionMandate" (migration 0064 applied) — read at most once a minute per client; a failed read is not remembered */
export async function legalProtectionInstalled(db = defaultDb) {
  const hit = presence.get(db);
  if (hit && Date.now() - hit.at < PRESENCE_TTL_MS) return hit.value;
  try {
    const r = await db.execute(sql`SELECT to_regclass('"LegalProtectionMandate"') IS NOT NULL AS ok`);
    const value = Boolean((r.rows || r)[0]?.ok);
    presence.set(db, { at: Date.now(), value });
    return value;
  } catch { return false; }
}

// ───────────── powers
/** ACT (representation by the platform: tutelle, habilitation familiale générale en représentation) or CONFIRM (everything else) @param {{ measure: string, mode: string }} m */
export function platformMode(m) {
  return m.mode === 'REPRESENTATION' && (m.measure === 'TUTELLE' || m.measure === 'HABILITATION_FAMILIALE_GENERALE') ? 'ACT' : 'CONFIRM';
}
/** the state the people see: EXPIRED is computed (a verified or suspended link past validUntil opens nothing) */
export function stateOf(m, now = Date.now()) {
  if ((m.status === 'VERIFIED' || m.status === 'SUSPENDED') && m.validUntil && String(m.validUntil) <= parisToday(now)) return 'EXPIRED';
  return m.status;
}
/** what the representative may do now: null when nothing @returns {{ mode: 'ACT' | 'CONFIRM', areas: string[] } | null} */
export function powersOf(m, now = Date.now()) {
  if (!m || stateOf(m, now) !== 'VERIFIED') return null;
  const areas = (m.areas || []).filter((a) => AREAS.includes(a));
  return areas.length ? { mode: platformMode(m), areas } : null;
}

/**
 * Checks the facts of a decision (declared by the representative or confirmed by the administrator). Returns the normalised facts or a refusal.
 * @param {Record<string, any>} input @param {{ today: string, admin?: boolean }} o
 */
export function checkFacts(input, o) {
  const measure = String(input?.measure || ''); const spec = MEASURES[measure];
  if (!spec) return bad('INVALID_MEASURE', 'Choisissez la mesure prononcée par le juge.');
  const kind = String(input?.representativeKind || '');
  if (!REPRESENTATIVE_KINDS.includes(kind)) return bad('INVALID_KIND', 'Indiquez si vous êtes un proche ou un mandataire judiciaire à la protection des majeurs.');
  if (!spec.kinds.includes(kind)) return bad('KIND_NOT_ALLOWED', 'L’habilitation familiale ne peut être confiée qu’à un proche de la personne (Code civil, art. 494-1).');
  const mode = spec.modes.length === 1 ? spec.modes[0] : String(input?.mode || '');
  if (!spec.modes.includes(mode)) return bad('INVALID_MODE', 'Indiquez si la décision vous charge de représenter la personne ou de l’assister.');
  const scopePerson = input?.scopePerson === true; const scopeAssets = input?.scopeAssets === true;
  if (!scopePerson && !scopeAssets) return bad('INVALID_SCOPE', 'Indiquez si la mesure porte sur la protection de la personne, sur ses biens, ou les deux.');
  const mjpmForm = kind === 'MJPM' ? String(input?.mjpmForm || '') : null;
  if (kind === 'MJPM' && !MJPM_FORMS.includes(mjpmForm)) return bad('INVALID_MJPM_FORM', 'Indiquez comment vous exercez : service mandataire, mandataire individuel ou préposé d’établissement.');
  let siret = null;
  if (kind === 'MJPM' && input?.siret) { siret = validSiret(input.siret); if (!siret) return bad('INVALID_SIRET', 'Le numéro SIRET n’est pas valide (14 chiffres).'); }
  const courtName = clean(input?.courtName, 120);
  if (courtName.length < 3) return bad('INVALID_COURT', 'Indiquez le tribunal qui a rendu la décision (par exemple : tribunal judiciaire de Strasbourg).');
  const decisionDate = String(input?.decisionDate || '');
  if (!validDate(decisionDate) || decisionDate > o.today) return bad('INVALID_DECISION_DATE', 'Indiquez la date de la décision (elle ne peut pas être dans le futur).');
  let measureEndsOn = null;
  if (spec.term) {
    measureEndsOn = String(input?.measureEndsOn || '');
    if (!validDate(measureEndsOn) || measureEndsOn <= decisionDate) return bad('INVALID_END_DATE', 'Indiquez la date de fin de la mesure écrite dans la décision.');
    if (measureEndsOn > addDays(addYears(decisionDate, spec.maxYears), 1)) return bad('END_DATE_BEYOND_LAW', `Cette date de fin dépasse la durée que la loi permet pour cette mesure (${spec.refs}) : vérifiez-la.`);
    if (measureEndsOn <= o.today) return bad('MEASURE_ALREADY_ENDED', 'Cette mesure est terminée d’après sa date de fin : elle ne peut pas être enregistrée.', 409);
  }
  const out = { measure, mode, representativeKind: kind, mjpmForm, siret, scopePerson, scopeAssets, courtName, decisionDate, measureEndsOn };
  if (o.admin) {
    const areas = [...new Set(Array.isArray(input?.areas) ? input.areas.map(String) : [])];
    if (!areas.length || areas.some((a) => !AREAS.includes(a))) return bad('INVALID_AREAS', 'Choisissez au moins une partie couverte par la décision (rendez-vous, Mon Parcours).');
    // the appointments are about the person (art. 457-1 to 459): a decision limited to the property (biens) never covers them
    if (areas.includes('RDV') && !scopePerson) return bad('AREA_OUTSIDE_SCOPE', 'Une mesure limitée aux biens ne couvre pas les rendez-vous de la personne.');
    out.areas = areas;
  }
  return { ok: true, facts: out };
}

const refSecret = () => env.auth?.secret || env.secrets?.jwtSecret || '';
/** the court case number (n° RG / n° de portalis), kept only as a keyed HMAC to detect a duplicate declaration — never readable */
export function decisionRefHmac(ref, secret = refSecret()) {
  const r = String(ref || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (r.length < 4 || !secret) return null;
  return crypto.createHmac('sha256', String(secret)).update(`ada-lp-ref|v1|${r}`).digest('hex');
}

async function passwordOk(userId, password, db) {
  const [u] = await db.select({ h: CitizenUser.passwordHash }).from(CitizenUser).where(eq(CitizenUser.id, userId)).limit(1);
  if (!u || isUnsetPassword(u.h)) return false;
  const pw = String(password || '');
  return Boolean(pw) && (await verifyPassword(pw, u.h).catch(() => false));
}

const audit = (db, action, personId, actorId, details, id) => db.insert(AuditLog).values({ ...(id ? { id } : {}), action, actor: actorId, actor_id: actorId, entity: 'CitizenUser', entity_id: personId, details });

/** the view both people get (never the HMAC) */
function view(m, extra = {}, now = Date.now()) {
  const p = powersOf(m, now);
  return { id: m.id, state: stateOf(m, now), measure: m.measure, mode: m.mode, platformMode: platformMode(m), representativeKind: m.representativeKind, mjpmForm: m.mjpmForm,
    siret: m.siret, scopePerson: m.scopePerson, scopeAssets: m.scopeAssets, areas: m.areas || [], courtName: m.courtName, decisionDate: m.decisionDate,
    measureEndsOn: m.measureEndsOn, validUntil: m.validUntil, contested: Boolean(m.personContestedAt), verifiedAt: m.verifiedAt, verificationMethod: m.verificationMethod,
    verificationNote: m.verificationNote, endedAt: m.endedAt, endedBy: m.endedBy, endReason: m.endReason, createdAt: m.createdAt, powers: p, ...extra };
}

const NEUTRAL_DECLARED = 'Votre déclaration est enregistrée. Si l’adresse indiquée est celle du compte de la personne protégée, elle verra cette déclaration dans son espace ; '
  + 'l’administrateur vous contactera pour examiner la décision du juge. Aucun accès n’est ouvert avant cette vérification.';

/**
 * The representative declares a decision. Password re-entered; verified adult account; never in an assisted session. The person is found by the e-mail
 * of their account; the answer is the same whether that account exists or not (no existence oracle).
 * @param {{ id: string, email?: string, assist?: object | null }} rep @param {Record<string, any>} input
 */
export async function declareMandate(rep, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (rep.assist) return bad('ASSIST_NOT_ALLOWED', 'Une mesure de protection se déclare depuis votre propre session, sans accompagnant.', 403);
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  if (input?.truthful !== true) return bad('STATEMENT_REQUIRED', 'Cochez la case qui certifie que la décision existe et vous désigne.');
  const checked = checkFacts(input, { today: parisToday(now) });
  if (!checked.ok) return checked;
  if (!(await isAdultAccount(rep.id, db))) return bad('ADULT_ONLY', 'Cette fonction est réservée aux comptes de personnes majeures.', 409);
  if (await isRestricted(rep.id, db)) return bad('PROCESSING_RESTRICTED', 'Vous avez demandé la limitation du traitement de vos données : levez-la d’abord.', 409);
  if (!(await passwordOk(rep.id, input?.password, db))) return bad('INVALID_PASSWORD', 'Mot de passe incorrect.', 403);
  const email = normalizeEmail(input?.personEmail);
  if (!email || email === normalizeEmail(rep.email)) return bad('INVALID_EMAIL', 'Indiquez l’adresse e-mail du compte de la personne protégée.');
  const f = checked.facts;
  let structureId = null;
  if (f.siret) {
    const [s] = await db.select({ id: Structure.id }).from(Structure).where(eq(Structure.siret, f.siret)).limit(1);
    structureId = s?.id || null;
  }
  const [person] = await db.select({ id: CitizenUser.id }).from(CitizenUser).where(eq(CitizenUser.email, email)).limit(1);
  // the same answer whatever happens below: an unknown address, a person already linked to this representative, or too many links create nothing
  const neutral = { ok: true, status: 202, message: NEUTRAL_DECLARED };
  if (!person || person.id === rep.id) return neutral;
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "LegalProtectionMandate" WHERE "protectedUserId" = ${person.id} AND status IN ('DECLARED', 'VERIFIED', 'SUSPENDED')`)).rows;
  if (n >= MAX_LIVE_PER_PERSON) return neutral;
  const id = crypto.randomUUID();
  const rows = await db.insert(T).values({ id, protectedUserId: person.id, representativeUserId: rep.id, representativeKind: f.representativeKind, mjpmForm: f.mjpmForm,
    structureId, siret: f.siret, measure: f.measure, mode: f.mode, scopePerson: f.scopePerson, scopeAssets: f.scopeAssets, areas: [], courtName: f.courtName,
    decisionDate: f.decisionDate, measureEndsOn: f.measureEndsOn, decisionRefHmac: decisionRefHmac(input?.decisionRef), status: 'DECLARED' }).onConflictDoNothing().returning({ id: T.id });
  if (!rows.length) return neutral;
  await audit(db, 'LEGAL_PROTECTION_DECLARED', person.id, rep.id, { mandateId: id, measure: f.measure, mode: f.mode, representativeKind: f.representativeKind });
  return neutral;
}

async function emailsOf(ids, db) {
  const uniq = [...new Set(ids.filter(Boolean))]; if (!uniq.length) return {};
  const rows = await db.select({ id: CitizenUser.id, email: CitizenUser.email }).from(CitizenUser).where(inArray(CitizenUser.id, uniq));
  return Object.fromEntries(rows.map((x) => [x.id, x.email]));
}
async function structureNames(ids, db) {
  const uniq = [...new Set(ids.filter(Boolean))]; if (!uniq.length) return {};
  const rows = await db.select({ id: Structure.id, nom: Structure.nom }).from(Structure).where(inArray(Structure.id, uniq));
  return Object.fromEntries(rows.map((x) => [x.id, x.nom]));
}

/** Both sides: the links where I am the person (with my representatives' e-mails) and where I am the representative (with the person's e-mail). */
export async function listMine(userId, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (!(await legalProtectionInstalled(db))) return { ok: true, status: 200, installed: false, asPerson: [], asRepresentative: [], requests: [] };
  const mine = await db.select().from(T).where(sql`${T.protectedUserId} = ${userId} OR ${T.representativeUserId} = ${userId}`).orderBy(desc(T.createdAt)).limit(50);
  const who = await emailsOf(mine.flatMap((m) => [m.protectedUserId, m.representativeUserId]), db);
  const orgs = await structureNames(mine.map((m) => m.structureId), db);
  const asPerson = mine.filter((m) => m.protectedUserId === userId)
    .map((m) => view(m, { representativeEmail: who[m.representativeUserId] || '', structureName: orgs[m.structureId] || null }, now));
  const asRepresentative = mine.filter((m) => m.representativeUserId === userId)
    .map((m) => view(m, { personEmail: who[m.protectedUserId] || '', structureName: orgs[m.structureId] || null }, now));
  return { ok: true, status: 200, installed: true, asPerson, asRepresentative, requests: await listRequests(userId, db, now),
    limits: { measures: Object.keys(MEASURES), kinds: REPRESENTATIVE_KINDS, mjpmForms: MJPM_FORMS, areas: AREAS, requestHours: REQUEST_HOURS } };
}

async function mandateOf(id, db) {
  const [m] = await db.select().from(T).where(eq(T.id, String(id || ''))).limit(1);
  return m || null;
}

/**
 * The person says they do not recognise a link (or no longer accept it pending review): a verified link is SUSPENDED at once (every power stops);
 * a declared one is flagged for the administrator. The measure itself is the judge's: the review is the administrator's, never automatic.
 */
export async function contestMandate(person, id, deps = {}) {
  const db = deps.db || defaultDb;
  if (person.assist) return bad('ASSIST_NOT_ALLOWED', 'Seule la personne elle-même, sans accompagnant, peut faire ce signalement.', 403);
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const m = await mandateOf(id, db);
  if (!m || m.protectedUserId !== person.id) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  if (!LIVE.includes(m.status)) return bad('ALREADY_ENDED', 'Ce lien est déjà terminé.', 409);
  const now = new Date();
  const set = m.status === 'VERIFIED' ? { status: 'SUSPENDED', personContestedAt: now, updatedAt: now } : { personContestedAt: now, updatedAt: now };
  await db.update(T).set(set).where(and(eq(T.id, m.id), inArray(T.status, LIVE)));
  await audit(db, 'LEGAL_PROTECTION_CONTESTED', person.id, person.id, { mandateId: m.id, from: m.status });
  return { ok: true, status: 200, state: set.status || m.status };
}

/** The representative ends their own link (renounces on the platform; the measure itself only ends by the judge). */
export async function renounceMandate(rep, id, deps = {}) {
  const db = deps.db || defaultDb;
  if (rep.assist) return bad('ASSIST_NOT_ALLOWED', 'Cette action n’est pas possible en mode accompagnant.', 403);
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const m = await mandateOf(id, db);
  if (!m || m.representativeUserId !== rep.id) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  const now = new Date();
  const rows = await db.update(T).set({ status: 'ENDED', endedAt: now, endedBy: 'REPRESENTATIVE', endReason: 'RENOUNCED', updatedAt: now })
    .where(and(eq(T.id, m.id), inArray(T.status, LIVE))).returning({ id: T.id });
  if (!rows.length) return bad('ALREADY_ENDED', 'Ce lien est déjà terminé.', 409);
  await audit(db, 'LEGAL_PROTECTION_ENDED', m.protectedUserId, rep.id, { mandateId: m.id, by: 'REPRESENTATIVE', reason: 'RENOUNCED' });
  return { ok: true, status: 200 };
}

/** a live mandate of this representative with this area — or a refusal; checks the area's own capability and the person's restriction */
async function usable(repId, id, area, db, deps, now) {
  const m = await mandateOf(id, db);
  if (!m || m.representativeUserId !== repId) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  const p = powersOf(m, now);
  if (!p) return bad('MANDATE_NOT_ACTIVE', stateOf(m, now) === 'DECLARED' ? 'La décision n’a pas encore été vérifiée : aucun accès n’est ouvert.' : 'Ce lien n’est pas actif : aucun accès n’est ouvert.', 409);
  if (!p.areas.includes(area)) return bad('AREA_NOT_COVERED', 'La décision vérifiée ne couvre pas cette partie.', 403);
  const { openScopes } = await import('./delegation.js');
  if (!openScopes(deps.isOpen).includes(AREA_SCOPE[area])) return bad('CAPABILITY_NOT_OPEN', 'Cette partie n’est pas ouverte sur ce service.', 404);
  if (await isRestricted(m.protectedUserId, db)) return bad('PROCESSING_RESTRICTED', 'La personne a demandé la limitation du traitement de ses données : rien n’est possible pendant ce temps.', 409);
  return { ok: true, m, p };
}

/**
 * The representative views a covered part (read-only projection, the same columns as a trusted person's; sensitive steps never). Logged for the person.
 * @param {{ id: string, assist?: object | null }} rep @param {string} id @param {'rdv' | 'parcours'} what
 */
export async function representativeView(rep, id, what, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (rep.assist) return bad('ASSIST_NOT_ALLOWED', 'Cette action n’est pas possible en mode accompagnant.', 403);
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const area = what === 'rdv' ? 'RDV' : what === 'parcours' ? 'PARCOURS' : null;
  if (!area) return bad('INVALID_VIEW', 'Vue inconnue.');
  const u = await usable(rep.id, id, area, db, deps, now);
  if (!u.ok) return u;
  const owner = u.m.protectedUserId;
  let data;
  if (area === 'PARCOURS') {
    const { parcoursItemTable, parcoursPlanStepSchema } = await import('../_utils/schema-features.js');
    const { sensitiveItemIds } = await import('./mon-espace.js');
    const has = await parcoursPlanStepSchema(db); const PT = parcoursItemTable(has);
    const rows = await db.select({ id: ParcoursItem.id, title: ParcoursItem.title, status: ParcoursItem.status, dueDate: ParcoursItem.dueDate, dueSourceUrl: ParcoursItem.dueSourceUrl,
      itemCodes: ParcoursItem.itemCodes, ...(has ? { planStep: PT.planStep } : {}) }).from(PT).where(eq(ParcoursItem.userId, owner)).orderBy(ParcoursItem.createdAt);
    const hidden = await sensitiveItemIds(rows, db);
    data = { items: rows.filter((i) => !hidden.has(i.id)).map((i) => ({ id: i.id, title: i.title, status: i.status, dueDate: i.dueDate, dueSourceUrl: i.dueSourceUrl })), hiddenSensitive: hidden.size };
  } else {
    const rows = await db.select({ id: ProAppointment.id, startAt: ProAppointment.startAt, status: ProAppointment.status, structure: Structure.nom }).from(ProAppointment)
      .leftJoin(Structure, eq(Structure.id, ProAppointment.structureId))
      .where(and(eq(ProAppointment.citizenUserId, owner), sql`${ProAppointment.startAt} > NOW()`, sql`${ProAppointment.status} <> 'cancelled'`)).orderBy(ProAppointment.startAt).limit(20);
    data = { appointments: rows.map((a) => ({ id: a.id, startAt: a.startAt, status: a.status, structure: a.structure || '' })) };
  }
  await audit(db, VIEW_ACTION[area], owner, rep.id, { mandateId: u.m.id });
  return { ok: true, status: 200, mandate: { id: u.m.id, platformMode: u.p.mode, areas: u.p.areas }, ...data };
}

/**
 * The representative acts (ACT: executed at once, the person informed) or asks (CONFIRM: a request waits 48 h for the person's own confirmation).
 * @param {{ id: string, assist?: object | null }} rep @param {{ id: string, type: string, appointmentId?: string, itemId?: string, status?: string }} input
 */
export async function representativeAct(rep, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (rep.assist) return bad('ASSIST_NOT_ALLOWED', 'Cette action n’est pas possible en mode accompagnant.', 403);
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const type = String(input?.type || ''); const area = ACTIONS[type];
  if (!area) return bad('INVALID_ACTION', 'Action inconnue.');
  const u = await usable(rep.id, input?.id, area, db, deps, now);
  if (!u.ok) return u;
  const owner = u.m.protectedUserId;
  const { checkActionTarget, executeAction } = await import('./delegation-actions.js');
  const checked = await checkActionTarget(owner, type, input, db);
  if (!checked.ok) return checked;
  const base = { mandateId: u.m.id, representativeUserId: rep.id, type, target: checked.target };
  if (u.p.mode === 'ACT') {
    const out = await executeAction(owner, type, checked.target, deps);
    await audit(db, 'LEGAL_REP_ACTION_EXECUTED', owner, rep.id, { ...base, outcome: out.status });
    if (!out.ok) return bad('ACTION_FAILED', 'L’action n’a pas pu être faite (elle a peut-être déjà été faite).', 409);
    return { ok: true, status: 200, executed: true };
  }
  const pending = await pendingOf(owner, db, now);
  if (pending.filter((x) => x.mandateId === u.m.id).length >= MAX_PENDING_PER_MANDATE) return bad('TOO_MANY_REQUESTS', `Au plus ${MAX_PENDING_PER_MANDATE} demandes en attente.`, 409);
  const rid = crypto.randomUUID(); const expiresAt = new Date(now + REQUEST_HOURS * 3600000);
  await db.insert(AuthToken).values({ id: rid, userId: owner, type: REQUEST_TOKEN_TYPE, tokenHash: requestTokenHash(rid), expiresAt });
  await audit(db, 'LEGAL_REP_ACTION_REQUESTED', owner, rep.id, { ...base, requestId: rid, expiresAt: expiresAt.toISOString() }, payloadId(rid));
  return { ok: true, status: 202, executed: false, request: { id: rid, expiresAt: expiresAt.toISOString() } };
}

async function pendingOf(personId, db, now = Date.now()) {
  const tokens = await db.select({ id: AuthToken.id, expiresAt: AuthToken.expiresAt, createdAt: AuthToken.createdAt }).from(AuthToken)
    .where(and(eq(AuthToken.userId, personId), eq(AuthToken.type, REQUEST_TOKEN_TYPE), isNull(AuthToken.usedAt), gt(AuthToken.expiresAt, new Date(now))));
  if (!tokens.length) return [];
  const payloads = await db.select({ id: AuditLog.id, details: AuditLog.details }).from(AuditLog).where(inArray(AuditLog.id, tokens.map((t) => payloadId(t.id))));
  const byId = Object.fromEntries(payloads.map((p) => [p.id, p.details || {}]));
  return tokens.filter((t) => byId[payloadId(t.id)]).map((t) => ({ id: t.id, createdAt: t.createdAt, expiresAt: t.expiresAt, ...byId[payloadId(t.id)] }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** the person's requests to confirm (with the representative's e-mail and what would be done) */
export async function listRequests(personId, db = defaultDb, now = Date.now()) {
  const rows = await pendingOf(personId, db, now);
  const who = await emailsOf(rows.map((r) => r.representativeUserId), db);
  return rows.map((r) => ({ id: r.id, mandateId: r.mandateId, type: r.type, target: r.target, representativeEmail: who[r.representativeUserId] || '', createdAt: r.createdAt, expiresAt: r.expiresAt }));
}

/** the person's pending requests for the in-app notification centre: [{ id, at }] */
export async function pendingRequestNotices(personId, db = defaultDb, now = Date.now()) {
  if (!(await legalProtectionInstalled(db))) return [];
  return db.select({ id: AuthToken.id, at: AuthToken.createdAt }).from(AuthToken)
    .where(and(eq(AuthToken.userId, personId), eq(AuthToken.type, REQUEST_TOKEN_TYPE), isNull(AuthToken.usedAt), gt(AuthToken.expiresAt, new Date(now))));
}
/** declarations that name the person and are still waiting for the administrator (the person is told at once): [{ id, at }] */
export async function declaredNotices(personId, db = defaultDb) {
  if (!(await legalProtectionInstalled(db))) return [];
  return db.select({ id: T.id, at: T.createdAt }).from(T).where(and(eq(T.protectedUserId, personId), eq(T.status, 'DECLARED')));
}

/** The person confirms (done as their own decision) or refuses one request. Single use (claimed atomically first). */
export async function resolveRequest(person, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (person.assist) return bad('ASSIST_NOT_ALLOWED', 'Seule la personne elle-même, sans accompagnant, peut confirmer une demande.', 403);
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const rid = String(input?.requestId || ''); const accept = input?.accept === true;
  const claimed = await db.update(AuthToken).set({ usedAt: new Date(now) })
    .where(and(eq(AuthToken.id, rid), eq(AuthToken.userId, person.id), eq(AuthToken.type, REQUEST_TOKEN_TYPE), isNull(AuthToken.usedAt), gt(AuthToken.expiresAt, new Date(now))))
    .returning({ id: AuthToken.id });
  if (!claimed.length) return bad('REQUEST_NOT_FOUND', 'Demande introuvable, expirée ou déjà traitée.', 404);
  const [p] = await db.select({ details: AuditLog.details }).from(AuditLog).where(eq(AuditLog.id, payloadId(rid))).limit(1);
  const req = p?.details || {};
  const base = { requestId: rid, mandateId: req.mandateId, representativeUserId: req.representativeUserId, type: req.type, target: req.target };
  if (!accept) { await audit(db, 'LEGAL_REP_ACTION_REFUSED', person.id, person.id, base); return { ok: true, status: 200, done: false }; }
  const area = ACTIONS[req.type];
  const m = await mandateOf(req.mandateId, db);
  const pw = m && m.protectedUserId === person.id ? powersOf(m, now) : null;
  if (!area || !pw || !pw.areas.includes(area)) {
    await audit(db, 'LEGAL_REP_ACTION_REFUSED', person.id, person.id, { ...base, reason: 'MANDATE_NOT_ACTIVE' });
    return bad('MANDATE_NOT_ACTIVE', 'Ce lien n’est plus actif : la demande n’a pas été faite. Vous pouvez faire cette action vous-même.', 409);
  }
  const { checkActionTarget, executeAction } = await import('./delegation-actions.js');
  const checked = await checkActionTarget(person.id, req.type, { ...req.target }, db);
  if (!checked.ok) { await audit(db, 'LEGAL_REP_ACTION_REFUSED', person.id, person.id, { ...base, reason: checked.code }); return checked; }
  const out = await executeAction(person.id, req.type, checked.target, deps);
  await audit(db, 'LEGAL_REP_ACTION_CONFIRMED', person.id, person.id, { ...base, outcome: out.status });
  if (!out.ok) return bad('ACTION_FAILED', 'L’action n’a pas pu être faite (elle a peut-être déjà été faite).', 409);
  return { ok: true, status: 200, done: true };
}

/** What happened on the person's links, newest first: declarations, verifications, contests, ends, views, requests, actions (for both sides). */
export async function historyOf(personId, mandateIds, db = defaultDb) {
  if (!mandateIds.length) return [];
  const rows = await db.select({ action: AuditLog.action, at: AuditLog.timestamp, actor: AuditLog.actor_id, details: AuditLog.details }).from(AuditLog)
    .where(and(eq(AuditLog.entity, 'CitizenUser'), eq(AuditLog.entity_id, personId), sql`(${AuditLog.action} LIKE 'LEGAL_PROTECTION_%' OR ${AuditLog.action} LIKE 'LEGAL_REP_%')`,
      inArray(sql`${AuditLog.details}->>'mandateId'`, mandateIds)))
    .orderBy(desc(AuditLog.timestamp)).limit(300);
  return rows.map((r) => ({ at: r.at, event: r.action, mandateId: r.details?.mandateId || null, type: r.details?.type || null, target: r.details?.target || null,
    by: r.actor === personId ? 'PERSON' : r.details?.by || (r.action.startsWith('LEGAL_REP_') ? 'REPRESENTATIVE' : null), reason: r.details?.reason || null }));
}

/** The person's history of one of their links, or the representative's history of the link they hold (only that link). */
export async function mandateHistory(userId, id, deps = {}) {
  const db = deps.db || defaultDb;
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const m = await mandateOf(id, db);
  if (!m || (m.protectedUserId !== userId && m.representativeUserId !== userId)) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  return { ok: true, status: 200, events: await historyOf(m.protectedUserId, [m.id], db) };
}

// ───────────── the verified representative as a helper in the person's « mode accompagnant » (G14-AID)
const CODE_WINDOW_MS = 10 * 60000;
const codeSecret = () => env.auth?.secret || env.secrets?.jwtSecret || '';
/** the 8-digit code of a verified representative for one link and a 10-minute window (HMAC of the server secret; nothing stored) */
export function representativeHelperCode(mandateId, repId, at = Date.now(), secret = codeSecret()) {
  if (!secret) throw new Error('Missing signing secret');
  const w = Math.floor(at / CODE_WINDOW_MS);
  const h = crypto.createHmac('sha256', String(secret)).update(`ada-lp-helper|v1|${mandateId}|${repId}|${w}`).digest();
  return String(h.readUIntBE(0, 6) % 100000000).padStart(8, '0');
}
const codeValid = (mandateId, repId, code, at, secret = codeSecret()) => {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 8 || !secret) return false;
  return [0, 1].some((k) => crypto.timingSafeEqual(Buffer.from(representativeHelperCode(mandateId, repId, at - k * CODE_WINDOW_MS, secret)), Buffer.from(c)));
};

/** The representative gets the code they show the person, for a VERIFIED live link only. */
export async function issueHelperCode(rep, id, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (rep.assist) return bad('ASSIST_NOT_ALLOWED', 'Cette action n’est pas possible en mode accompagnant.', 403);
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const m = await mandateOf(id, db);
  if (!m || m.representativeUserId !== rep.id) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  if (!powersOf(m, now)) return bad('MANDATE_NOT_ACTIVE', 'Ce lien n’est pas actif : aucun code ne peut être donné.', 409);
  const code = representativeHelperCode(m.id, rep.id, now);
  await audit(db, 'LEGAL_REP_HELPER_CODE_ISSUED', m.protectedUserId, rep.id, { mandateId: m.id });
  return { ok: true, status: 200, code: `${code.slice(0, 4)} ${code.slice(4)}`, validUntil: new Date((Math.floor(now / CODE_WINDOW_MS) + 2) * CODE_WINDOW_MS) };
}

/**
 * The C23 rule of the « mode accompagnant » for a person under a VERIFIED measure (called by api/_services/assisted-mode.js startAssist):
 *   - helper role REPRESENTANT_LEGAL: allowed only with a valid code of one of the person's verified live links, and only in the areas it covers;
 *   - any other helper: refused while a verified link gives the representative the power to ACT (tutelle, habilitation générale en représentation:
 *     the person is represented in the acts of civil life, art. 473 / 494-1 — a third party acting in their account would bypass the representative);
 *     allowed under assistance measures and a mandat spécial (the person keeps the exercise of their rights: art. 467, 494-8, F2075).
 * Declared (unverified) links have no effect either way (anyone can declare: a declaration must never take the person's own choices away).
 * @returns {Promise<{ ok: true, representative: null | { mandateId: string, representativeUserId: string, areas: string[], structureName: string | null } } | ReturnType<typeof bad>>}
 */
export async function assistRuleFor(personId, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  const role = String(input?.helperRole || '');
  if (!(await legalProtectionInstalled(db))) {
    return role === 'REPRESENTANT_LEGAL' ? bad('REPRESENTATIVE_NOT_VERIFIED', 'Le code du représentant n’est pas valable, ou son lien n’est pas vérifié.', 403) : { ok: true, representative: null };
  }
  const live = (await db.select().from(T).where(and(eq(T.protectedUserId, personId), eq(T.status, 'VERIFIED')))).filter((m) => powersOf(m, now));
  if (role === 'REPRESENTANT_LEGAL') {
    const m = live.find((x) => codeValid(x.id, x.representativeUserId, input?.representativeCode, now));
    if (!m) return bad('REPRESENTATIVE_NOT_VERIFIED', 'Le code du représentant n’est pas valable, ou son lien n’est pas vérifié. Demandez-lui un nouveau code.', 403);
    const areas = Array.isArray(input?.areas) ? input.areas.map(String) : [];
    if (areas.some((a) => !powersOf(m, now).areas.includes(a))) return bad('AREA_NOT_COVERED', 'La décision vérifiée ne couvre pas toutes les parties choisies.', 409);
    const orgs = await structureNames([m.structureId], db);
    return { ok: true, representative: { mandateId: m.id, representativeUserId: m.representativeUserId, areas: powersOf(m, now).areas, structureName: orgs[m.structureId] || null } };
  }
  if (live.some((m) => powersOf(m, now).mode === 'ACT')) {
    return bad('ASSIST_REPRESENTATIVE_REQUIRED', 'Une décision de justice vérifiée confie à votre représentant le soin d’agir pour vous dans ce service : le mode accompagnant n’est possible qu’avec lui. Vous pouvez toujours utiliser votre compte vous-même.', 409);
  }
  return { ok: true, representative: null };
}

// ───────────── the administrator (named session with MFA: api/_handlers/admin/legal-protection.js)
/** the queue: declarations waiting, links contested; with what the administrator needs to examine the decision (the two e-mails, the declared facts) */
export async function adminQueue(deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (!(await legalProtectionInstalled(db))) return { ok: true, status: 200, installed: false, pending: [], contested: [] };
  const rows = await db.select().from(T).where(sql`${T.status} IN ('DECLARED', 'SUSPENDED') OR (${T.status} = 'VERIFIED' AND ${T.personContestedAt} IS NOT NULL)`).orderBy(T.createdAt).limit(200);
  const who = await emailsOf(rows.flatMap((m) => [m.protectedUserId, m.representativeUserId]), db);
  const orgs = await structureNames(rows.map((m) => m.structureId), db);
  const v = (m) => view(m, { personEmail: who[m.protectedUserId] || '', representativeEmail: who[m.representativeUserId] || '', structureName: orgs[m.structureId] || null,
    duplicateRef: false }, now);
  const out = rows.map(v);
  // the same case number declared twice for the same person (HMAC only): shown, never decided automatically
  const refs = rows.filter((m) => m.decisionRefHmac).map((m) => m.decisionRefHmac);
  if (refs.length) {
    const dup = (await db.execute(sql`SELECT "decisionRefHmac" AS h, "protectedUserId" AS p, count(*)::int AS n FROM "LegalProtectionMandate" WHERE "decisionRefHmac" IN (${sql.join(refs.map((h) => sql`${h}`), sql`, `)}) GROUP BY 1, 2`)).rows;
    const many = new Set(dup.filter((d) => d.n > 1).map((d) => `${d.h}|${d.p}`));
    rows.forEach((m, i) => { out[i].duplicateRef = many.has(`${m.decisionRefHmac}|${m.protectedUserId}`); });
  }
  return { ok: true, status: 200, installed: true, pending: out.filter((m) => m.state === 'DECLARED'), contested: out.filter((m) => m.state !== 'DECLARED'),
    limits: { measures: MEASURES, methods: VERIFICATION_METHODS, areas: AREAS, endReasons: ADMIN_END_REASONS, specialReviewDays: SPECIAL_REVIEW_DAYS } };
}

const noteOf = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s.length >= 10 && s.length <= 500 && !/[<>]/.test(s) ? s : null; };

/**
 * The administrator records what they examined: the facts the decision confirms (they may correct the declaration), the areas it covers, the method,
 * a note (10–500 characters, plain text, never the decision's content). DECLARED → VERIFIED.
 */
export async function adminVerify(adminEmail, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const m = await mandateOf(input?.id, db);
  if (!m) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  if (m.status !== 'DECLARED') return bad('NOT_DECLARED', 'Seule une déclaration en attente peut être vérifiée.', 409);
  const method = String(input?.method || '');
  if (!VERIFICATION_METHODS.includes(method)) return bad('INVALID_METHOD', 'Indiquez comment la décision a été examinée.');
  const note = noteOf(input?.note);
  if (!note) return bad('NOTE_REQUIRED', 'Indiquez en quelques mots ce qui a été vérifié (10 à 500 caractères, texte simple, sans recopier la décision).');
  const today = parisToday(now);
  const checked = checkFacts({ mjpmForm: m.mjpmForm, siret: m.siret, ...input, representativeKind: input?.representativeKind || m.representativeKind }, { today, admin: true });
  if (!checked.ok) return checked;
  const f = checked.facts;
  const validUntil = MEASURES[f.measure].term ? f.measureEndsOn : addDays(today, SPECIAL_REVIEW_DAYS);
  const at = new Date(now);
  const rows = await db.update(T).set({ ...f, structureId: f.representativeKind === 'MJPM' ? m.structureId : null, validUntil, status: 'VERIFIED', verifiedAt: at, verifiedBy: String(adminEmail), verificationMethod: method, verificationNote: note, updatedAt: at })
    .where(and(eq(T.id, m.id), eq(T.status, 'DECLARED'))).returning();
  if (!rows.length) return bad('NOT_DECLARED', 'Seule une déclaration en attente peut être vérifiée.', 409);
  await audit(db, 'LEGAL_PROTECTION_VERIFIED', m.protectedUserId, String(adminEmail), { mandateId: m.id, by: 'ADMIN', method, measure: f.measure, mode: f.mode, areas: f.areas, validUntil });
  return { ok: true, status: 200, mandate: view(rows[0], {}, now) };
}

/** DECLARED → REJECTED (the decision could not be examined, does not exist or does not name the declarant). */
export async function adminReject(adminEmail, input, deps = {}) {
  const db = deps.db || defaultDb;
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const note = noteOf(input?.note);
  if (!note) return bad('NOTE_REQUIRED', 'Indiquez pourquoi la déclaration n’a pas pu être vérifiée (10 à 500 caractères).');
  const m = await mandateOf(input?.id, db);
  if (!m) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  const at = new Date();
  const rows = await db.update(T).set({ status: 'REJECTED', endedAt: at, endedBy: 'ADMIN', endReason: 'NOT_VERIFIED', verificationNote: note, updatedAt: at })
    .where(and(eq(T.id, m.id), eq(T.status, 'DECLARED'))).returning({ id: T.id });
  if (!rows.length) return bad('NOT_DECLARED', 'Seule une déclaration en attente peut être refusée.', 409);
  await audit(db, 'LEGAL_PROTECTION_REJECTED', m.protectedUserId, String(adminEmail), { mandateId: m.id, by: 'ADMIN', reason: 'NOT_VERIFIED' });
  return { ok: true, status: 200 };
}

/** SUSPENDED → VERIFIED after the review of a contest (the decision stands: the person is told why in the note) — never past validUntil. */
export async function adminReinstate(adminEmail, input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || Date.now();
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const note = noteOf(input?.note);
  if (!note) return bad('NOTE_REQUIRED', 'Indiquez ce qui a été revu (10 à 500 caractères) : la personne le verra.');
  const m = await mandateOf(input?.id, db);
  if (!m) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  if (stateOf(m, now) !== 'SUSPENDED') return bad('NOT_SUSPENDED', 'Seul un lien suspendu (et non expiré) peut être rétabli.', 409);
  const at = new Date(now);
  const rows = await db.update(T).set({ status: 'VERIFIED', verificationNote: note, updatedAt: at }).where(and(eq(T.id, m.id), eq(T.status, 'SUSPENDED'))).returning({ id: T.id });
  if (!rows.length) return bad('NOT_SUSPENDED', 'Seul un lien suspendu peut être rétabli.', 409);
  await audit(db, 'LEGAL_PROTECTION_REINSTATED', m.protectedUserId, String(adminEmail), { mandateId: m.id, by: 'ADMIN' });
  return { ok: true, status: 200 };
}

/** Any live link → ENDED (mainlevée, change of measure, contest upheld, death, other). */
export async function adminEnd(adminEmail, input, deps = {}) {
  const db = deps.db || defaultDb;
  if (!(await legalProtectionInstalled(db))) return NOT_INSTALLED;
  const reason = String(input?.reason || '');
  if (!ADMIN_END_REASONS.includes(reason)) return bad('INVALID_REASON', 'Choisissez le motif de fin.');
  const note = noteOf(input?.note);
  if (!note) return bad('NOTE_REQUIRED', 'Indiquez en quelques mots la raison (10 à 500 caractères).');
  const m = await mandateOf(input?.id, db);
  if (!m) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  const at = new Date();
  const rows = await db.update(T).set({ status: 'ENDED', endedAt: at, endedBy: 'ADMIN', endReason: reason, verificationNote: note, updatedAt: at })
    .where(and(eq(T.id, m.id), inArray(T.status, LIVE))).returning({ id: T.id });
  if (!rows.length) return bad('ALREADY_ENDED', 'Ce lien est déjà terminé.', 409);
  await audit(db, 'LEGAL_PROTECTION_ENDED', m.protectedUserId, String(adminEmail), { mandateId: m.id, by: 'ADMIN', reason });
  return { ok: true, status: 200 };
}

/** is the capability open here @param {(c: string) => boolean} [isOpen] */
export const legalProtectionOpen = (isOpen = (c) => capabilityOpen(c)) => isOpen(LP_CAPABILITY);
export { NOT_OPEN as LEGAL_PROTECTION_NOT_OPEN };
