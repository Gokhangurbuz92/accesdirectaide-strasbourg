// @ts-nocheck
/**
 * PKG-5 / I01 I05 — institutional partner onboarding. An administrator records an agreement from a REAL signed document (reference, date, signatory);
 * nothing is pre-filled and no partner exists until someone records it. An institutional account can be activated only under a SIGNED agreement (also a
 * database CHECK); ending the agreement suspends its accounts. The initial password is shown ONCE to the administrator for out-of-band hand-over and only
 * its hash is stored. Every step is audited.
 * R21: that initial password is TEMPORARY (the space asks for a personal one first); the partner changes it in the space after giving the current one (shared
 * password rule, every other session ends); a lost password is replaced the same way as the initial one was given: an administrator hands over a new temporary
 * password (elevation, shown once). No password, hash or fingerprint is ever written to a response other than that one-time display, to the journal or to logs.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { hashPassword, verifyPassword, isValidEmail, normalizeEmail } from '../_utils/user-auth.js';
import { signInstitutionToken, TEMPORARY_PASSWORD_PREFIX, isTemporaryPassword, storedHash } from '../_utils/institution-auth.js';
import { passwordMessage, passwordProblems } from '../../src/lib/passwordPolicy.js';
import { officialTerritory } from '../lib/geography/officialTerritory.js';

const KINDS = ['CONVENTION', 'DATA_SHARING', 'OTHER'];
const bad = (status, code, message) => ({ ok: false, status, code, message });
/** R21: a handed-over password meets the shared rule too (a random one sometimes had no digit or no capital); 16 characters, about 95 bits. */
function temporaryPassword() {
  for (;;) { const p = crypto.randomBytes(12).toString('base64url'); if (!passwordProblems(p).length) return p; }
}
const audit = (db, action, actor, entity, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity, entity_id: id, details });

export async function listAll(db = defaultDb) {
  const agreements = (await db.execute(sql`SELECT id, "partnerName", kind, status, scope, "documentRef", "signedAt", "signedByPartner", "recordedBy", "createdAt", "endedAt" FROM "PartnerAgreement" ORDER BY "createdAt" DESC`)).rows;
  const accounts = (await db.execute(sql`SELECT id, email, "organisationName", territory, status, "agreementId", "createdBy", "createdAt", "lastLogin",
    starts_with("passwordHash", ${TEMPORARY_PASSWORD_PREFIX}) AS "temporaryPassword" FROM "InstitutionAccount" ORDER BY "createdAt" DESC`)).rows;
  return { ok: true, agreements, accounts };
}

