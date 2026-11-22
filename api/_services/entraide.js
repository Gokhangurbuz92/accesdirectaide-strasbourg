// @ts-nocheck
/**
 * X03 (EXPANSION, founder authorization 19/11/2026 — not one of the 173) — ENTRAIDE: peer support between adults. The only reader / writer of EntraideMember,
 * EntraideOffer, EntraideRequest, EntraideContactShare, EntraideReport and EntraideBlock (drizzle/0057_x03_entraide.sql). Canonical row X03: « Safeguarding,
 * matching privacy, reporting » (external gate: « safeguarding policy »).
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ AIPD GUARD — A DEDICATED AIPD IS MANDATORY BEFORE ANY OPENING. Matching people on their needs is a SENSITIVE INFERENCE (a request for help reveals   │
 * │ a situation of vulnerability). The capability « community.entraide » stays OUTSIDE the AIPD and the surface « entraide » is opened by NO deployment   │
 * │ until the controller has signed the dedicated AIPD (draft: CONTROL/master/completion/G6_X03_ENTRAIDE_2026-11-19.md § 3), approved the charter text   │
 * │ (CHARTER_VERSION is a « projet »), the safeguarding policy and the moderators. Do NOT add « entraide » to any opening list, simulator final state or │
 * │ release configuration without that signature. Do NOT add a category, a free-text need, a score or an automatic match without a new AIPD review.      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * PRIVACY BY DESIGN
 *   - Own PSEUDONYMOUS principal (X01 pattern, R47 § 8): an adult account JOINS Entraide with a chosen pseudonym (X01 rules: never prefilled, not the e-mail
 *     local part, no space / « @ » / 5-digit run / reserved word; unique without regard to case; immutable) — and NOT its X01 story pseudonym (the two
 *     activities are never linked). The member row has its own random id; nothing public or shown to a moderator names the account.
 *   - CLOSED lists only: help CATEGORIES (practical help: no health, disability, addiction, legal-status, religion, sexuality or ethnicity category — tested)
 *     and coarse AREAS (commune / quartier: no address, no position, no distance). A short LOGISTICS NOTE (≤ NOTE_MAX) with the health / sensitive-data warning
 *     on screen; contacts, links, phone numbers, markup and money are REFUSED in it.
 *   - NO algorithmic matching, NO score, NO ranking by person: a member BROWSES anonymous open offers filtered by category and area (newest first) — an offer
 *     shows its category, area, note and day, never the volunteer. Needs are NEVER published: a request goes to ONE offer.
 *   - DOUBLE OPT-IN: requester asks (pending) → the volunteer accepts (accepted) → only then each side sees the other's pseudonym, and each MAY choose to show
 *     ONE e-mail address (explicit box, ConsentLog ENTRAIDE_CONTACT_SHARE, revocable at any time; deleted when the request ends). NO messaging surface exists.
 * SAFEGUARDING
 *   - Adults only: joining and every write / browse re-check api/_utils/age-policy.js isAdultAccount (403 otherwise). No minors.
 *   - Charter: joining needs the explicit acceptance of the charter (CHARTER_VERSION « projet »; ConsentLog ENTRAIDE_VOLUNTEER_CHARTER, same transaction); a
 *     new version requires a new acceptance before any write (409 CHARTER_UPDATE_REQUIRED).
 *   - Report (closed reasons, once per pair, REPORTS_PER_DAY) and BLOCK (both ways: offers hidden, no request, active requests ended, shared e-mails deleted).
 *   - Moderation (api/_handlers/admin/entraide.js, adminGate WRITE for reading too — a NAMED administrator with MFA; every read and decision audited): reported
 *     and suspended members by PSEUDONYM, report counts per reason, their open offers — never the account, its e-mail, the member id, who reported, the
 *     request notes or the shared e-mails. Suspend (closed reason; offers closed, active requests ended, shared e-mails deleted), reinstate, dismiss reports,
 *     close an offer.
 *   - Limits: OPEN_OFFERS_MAX open offers, OFFERS_PER_DAY, PENDING_REQUESTS_MAX, REQUESTS_PER_DAY, REPORTS_PER_DAY — plus citizenHandler's per-account limit.
 * DATA RIGHTS: export sections (export-account-sections.js), LEAVING Entraide deletes the member and with it offers, requests, shared e-mails, reports and blocks
 *   (charter and contact consent withdrawals appended to ConsentLog first); account deletion / DSR erasure / purge 6c cascade.
 * Without 0057 nothing is read: GET says « not available », every write answers 503 ENTRAIDE_NOT_AVAILABLE, the export sections are empty.
 * NO seed, NO sample: only offers written by real members exist (tests use clearly labelled synthetic fixtures).
 */
import crypto from 'node:crypto';
import { and, desc, eq, gt, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, CommunityMember, ConsentLog, EntraideBlock, EntraideContactShare, EntraideMember, EntraideOffer, EntraideReport, EntraideRequest } from '../../src/db/schema.js';
import { communitySchemaAvailable, pseudonymProblems, textSafetyProblems, tidy } from './community-stories.js';

/** practical help only (the same list as the CHECK of drizzle/0057 and src/lib/entraide.js) */
export const CATEGORIES = Object.freeze(['ADMIN_APPOINTMENT', 'SHOPPING', 'DIGITAL_HELP', 'FRENCH_CONVERSATION', 'PET_CARE', 'MOVING_HELP']);
/** coarse areas: a Strasbourg quartier or a commune of the Eurométropole — never an address or a position */
export const AREAS = Object.freeze(['STRASBOURG_CENTRE', 'STRASBOURG_GARE', 'STRASBOURG_KRUTENAU_ESPLANADE', 'STRASBOURG_ORANGERIE_CONSEIL_DES_XV', 'STRASBOURG_ROBERTSAU_WACKEN',
  'STRASBOURG_CRONENBOURG', 'STRASBOURG_HAUTEPIERRE_POTERIES', 'STRASBOURG_KOENIGSHOFFEN_MONTAGNE_VERTE_ELSAU', 'STRASBOURG_MEINAU', 'STRASBOURG_NEUDORF_PORT_DU_RHIN',
  'STRASBOURG_NEUHOF', 'SCHILTIGHEIM', 'BISCHHEIM', 'HOENHEIM', 'ILLKIRCH_GRAFFENSTADEN', 'LINGOLSHEIM', 'OSTWALD', 'AUTRE_EUROMETROPOLE']);
