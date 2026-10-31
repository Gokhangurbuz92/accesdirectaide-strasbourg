// @ts-nocheck
/**
 * C05 (R30) — the link between a minor's account and a legal guardian's account. Public rights information never depends on it (all ages); it only
 * matters for the account features the age policy marks GUARDIAN_CONSENT_REQUIRED (api/lib/agePolicy.js, ageGate in citizen-account.js).
 *
 *   DECLARED ──(the guardian confirms, with a verified e-mail)──▶ EMAIL_VERIFIED ──(the guardian asks for the strong check)──▶
 *   STRONGER_VERIFICATION_REQUIRED ──(a verifier records a method the policy allows)──▶ VERIFIED_STRONG          any state ──(either person)──▶ REVOKED
 *
 * What this code does NOT decide: which strong methods prove a guardianship, and what a verified guardian may do (scopes). Both come from the age
 * policy configured by the DPO (ADA_AGE_POLICY_JSON.guardianVerification); by default no method is allowed, so no link can reach VERIFIED_STRONG and
 * nothing a minor can do changes. An e-mail confirmation is never treated as proof of guardianship.
 * No account enumeration: declaring a guardian answers the same whether or not the address belongs to an adult's account.
 * Every step is written to the append-only consent ledger (purpose GUARDIAN_LINK, guardian_involved).
 */
import { eq, or } from 'drizzle-orm';

export const GUARDIAN_STATES = ['DECLARED', 'EMAIL_VERIFIED', 'STRONGER_VERIFICATION_REQUIRED', 'VERIFIED_STRONG', 'REVOKED'];
/** the closed vocabulary of strong methods a policy may allow (none is allowed by default) */
export const STRONG_METHODS = ['PROFESSIONAL_ATTESTATION', 'IDENTITY_DOCUMENT_CHECK', 'OFFICIAL_IDENTITY_SERVICE'];
export const MAX_ACTIVE_GUARDIANS = 2;
export const NEUTRAL_DECLARE = 'Si cette adresse correspond au compte d’un adulte, cette personne verra votre demande dans son espace.';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** the guardian part of the age policy; empty unless the DPO configured it @param {Record<string, string | undefined>} [env] */
export function loadGuardianPolicy(env = process.env) {
  try {
    const p = JSON.parse(env.ADA_AGE_POLICY_JSON || 'null');
    const g = p && p.status === 'CONFIGURED' ? p.guardianVerification : null;
    if (g && Array.isArray(g.strongMethods)) {
      return Object.freeze({ configured: true, strongMethods: g.strongMethods.filter((m) => STRONG_METHODS.includes(m)), scopes: Array.isArray(g.scopes) ? g.scopes.map(String) : [] });
    }
  } catch { /* the safe default below */ }
  return Object.freeze({ configured: false, strongMethods: [], scopes: [] });
}

/**
 * The state machine, without storage. @param {string} state @param {'CONFIRM'|'REQUIRE_STRONG'|'STRONG_PASSED'|'REVOKE'} event
 * @param {{ method?: string, policy?: ReturnType<typeof loadGuardianPolicy> }} [opts] @returns {{ ok: true, next: string } | { ok: false, code: string }}
 */
export function transition(state, event, opts = {}) {
  const policy = opts.policy ?? loadGuardianPolicy();
  if (state === 'REVOKED') return { ok: false, code: 'ALREADY_REVOKED' };
  if (event === 'REVOKE') return { ok: true, next: 'REVOKED' };
  if (event === 'CONFIRM') return state === 'DECLARED' ? { ok: true, next: 'EMAIL_VERIFIED' } : { ok: false, code: 'INVALID_STATE' };
  if (event === 'REQUIRE_STRONG') {
    if (state !== 'EMAIL_VERIFIED') return { ok: false, code: 'INVALID_STATE' };
    return policy.strongMethods.length ? { ok: true, next: 'STRONGER_VERIFICATION_REQUIRED' } : { ok: false, code: 'POLICY_PENDING' };
  }
  if (event === 'STRONG_PASSED') {
    if (state !== 'STRONGER_VERIFICATION_REQUIRED') return { ok: false, code: 'INVALID_STATE' };
    if (!policy.strongMethods.length) return { ok: false, code: 'POLICY_PENDING' };
    return policy.strongMethods.includes(opts.method) ? { ok: true, next: 'VERIFIED_STRONG' } : { ok: false, code: 'METHOD_NOT_ALLOWED' };
  }
  return { ok: false, code: 'UNKNOWN_EVENT' };
}

