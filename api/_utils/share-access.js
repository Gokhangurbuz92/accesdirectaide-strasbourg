/**
 * RC5 dossier authorization model - product convergence version (docs/release/RC5_PRIVACY_SECURITY_UX_PRODUCT_CONTRACT.md).
 *
 *   OWNER secret   (SharedDiagnostic.rightsSecretHash)  the citizen's management rights: stop sharing, remove one organization, choose purposes, invite an organization,
 *                  open the passport, answer chats, request erasure.  Approved requirement: "Destructive actions require the rightsSecret. Share tokens are strictly
 *                  read/share only." (specs/005-commercial-intelligence-foundation/gate2b/SHARED_DIAGNOSTIC_RIGHTS_RESOLUTION.md)
 *   SHARE token    (SharedDiagnostic.shareTokenHash)    read-only public view of the dossier summary. Never destructive, never authorizes an organization.
 *   INVITE token   (SharedDossierInvite.tokenHash)      issued by the owner for ONE verified organization (immutable Structure.id), single use, short lived, purpose bound.
 *   GRANT          (SharedDossierGrant)                 what an organization may do. Created ONLY by redeeming an invite with a pro session of that organization.
 *   MEMBERSHIP     (ProUser: active, role PRO | STRUCTURE_ADMIN, organization 'actif')  checked on EVERY access, so departure / suspension / role change take effect immediately.
 *
 * LEGACY rows (shareTokenHash IS NULL; created before RC5) carried ONE secret in the link.  A link is never proof of ownership: legacy rows have NO owner
 * (holdsOwnerSecret is false for them) and their link can only be used as a read / transitional-redeem token while ADA_LEGACY_SHARE_READ is not '0'.
 *
 * Secrets travel in a header or JSON body (never in a query string).  Security-critical module: type-checked (no @ts-nocheck).
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { SharedDiagnostic, SharedDossierGrant } from '../../src/db/schema.js';
import { verifyCapability } from './share-capability.js';
import { presentResults } from '../lib/shareResults.js';
import { resolveCitizen } from './citizen-auth.js';
import { isDossierRestricted, restrictedDossierSql } from '../_services/processing-restriction.js';

export const OWNER_HEADER = 'x-share-owner-secret';
export const TOKEN_HEADER = 'x-share-token';
export const INVITE_HEADER = 'x-invite-token';
export const NOT_FOUND_BODY = { error: 'not_found', message: 'Ce dossier est introuvable ou inaccessible.' };
export const PURPOSE_SHARING = 'PURP-06';
export const PURPOSE_AI = 'PURP-05';
// PKG-5 / R22: transmission to the SIAO operator is its own purpose, granted per organization by the person (the transmission itself stays off until the operator agreement)
// (set by its own owner action 'set_siao', never through set_purposes, whose list stays the two RC5 matrix purposes)
export const PURPOSE_SIAO = 'PURP-07';
export const ALL_PURPOSES = [PURPOSE_SHARING, PURPOSE_AI];
export const ALLOWED_PRO_ROLES = ['PRO', 'STRUCTURE_ADMIN'];
export const INVITE_TTL_HOURS = 72;

/** @typedef {{ headers?: Record<string, string | string[] | undefined>, body?: any }} ReqLike */
/** @typedef {{ rightsSecretHash?: string | null, shareTokenHash?: string | null }} SharedLike */
/** @typedef {{ structureId: string, userId: string, role?: string }} ProCtx */

/** Transitional switch for pre-RC5 link-only shares (read + redeem): OFF unless ADA_LEGACY_SHARE_READ=1 (launch-readiness campaign 2026-10-25, item 38) —
 * a fresh installation has none, and a bare link must not open a dossier by default. */
export const legacyShareReadEnabled = () => process.env.ADA_LEGACY_SHARE_READ === '1';
/** @param {SharedLike | null | undefined} shared */
export const isLegacyShare = (shared) => {
  if (!shared) return false;
  // fail LOUD, not silent: a query that forgot to select the column would misclassify every RC5 dossier as legacy (owner locked out, found by run 70172c)
  if (shared.shareTokenHash === undefined) throw new Error('share-access: shareTokenHash must be selected before classifying a dossier');
  return !shared.shareTokenHash;
};