/** reasons of a report, a suspension or an offer closed by the moderation (closed list, the same as the CHECKs) */
export const REASONS = Object.freeze(['HARASSMENT', 'MONEY_REQUEST', 'UNSAFE_BEHAVIOUR', 'INAPPROPRIATE_CONTENT', 'SENSITIVE_DATA', 'SPAM']);
/** what a category may NEVER name (special categories of art. 9 and other sensitive inferences) — checked by the tests on CATEGORIES */
export const FORBIDDEN_CATEGORY_TOPICS = /health|sant|medic|m[ée]dic|soin|care_?giv|disab|handicap|addict|drog|alcool|alcohol|legal|juridi|papiers|titre_?de_?s[ée]jour|immigra|asyl|religi|cult|sexu|lgbt|ethni|origin|race|dette|debt/i;
export const CHARTER_VERSION = 'x03-2026-11-19-projet';
export const CHARTER_PURPOSE = 'ENTRAIDE_VOLUNTEER_CHARTER';
export const CONTACT_VERSION = 'x03-contact-2026-11-19-projet';
export const CONTACT_PURPOSE = 'ENTRAIDE_CONTACT_SHARE';
export const NOTE_MAX = 280;
export const OPEN_OFFERS_MAX = 3;
export const OFFERS_PER_DAY = 3;
export const PENDING_REQUESTS_MAX = 3;
export const REQUESTS_PER_DAY = 5;
export const REPORTS_PER_DAY = 5;
const BROWSE_LIMIT = 50;
const DAY = 86400e3;
const ACTIVE_REQ = ['pending', 'accepted'];
/** a shared contact is an e-mail address, nothing else */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** money in a note: Entraide is free — an amount, a price, a payment is refused (the safety guidance says « never give money ») */
const MONEY = /€|\$|£|\b(?:euros?|payer|payé|payée|paiement|payment|pay|rémunér\p{L}*|tarifs?|prix|argent|cash|money|price)(?!\p{L})/iu;

/**
 * what is wrong with a logistics note (empty = acceptable; an empty note is allowed)
 * @param {string | null | undefined} note @returns {string[]}
 */
export function noteProblems(note) {
  const n = String(note ?? '');
  if (!n) return [];
  const p = [];
  if (n.length > NOTE_MAX) p.push('NOTE_TOO_LONG');
  p.push(...textSafetyProblems(n));
  if (MONEY.test(n)) p.push('MONEY_IN_NOTE');
  return p;
}

const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });
const refusal = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/* ----------------------------------------------------------------------------------------------------------------------------------- schema */

const schemaCache = new WeakMap();
const TABLES = ['EntraideMember', 'EntraideOffer', 'EntraideRequest', 'EntraideContactShare', 'EntraideReport', 'EntraideBlock'];
/** does this database have migration 0057 (read at most once a minute per client; a failed read is not remembered) @param {any} database */
export async function entraideSchemaAvailable(database = defaultDb) {
  const hit = schemaCache.get(database);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const res = await database.execute(sql.raw(`SELECT ${TABLES.map((t) => `to_regclass('"${t}"') IS NOT NULL`).join(' AND ')} AS ok`));
    const value = Boolean((res?.rows || res || [])[0]?.ok);
    schemaCache.set(database, { at: Date.now(), value });
    return value;
  } catch { return false; }
}
const NOT_AVAILABLE = refusal(503, 'ENTRAIDE_NOT_AVAILABLE', 'L’entraide n’est pas disponible sur ce service.');
const ADULT_ONLY = refusal(403, 'ADULT_ACCOUNT_REQUIRED', 'L’entraide est réservée aux comptes de personnes de 18 ans ou plus (déclaration dans votre compte).');
const NOT_MEMBER = refusal(409, 'MEMBER_REQUIRED', 'Rejoignez d’abord l’entraide (pseudonyme et charte).');
const SUSPENDED = refusal(403, 'MEMBER_SUSPENDED', 'Votre participation à l’entraide est suspendue par la modération.');
const CHARTER_UPDATE = refusal(409, 'CHARTER_UPDATE_REQUIRED', 'La charte de l’entraide a changé : lisez-la et acceptez-la de nouveau pour continuer.');
const OFFER_NOT_FOUND = refusal(404, 'OFFER_NOT_FOUND', 'Offre introuvable ou plus disponible.');
const REQUEST_NOT_FOUND = refusal(404, 'REQUEST_NOT_FOUND', 'Demande introuvable.');

/** one append-only ConsentLog row @param {any} q @param {string} userId @param {string} purpose @param {string} version @param {string} ref @param {boolean} decision */
export async function consentRow(q, userId, purpose, version, ref, decision) {
  await q.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER', subject_id: String(userId), purpose, decision: decision === true, policy_version: version, policy_hash: `${version}:${purpose}:${ref}`,
    collection_channel: 'account', guardian_involved: false, proof_level: decision === true ? 'EXPLICIT_CHECKBOX' : 'AUTHENTICATED_SESSION',
    ...(decision === true ? {} : { withdrawn_at: new Date() }),
  });
}

/** delete the shared e-mails of these requests, each one with its consent withdrawal (the account of the member who shared it) @param {any} tx @param {string[]} requestIds */
export async function releaseShares(tx, requestIds) {
  if (!requestIds.length) return 0;
  const shares = await tx.select({ id: EntraideContactShare.id, requestId: EntraideContactShare.requestId, userId: EntraideMember.citizenUserId }).from(EntraideContactShare)
    .innerJoin(EntraideMember, eq(EntraideMember.id, EntraideContactShare.memberId)).where(inArray(EntraideContactShare.requestId, requestIds));
  if (!shares.length) return 0;
  await tx.delete(EntraideContactShare).where(inArray(EntraideContactShare.id, shares.map((s) => s.id)));
  for (const s of shares) await consentRow(tx, s.userId, CONTACT_PURPOSE, CONTACT_VERSION, s.requestId, false);
  return shares.length;
}

/** end the active (pending / accepted) requests matching `where`: note erased, shared e-mails deleted @param {any} tx @param {any} where @param {Date} at */
export async function endActiveRequests(tx, where, at) {
  const rows = await tx.update(EntraideRequest).set({ status: 'ended', note: null, closedAt: at, updatedAt: at })
    .where(and(where, inArray(EntraideRequest.status, ACTIVE_REQ))).returning({ id: EntraideRequest.id });
  await releaseShares(tx, rows.map((r) => r.id));
  return rows.length;
}
/** the requests on the offers of member `m` @param {string} m */
const onOffersOf = (m) => inArray(EntraideRequest.offerId, sql`(SELECT o.id FROM "EntraideOffer" o WHERE o."memberId" = ${m})`);
/** the active requests between two members, whichever side asked @param {string} a @param {string} b */
const between = (a, b) => or(and(eq(EntraideRequest.requesterId, a), onOffersOf(b)), and(eq(EntraideRequest.requesterId, b), onOffersOf(a)));

