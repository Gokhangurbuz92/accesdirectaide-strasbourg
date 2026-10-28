// @ts-nocheck
/**
 * PKG-11 / C21 — restriction of processing (RGPD art. 18). Before: the person could export or erase, object to audience measurement, but had no way to restrict
 * processing (e.g. while the accuracy of their data is contested); nothing created or honoured a restriction.
 *
 * The person asks with one of the four grounds of art. 18(1) (a code, never free text). The restriction applies AT ONCE (precautionary, fail-closed) and holds
 * until the person lifts it, or until ADA lifts it after informing the person first (art. 18(3); a named MFA administrator, a written reason, audited).
 * While a restriction is active (a DSRRequest of type RESTRICT, status ACTIVE — no schema change):
 *   - no organization can open the person's dossiers: the central access predicate (api/_utils/share-access.js) treats them like a revoked access; organizations
 *     holding an access are told that it is suspended (in-app, no name);
 *   - the person cannot share anew or widen a purpose (it would contradict the restriction); revoking stays possible; an organization cannot redeem an invitation;
 *   - no notification is sent to the person (except the notices of this restriction itself);
 *   - the retention purge skips the person's dossiers (storage only, nothing is deleted automatically);
 *   - (audit pass 2) the person's read-only SHARE LINKS are sealed: share/get.js is byte-pinned, so the stored share-token hash is prefixed with SHARE_SEAL — no link
 *     matches it any more — and the prefix comes off when the last restriction is lifted (a link stopped meanwhile stays stopped). Only rows with their own share
 *     token: a legacy row's single secret must never become an owner secret;
 *   - the person keeps every right: reading (Mon Espace, the owner secret), export, erasure request.
 * A request is serialised per person (advisory lock): two concurrent requests used to create two ACTIVE rows, and lifting one left the other in force.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, CitizenUser } from '../../src/db/schema.js';
import { sendMail as defaultSendMail, mailLedgerStatus } from '../_utils/mailer.js';
import logger from '../_utils/logger.js';

export const REQUEST_TYPE = 'RESTRICT';
/** art. 18(1) a-d */
export const GROUNDS = { ACCURACY_CONTESTED: 'a', UNLAWFUL_PROCESSING: 'b', LEGAL_CLAIMS: 'c', OBJECTION_PENDING: 'd' };
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });

/** SQL: the citizen (id expression) has an ACTIVE restriction. */
export const restrictedSubjectSql = (subjectExpr) => sql`EXISTS (SELECT 1 FROM "DSRRequest" r WHERE r."requestType" = ${REQUEST_TYPE} AND r.status = 'ACTIVE' AND r."subjectId" = ${subjectExpr})`;
/** SQL: the dossier (id expression) belongs to a person whose processing is restricted. */
export const restrictedDossierSql = (dossierExpr) => sql`EXISTS (SELECT 1 FROM "SharedDiagnostic" d JOIN "DSRRequest" r ON r."subjectId" = d."ownerCitizenId"
  WHERE d.id = ${dossierExpr} AND r."requestType" = ${REQUEST_TYPE} AND r.status = 'ACTIVE')`;

export const SHARE_SEAL = 'restricted:';
const sealShares = (tx, citizenId) => tx.execute(sql`UPDATE "SharedDiagnostic" SET "shareTokenHash" = ${SHARE_SEAL} || "shareTokenHash"
  WHERE "ownerCitizenId" = ${citizenId} AND "shareTokenHash" IS NOT NULL AND "shareTokenHash" NOT LIKE ${SHARE_SEAL + '%'}`);
const unsealShares = (tx, citizenId) => tx.execute(sql`UPDATE "SharedDiagnostic" SET "shareTokenHash" = substr("shareTokenHash", ${SHARE_SEAL.length + 1})
  WHERE "ownerCitizenId" = ${citizenId} AND "shareTokenHash" LIKE ${SHARE_SEAL + '%'}
    AND NOT EXISTS (SELECT 1 FROM "DSRRequest" r WHERE r."requestType" = ${REQUEST_TYPE} AND r.status = 'ACTIVE' AND r."subjectId" = ${citizenId})`);