export async function createAgreement({ partnerName, kind, scope }, actor, db = defaultDb) {
  const name = String(partnerName || '').trim(); const k = String(kind || '').toUpperCase();
  if (name.length < 3) return bad(400, 'NAME_REQUIRED', 'Nom du partenaire requis.');
  if (!KINDS.includes(k)) return bad(400, 'INVALID_KIND', 'Type de convention invalide.');
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO "PartnerAgreement" (id, "partnerName", kind, status, scope, "recordedBy", "createdAt") VALUES (${id}, ${name.slice(0, 200)}, ${k}, 'DRAFT', ${String(scope || '').slice(0, 1000) || null}, ${actor}, NOW())`);
  await audit(db, 'PARTNER_AGREEMENT_DRAFTED', actor, 'PartnerAgreement', id, { kind: k });
  return { ok: true, id };
}

export async function recordSignature(id, { documentRef, signedAt, signedByPartner }, actor, db = defaultDb) {
  const ref = String(documentRef || '').trim(); const who = String(signedByPartner || '').trim(); const day = String(signedAt || '');
  if (ref.length < 3 || who.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(400, 'SIGNATURE_EVIDENCE_REQUIRED', 'Référence du document signé, date de signature et signataire du partenaire sont requis.');
  if (new Date(`${day}T00:00:00Z`) > new Date()) return bad(400, 'FUTURE_DATE', 'La date de signature ne peut pas être dans le futur.');
  const rows = (await db.execute(sql`UPDATE "PartnerAgreement" SET status = 'SIGNED', "documentRef" = ${ref.slice(0, 300)}, "signedAt" = ${day}::date, "signedByPartner" = ${who.slice(0, 200)}
    WHERE id = ${String(id || '')} AND status = 'DRAFT' RETURNING id`)).rows;
  if (!rows.length) return bad(404, 'not_found', 'Convention introuvable ou déjà signée.');
  await audit(db, 'PARTNER_AGREEMENT_SIGNATURE_RECORDED', actor, 'PartnerAgreement', rows[0].id, {});
  return { ok: true };
}

export async function endAgreement(id, actor, db = defaultDb) {
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`UPDATE "PartnerAgreement" SET status = 'ENDED', "endedAt" = NOW() WHERE id = ${String(id || '')} AND status = 'SIGNED' RETURNING id`)).rows;
    if (!rows.length) return bad(404, 'not_found', 'Convention introuvable ou non signée.');
    const sus = (await tx.execute(sql`UPDATE "InstitutionAccount" SET status = 'SUSPENDED' WHERE "agreementId" = ${rows[0].id} AND status = 'ACTIVE' RETURNING id`)).rows;
    await tx.insert(AuditLog).values({ action: 'PARTNER_AGREEMENT_ENDED', actor, actor_id: actor, entity: 'PartnerAgreement', entity_id: rows[0].id, details: { accountsSuspended: sus.length } });
    return { ok: true, accountsSuspended: sus.length };
  });
}

export async function createAccount({ email, organisationName, territory, agreementId }, actor, db = defaultDb) {
  const e = normalizeEmail(email); const org = String(organisationName || '').trim(); const terr = String(territory || '').trim();
  if (!isValidEmail(e) || org.length < 3 || terr.length < 3) return bad(400, 'INVALID_INPUT', 'Adresse, organisme et territoire requis.');
  // R20: an official territory (INSEE reference), stored under its official label — a label, never a coverage (R18.3 stays an owner decision)
  const place = officialTerritory(terr);
  if (!place.ok) return bad(400, 'INVALID_TERRITORY', place.reason === 'AMBIGUOUS'
    ? `Territoire ambigu : précisez son code officiel (par exemple ${(place.candidates || []).join(' ; ')}).`
    : 'Territoire inconnu : indiquez une région, un département, une intercommunalité ou une commune par son nom ou son code officiel (référentiel INSEE).');
  const [g] = (await db.execute(sql`SELECT id FROM "PartnerAgreement" WHERE id = ${String(agreementId || '')} AND status IN ('DRAFT', 'SIGNED') LIMIT 1`)).rows;
  if (!g) return bad(404, 'AGREEMENT_NOT_FOUND', 'Rattachez le compte à une convention enregistrée.');
  const initialPassword = temporaryPassword();
  const id = crypto.randomUUID();
  try {
    await db.execute(sql`INSERT INTO "InstitutionAccount" (id, email, "passwordHash", "organisationName", territory, status, "agreementId", "createdBy", "createdAt")
      VALUES (${id}, ${e}, ${TEMPORARY_PASSWORD_PREFIX + await hashPassword(initialPassword)}, ${org.slice(0, 200)}, ${place.label}, 'PENDING_AGREEMENT', ${g.id}, ${actor}, NOW())`);
  } catch { return bad(409, 'EMAIL_IN_USE', 'Un compte institutionnel existe déjà pour cette adresse.'); }
  await audit(db, 'INSTITUTION_ACCOUNT_CREATED', actor, 'InstitutionAccount', id, { agreementId: g.id });
  return { ok: true, id, initialPassword, note: 'Mot de passe initial affiché une seule fois : transmettez-le par un canal séparé.' };
}

export async function setAccountStatus(id, action, actor, db = defaultDb) {
  if (action === 'ACTIVATE') {
    const rows = (await db.execute(sql`UPDATE "InstitutionAccount" i SET status = 'ACTIVE' FROM "PartnerAgreement" g WHERE i.id = ${String(id || '')} AND g.id = i."agreementId"
      AND g.status = 'SIGNED' AND g."endedAt" IS NULL AND i.status IN ('PENDING_AGREEMENT', 'SUSPENDED') RETURNING i.id`)).rows;
    if (!rows.length) return bad(409, 'AGREEMENT_NOT_SIGNED', 'Activation impossible : la convention doit être signée (document enregistré) et en cours.');
    await audit(db, 'INSTITUTION_ACCOUNT_ACTIVATED', actor, 'InstitutionAccount', rows[0].id);
    return { ok: true };
  }
  if (action === 'SUSPEND') {
    const rows = (await db.execute(sql`UPDATE "InstitutionAccount" SET status = 'SUSPENDED' WHERE id = ${String(id || '')} AND status = 'ACTIVE' RETURNING id`)).rows;
    if (!rows.length) return bad(404, 'not_found', 'Compte introuvable ou non actif.');
    await audit(db, 'INSTITUTION_ACCOUNT_SUSPENDED', actor, 'InstitutionAccount', rows[0].id);
    return { ok: true };
  }
  return bad(400, 'unknown_action', 'Action inconnue.');
}

export async function institutionLogin({ email, password }, db = defaultDb) {
  const e = normalizeEmail(email);
  const [a] = (await db.execute(sql`SELECT i.id, i.email, i."passwordHash" AS h, i.status, i."lockoutUntil" AS l, i."failedLoginAttempts" AS f, g.status AS g, g."endedAt" AS ge
    FROM "InstitutionAccount" i LEFT JOIN "PartnerAgreement" g ON g.id = i."agreementId" WHERE i.email = ${e} LIMIT 1`)).rows;
  if (!a) return bad(401, 'invalid_credentials', 'Identifiants invalides.');
  if (a.l && new Date(a.l) > new Date()) return bad(423, 'locked', 'Compte temporairement verrouillé.');
  if (!(await verifyPassword(String(password || ''), storedHash(a.h)).catch(() => false))) {
    // R12 / Q11: atomic increment and lockout in one statement (concurrent failures on several instances all count)
    await db.execute(sql`UPDATE "InstitutionAccount" SET "failedLoginAttempts" = COALESCE("failedLoginAttempts", 0) + 1,
      "lockoutUntil" = CASE WHEN COALESCE("failedLoginAttempts", 0) + 1 >= 5 THEN ${new Date(Date.now() + 15 * 60000)} ELSE "lockoutUntil" END WHERE id = ${a.id}`);
    return bad(401, 'invalid_credentials', 'Identifiants invalides.');
  }
  if (a.status !== 'ACTIVE' || a.g !== 'SIGNED' || a.ge) return bad(403, 'ACCOUNT_NOT_ACTIVE', 'Compte non actif : la convention doit être signée et le compte activé par ADA.');
  await db.execute(sql`UPDATE "InstitutionAccount" SET "failedLoginAttempts" = 0, "lockoutUntil" = NULL, "lastLogin" = NOW() WHERE id = ${a.id}`);
  await audit(db, 'INSTITUTION_LOGIN', a.email, 'InstitutionAccount', a.id);
  return { ok: true, token: signInstitutionToken({ id: a.id, email: a.email, passwordHash: a.h }), temporaryPassword: isTemporaryPassword(a.h) };
}

/** R21 — the partner changes their password in the space: the current one first, the shared rule, a different one; the other sessions end, this one goes on. */
export async function changeInstitutionPassword(inst, { currentPassword, newPassword }, db = defaultDb) {
  const cur = String(currentPassword || ''); const next = String(newPassword || '');
  if (!cur || !next) return bad(400, 'MISSING_FIELDS', 'Indiquez votre mot de passe actuel et le nouveau.');
  const problems = passwordProblems(next);
  if (problems.length) return bad(400, 'WEAK_PASSWORD', passwordMessage(problems));
  const [a] = (await db.execute(sql`SELECT id, email, "passwordHash" AS h FROM "InstitutionAccount" WHERE id = ${String(inst.id)} AND status = 'ACTIVE' LIMIT 1`)).rows;
  if (!a) return bad(401, 'SESSION_ENDED', 'Votre session a pris fin. Reconnectez-vous.');
  if (!(await verifyPassword(cur, storedHash(a.h)).catch(() => false))) return bad(400, 'WRONG_CURRENT_PASSWORD', 'Le mot de passe actuel est incorrect.');
  if (await verifyPassword(next, storedHash(a.h)).catch(() => false)) return bad(400, 'SAME_PASSWORD', 'Choisissez un mot de passe différent de l’actuel.');
  const h = await hashPassword(next);
  // compare-and-set on the hash read above: two concurrent changes cannot both win, and a change made meanwhile by an administrator is not overwritten
  const rows = (await db.execute(sql`UPDATE "InstitutionAccount" SET "passwordHash" = ${h}, "failedLoginAttempts" = 0, "lockoutUntil" = NULL, "resetTokenHash" = NULL, "resetExpiresAt" = NULL
    WHERE id = ${a.id} AND "passwordHash" = ${a.h} RETURNING id`)).rows;   // R24: a pending reset link dies with the change
  if (!rows.length) return bad(409, 'PASSWORD_CHANGED_MEANWHILE', 'Le mot de passe vient d’être modifié ailleurs. Reconnectez-vous.');
  await audit(db, 'INSTITUTION_PASSWORD_CHANGED', a.email, 'InstitutionAccount', a.id, { otherSessionsEnded: true, wasTemporary: isTemporaryPassword(a.h) });
  return { ok: true, token: signInstitutionToken({ id: a.id, email: a.email, passwordHash: h }), message: 'Mot de passe modifié. Vos autres sessions ont été fermées.' };
}

/** R21 — lost password or locked account: an administrator (elevation) hands over a new temporary password, shown once; every session of the account ends. */
export async function resetInstitutionPassword(id, actor, db = defaultDb) {
  const temporary = temporaryPassword();
  const rows = (await db.execute(sql`UPDATE "InstitutionAccount" SET "passwordHash" = ${TEMPORARY_PASSWORD_PREFIX + await hashPassword(temporary)}, "failedLoginAttempts" = 0, "lockoutUntil" = NULL,
    "resetTokenHash" = NULL, "resetExpiresAt" = NULL WHERE id = ${String(id || '')} RETURNING id`)).rows;
  if (!rows.length) return bad(404, 'not_found', 'Compte introuvable.');
  await audit(db, 'INSTITUTION_PASSWORD_RESET', actor, 'InstitutionAccount', rows[0].id, { sessionsEnded: true });
  return { ok: true, initialPassword: temporary, note: 'Mot de passe provisoire affiché une seule fois : transmettez-le par un canal séparé. La personne en choisira un nouveau à sa connexion.' };
}

/** R24 (owner decision R21.1): the self-service reset link of an institutional account lives 30 minutes, once. */
export const INSTITUTION_RESET_MINUTES = 30;
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * R24 (owner decision R21.1) — « Mot de passe oublié » for an institutional partner. Only an ACTIVE account (signed agreement, activated by ADA) at the e-mail
 * address ADA registered for it gets a link; the answer never says whether the address is known. The token (256 bits) exists only in the e-mail: the database
 * keeps its SHA-256 and expiry, a new request replaces the previous link. Institutional accounts are all local-password accounts (no SSO in this product).
 * @returns {Promise<{ accountId: string, email: string, organisationName: string, token: string } | null>} the link to send, or null (no such active account)
 */
export async function requestInstitutionReset(email, db = defaultDb) {
  const e = normalizeEmail(String(email || ''));
  if (!isValidEmail(e)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const rows = (await db.execute(sql`UPDATE "InstitutionAccount" SET "resetTokenHash" = ${tokenHash(token)}, "resetExpiresAt" = NOW() + make_interval(mins => ${INSTITUTION_RESET_MINUTES})
    WHERE lower(email) = ${e} AND status = 'ACTIVE' RETURNING id, email, "organisationName" o`)).rows;
  if (!rows.length) return null;
  await audit(db, 'INSTITUTION_RESET_REQUESTED', rows[0].email, 'InstitutionAccount', rows[0].id, { validMinutes: INSTITUTION_RESET_MINUTES });
  return { accountId: rows[0].id, email: rows[0].email, organisationName: rows[0].o, token };
}

/**
 * R24 (owner decision R21.1) — the person follows the link and chooses a password (shared rule). One UPDATE checks the token, its expiry and the account's status
 * and consumes the link (single use); the new password is personal (not temporary), the lockout is cleared, and every session ends (the token fingerprint).
 */
export async function completeInstitutionReset({ token, password }, db = defaultDb) {
  const raw = String(token || ''); const next = String(password || '');
  const invalid = () => bad(400, 'INVALID_RESET_LINK', 'Ce lien n’est plus valable (déjà utilisé, remplacé ou expiré). Demandez-en un nouveau.');
  if (!/^[a-f0-9]{64}$/.test(raw)) return invalid();
  const problems = passwordProblems(next);
  if (problems.length) return bad(400, 'WEAK_PASSWORD', passwordMessage(problems));
  const h = tokenHash(raw);
  const [a] = (await db.execute(sql`SELECT id, "passwordHash" ph FROM "InstitutionAccount" WHERE "resetTokenHash" = ${h} AND "resetExpiresAt" > NOW() AND status = 'ACTIVE' LIMIT 1`)).rows;
  if (!a) return invalid();
  if (await verifyPassword(next, storedHash(a.ph)).catch(() => false)) return bad(400, 'SAME_PASSWORD', 'Choisissez un mot de passe différent de l’actuel.');
  const rows = (await db.execute(sql`UPDATE "InstitutionAccount" SET "passwordHash" = ${await hashPassword(next)}, "resetTokenHash" = NULL, "resetExpiresAt" = NULL,
    "failedLoginAttempts" = 0, "lockoutUntil" = NULL WHERE id = ${a.id} AND "resetTokenHash" = ${h} AND "resetExpiresAt" > NOW() AND status = 'ACTIVE' RETURNING id, email`)).rows;
  if (!rows.length) return invalid();   // consumed meanwhile (two tabs): only one wins
  await audit(db, 'INSTITUTION_PASSWORD_RESET_BY_LINK', rows[0].email, 'InstitutionAccount', rows[0].id, { sessionsEnded: true });
  return { ok: true, message: 'Mot de passe enregistré. Toutes vos sessions ont été fermées : connectez-vous avec le nouveau mot de passe.' };
}

/** R21 — « Se déconnecter » ends the account's sessions on the server (every device), like the professional logout: the journal entry IS the revocation. */
export async function institutionLogout(inst, db = defaultDb) {
  await audit(db, 'INSTITUTION_LOGOUT', inst.email, 'InstitutionAccount', inst.id, { scope: 'all_sessions' });
  return { ok: true };
}