/* ------------------------------------------------------------------------------------------------------------------------------ citizen */

/**
 * The member side. `isAdult(userId)` = api/_utils/age-policy.js isAdultAccount (injected for tests).
 * @param {{ db?: any, now?: () => Date, isAdult?: (userId: string) => Promise<boolean> }} [deps]
 */
export function citizenEntraide({ db = defaultDb, now = () => new Date(), isAdult } = {}) {
  const adult = isAdult || (async (id) => (await import('../_utils/age-policy.js')).isAdultAccount(id, db));
  const memberOf = async (userId) => (await db.select().from(EntraideMember).where(eq(EntraideMember.citizenUserId, String(userId))).limit(1))[0] || null;
  /** the member, only when it may act: schema, membership, not suspended, current charter, adult — or the refusal */
  const active = async (userId) => {
    if (!(await entraideSchemaAvailable(db))) return { refusal: NOT_AVAILABLE };
    const m = await memberOf(userId);
    if (!m) return { refusal: NOT_MEMBER };
    if (m.status !== 'active') return { refusal: SUSPENDED };
    if (m.charterVersion !== CHARTER_VERSION) return { refusal: CHARTER_UPDATE };
    if (!(await adult(userId))) return { refusal: ADULT_ONLY };
    return { m };
  };
  /** the member whatever its state (protective actions stay possible when suspended: end a request, revoke an e-mail, unblock, close an offer, leave) */
  const anyMember = async (userId) => {
    if (!(await entraideSchemaAvailable(db))) return { refusal: NOT_AVAILABLE };
    const m = await memberOf(userId);
    return m ? { m } : { refusal: NOT_MEMBER };
  };
  /** ids of the members blocked by m or blocking m */
  const blockedWith = async (mId) => {
    const rows = await db.select({ a: EntraideBlock.blockerId, b: EntraideBlock.blockedId }).from(EntraideBlock)
      .where(or(eq(EntraideBlock.blockerId, mId), eq(EntraideBlock.blockedId, mId)));
    return [...new Set(rows.map((r) => (r.a === mId ? r.b : r.a)))];
  };
  /** the counterpart of a request or an offer the member may name in a report / block: { targetId } or null */
  const targetOf = async (mId, { offerId, requestId }) => {
    if (offerId) {
      const [o] = await db.select({ memberId: EntraideOffer.memberId }).from(EntraideOffer).where(and(eq(EntraideOffer.id, String(offerId)), ne(EntraideOffer.status, 'closed'))).limit(1);
      return o ? o.memberId : null;
    }
    if (requestId) {
      const [r] = await db.select({ requesterId: EntraideRequest.requesterId, volunteerId: EntraideOffer.memberId }).from(EntraideRequest)
        .innerJoin(EntraideOffer, eq(EntraideOffer.id, EntraideRequest.offerId)).where(eq(EntraideRequest.id, String(requestId))).limit(1);
      if (!r) return null;
      if (r.requesterId === mId) return r.volunteerId;
      if (r.volunteerId === mId) return r.requesterId;
    }
    return null;
  };
  /** a request the member is a party to, with both sides @param {string} mId @param {string} id */
  const requestOf = async (mId, id) => {
    const [r] = await db.select({ id: EntraideRequest.id, status: EntraideRequest.status, requesterId: EntraideRequest.requesterId, volunteerId: EntraideOffer.memberId })
      .from(EntraideRequest).innerJoin(EntraideOffer, eq(EntraideOffer.id, EntraideRequest.offerId)).where(eq(EntraideRequest.id, String(id))).limit(1);
    return r && (r.requesterId === mId || r.volunteerId === mId) ? r : null;
  };
  /** pseudonyms and shared e-mails of ACCEPTED requests only — the mutual acceptance is what reveals them @param {string} mId @param {any[]} reqs */
  const reveal = async (mId, reqs) => {
    const accepted = reqs.filter((r) => r.status === 'accepted');
    const out = new Map();
    if (!accepted.length) return out;
    const ids = accepted.map((r) => r.id);
    const partnerIds = [...new Set(accepted.map((r) => (r.requesterId === mId ? r.volunteerId : r.requesterId)))];
    const names = new Map((await db.select({ id: EntraideMember.id, pseudonym: EntraideMember.pseudonym }).from(EntraideMember).where(inArray(EntraideMember.id, partnerIds))).map((x) => [x.id, x.pseudonym]));
    const shares = await db.select({ requestId: EntraideContactShare.requestId, memberId: EntraideContactShare.memberId, email: EntraideContactShare.email })
      .from(EntraideContactShare).where(inArray(EntraideContactShare.requestId, ids));
    for (const r of accepted) {
      const partner = r.requesterId === mId ? r.volunteerId : r.requesterId;
      const mine = shares.find((s) => s.requestId === r.id && s.memberId === mId)?.email || null;
      const theirs = shares.find((s) => s.requestId === r.id && s.memberId === partner)?.email || null;
      out.set(r.id, { partner: names.get(partner) || null, contacts: { mine, theirs } });
    }
    return out;
  };

  return {
    /** the person's Entraide: pseudonym and state, own offers, requests sent and received (pseudonyms and e-mails only once accepted), blocks */
    async mine(userId) {
      const base = { ok: true, status: 200, charterVersion: CHARTER_VERSION, contactVersion: CONTACT_VERSION,
        limits: { openOffersMax: OPEN_OFFERS_MAX, pendingRequestsMax: PENDING_REQUESTS_MAX, noteMax: NOTE_MAX } };
      if (!(await entraideSchemaAvailable(db))) return { ...base, available: false, member: null, offers: [], sent: [], received: [], blocks: [] };
      const m = await memberOf(userId);
      if (!m) return { ...base, available: true, member: null, offers: [], sent: [], received: [], blocks: [] };
      const offers = await db.select({ id: EntraideOffer.id, category: EntraideOffer.category, area: EntraideOffer.area, note: EntraideOffer.note, status: EntraideOffer.status,
        createdAt: EntraideOffer.createdAt, closedAt: EntraideOffer.closedAt }).from(EntraideOffer).where(eq(EntraideOffer.memberId, m.id)).orderBy(desc(EntraideOffer.createdAt)).limit(50);
      const cols = { id: EntraideRequest.id, offerId: EntraideRequest.offerId, category: EntraideOffer.category, area: EntraideOffer.area, note: EntraideRequest.note,
        status: EntraideRequest.status, createdAt: EntraideRequest.createdAt, decidedAt: EntraideRequest.decidedAt, closedAt: EntraideRequest.closedAt,
        requesterId: EntraideRequest.requesterId, volunteerId: EntraideOffer.memberId };
      const sentRows = await db.select(cols).from(EntraideRequest).innerJoin(EntraideOffer, eq(EntraideOffer.id, EntraideRequest.offerId))
        .where(eq(EntraideRequest.requesterId, m.id)).orderBy(desc(EntraideRequest.createdAt)).limit(50);
      const receivedRows = await db.select(cols).from(EntraideRequest).innerJoin(EntraideOffer, eq(EntraideOffer.id, EntraideRequest.offerId))
        .where(eq(EntraideOffer.memberId, m.id)).orderBy(desc(EntraideRequest.createdAt)).limit(50);
      const revealed = await reveal(m.id, [...sentRows, ...receivedRows]);
      // never the other member's id: only its pseudonym, and only once the request is accepted
      const shape = (r) => ({ id: r.id, offerId: r.offerId, category: r.category, area: r.area, note: r.note, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt,
        closedAt: r.closedAt, partner: revealed.get(r.id)?.partner || null, contacts: revealed.get(r.id)?.contacts || null });
      const blocks = await db.select({ id: EntraideBlock.id, createdAt: EntraideBlock.createdAt }).from(EntraideBlock).where(eq(EntraideBlock.blockerId, m.id)).orderBy(desc(EntraideBlock.createdAt));
      return { ...base, available: true,
        member: { pseudonym: m.pseudonym, status: m.status, suspensionReason: m.suspensionReason, charterCurrent: m.charterVersion === CHARTER_VERSION, createdAt: m.createdAt },
        offers, sent: sentRows.map(shape), received: receivedRows.map(shape), blocks };
    },

    /** anonymous open offers, filtered by category and area — no volunteer, no score, newest first; never one's own or a blocked member's */
    async browse(userId, q = {}) {
      const { m, refusal: no } = await active(userId);
      if (no) return no;
      const category = q.category ? String(q.category) : null;
      const area = q.area ? String(q.area) : null;
      if (category && !CATEGORIES.includes(category)) return refusal(400, 'UNKNOWN_CATEGORY', 'Catégorie inconnue.');
      if (area && !AREAS.includes(area)) return refusal(400, 'UNKNOWN_AREA', 'Secteur inconnu.');
      const hidden = [m.id, ...(await blockedWith(m.id))];
      const rows = await db.select({ id: EntraideOffer.id, category: EntraideOffer.category, area: EntraideOffer.area, note: EntraideOffer.note, createdAt: EntraideOffer.createdAt,
        requested: sql`EXISTS (SELECT 1 FROM "EntraideRequest" r WHERE r."offerId" = ${EntraideOffer.id} AND r."requesterId" = ${m.id} AND r.status IN ('pending', 'accepted'))` })
        .from(EntraideOffer).innerJoin(EntraideMember, eq(EntraideMember.id, EntraideOffer.memberId))
        .where(and(eq(EntraideOffer.status, 'open'), eq(EntraideMember.status, 'active'), notInArray(EntraideOffer.memberId, hidden),
          ...(category ? [eq(EntraideOffer.category, category)] : []), ...(area ? [eq(EntraideOffer.area, area)] : [])))
        .orderBy(desc(EntraideOffer.createdAt)).limit(BROWSE_LIMIT);
      // the day only (not the time): less to link an offer to a person
      return { ok: true, status: 200, items: rows.map((r) => ({ id: r.id, category: r.category, area: r.area, note: r.note, createdOn: day(r.createdAt), requested: r.requested === true })) };
    },

    /** join with a chosen pseudonym and the explicit acceptance of the charter (adults only) @param {{ id: string, email?: string }} citizen @param {any} body */
    async join(citizen, body = {}) {
      if (!(await entraideSchemaAvailable(db))) return NOT_AVAILABLE;
      const pseudonym = String(body.pseudonym ?? '').normalize('NFC').trim();
      const problems = pseudonymProblems(pseudonym, citizen.email);
      if (problems.length) return refusal(400, problems[0], 'Ce pseudonyme ne peut pas être utilisé : 3 à 24 lettres ou chiffres, sans espace, sans « @ », sans lien avec votre adresse e-mail.', { problems });
      if (body.charter !== true || body.charterVersion !== CHARTER_VERSION) return refusal(400, 'CHARTER_REQUIRED', 'Pour rejoindre l’entraide, lisez la charte et cochez la case d’acceptation (version actuelle).');
      if (!(await adult(citizen.id))) return ADULT_ONLY;
      // never the X01 story pseudonym: the two activities must not be linkable
      if (await communitySchemaAvailable(db)) {
        const [c] = await db.select({ p: CommunityMember.pseudonym }).from(CommunityMember).where(eq(CommunityMember.citizenUserId, String(citizen.id))).limit(1);
        if (c && c.p.toLowerCase() === pseudonym.toLowerCase()) return refusal(400, 'PSEUDONYM_SAME_AS_COMMUNITY', 'Choisissez un pseudonyme différent de celui de vos histoires : les deux activités ne sont pas reliées.');
      }
      const at = now(); const id = crypto.randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(EntraideMember).values({ id, citizenUserId: citizen.id, pseudonym, status: 'active', charterVersion: CHARTER_VERSION, charterAcceptedAt: at, createdAt: at, updatedAt: at });
          await consentRow(tx, citizen.id, CHARTER_PURPOSE, CHARTER_VERSION, id, true);
        });
      } catch (e) {
        if (String(e?.cause?.code || e?.code) === '23505') {
          return (await memberOf(citizen.id)) ? refusal(409, 'ALREADY_MEMBER', 'Vous participez déjà à l’entraide.') : refusal(409, 'PSEUDONYM_TAKEN', 'Ce pseudonyme est déjà utilisé : choisissez-en un autre.');
        }
        throw e;
      }
      return { ok: true, status: 201, member: { pseudonym } };
    },

    /** accept a new version of the charter @param {{ id: string }} citizen @param {any} body */
    async acceptCharter(citizen, body = {}) {
      const { m, refusal: no } = await anyMember(citizen.id);
      if (no) return no;
      if (body.charter !== true || body.charterVersion !== CHARTER_VERSION) return refusal(400, 'CHARTER_REQUIRED', 'Cochez la case d’acceptation de la charte (version actuelle).');
      if (m.charterVersion === CHARTER_VERSION) return { ok: true, status: 200, charterCurrent: true };
      const at = now();
      await db.transaction(async (tx) => {
        await tx.update(EntraideMember).set({ charterVersion: CHARTER_VERSION, charterAcceptedAt: at, updatedAt: at }).where(eq(EntraideMember.id, m.id));
        await consentRow(tx, citizen.id, CHARTER_PURPOSE, CHARTER_VERSION, m.id, true);
      });
      return { ok: true, status: 200, charterCurrent: true };
    },

    /** leave Entraide: consent withdrawals recorded, then the member deleted with its offers, requests, shared e-mails, reports and blocks (cascade) */
    async leave(userId) {
      if (!(await entraideSchemaAvailable(db))) return NOT_AVAILABLE;
      const out = await db.transaction(async (tx) => {
        const [m] = await tx.select().from(EntraideMember).where(eq(EntraideMember.citizenUserId, String(userId))).limit(1);
        if (!m) return null;
        // the counterparts' e-mails shared on this member's requests go too (their consent withdrawal is recorded on their own account)
        const reqs = await tx.select({ id: EntraideRequest.id }).from(EntraideRequest).where(or(eq(EntraideRequest.requesterId, m.id), onOffersOf(m.id)));
        const shares = await releaseShares(tx, reqs.map((r) => r.id));
        await consentRow(tx, userId, CHARTER_PURPOSE, m.charterVersion, m.id, false);
        await tx.delete(EntraideMember).where(eq(EntraideMember.id, m.id));
        return { shares };
      });
      if (!out) return refusal(404, 'NOT_A_MEMBER', 'Vous ne participez pas à l’entraide.');
      return { ok: true, status: 200, left: true };
    },

    /** offer help: a category and an area from the closed lists, an optional logistics note @param {{ id: string }} citizen @param {any} body */
    async offerCreate(citizen, body = {}) {
      const { m, refusal: no } = await active(citizen.id);
      if (no) return no;
      if (!CATEGORIES.includes(body.category)) return refusal(400, 'UNKNOWN_CATEGORY', 'Choisissez une catégorie dans la liste.');
      if (!AREAS.includes(body.area)) return refusal(400, 'UNKNOWN_AREA', 'Choisissez un secteur dans la liste.');
      const note = tidy(body.note, NOTE_MAX + 1) || null;
      const problems = noteProblems(note);
      if (problems.length) return refusal(400, problems[0], 'La note ne peut pas être enregistrée telle quelle (sans coordonnées, lien, argent ni détail personnel).', { problems });
      const at = now();
      const [{ open, recent }] = await db.select({
        open: sql`count(*) FILTER (WHERE ${EntraideOffer.status} IN ('open', 'paused'))::int`,
        recent: sql`count(*) FILTER (WHERE ${EntraideOffer.createdAt} > ${new Date(at.getTime() - DAY)})::int`,
      }).from(EntraideOffer).where(eq(EntraideOffer.memberId, m.id));
      if (Number(open) >= OPEN_OFFERS_MAX) return refusal(409, 'TOO_MANY_OFFERS', `Vous avez déjà ${OPEN_OFFERS_MAX} offres en cours : fermez-en une avant d’en proposer une autre.`);
      if (Number(recent) >= OFFERS_PER_DAY) return refusal(429, 'OFFER_LIMIT', 'Vous avez atteint le nombre d’offres possibles pour aujourd’hui.');
      const id = crypto.randomUUID();
      await db.insert(EntraideOffer).values({ id, memberId: m.id, category: body.category, area: body.area, note, status: 'open', createdAt: at, updatedAt: at });
      return { ok: true, status: 201, id, offerStatus: 'open' };
    },

    /** pause or reopen one's own offer @param {string} userId @param {string} id @param {'open' | 'paused'} status */
    async offerStatus(userId, id, status) {
      const { m, refusal: no } = await active(userId);
      if (no) return no;
      if (!['open', 'paused'].includes(status)) return refusal(400, 'BAD_STATUS', 'État inconnu.');
      const rows = await db.update(EntraideOffer).set({ status, updatedAt: now() })
        .where(and(eq(EntraideOffer.id, String(id)), eq(EntraideOffer.memberId, m.id), ne(EntraideOffer.status, 'closed'))).returning({ id: EntraideOffer.id });
      return rows.length ? { ok: true, status: 200, id: String(id), offerStatus: status } : OFFER_NOT_FOUND;
    },

    /** close one's own offer: note erased, its active requests ended, their shared e-mails deleted */
    async offerClose(userId, id) {
      const { m, refusal: no } = await anyMember(userId);
      if (no) return no;
      const at = now();
      const done = await db.transaction(async (tx) => {
        const rows = await tx.update(EntraideOffer).set({ status: 'closed', note: null, closedAt: at, updatedAt: at })
          .where(and(eq(EntraideOffer.id, String(id)), eq(EntraideOffer.memberId, m.id), ne(EntraideOffer.status, 'closed'))).returning({ id: EntraideOffer.id });
        if (!rows.length) return null;
        return endActiveRequests(tx, eq(EntraideRequest.offerId, rows[0].id), at);
      });
      return done === null ? OFFER_NOT_FOUND : { ok: true, status: 200, id: String(id), offerStatus: 'closed', endedRequests: done };
    },

    /** ask for help on ONE open offer (the first half of the double opt-in) @param {{ id: string }} citizen @param {any} body */
    async requestCreate(citizen, body = {}) {
      const { m, refusal: no } = await active(citizen.id);
      if (no) return no;
      const [offer] = await db.select({ id: EntraideOffer.id, memberId: EntraideOffer.memberId }).from(EntraideOffer).innerJoin(EntraideMember, eq(EntraideMember.id, EntraideOffer.memberId))
        .where(and(eq(EntraideOffer.id, String(body.offerId)), eq(EntraideOffer.status, 'open'), eq(EntraideMember.status, 'active'))).limit(1);
      // a blocked pair answers as an unknown offer: the block itself is never revealed
      if (!offer || (await blockedWith(m.id)).includes(offer.memberId)) return OFFER_NOT_FOUND;
      if (offer.memberId === m.id) return refusal(409, 'OWN_OFFER', 'C’est votre propre offre.');
      const note = tidy(body.note, NOTE_MAX + 1) || null;
      const problems = noteProblems(note);
      if (problems.length) return refusal(400, problems[0], 'La note ne peut pas être envoyée telle quelle (sans coordonnées, lien, argent ni détail personnel).', { problems });
      const at = now();
      const [{ pending, recent }] = await db.select({
        pending: sql`count(*) FILTER (WHERE ${EntraideRequest.status} = 'pending')::int`,
        recent: sql`count(*) FILTER (WHERE ${EntraideRequest.createdAt} > ${new Date(at.getTime() - DAY)})::int`,
      }).from(EntraideRequest).where(eq(EntraideRequest.requesterId, m.id));
      if (Number(pending) >= PENDING_REQUESTS_MAX) return refusal(409, 'TOO_MANY_PENDING', `Vous avez déjà ${PENDING_REQUESTS_MAX} demandes en attente de réponse.`);
      if (Number(recent) >= REQUESTS_PER_DAY) return refusal(429, 'REQUEST_LIMIT', 'Vous avez atteint le nombre de demandes possibles pour aujourd’hui.');
      const id = crypto.randomUUID();
      try {
        await db.insert(EntraideRequest).values({ id, offerId: offer.id, requesterId: m.id, note, status: 'pending', createdAt: at, updatedAt: at });
      } catch (e) {
        if (String(e?.cause?.code || e?.code) === '23505') return refusal(409, 'ALREADY_REQUESTED', 'Vous avez déjà une demande en cours sur cette offre.');
        throw e;
      }
      return { ok: true, status: 201, id, requestStatus: 'pending' };
    },

    /** the volunteer accepts (second half of the double opt-in) or declines a pending request on one of its offers @param {string} userId @param {string} id @param {boolean} accept */
    async requestDecide(userId, id, accept) {
      const { m, refusal: no } = await active(userId);
      if (no) return no;
      const r = await requestOf(m.id, id);
      if (!r || r.volunteerId !== m.id) return REQUEST_NOT_FOUND;
      if (r.status !== 'pending') return refusal(409, 'NOT_PENDING', 'Cette demande n’attend plus de réponse.');
      const at = now();
      const values = accept ? { status: 'accepted', decidedAt: at, updatedAt: at } : { status: 'declined', note: null, decidedAt: at, closedAt: at, updatedAt: at };
      // compare-and-set: a withdrawal by the requester at the same moment wins
      const rows = await db.update(EntraideRequest).set(values).where(and(eq(EntraideRequest.id, r.id), eq(EntraideRequest.status, 'pending'))).returning({ id: EntraideRequest.id });
      if (!rows.length) return refusal(409, 'NOT_PENDING', 'Cette demande n’attend plus de réponse.');
      return { ok: true, status: 200, id: r.id, requestStatus: values.status };
    },

    /** end a request: the requester withdraws a pending one; either side ends an accepted one (note erased, shared e-mails deleted) */
    async requestEnd(userId, id) {
      const { m, refusal: no } = await anyMember(userId);
      if (no) return no;
      const r = await requestOf(m.id, id);
      if (!r) return REQUEST_NOT_FOUND;
      const at = now();
      if (r.status === 'pending' && r.requesterId === m.id) {
        const rows = await db.update(EntraideRequest).set({ status: 'withdrawn', note: null, closedAt: at, updatedAt: at })
          .where(and(eq(EntraideRequest.id, r.id), eq(EntraideRequest.status, 'pending'))).returning({ id: EntraideRequest.id });
        if (rows.length) return { ok: true, status: 200, id: r.id, requestStatus: 'withdrawn' };
      }
      if (r.status === 'accepted') {
        const n = await db.transaction((tx) => endActiveRequests(tx, and(eq(EntraideRequest.id, r.id), eq(EntraideRequest.status, 'accepted')), at));
        if (n) return { ok: true, status: 200, id: r.id, requestStatus: 'ended' };
      }
      return refusal(409, 'NOT_ACTIVE', 'Cette demande est déjà terminée (ou attend la réponse de la personne bénévole).');
    },

    /** show ONE e-mail address to the other side of an ACCEPTED request — explicit, recorded, revocable @param {{ id: string }} citizen @param {any} body */
    async contactShare(citizen, body = {}) {
      const { m, refusal: no } = await active(citizen.id);
      if (no) return no;
      const r = await requestOf(m.id, body.requestId);
      if (!r) return REQUEST_NOT_FOUND;
      // the reveal needs the MUTUAL acceptance: nothing can be shared on a pending, declined or ended request
      if (r.status !== 'accepted') return refusal(409, 'NOT_ACCEPTED', 'Une adresse ne peut être communiquée qu’après l’accord des deux côtés.');
      if (body.consent !== true || body.consentVersion !== CONTACT_VERSION) return refusal(400, 'CONTACT_CONSENT_REQUIRED', 'Cochez la case pour confirmer que vous choisissez de montrer cette adresse.');
      const email = String(body.email ?? '').trim();
      if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email)) return refusal(400, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
      try {
        await db.transaction(async (tx) => {
          await tx.insert(EntraideContactShare).values({ id: crypto.randomUUID(), requestId: r.id, memberId: m.id, email, createdAt: now() });
          await consentRow(tx, citizen.id, CONTACT_PURPOSE, CONTACT_VERSION, r.id, true);
        });
      } catch (e) {
        if (String(e?.cause?.code || e?.code) === '23505') return refusal(409, 'ALREADY_SHARED', 'Vous avez déjà communiqué une adresse : retirez-la d’abord pour en donner une autre.');
        throw e;
      }
      return { ok: true, status: 201, shared: true };
    },

    /** withdraw the e-mail one shared on a request (at any time, even suspended): deleted, consent withdrawal recorded */
    async contactRevoke(userId, requestId) {
      const { m, refusal: no } = await anyMember(userId);
      if (no) return no;
      const done = await db.transaction(async (tx) => {
        const rows = await tx.delete(EntraideContactShare).where(and(eq(EntraideContactShare.requestId, String(requestId)), eq(EntraideContactShare.memberId, m.id)))
          .returning({ requestId: EntraideContactShare.requestId });
        for (const x of rows) await consentRow(tx, userId, CONTACT_PURPOSE, CONTACT_VERSION, x.requestId, false);
        return rows.length;
      });
      return done ? { ok: true, status: 200, revoked: true } : refusal(404, 'NOT_SHARED', 'Aucune adresse communiquée sur cette demande.');
    },

    /** report the member behind an offer or the other side of a request (closed list, once per pair, daily limit) */
    async report(citizen, body = {}) {
      const { m, refusal: no } = await active(citizen.id);
      if (no) return no;
      if (!REASONS.includes(body.reason)) return refusal(400, 'UNKNOWN_REASON', 'Motif inconnu : choisissez dans la liste proposée.');
      const target = await targetOf(m.id, body);
      if (!target) return refusal(404, 'NOT_FOUND', 'Rien à signaler ici.');
      if (target === m.id) return refusal(409, 'OWN_OFFER', 'Vous ne pouvez pas vous signaler vous-même.');
      const at = now();
      const [{ n }] = await db.select({ n: sql`count(*)::int` }).from(EntraideReport).where(and(eq(EntraideReport.reporterId, m.id), gt(EntraideReport.createdAt, new Date(at.getTime() - DAY))));
      if (Number(n) >= REPORTS_PER_DAY) return refusal(429, 'REPORT_LIMIT', 'Vous avez atteint le nombre de signalements possibles pour aujourd’hui.');
      const ins = await db.insert(EntraideReport).values({ id: crypto.randomUUID(), reporterId: m.id, targetId: target, reason: body.reason, createdAt: at })
        .onConflictDoNothing().returning({ id: EntraideReport.id });
      if (!ins.length) return refusal(409, 'ALREADY_REPORTED', 'Vous avez déjà signalé cette personne.');
      return { ok: true, status: 201, reported: true };
    },

    /** block the member behind an offer or a request (even suspended): both ways, active requests between them ended, shared e-mails deleted */
    async block(userId, body = {}) {
      const { m, refusal: no } = await anyMember(userId);
      if (no) return no;
      const target = await targetOf(m.id, body);
      if (!target) return refusal(404, 'NOT_FOUND', 'Rien à bloquer ici.');
      if (target === m.id) return refusal(409, 'OWN_OFFER', 'Vous ne pouvez pas vous bloquer vous-même.');
      const at = now();
      const ended = await db.transaction(async (tx) => {
        await tx.insert(EntraideBlock).values({ id: crypto.randomUUID(), blockerId: m.id, blockedId: target, createdAt: at }).onConflictDoNothing();
        return endActiveRequests(tx, between(m.id, target), at);
      });
      return { ok: true, status: 200, blocked: true, endedRequests: ended };
    },

    /** lift one of one's own blocks @param {string} userId @param {string} id */
    async unblock(userId, id) {
      const { m, refusal: no } = await anyMember(userId);
      if (no) return no;
      const rows = await db.delete(EntraideBlock).where(and(eq(EntraideBlock.id, String(id)), eq(EntraideBlock.blockerId, m.id))).returning({ id: EntraideBlock.id });
      return rows.length ? { ok: true, status: 200, unblocked: true } : refusal(404, 'NOT_FOUND', 'Blocage introuvable.');
    },
  };
}

