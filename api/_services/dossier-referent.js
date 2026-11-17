// @ts-nocheck
/**
 * M2 / G5 (R07 R11) — « référent de parcours »: a NAMED CONTACT PERSON for the person's path (migration 0047, tables DossierReferent / DossierReferentEvent).
 *
 *   professional volunteers ──▶ PROPOSED ──the person agrees──▶ ACCEPTED_BY_CITIZEN ──▶ ENDED (the person, the professional, a departure, a lost access,
 *                                   └──────the person refuses──────────────────────────▶ ENDED  the organization's closure)
 *
 * What the record is NOT — enforced here and proven by the tests:
 *   - it grants NO access: nothing in api/_utils/share-access.js reads these tables; a référent whose organization holds no active grant is answered exactly
 *     like anyone else (404). Only a professional who may ALREADY open the case can volunteer;
 *   - it carries NO legal responsibility and no authority over other organizations: it is declarative (a name the person can call), it replaces no legal or
 *     contractual designation (référent CASF, mesure de protection, mandat…). The interface says « personne de contact », never « responsable »;
 *   - it never exists without the person: effective only once THEY agree (citizenDecisionAt, also a database CHECK), ended by them at any time.
 * It is shown to the person and to the organizations that hold an active grant on the dossier — and only while the référent's own organization holds one
 * and the professional is an active member (a row a revocation path did not end is simply not shown, and is ended on the next write).
 * Every change is one conditional UPDATE plus an append-only DossierReferentEvent and an AuditLog line (identifiers and codes only).
 * On a database without migration 0047 every function answers « not available » / « none » and writes nothing (api/_utils/schema-features.js).
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { activeGrantExists, activeMemberSql, referralGrantLapsedSql } from '../_utils/share-access.js';
import { referralChainSchema } from '../_utils/schema-features.js';
import { mailLedgerStatus, sendMail as defaultSendMail } from '../_utils/mailer.js';
import { canNotify } from './citizen-account.js';
import { buildAppUrl } from '../_utils/user-auth.js';

export const REFERENT_STATUSES = Object.freeze(['PROPOSED', 'ACCEPTED_BY_CITIZEN', 'ENDED']);
export const REFERENT_ENDED_BY = Object.freeze(['CITIZEN', 'PROFESSIONAL', 'DEPARTURE', 'ACCESS_REVOKED', 'ORGANIZATION_CLOSED']);
const CURRENT = sql`('PROPOSED', 'ACCEPTED_BY_CITIZEN')`;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
/** C7 — a display name carries no other identifier: no « @ », no link, at most 5 digits in all (« Camille, CESF 2 » passes; a telephone number does not) */
export const isMinimalDisplayName = (/** @type {string} */ name) => !/@|https?:|www\.|:\/\//i.test(name) && (name.match(/\d/g) || []).length <= 5;
const notFound = () => bad('not_found', 'Dossier introuvable.', 404);
const unavailable = () => bad('REFERENT_UNAVAILABLE', 'La personne de contact du parcours n’est pas encore disponible sur ce service.', 409);
const ready = async (db) => (await referralChainSchema(db)).referent;
const isAdmin = (ctx) => ['structure_admin', 'STRUCTURE_ADMIN'].includes(String(ctx.role || ''));

/** SQL (built per call: the lapse limit follows the clock): the référent aliased f is still backed by reality — its organization holds an active grant on the dossier and the professional is an active member */
const backed = () => sql`(EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = f."sharedDiagnosticId" AND g."structureId" = f."structureId" AND g."revokedAt" IS NULL AND NOT ${referralGrantLapsedSql('g')})
  AND EXISTS (SELECT 1 FROM "ProUser" u JOIN "Structure" s ON s.id = u."structureId" WHERE u.id = f."proUserId" AND u."structureId" = f."structureId" AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN') AND s.statut = 'actif'))`;