const lockSubject = (tx, citizenId) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'dsr-restrict:' + citizenId}))`);
const count = (r) => Number(r?.rowCount ?? 0);

export async function isRestricted(citizenId, db = defaultDb) {
  if (!citizenId) return false;
  return (await db.execute(sql`SELECT 1 AS x WHERE ${restrictedSubjectSql(String(citizenId))}`)).rows.length > 0;
}
export async function isDossierRestricted(dossierId, db = defaultDb) {
  if (!dossierId) return false;
  return (await db.execute(sql`SELECT 1 AS x WHERE ${restrictedDossierSql(String(dossierId))}`)).rows.length > 0;
}

async function active(db, citizenId) {
  return (await db.execute(sql`SELECT id, "reasonCode" AS ground, "createdAt" FROM "DSRRequest" WHERE "requestType" = ${REQUEST_TYPE} AND status = 'ACTIVE' AND "subjectId" = ${citizenId}
    ORDER BY "createdAt" DESC LIMIT 1`)).rows[0] || null;
}

/** The organizations that hold an access to one of the person's dossiers are told (in-app; no name, no dossier content). */
async function tellOrganizations(db, citizenId, type, deps) {
  try {
    const orgs = (await db.execute(sql`SELECT DISTINCT g."structureId" AS s FROM "SharedDossierGrant" g JOIN "SharedDiagnostic" d ON d.id = g."sharedDiagnosticId"
      WHERE d."ownerCitizenId" = ${citizenId} AND g."revokedAt" IS NULL`)).rows.map((r) => r.s);
    const notify = deps.notify || (await import('./pro-notifications.js')).notify;
    const text = type === 'dossier_restricted'
      ? 'Une personne a demandé la limitation du traitement de ses données (RGPD art. 18) : l’accès à son dossier est suspendu tant que la limitation dure.'
      : 'La limitation du traitement demandée par une personne est levée : l’accès à son dossier est rétabli.';
    for (const structureId of orgs) await notify({ structureId, to: 'members', type, title: type === 'dossier_restricted' ? 'Accès à un dossier suspendu' : 'Accès à un dossier rétabli', message: text }).catch(() => {});
    return orgs.length;
  } catch (error) { logger.warn({ err: { name: error?.name } }, '[restriction] organization notice failed'); return 0; }
}

export async function requestRestriction(citizenId, input, db = defaultDb, deps = {}) {
  const ground = String(input?.ground || '');
  if (!GROUNDS[ground]) return bad('ground_required', 'Choisissez la raison de votre demande (une des quatre raisons prévues par l’article 18 du RGPD).');
  const out = await db.transaction(async (tx) => {
    await lockSubject(tx, String(citizenId));
    const cur = await active(tx, String(citizenId));
    if (cur) return { cur };
    const id = crypto.randomUUID();
    await tx.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "reasonCode", "createdAt", "reviewOutcome")
      VALUES (${id}, 'CITIZEN_USER', ${String(citizenId)}, ${REQUEST_TYPE}, 'ACTIVE', 'IMMEDIATE', ${JSON.stringify(['dossier_access', 'sharing', 'share_links', 'notifications', 'retention_purge'])}::jsonb,
        ${ground}, NOW(), ${JSON.stringify({ requestedAt: new Date().toISOString(), article: `18(1)(${GROUNDS[ground]})` })}::jsonb)`);
    const sealed = count(await sealShares(tx, String(citizenId)));
    await tx.insert(AuditLog).values({ action: 'PROCESSING_RESTRICTED', entity: 'DSR_REQUEST', entity_id: id, actor_id: 'subject', details: { requestId: id, ground, shareLinksSuspended: sealed }, ip_hash: 'CITIZEN' });
    return { id, sealed };
  });
  if (out.cur) return { ok: true, status: 200, restriction: { id: out.cur.id, ground: out.cur.ground, since: out.cur.createdAt, status: 'ACTIVE' } };
  const organizations = await tellOrganizations(db, String(citizenId), 'dossier_restricted', deps);
  return { ok: true, status: 201, restriction: { id: out.id, ground, status: 'ACTIVE' }, organizationsTold: organizations, shareLinksSuspended: out.sealed };
}