/* --------------------------------------------------------------------------------------------------------------------------- moderation */

export const QUEUES = Object.freeze(['reported', 'suspended']);

/** the moderation side (MFA admin, audited) — by PSEUDONYM: never the account, its e-mail, the member id, who reported, request notes or shared e-mails */
export function entraideModeration({ db = defaultDb, now = () => new Date() } = {}) {
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'EntraideMember', entity_id: id, details }).catch(() => {});
  const requireSchema = async () => { if (!(await entraideSchemaAvailable(db))) throw err('ENTRAIDE_NOT_AVAILABLE', 503); };
  const byPseudonym = async (pseudonym) => {
    const p = String(pseudonym ?? '');
    if (!p || p.length > 24) throw err('PSEUDONYM_REQUIRED');
    const [m] = await db.select().from(EntraideMember).where(sql`lower(${EntraideMember.pseudonym}) = lower(${p})`).limit(1);
    if (!m) throw err('NOT_FOUND', 404);
    return m;
  };
  /** close the member's offers and end every active request it is a party to @param {any} tx @param {string} mId @param {Date} at */
  const freeze = async (tx, mId, at) => {
    await tx.update(EntraideOffer).set({ status: 'closed', note: null, closedAt: at, updatedAt: at }).where(and(eq(EntraideOffer.memberId, mId), ne(EntraideOffer.status, 'closed')));
    return endActiveRequests(tx, or(eq(EntraideRequest.requesterId, mId), onOffersOf(mId)), at);
  };
  return {
    /** reported (active members with reports) or suspended members @param {string} actor @param {'reported' | 'suspended'} queue */
    async list(actor, queue = 'reported') {
      await requireSchema();
      const where = queue === 'suspended' ? eq(EntraideMember.status, 'suspended')
        : and(eq(EntraideMember.status, 'active'), sql`EXISTS (SELECT 1 FROM "EntraideReport" r WHERE r."targetId" = ${EntraideMember.id})`);
      const members = await db.select({ id: EntraideMember.id, pseudonym: EntraideMember.pseudonym, status: EntraideMember.status, suspensionReason: EntraideMember.suspensionReason,
        createdAt: EntraideMember.createdAt }).from(EntraideMember).where(where).orderBy(desc(EntraideMember.updatedAt)).limit(200);
      const ids = members.map((x) => x.id);
      const counts = ids.length ? await db.select({ id: EntraideReport.targetId, reason: EntraideReport.reason, n: sql`count(*)::int` }).from(EntraideReport)
        .where(inArray(EntraideReport.targetId, ids)).groupBy(EntraideReport.targetId, EntraideReport.reason) : [];
      const offers = ids.length ? await db.select({ id: EntraideOffer.id, memberId: EntraideOffer.memberId, category: EntraideOffer.category, area: EntraideOffer.area,
        note: EntraideOffer.note, status: EntraideOffer.status }).from(EntraideOffer).where(and(inArray(EntraideOffer.memberId, ids), ne(EntraideOffer.status, 'closed'))) : [];
      await audit('ENTRAIDE_QUEUE_READ', actor, queue, { queue, count: members.length });
      return members.map((x) => {
        const reasons = {}; let total = 0;
        for (const c of counts.filter((y) => y.id === x.id)) { reasons[c.reason] = Number(c.n); total += Number(c.n); }
        return { pseudonym: x.pseudonym, status: x.status, suspensionReason: x.suspensionReason, memberSince: x.createdAt ? new Date(x.createdAt).toISOString().slice(0, 7) : null,
          reports: { total, reasons }, offers: offers.filter((o) => o.memberId === x.id).map((o) => ({ id: o.id, category: o.category, area: o.area, note: o.note, status: o.status })) };
      });
    },
    /** suspend a member (closed reason): offers closed, active requests ended, shared e-mails deleted */
    async suspend(actor, pseudonym, reason) {
      await requireSchema();
      if (!REASONS.includes(reason)) throw err('REASON_REQUIRED');
      const m = await byPseudonym(pseudonym);
      if (m.status !== 'active') throw err('ALREADY_SUSPENDED', 409);
      const at = now();
      const ended = await db.transaction(async (tx) => {
        const rows = await tx.update(EntraideMember).set({ status: 'suspended', suspendedAt: at, suspensionReason: reason, updatedAt: at })
          .where(and(eq(EntraideMember.id, m.id), eq(EntraideMember.status, 'active'))).returning({ id: EntraideMember.id });
        if (!rows.length) return null;
        return freeze(tx, m.id, at);
      });
      if (ended === null) throw err('STATE_CHANGED', 409);
      await audit('ENTRAIDE_SUSPEND', actor, m.id, { reason, endedRequests: ended });
      return { pseudonym: m.pseudonym, status: 'suspended', endedRequests: ended };
    },
    /** lift a suspension (the closed offers stay closed) */
    async reinstate(actor, pseudonym) {
      await requireSchema();
      const m = await byPseudonym(pseudonym);
      if (m.status !== 'suspended') throw err('NOT_SUSPENDED', 409);
      await db.update(EntraideMember).set({ status: 'active', suspendedAt: null, suspensionReason: null, updatedAt: now() }).where(eq(EntraideMember.id, m.id));
      await audit('ENTRAIDE_REINSTATE', actor, m.id);
      return { pseudonym: m.pseudonym, status: 'active' };
    },
    /** the reports about a member are unfounded: deleted */
    async dismissReports(actor, pseudonym) {
      await requireSchema();
      const m = await byPseudonym(pseudonym);
      const gone = await db.delete(EntraideReport).where(eq(EntraideReport.targetId, m.id)).returning({ id: EntraideReport.id });
      await audit('ENTRAIDE_DISMISS_REPORTS', actor, m.id, { count: gone.length });
      return { pseudonym: m.pseudonym, dismissed: gone.length };
    },
    /** close one offer (closed reason): note erased, its active requests ended */
    async closeOffer(actor, offerId, reason) {
      await requireSchema();
      if (!REASONS.includes(reason)) throw err('REASON_REQUIRED');
      const at = now();
      const out = await db.transaction(async (tx) => {
        const rows = await tx.update(EntraideOffer).set({ status: 'closed', note: null, closedAt: at, updatedAt: at })
          .where(and(eq(EntraideOffer.id, String(offerId)), ne(EntraideOffer.status, 'closed'))).returning({ id: EntraideOffer.id, memberId: EntraideOffer.memberId });
        if (!rows.length) return null;
        return { memberId: rows[0].memberId, ended: await endActiveRequests(tx, eq(EntraideRequest.offerId, rows[0].id), at) };
      });
      if (!out) throw err('NOT_FOUND', 404);
      await audit('ENTRAIDE_OFFER_CLOSE', actor, out.memberId, { reason, offerId: String(offerId) });
      return { id: String(offerId), status: 'closed', endedRequests: out.ended };
    },
  };
}