async function event(db, referentId, actorType, actorId, fromStatus, toStatus, reason = null) {
  await db.execute(sql`INSERT INTO "DossierReferentEvent" (id, "referentId", "actorType", "actorId", "fromStatus", "toStatus", reason) VALUES (${crypto.randomUUID()}, ${referentId}, ${actorType}, ${actorId || null}, ${fromStatus}, ${toStatus}, ${reason})`);
}
async function audit(db, action, referentId, actor, actorId, details) {
  await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES (${crypto.randomUUID()}, ${action}, ${actor}, ${actorId || null}, 'DossierReferent', ${referentId}, ${JSON.stringify(details || {})}::jsonb)`).catch(() => {});
}
/** One conditional end; the rows that were really ended (raced or replayed = none). `where` is evaluated on alias f. */
async function end(db, where, endedBy, actorType, actorId) {
  const rows = (await db.execute(sql`WITH cur AS (SELECT f.id, f.status FROM "DossierReferent" f WHERE f.status IN ${CURRENT} AND ${where} FOR UPDATE)
    UPDATE "DossierReferent" r SET status = 'ENDED', "endedAt" = NOW(), "endedBy" = ${endedBy}, "updatedAt" = NOW()${endedBy === 'CITIZEN' ? sql`, "citizenDecisionAt" = COALESCE(r."citizenDecisionAt", NOW())` : sql``}
    FROM cur WHERE r.id = cur.id RETURNING r.id, cur.status AS "fromStatus", r."sharedDiagnosticId", r."structureId", r."proUserId"`)).rows;
  for (const r of rows) {
    await event(db, r.id, actorType, actorId, r.fromStatus, 'ENDED', endedBy);
    await audit(db, 'DOSSIER_REFERENT_ENDED', r.id, actorType.toLowerCase(), actorId, { endedBy, from: r.fromStatus, structureId: r.structureId });
  }
  return rows;
}
/** in-app notice to the professional concerned (catalogue event, in-app only; no name of the person, no dossier content) */
async function tellProfessional(r, title, message) {
  if (!r?.proUserId) return;
  try { const { notify } = await import('./pro-notifications.js'); await notify({ structureId: r.structureId, to: [r.proUserId], type: 'referent_update', title, message, metadata: { kind: 'referent' } }); } catch { /* best effort */ }
}
/** the person's e-mail (best effort; the decision is in Mon Espace anyway): never a professional's name — the outcome is recorded like every notice to them */
async function tellPerson(db, dossierId, referentId, sendMail, subject, text, kind) {
  let outcome = 'FAILED';
  try {
    const [o] = (await db.execute(sql`SELECT u.id, u.email FROM "SharedDiagnostic" d JOIN "CitizenUser" u ON u.id = d."ownerCitizenId" WHERE d.id = ${dossierId} AND u."emailVerifiedAt" IS NOT NULL`)).rows;
    if (!o) outcome = 'NO_RECIPIENT';
    else if (!(await canNotify(o.id, 'email', 'service', db).catch(() => false))) outcome = 'NO_CONSENT';
    else outcome = mailLedgerStatus(await sendMail({ to: o.email, subject, text, category: 'referral' }));
  } catch { outcome = 'FAILED'; }
  await audit(db, 'DOSSIER_REFERENT_CITIZEN_NOTICE', referentId, 'system', null, { kind, outcome });
  return outcome;
}

/**
 * Professional: volunteer as the contact person of a case the caller may open (grant + active member + assignment rule — the same check as every case
 * action; anything else is « not found »). Requires the professional's explicit agreement to show the given name to the person and to the organizations
 * holding a grant. Nothing is effective before the person agrees.
 */
export async function volunteer(ctx, caseId, input = {}, deps = {}) {
  const db = deps.db || defaultDb;
  const [c] = (await db.execute(sql`SELECT c.id, c."sharedDiagnosticId" AS d, c.status FROM "ProCase" c WHERE c.id = ${String(caseId || '')} AND c."structureId" = ${ctx.structureId}`)).rows;
  if (!c || !(await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(c.d, ctx)}`)).rows.length) return notFound();
  if (!(await ready(db))) return unavailable();
  if (c.status === 'CLOSED') return bad('CASE_CLOSED', 'Ce dossier est clôturé.', 409);
  if (input.displayNameConsent !== true) return bad('NAME_CONSENT_REQUIRED', 'Confirmez que vous acceptez que ce nom soit montré à la personne et aux structures qui ont accès à son dossier.', 400);
  // eslint-disable-next-line no-control-regex -- control characters are removed from a name that will be displayed
  const displayName = String(input.displayName || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (displayName.length < 2 || displayName.length > 80) return bad('INVALID_NAME', 'Indiquez le nom à afficher (2 à 80 caractères).', 400);
  // C7 (data minimisation, owner Paket 4): the field is a NAME to show, nothing else — no e-mail address, link or number (telephone, file or social-security
  // number…) that would identify or reach someone beyond the name the professional chose
  if (!isMinimalDisplayName(displayName)) return bad('NAME_NOT_MINIMAL', 'Indiquez seulement un nom (par exemple votre prénom et votre fonction), sans adresse e-mail, lien ni numéro.', 400);
  // only the dossier's owner can agree, from a verified account (as for a referral proposal)
  if (!(await db.execute(sql`SELECT 1 AS ok FROM "SharedDiagnostic" d JOIN "CitizenUser" u ON u.id = d."ownerCitizenId" WHERE d.id = ${c.d} AND u."emailVerifiedAt" IS NOT NULL`)).rows.length) {
    return bad('NO_CITIZEN_ACCOUNT', 'Ce dossier n’est rattaché à aucun compte vérifié : personne ne pourrait donner son accord.', 409);
  }
  await endStale(db, c.d);
  const id = crypto.randomUUID();
  const rows = (await db.execute(sql`INSERT INTO "DossierReferent" (id, "sharedDiagnosticId", "structureId", "proUserId", "displayName", status, "displayNameConsentAt", "updatedAt")
    VALUES (${id}, ${c.d}, ${ctx.structureId}, ${ctx.userId}, ${displayName}, 'PROPOSED', NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`)).rows;
  if (!rows.length) return bad('REFERENT_EXISTS', 'Une personne de contact est déjà proposée ou désignée pour ce parcours.', 409);
  await event(db, id, 'PROFESSIONAL', ctx.userId, null, 'PROPOSED');
  await audit(db, 'DOSSIER_REFERENT_PROPOSED', id, 'pro', ctx.userId, { structureId: ctx.structureId });
  await tellPerson(db, c.d, id, deps.sendMail || defaultSendMail, 'Une personne de contact est proposée pour votre parcours',
    `Une structure qui vous accompagne propose qu’une personne de son équipe soit votre personne de contact pour votre parcours. Rien ne change sans votre accord, et cela ne donne aucun accès supplémentaire à votre dossier.\nDécidez depuis Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'PROPOSED');
  return { ok: true, status: 201, referent: { status: 'PROPOSED', displayName } };
}

/** Professional: step down (the professional concerned, or an administrator of the same organization). Possible even after the access was lost. */
export async function stepDown(ctx, caseId, deps = {}) {
  const db = deps.db || defaultDb;
  const [c] = (await db.execute(sql`SELECT c."sharedDiagnosticId" AS d FROM "ProCase" c WHERE c.id = ${String(caseId || '')} AND c."structureId" = ${ctx.structureId} AND ${activeMemberSql(ctx)}`)).rows;
  if (!c) return notFound();
  if (!(await ready(db))) return unavailable();
  const rows = await end(db, sql`f."sharedDiagnosticId" = ${c.d} AND f."structureId" = ${ctx.structureId} ${isAdmin(ctx) ? sql`` : sql`AND f."proUserId" = ${ctx.userId}`}`, 'PROFESSIONAL', 'PROFESSIONAL', ctx.userId);
  if (!rows.length) return notFound();
  await tellPerson(db, c.d, rows[0].id, deps.sendMail || defaultSendMail, 'Votre personne de contact a changé',
    `La personne de contact de votre parcours n’assure plus ce rôle. Les accès à votre dossier ne changent pas. Détails dans Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'ENDED_BY_PROFESSIONAL');
  return { ok: true, status: 200, referent: null };
}