export async function restrictionState(citizenId, db = defaultDb) {
  const cur = await active(db, String(citizenId));
  const last = cur ? null : (await db.execute(sql`SELECT id, status, "completedAt", "reviewOutcome" AS o FROM "DSRRequest" WHERE "requestType" = ${REQUEST_TYPE} AND "subjectId" = ${String(citizenId)}
    ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
  return { ok: true, restriction: cur ? { id: cur.id, ground: cur.ground, since: cur.createdAt, status: 'ACTIVE' } : null,
    lastLifted: last && last.status === 'LIFTED' ? { at: last.completedAt, by: last.o?.lift?.by === 'subject' ? 'vous' : 'ADA', reason: last.o?.lift?.by === 'subject' ? null : last.o?.lift?.reason || null } : null,
    grounds: Object.keys(GROUNDS) };
}

/** The person lifts their own restriction (at any time). */
export async function liftBySubject(citizenId, db = defaultDb, deps = {}) {
  const rows = await db.transaction(async (tx) => {
    await lockSubject(tx, String(citizenId));
    const r = (await tx.execute(sql`UPDATE "DSRRequest" SET status = 'LIFTED', "completedAt" = NOW(),
        "reviewOutcome" = COALESCE("reviewOutcome", '{}'::jsonb) || ${JSON.stringify({ lift: { by: 'subject', at: new Date().toISOString() } })}::jsonb
      WHERE "requestType" = ${REQUEST_TYPE} AND status = 'ACTIVE' AND "subjectId" = ${String(citizenId)} RETURNING id`)).rows;
    if (r.length) await unsealShares(tx, String(citizenId));
    return r;
  });
  if (!rows.length) return bad('not_found', 'Aucune limitation en cours.', 404);
  await db.insert(AuditLog).values({ action: 'PROCESSING_RESTRICTION_LIFTED', entity: 'DSR_REQUEST', entity_id: rows[0].id, actor_id: 'subject', details: { requestId: rows[0].id, by: 'subject' }, ip_hash: 'CITIZEN' });
  await tellOrganizations(db, String(citizenId), 'dossier_restriction_lifted', deps);
  return { ok: true, status: 200, restriction: { id: rows[0].id, status: 'LIFTED' } };
}

/** ADA administrators: the active restrictions (ground, since — never dossier content). */
export async function listRestrictions(db = defaultDb) {
  const rows = (await db.execute(sql`SELECT r.id, r."reasonCode" AS ground, r."createdAt", u.email FROM "DSRRequest" r LEFT JOIN "CitizenUser" u ON u.id = r."subjectId"
    WHERE r."requestType" = ${REQUEST_TYPE} AND r.status = 'ACTIVE' ORDER BY r."createdAt" LIMIT 200`)).rows;
  return { ok: true, restrictions: rows.map((r) => ({ id: r.id, ground: r.ground, since: r.createdAt, account: r.email ? r.email.replace(/^(.).*(@.*)$/, '$1…$2') : null })) };
}

/**
 * ADA lifts a restriction (e.g. the accuracy has been checked): a named MFA administrator, a written reason; the person is informed FIRST (art. 18(3)) — the notice
 * outcome is recorded (a verified account e-mail; otherwise NO_RECIPIENT, and the person sees it in their space) — then the restriction ends.
 */
export async function liftByController(id, input, reviewer, db = defaultDb, deps = {}) {
  const reason = String(input?.reason || '').trim().slice(0, 1000);
  if (reason.length < 10) return bad('reason_required', 'Indiquez la raison de la levée (elle est communiquée à la personne).');
  const [r] = (await db.execute(sql`SELECT id, "subjectId" AS s FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = ${REQUEST_TYPE} AND status = 'ACTIVE'`)).rows;
  if (!r) return bad('not_found', 'Aucune limitation en cours avec cet identifiant.', 404);
  const sendMail = deps.sendMail || defaultSendMail;
  let notice = 'NO_RECIPIENT';
  try {
    const [u] = await db.select({ email: CitizenUser.email, verified: CitizenUser.emailVerifiedAt }).from(CitizenUser).where(sql`${CitizenUser.id} = ${r.s}`).limit(1);
    if (u?.email && u.verified) {
      const out = await sendMail({ to: u.email, subject: 'Fin de la limitation du traitement de vos données', category: 'rights-restriction',
        text: `L’équipe AccèsDirectAide va lever la limitation du traitement de vos données que vous aviez demandée (RGPD art. 18).\n\nRaison : ${reason}\n\nVous pouvez en demander une nouvelle à tout moment depuis « Mon compte ».` });
      notice = mailLedgerStatus(out);
    }
  } catch (error) { notice = 'FAILED'; logger.warn({ err: { name: error?.name } }, '[restriction] lift notice failed'); }
  // owner LAB audit: art. 18(3) — the person is informed BEFORE the restriction is lifted. An e-mail that could not be handed to a provider (NOT_DELIVERED, FAILED)
  // informed nobody: the restriction stays (it used to be lifted anyway). Without a verified address (NO_RECIPIENT) the person is informed in their space.
  if (notice === 'NOT_DELIVERED' || notice === 'FAILED') {
    await db.insert(AuditLog).values({ action: 'PROCESSING_RESTRICTION_LIFT_REFUSED', entity: 'DSR_REQUEST', entity_id: r.id, actor_id: reviewer, details: { requestId: r.id, notice }, ip_hash: 'ADMIN_MFA' });
    return bad('notice_not_delivered', 'La personne n’a pas pu être informée avant la levée (e-mail non remis) : la limitation reste en place. Réessayez quand l’envoi d’e-mails fonctionne.', 503);
  }
  const rows = await db.transaction(async (tx) => {
    await lockSubject(tx, String(r.s));
    const u = (await tx.execute(sql`UPDATE "DSRRequest" SET status = 'LIFTED', "completedAt" = NOW(),
        "reviewOutcome" = COALESCE("reviewOutcome", '{}'::jsonb) || ${JSON.stringify({ lift: { by: reviewer, at: new Date().toISOString(), reason, notice } })}::jsonb
      WHERE id = ${r.id} AND status = 'ACTIVE' RETURNING id`)).rows;
    if (u.length) await unsealShares(tx, String(r.s));
    return u;
  });
  if (!rows.length) return bad('conflict', 'La limitation a changé entre-temps.', 409);
  await db.insert(AuditLog).values({ action: 'PROCESSING_RESTRICTION_LIFTED', entity: 'DSR_REQUEST', entity_id: r.id, actor_id: reviewer, details: { requestId: r.id, by: 'ADA', notice }, ip_hash: 'ADMIN_MFA' });
  await tellOrganizations(db, String(r.s), 'dossier_restriction_lifted', deps);
  return { ok: true, status: 200, restriction: { id: r.id, status: 'LIFTED' }, notice };
}