/* ----------------------------------------------------------------------------------------------------------------------------------- DSR */

/**
 * Art. 15 / 20 export sections (export-account-sections.js); the caller asks entraideSchemaAvailable() first. Each query reads the person's rows only
 * (through their EntraideMember row). A counterpart's note, pseudonym or e-mail is NOT included (it is the other person's data).
 * @param {string} userId
 */
export const entraideMemberExportSql = (userId) => sql`SELECT m.pseudonym, m.status, m."suspensionReason", m."charterVersion", m."charterAcceptedAt", m."createdAt"
  FROM "EntraideMember" m WHERE m."citizenUserId" = ${userId}`;
/** @param {string} userId */
export const entraideOffersExportSql = (userId) => sql`SELECT o.id, o.category, o.area, o.note, o.status, o."createdAt", o."closedAt"
  FROM "EntraideOffer" o JOIN "EntraideMember" m ON m.id = o."memberId" WHERE m."citizenUserId" = ${userId} ORDER BY o."createdAt"`;
/** the requests the person SENT (with their own note) @param {string} userId */
export const entraideRequestsExportSql = (userId) => sql`SELECT r.id, o.category, o.area, r.note, r.status, r."createdAt", r."decidedAt", r."closedAt"
  FROM "EntraideRequest" r JOIN "EntraideOffer" o ON o.id = r."offerId" JOIN "EntraideMember" m ON m.id = r."requesterId" WHERE m."citizenUserId" = ${userId} ORDER BY r."createdAt"`;