const POLICY_PENDING_MESSAGE = 'La façon de vérifier un représentant légal n’est pas encore fixée : le lien reste enregistré, sans effet sur le compte.';
const refusal = (code) => ({
  ALREADY_REVOKED: bad('ALREADY_REVOKED', 'Ce lien a déjà été retiré.', 409),
  INVALID_STATE: bad('INVALID_STATE', 'Cette étape n’est pas possible pour ce lien.', 409),
  POLICY_PENDING: bad('POLICY_PENDING', POLICY_PENDING_MESSAGE, 409),
  METHOD_NOT_ALLOWED: bad('METHOD_NOT_ALLOWED', 'Cette méthode de vérification n’est pas prévue par la politique en vigueur.', 409),
}[code] || bad(code, 'Action impossible.', 409));

/** the view of a link for one of its two people (never the other person's e-mail) */
const view = (r, me, names = {}) => ({ id: r.id, role: r.minorId === me ? 'minor' : 'guardian', status: r.status, scopes: r.status === 'VERIFIED_STRONG' ? r.scopes : [],
  other: names[r.minorId === me ? r.guardianId : r.minorId] || null, createdAt: r.createdAt });

/** A minor declares a guardian by e-mail. Same answer whatever the address is (no account enumeration). @param {string} minorId @param {{ guardianEmail?: string }} input @param {ReturnType<typeof drizzleGuardianStore>} store */
export async function declareGuardian(minorId, input, store) {
  const email = String(input?.guardianEmail || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return bad('INVALID_EMAIL', 'Adresse e-mail invalide.');
  if ((await store.ageBandOf(minorId)) !== 'moins-de-18') return bad('NOT_A_MINOR', 'Cette démarche concerne les comptes de personnes mineures.', 409);
  const active = (await store.relationshipsOf(minorId)).filter((r) => r.minorId === minorId && r.status !== 'REVOKED');
  if (active.length >= MAX_ACTIVE_GUARDIANS) return bad('TOO_MANY_GUARDIANS', `Un compte peut être lié à ${MAX_ACTIVE_GUARDIANS} représentants légaux au plus.`, 409);
  const guardian = await store.findUserByEmail(email);
  const eligible = guardian && guardian.id !== minorId && (await store.ageBandOf(guardian.id)) && (await store.ageBandOf(guardian.id)) !== 'moins-de-18'
    && !active.some((r) => r.guardianId === guardian.id);
  if (eligible) {
    await store.insertRelationship({ minorId, guardianId: guardian.id, status: 'DECLARED', scopes: [] });
    await store.audit(minorId, 'GUARDIAN_LINK_DECLARED', true);
  }
  return { ok: true, status: 202, message: NEUTRAL_DECLARE };
}

/** both sides' links @param {string} userId */
export async function listGuardianships(userId, store) {
  const rows = (await store.relationshipsOf(userId)).filter((r) => r.status !== 'REVOKED');
  const names = await store.displayNames([...new Set(rows.flatMap((r) => [r.minorId, r.guardianId]))].filter((id) => id !== userId));
  const policy = store.policy();
  return { ok: true, status: 200, guardianships: rows.map((r) => view(r, userId, names)), policy: { strongVerification: policy.strongMethods.length ? 'CONFIGURED' : 'POLICY_PENDING' } };
}

async function step(userId, id, event, who, store, opts = {}) {
  const r = await store.relationship(String(id || ''));
  const mine = r && (who === 'guardian' ? r.guardianId === userId : who === 'either' ? (r.guardianId === userId || r.minorId === userId) : false);
  if (!mine) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  const t = transition(r.status, event, { policy: store.policy(), method: opts.method });
  if (!t.ok) return refusal(t.code);
  await store.updateRelationship(r.id, { status: t.next, ...(t.next === 'VERIFIED_STRONG' ? { scopes: store.policy().scopes } : {}), ...(t.next === 'REVOKED' ? { scopes: [] } : {}) });
  await store.audit(r.minorId, `GUARDIAN_LINK_${t.next}`, t.next !== 'REVOKED');
  return { ok: true, status: 200, guardianship: { id: r.id, status: t.next } };
}

/** the guardian accepts the request; their own e-mail must be verified (an e-mail is never a proof of guardianship) */
export async function confirmAsGuardian(guardianId, id, store) {
  if (!(await store.emailVerified(guardianId))) return bad('EMAIL_NOT_VERIFIED', 'Vérifiez d’abord votre adresse e-mail.', 409);
  return step(guardianId, id, 'CONFIRM', 'guardian', store);
}
/** the guardian asks for the strong check; refused while the policy names no method */
export const requestStrongVerification = (guardianId, id, store) => step(guardianId, id, 'REQUIRE_STRONG', 'guardian', store);
/** either person withdraws the link at any time; the gate closes at once */
export const revokeGuardianship = (userId, id, store) => step(userId, id, 'REVOKE', 'either', store);

/**
 * A verifier (an administrator or an authorised professional, checked by the caller) records the strong check, with a method the policy allows.
 * @param {{ verifierId: string, isVerifier: boolean }} actor @param {string} id @param {{ method: string }} input
 */
export async function recordStrongVerification(actor, id, input, store) {
  if (!actor?.isVerifier) return bad('FORBIDDEN', 'Action réservée aux personnes habilitées.', 403);
  const r = await store.relationship(String(id || ''));
  if (!r) return bad('NOT_FOUND', 'Lien introuvable.', 404);
  const t = transition(r.status, 'STRONG_PASSED', { policy: store.policy(), method: input?.method });
  if (!t.ok) return refusal(t.code);
  await store.updateRelationship(r.id, { status: t.next, scopes: store.policy().scopes });
  await store.audit(r.minorId, `GUARDIAN_LINK_VERIFIED_STRONG:${input.method}`, true);
  return { ok: true, status: 200, guardianship: { id: r.id, status: t.next } };
}

/** the production store (drizzle) */
export function drizzleGuardianStore(db, { GuardianRelationship, CitizenUser, CitizenProfile }, appendConsent, env = process.env) {
  return {
    policy: () => loadGuardianPolicy(env),
    ageBandOf: async (userId) => (await db.select({ b: CitizenProfile.ageBand }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1))[0]?.b ?? null,
    findUserByEmail: async (email) => (await db.select({ id: CitizenUser.id }).from(CitizenUser).where(eq(CitizenUser.email, email)).limit(1))[0] || null,
    emailVerified: async (userId) => Boolean((await db.select({ v: CitizenUser.emailVerifiedAt }).from(CitizenUser).where(eq(CitizenUser.id, userId)).limit(1))[0]?.v),
    displayNames: async (ids) => {
      const out = {};
      for (const id of ids) out[id] = (await db.select({ n: CitizenProfile.displayName }).from(CitizenProfile).where(eq(CitizenProfile.userId, id)).limit(1))[0]?.n || null;
      return out;
    },
    relationshipsOf: (userId) => db.select().from(GuardianRelationship).where(or(eq(GuardianRelationship.minorId, userId), eq(GuardianRelationship.guardianId, userId))),
    relationship: async (id) => (await db.select().from(GuardianRelationship).where(eq(GuardianRelationship.id, id)).limit(1))[0] || null,
    insertRelationship: (row) => db.insert(GuardianRelationship).values(row).returning(),
    updateRelationship: (id, patch) => db.update(GuardianRelationship).set(patch).where(eq(GuardianRelationship.id, id)),
    audit: (minorId, purpose, decision) => appendConsent({ userId: minorId, purpose, decision, guardianInvolved: true }, db),
  };
}