/** @param {ReqLike} req @param {string} name */
const header = (req, name) => {
  const raw = req?.headers?.[name];
  return String(Array.isArray(raw) ? raw[0] : raw || '').trim();
};
/** @param {ReqLike} req @returns {Record<string, any>} */
const body = (req) => (req?.body && typeof req.body === 'object' ? req.body : {});

/** @param {ReqLike} req */
export function readOwnerSecret(req) {
  return header(req, OWNER_HEADER) || String(body(req).rightsSecret || '').trim();
}
/** @param {ReqLike} req */
export function readShareToken(req) {
  return header(req, TOKEN_HEADER) || String(body(req).shareToken || body(req).capability || '').trim();
}
/** @param {ReqLike} req */
export function readInviteToken(req) {
  return header(req, INVITE_HEADER) || String(body(req).inviteToken || '').trim();
}

/** Owner = knows the owner secret of a NON-legacy row. A legacy row has no distinct owner secret, so a link can never prove ownership. @param {SharedLike | null | undefined} shared @param {string} secret */
export function holdsOwnerSecret(shared, secret) {
  return Boolean(shared) && !isLegacyShare(shared) && verifyCapability(secret, shared?.rightsSecretHash);
}

/**
 * PKG-1 / K0: OWNERSHIP = the owner secret OR the verified citizen session of the account the dossier was attached to (ownerCitizenId). The secret path is unchanged and still works for
 * account-free dossiers; the account path never applies to legacy rows and never to a dossier nobody claimed. Callers must select `ownerCitizenId` with the other share columns.
 * @param {(SharedLike & { ownerCitizenId?: string | null }) | null | undefined} shared @param {ReqLike} req
 */
export async function holdsOwnership(shared, req) {
  if (!shared) return false;
  if (holdsOwnerSecret(shared, readOwnerSecret(req))) return true;
  if (!shared.ownerCitizenId || isLegacyShare(shared)) return false;
  const citizen = await resolveCitizen(/** @type {any} */ (req));   // the structural ReqLike is the same object the session reader inspects (headers only)
  return Boolean(citizen && citizen.id === shared.ownerCitizenId);
}

/** Read-only share token.  Legacy rows: the single link secret, only while the transitional flag allows it. @param {SharedLike | null | undefined} shared @param {string} token */
export function holdsShareToken(shared, token) {
  if (!shared) return false;
  if (shared.shareTokenHash) return verifyCapability(token, shared.shareTokenHash);
  return legacyShareReadEnabled() && verifyCapability(token, shared.rightsSecretHash);
}

/** @param {{ expiresAt: Date | string }} shared */
export const isExpired = (shared) => !(new Date(shared.expiresAt).getTime() > Date.now());

/** SQL: the caller is an ACTIVE member (role PRO | STRUCTURE_ADMIN) of an ACTIVE ('actif') organization.  Evaluated inside UPDATE ... WHERE so a departure cannot be raced. @param {ProCtx} ctx */
export function activeMemberSql(ctx) {
  return sql`EXISTS (SELECT 1 FROM "ProUser" u JOIN "Structure" s ON s.id = u."structureId" WHERE u.id = ${ctx.userId} AND u."structureId" = ${ctx.structureId} AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN') AND s.statut = 'actif')`;
}

/**
 * PKG-4: inside the organization, a case that is ASSIGNED is open only to its assignee and to the organization's administrators; an unassigned case is the organization's
 * triage queue (every active member). Membership alone never opens anything without the citizen's grant (see activeGrantExists). @param {string} dossierId @param {ProCtx} ctx
 */
export function caseAccessSql(dossierId, ctx) {
  const admin = ['structure_admin', 'STRUCTURE_ADMIN'].includes(String(ctx.role || ''));
  if (admin) return sql`TRUE`;
  return sql`NOT EXISTS (SELECT 1 FROM "ProCase" c WHERE c."sharedDiagnosticId" = ${dossierId} AND c."structureId" = ${ctx.structureId} AND c."assigneeProUserId" IS NOT NULL AND c."assigneeProUserId" <> ${ctx.userId})`;
}