/** the requests the person RECEIVED on their offers (states and times — the requester's note is the requester's data) @param {string} userId */
export const entraideRequestsReceivedExportSql = (userId) => sql`SELECT r.id, r."offerId", r.status, r."createdAt", r."decidedAt", r."closedAt"
  FROM "EntraideRequest" r JOIN "EntraideOffer" o ON o.id = r."offerId" JOIN "EntraideMember" m ON m.id = o."memberId" WHERE m."citizenUserId" = ${userId} ORDER BY r."createdAt"`;
/** the e-mail addresses the person chose to show @param {string} userId */
export const entraideContactSharesExportSql = (userId) => sql`SELECT s."requestId", s.email, s."createdAt"
  FROM "EntraideContactShare" s JOIN "EntraideMember" m ON m.id = s."memberId" WHERE m."citizenUserId" = ${userId} ORDER BY s."createdAt"`;
/** the reports the person made (reason, time — not whom) @param {string} userId */
export const entraideReportsExportSql = (userId) => sql`SELECT r.reason, r."createdAt"
  FROM "EntraideReport" r JOIN "EntraideMember" m ON m.id = r."reporterId" WHERE m."citizenUserId" = ${userId} ORDER BY r."createdAt"`;
/** the blocks the person set (id, time — not whom) @param {string} userId */
export const entraideBlocksExportSql = (userId) => sql`SELECT b.id, b."createdAt"
  FROM "EntraideBlock" b JOIN "EntraideMember" m ON m.id = b."blockerId" WHERE m."citizenUserId" = ${userId} ORDER BY b."createdAt"`;