/** the dossier, only for its owner (anything else is « not found ») */
async function ownedDossier(db, userId, dossierId) {
  const [d] = (await db.execute(sql`SELECT d.id FROM "SharedDiagnostic" d WHERE d.id = ${String(dossierId || '')} AND d."ownerCitizenId" = ${userId}`)).rows;
  return d || null;
}
const shape = (r) => (r ? { displayName: r.displayName, organization: r.organization, since: r.status === 'ACCEPTED_BY_CITIZEN' ? r.citizenDecisionAt : r.proposedAt } : null);

/** Citizen: the contact person of a dossier they own — `referent` (the one they agreed to) or `proposal` (waiting for their answer); only while it is backed by an access. */
export async function citizenView(userId, dossierId, db = defaultDb) {
  if (!(await ownedDossier(db, userId, dossierId))) return notFound();
  if (!(await ready(db))) return { ok: true, status: 200, available: false, referent: null, proposal: null };
  const [r] = (await db.execute(sql`SELECT f.status, f."displayName", f."proposedAt", f."citizenDecisionAt", s.nom AS organization FROM "DossierReferent" f JOIN "Structure" s ON s.id = f."structureId"
    WHERE f."sharedDiagnosticId" = ${String(dossierId)} AND f.status IN ${CURRENT} AND ${backed()}`)).rows;
  return { ok: true, status: 200, available: true, referent: r?.status === 'ACCEPTED_BY_CITIZEN' ? shape(r) : null, proposal: r?.status === 'PROPOSED' ? shape(r) : null };
}