/** SQL predicate "ctx holds an active grant on dossier Y AND is an active member (AND may open the case)" - usable inside UPDATE ... WHERE (revocation / departure / expiry / reassignment cannot be raced). @param {string} dossierId @param {ProCtx} ctx */
export function activeGrantExists(dossierId, ctx) {
  // PKG-11 / C21: a dossier whose owner restricted processing (RGPD art. 18) is closed to every organization, like a revoked access
  return sql`(EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = ${dossierId} AND g."structureId" = ${ctx.structureId} AND g."revokedAt" IS NULL) AND NOT ${restrictedDossierSql(dossierId)} AND ${activeMemberSql(ctx)} AND ${caseAccessSql(dossierId, ctx)})`;
}

/** @param {ProCtx} ctx */
export async function isActiveMember(ctx) {
  const r = await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`);
  return r.rows.length > 0;
}

/** @param {string} dossierId @param {string} structureId */
export async function findGrant(dossierId, structureId) {
  const [row] = await db.select().from(SharedDossierGrant)
    .where(and(eq(SharedDossierGrant.sharedDiagnosticId, dossierId), eq(SharedDossierGrant.structureId, structureId))).limit(1);
  return row || null;
}

/** Active (not revoked) grant of the caller's organization, only for an active member.  @param {string} dossierId @param {ProCtx} ctx */
export async function findActiveGrant(dossierId, ctx) {
  const grant = await findGrant(dossierId, ctx.structureId);
  if (!grant || grant.revokedAt) return null;
  if (await isDossierRestricted(dossierId)) return null;   // PKG-11 / C21: restriction of processing (art. 18) = no organization access
  if (!(await isActiveMember(ctx))) return null;
  const open = await db.execute(sql`SELECT 1 AS ok WHERE ${caseAccessSql(dossierId, ctx)}`);
  return open.rows.length ? grant : null;   // PKG-4: a case assigned to a colleague is not opened by another member (same answer as no grant)
}

/** @param {{ purposes?: string | null } | null | undefined} grant @param {string} purpose */
export const grantHasPurpose = (grant, purpose) => String(grant?.purposes || '').split(',').map((p) => p.trim()).includes(purpose);

/**
 * Resolve a dossier for a pro of an organization.  Unknown id, no grant, revoked grant and a non-member are indistinguishable ('not_found').
 * @param {string} shareId @param {ProCtx} ctx @param {Record<string, true>} [columns]
 * @returns {Promise<{ status: 'ok'|'not_found'|'expired', shared?: any, grant?: any }>}
 */
export async function resolveDossierForStructure(shareId, ctx, columns) {
  /** @type {any} */
  const shared = await db.query.SharedDiagnostic.findFirst({ where: eq(SharedDiagnostic.id, shareId), ...(columns ? { columns } : {}) });
  if (!shared) return { status: 'not_found' };
  const grant = await findActiveGrant(shareId, ctx);
  if (!grant) return { status: 'not_found' };
  if (shared.expiresAt && isExpired(shared)) return { status: 'expired', shared, grant };
  return { status: 'ok', shared, grant };
}

/**
 * Per-organization view of a dossier's JSON results: other organizations' follow-up notes and files are never returned; internal fields are stripped.
 * @param {any} results @param {string} structureId
 */
export function projectResultsForStructure(results, structureId) {
  /** @type {Record<string, any>} */
  const src = results && typeof results === 'object' ? results : {};
  /** @type {Record<string, any>} */
  const out = presentResults({ ...src });                  // DTA S1 2b-2: legacy eligible flags / amounts / totals never reach a structure
  /** @type {Record<string, any>} */
  const followUps = src._followUps && typeof src._followUps === 'object' ? src._followUps : {};
  delete out._followUps;
  delete out._followUp;                                   // legacy shared (cross-organization) note: never exposed
  if (followUps[structureId]) out._followUp = followUps[structureId];
  if (Array.isArray(src._files)) out._files = src._files.filter((/** @type {any} */ f) => !f?.structureId || f.structureId === structureId);   // legacy entries (no structureId) stay visible to grantees
  return out;
}
