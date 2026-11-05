// @ts-nocheck
/**
 * R46 / N08 (C26) — the link between an ADA citizen account and a FranceConnect identity (issuer + pseudonymous `sub`).
 *
 * Storage without a new migration (Production DB at 0042): one AuthToken row per link, type FRANCECONNECT_LINK, tokenHash = « fclink: » + sha256(issuer \n sub)
 * — never the sub itself, never a usable token (reset / verification handlers check their own type, and the « fclink: » prefix cannot be the sha-256 hex of any
 * raw token). expiresAt = 3 years after the last FranceConnect sign-in (renewed at each one); the retention purge removes an unused link like any expired
 * credential; account deletion cascades (AuthToken_user_fkey); the art. 15 export lists the row without its hash. A dedicated table
 * (CitizenExternalIdentity: userId, issuer, subHash, linkedAt, lastUsedAt) is the clean schema when a migration is allowed (lead decision).
 *
 * Rules: a FranceConnect identity signs in ONLY to the account it was linked to; linking needs an existing signed-in account (no account is created from
 * FranceConnect, no automatic link by e-mail address: an e-mail match is not a proof that the two identities are the same person); one identity ↔ one account.
 */
import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, AuthToken, CitizenUser } from '../../src/db/schema.js';

export const LINK_TYPE = 'FRANCECONNECT_LINK';
export const LINK_TTL_MS = 3 * 365 * 24 * 60 * 60 * 1000;
export const linkHash = (issuer, sub) => `fclink:${crypto.createHash('sha256').update(`${String(issuer)}\n${String(sub)}`).digest('hex')}`;

const audit = (db, action, userId, details = {}) => db.insert(AuditLog).values({ action, entity: 'CitizenUser', entity_id: userId, actor: 'citizen', actor_id: userId, details }).catch(() => {});

/** the account a FranceConnect identity is linked to (active link only) @returns {Promise<{ id: string, email: string, emailVerifiedAt: Date | null, lockoutUntil: Date | null } | null>} */
export async function findLinkedAccount(issuer, sub, db = defaultDb) {
  const rows = await db.select({ id: CitizenUser.id, email: CitizenUser.email, emailVerifiedAt: CitizenUser.emailVerifiedAt, lockoutUntil: CitizenUser.lockoutUntil, tokenId: AuthToken.id })
    .from(AuthToken).innerJoin(CitizenUser, eq(CitizenUser.id, AuthToken.userId))
    .where(and(eq(AuthToken.tokenHash, linkHash(issuer, sub)), eq(AuthToken.type, LINK_TYPE), sql`${AuthToken.expiresAt} > NOW()`)).limit(1);
  return rows[0] || null;
}

/** renew the link after a FranceConnect sign-in */
export async function touchLink(issuer, sub, db = defaultDb) {
  await db.update(AuthToken).set({ expiresAt: new Date(Date.now() + LINK_TTL_MS), usedAt: new Date() })
    .where(and(eq(AuthToken.tokenHash, linkHash(issuer, sub)), eq(AuthToken.type, LINK_TYPE)));
}

/** @returns {Promise<{ ok: true, status: number, linked: true } | { ok: false, status: number, code: string, message: string }>} */
export async function linkAccount(userId, issuer, sub, db = defaultDb) {
  const hash = linkHash(issuer, sub);
  const [existing] = await db.select({ userId: AuthToken.userId, expiresAt: AuthToken.expiresAt }).from(AuthToken).where(eq(AuthToken.tokenHash, hash)).limit(1);
  if (existing && existing.userId !== userId && new Date(existing.expiresAt).getTime() > Date.now()) {
    return { ok: false, status: 409, code: 'FC_IDENTITY_LINKED_ELSEWHERE', message: 'Cette identité FranceConnect est déjà liée à un autre compte.' };
  }
  if (existing) await db.delete(AuthToken).where(eq(AuthToken.tokenHash, hash));   // an expired link of another account, or a re-link of this one
  await db.delete(AuthToken).where(and(eq(AuthToken.userId, userId), eq(AuthToken.type, LINK_TYPE)));   // one FranceConnect identity per account
  await db.insert(AuthToken).values({ userId, type: LINK_TYPE, tokenHash: hash, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  await audit(db, 'citizen.franceconnect_linked', userId);
  return { ok: true, status: 200, linked: true };
}

export async function unlinkAccount(userId, db = defaultDb) {
  const rows = await db.delete(AuthToken).where(and(eq(AuthToken.userId, userId), eq(AuthToken.type, LINK_TYPE))).returning({ id: AuthToken.id });
  if (rows.length) await audit(db, 'citizen.franceconnect_unlinked', userId);
  return { ok: true, status: 200, linked: false, removed: rows.length };
}

/** @returns {Promise<{ linked: boolean, linkedAt: Date | null, lastUsedAt: Date | null }>} */
export async function linkStatus(userId, db = defaultDb) {
  const [r] = await db.select({ createdAt: AuthToken.createdAt, usedAt: AuthToken.usedAt }).from(AuthToken)
    .where(and(eq(AuthToken.userId, userId), eq(AuthToken.type, LINK_TYPE), sql`${AuthToken.expiresAt} > NOW()`)).limit(1);
  return { linked: Boolean(r), linkedAt: r?.createdAt || null, lastUsedAt: r?.usedAt || null };
}