/** Citizen: agree to (or refuse) the proposed contact person. Only the dossier's owner; only from PROPOSED; exactly once. */
export async function citizenDecide(userId, dossierId, accept, db = defaultDb) {
  if (!(await ownedDossier(db, userId, dossierId))) return notFound();
  if (!(await ready(db))) return unavailable();
  if (!accept) {
    const rows = await end(db, sql`f."sharedDiagnosticId" = ${String(dossierId)} AND f.status = 'PROPOSED'`, 'CITIZEN', 'CITIZEN', userId);
    if (!rows.length) return bad('ALREADY_DECIDED', 'Aucune proposition n’attend votre réponse.', 409);
    await tellProfessional(rows[0], 'Personne de contact : proposition refusée', 'La personne n’a pas souhaité vous désigner comme personne de contact de son parcours.');
    return { ok: true, status: 200, referent: null };
  }
  // the proposal must still be backed by an access: otherwise it ends (nothing is « accepted » for an organization that can no longer open the dossier)
  const stale = await endStale(db, String(dossierId));
  if (stale.some((x) => x.fromStatus === 'PROPOSED')) return bad('REFERENT_NO_LONGER_AVAILABLE', 'Cette proposition n’est plus valable : la structure n’a plus accès à votre dossier ou la personne n’y travaille plus.', 409);
  const rows = (await db.execute(sql`UPDATE "DossierReferent" f SET status = 'ACCEPTED_BY_CITIZEN', "citizenDecisionAt" = NOW(), "updatedAt" = NOW()
    WHERE f."sharedDiagnosticId" = ${String(dossierId)} AND f.status = 'PROPOSED' AND ${backed()} RETURNING f.id, f."structureId", f."proUserId", f."displayName"`)).rows;
  if (!rows.length) return bad('ALREADY_DECIDED', 'Aucune proposition n’attend votre réponse.', 409);
  await event(db, rows[0].id, 'CITIZEN', userId, 'PROPOSED', 'ACCEPTED_BY_CITIZEN');
  await audit(db, 'DOSSIER_REFERENT_ACCEPTED', rows[0].id, 'citizen', userId, { structureId: rows[0].structureId });
  await tellProfessional(rows[0], 'Personne de contact : accord de la personne', 'La personne a accepté que vous soyez sa personne de contact pour son parcours. Ce rôle ne vous donne aucun accès supplémentaire.');
  return { ok: true, status: 200, referent: { status: 'ACCEPTED_BY_CITIZEN', displayName: rows[0].displayName } };
}

/** Citizen: end the contact person (accepted or proposed) at any time. */
export async function citizenEnd(userId, dossierId, db = defaultDb) {
  if (!(await ownedDossier(db, userId, dossierId))) return notFound();
  if (!(await ready(db))) return unavailable();
  const rows = await end(db, sql`f."sharedDiagnosticId" = ${String(dossierId)}`, 'CITIZEN', 'CITIZEN', userId);
  if (!rows.length) return notFound();
  await tellProfessional(rows[0], 'Personne de contact : rôle terminé par la personne', 'La personne a mis fin à votre rôle de personne de contact pour son parcours. Vos accès au dossier ne changent pas.');
  return { ok: true, status: 200, referent: null };
}

/**
 * Organization view, for a caller who ALREADY passed the case access check (pro-cases.getCase): the accepted contact person — a name and an organization,
 * no account identifier — or, for the proposing organization only, its own pending proposal. null when there is none or the database has no 0047.
 */
export async function referentForCase(dossierId, ctx, db = defaultDb) {
  if (!(await ready(db))) return null;
  const [r] = (await db.execute(sql`SELECT f.status, f."displayName", f."proposedAt", f."citizenDecisionAt", f."structureId", f."proUserId", s.nom AS organization FROM "DossierReferent" f JOIN "Structure" s ON s.id = f."structureId"
    WHERE f."sharedDiagnosticId" = ${dossierId} AND f.status IN ${CURRENT} AND ${backed()}`)).rows;
  if (!r) return null;
  const own = r.structureId === ctx.structureId;
  if (r.status === 'PROPOSED' && !own) return null;   // a proposal the person has not answered is nobody else's to know
  return { status: r.status, ...shape(r), ownOrganization: own, mine: own && r.proUserId === ctx.userId };
}

/** rows that are no longer backed by an access / an active member are ended (ACCESS_REVOKED or DEPARTURE) — called before a write that needs the slot */
async function endStale(db, dossierId) {
  const gone = await end(db, sql`f."sharedDiagnosticId" = ${dossierId} AND NOT EXISTS (SELECT 1 FROM "ProUser" u WHERE u.id = f."proUserId" AND u."structureId" = f."structureId" AND u.status = 'active')`, 'DEPARTURE', 'SYSTEM', null);
  const lost = await end(db, sql`f."sharedDiagnosticId" = ${dossierId} AND NOT ${backed()}`, 'ACCESS_REVOKED', 'SYSTEM', null);
  return [...gone, ...lost];
}

/**
 * The access of `structureId` (null = every organization) to the dossier ended — the person revoked it, stopped sharing, or a referral grant was closed:
 * its référent ends in the SAME transaction. `actor` CITIZEN when the person withdrew the access. No-op without migration 0047.
 * @param {any} tx @param {string} dossierId @param {string | null} structureId @param {'ACCESS_REVOKED' | 'ORGANIZATION_CLOSED'} [endedBy] @param {{ type?: string, id?: string | null }} [actor]
 */
export async function endReferentsForLostAccess(tx, dossierId, structureId = null, endedBy = 'ACCESS_REVOKED', actor = {}) {
  if (!(await ready(tx))) return [];
  return end(tx, sql`f."sharedDiagnosticId" = ${dossierId} ${structureId ? sql`AND f."structureId" = ${structureId}` : sql``}`, endedBy, actor.type || 'SYSTEM', actor.id || null);
}
/** A member leaves: every contact-person role they hold ends (DEPARTURE). The successor does NOT inherit it — they may volunteer, the person decides again. */
export async function endReferentsForDeparture(tx, proUserId, structureId) {
  if (!(await ready(tx))) return [];
  return end(tx, sql`f."proUserId" = ${proUserId} AND f."structureId" = ${structureId}`, 'DEPARTURE', 'SYSTEM', null);
}
/** An organization closes: every contact-person role of its members ends (ORGANIZATION_CLOSED). */
export async function endReferentsForClosedOrganization(tx, structureId) {
  if (!(await ready(tx))) return [];
  return end(tx, sql`f."structureId" = ${structureId}`, 'ORGANIZATION_CLOSED', 'SYSTEM', null);
}
/** after COMMIT, best effort: the person is told that their contact person ended with an access / a departure (no name) */
export async function tellPersonReferentEnded(rows, db = defaultDb, sendMail = defaultSendMail) {
  for (const r of rows || []) {
    if (r.fromStatus !== 'ACCEPTED_BY_CITIZEN') continue;
    await tellPerson(db, r.sharedDiagnosticId, r.id, sendMail, 'Votre personne de contact a changé',
      `La personne de contact de votre parcours n’assure plus ce rôle. Vous pouvez en accepter une autre si une structure qui vous accompagne vous le propose. Détails dans Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'ENDED');
  }
}
