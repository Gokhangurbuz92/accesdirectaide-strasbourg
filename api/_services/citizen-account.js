// @ts-nocheck
/**
 * PKG-1 / K0 — citizen account core: profile, household, notification preferences, consent ledger, account-based dossier ownership.
 * Principles: minimisation (age BAND, no birth date), server-side enforcement (a UI toggle alone never counts), append-only consent proof (ConsentLog rows are only ever inserted),
 * safe defaults (marketing/SMS/push off), ownership beside — never instead of — the owner secret.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { isRestricted, SHARE_SEAL } from './processing-restriction.js';
import { db as defaultDb } from '../../src/db/index.js';
import { CitizenProfile, CitizenUser, ConsentLog, GuardianRelationship, HouseholdMember, NotificationPreference, SharedDiagnostic } from '../../src/db/schema.js';
import { AGE_BAND_KEYS } from '../lib/ageBands.js';
import { evaluateAge } from '../lib/agePolicy.js';
import { holdsOwnerSecret, isExpired } from '../_utils/share-access.js';
import { pushConfig, removeSubscriptions } from './web-push.js';

export const CHANNELS = ['email', 'sms', 'inapp', 'push'];
/** Launch-readiness item 59 / R11 (N04): web push exists only where the deployment holds its VAPID keys (api/_services/web-push.js pushConfig); without them the
 * option is not offered and cannot be switched on (a choice nothing would ever honour). */
// R12 (C20): « inapp » is not offered — no citizen in-app inbox exists, so nothing would honour it (it can still be switched off)
export const unavailableChannels = (env = process.env) => ['inapp', ...(pushConfig(env).ok ? [] : ['push'])];
export const CATEGORIES = ['service', 'reminder', 'marketing'];
export const HOUSEHOLD_RELATIONS = ['partner', 'child', 'parent', 'sibling', 'other'];
export const MAX_HOUSEHOLD = 12;
export const CONSENT_POLICY_VERSION = 'pkg1-2026-10-18-lab-proposal';   // wording is a LAB proposal until the DPO validates it
export const TEXT_SCALES = ['normal', 'large', 'xlarge'];

/** Safe defaults: transactional e-mail on (R12: in-app off — it does not exist); reminders by e-mail on (behaviour unchanged); everything else, and ALL marketing, off. */
export const DEFAULT_PREFS = Object.freeze({
  'email.service': true, 'email.reminder': true, 'email.marketing': false,
  'inapp.service': false, 'inapp.reminder': false, 'inapp.marketing': false,   // R12 (C20): no in-app inbox exists for citizens — never shown as on
  'sms.service': false, 'sms.reminder': false, 'sms.marketing': false,
  'push.service': false, 'push.reminder': false, 'push.marketing': false,
});
/** Pairs that need a recorded, citizen-given consent before they can be on. */
const CONSENT_REQUIRED = (channel, category) => category === 'marketing' || channel === 'sms' || channel === 'push';
export const purposeOf = (channel, category) => `NOTIF_${channel.toUpperCase()}_${category.toUpperCase()}`;

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });

// ───────────── consent ledger (append-only)
export async function appendConsent({ userId, purpose, decision, channel = 'ui', guardianInvolved = false, proofLevel = 'AUTHENTICATED_SESSION' }, db = defaultDb) {
  const [row] = await db.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER', subject_id: userId, purpose, decision: Boolean(decision), policy_version: CONSENT_POLICY_VERSION,
    policy_hash: `${CONSENT_POLICY_VERSION}:${purpose}`, collection_channel: channel, guardian_involved: guardianInvolved, proof_level: proofLevel,
  }).returning();
  return row;
}
/** @returns {Promise<boolean | null>} the latest decision for the purpose, null when never asked */
export async function currentConsent(userId, purpose, db = defaultDb) {
  const [row] = await db.select().from(ConsentLog).where(and(eq(ConsentLog.subject_id, userId), eq(ConsentLog.purpose, purpose))).orderBy(desc(ConsentLog.created_at)).limit(1);
  return row ? row.decision === true : null;
}

// ───────────── age policy gate
export async function ageGate(userId, db = defaultDb) {
  const [p] = await db.select({ ageBand: CitizenProfile.ageBand }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  let guardianVerified = false;
  if (p?.ageBand) {
    const [g] = await db.select({ id: GuardianRelationship.id }).from(GuardianRelationship).where(and(eq(GuardianRelationship.minorId, userId), eq(GuardianRelationship.status, 'VERIFIED_STRONG'))).limit(1);
    guardianVerified = Boolean(g);
  }
  return evaluateAge(p?.ageBand ?? null, { guardianVerified });
}
const ageRefusal = (gate) => bad('AGE_POLICY_PENDING', gate.accountFeatures === 'POLICY_PENDING'
  ? "Les informations publiques restent accessibles à tout âge. Les fonctions de compte sensibles pour les mineurs attendent un cadre de consentement validé juridiquement."
  : 'Cette fonction nécessite le consentement d’un représentant légal vérifié.', 409);

// ───────────── profile
const DEPT = /^(?:\d{2}|2A|2B|97\d)$/;
function cleanAccessibility(a) {
  const src = a && typeof a === 'object' ? a : {};
  const out = {};
  for (const k of ['falc', 'highContrast', 'reduceMotion', 'voice']) if (typeof src[k] === 'boolean') out[k] = src[k];
  if (TEXT_SCALES.includes(src.textScale)) out.textScale = src.textScale;
  return out;
}
export async function getAccount(userId, db = defaultDb) {
  const [profile] = await db.select().from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  const household = await db.select().from(HouseholdMember).where(eq(HouseholdMember.userId, userId)).orderBy(HouseholdMember.createdAt);
  const preferences = await getPreferences(userId, db);
  const gate = await ageGate(userId, db);
  return {
    profile: profile ? { displayName: profile.displayName, preferredLanguage: profile.preferredLanguage, ageBand: profile.ageBand, departement: profile.departement, accessibilityPrefs: profile.accessibilityPrefs, prefillConsent: profile.prefillConsent } : { displayName: null, preferredLanguage: 'fr', ageBand: null, departement: null, accessibilityPrefs: {}, prefillConsent: false },
    household: household.map((h) => ({ id: h.id, relation: h.relation, ageBand: h.ageBand, label: h.label })),
    preferences, agePolicy: { accountFeatures: gate.accountFeatures, allowed: gate.allowed, status: gate.policyStatus, publicInformation: 'ALL_AGES' },
  };
}
export async function saveProfile(userId, input, db = defaultDb) {
  const b = input && typeof input === 'object' ? input : {};
  const patch = {};
  if ('displayName' in b) {
    const v = b.displayName == null ? null : String(b.displayName).trim();
    if (v !== null && (v.length < 1 || v.length > 60)) return bad('INVALID_DISPLAY_NAME', 'Le nom affiché doit contenir 1 à 60 caractères.');
    patch.displayName = v;
  }
  if ('preferredLanguage' in b) { if (b.preferredLanguage !== 'fr') return bad('UNSUPPORTED_LANGUAGE', 'Seul le français est disponible pour le moment.'); patch.preferredLanguage = 'fr'; }
  if ('ageBand' in b) {
    if (b.ageBand !== null && !AGE_BAND_KEYS.includes(b.ageBand)) return bad('INVALID_AGE_BAND', 'Tranche d’âge inconnue.');
    patch.ageBand = b.ageBand;
  }
  if ('departement' in b) {
    if (b.departement !== null && !DEPT.test(String(b.departement))) return bad('INVALID_DEPARTEMENT', 'Département invalide.');
    patch.departement = b.departement;
  }
  if ('accessibilityPrefs' in b) patch.accessibilityPrefs = cleanAccessibility(b.accessibilityPrefs);
  if ('prefillConsent' in b) {
    if (typeof b.prefillConsent !== 'boolean') return bad('INVALID_PREFILL_CONSENT', 'prefillConsent doit être vrai ou faux.');
    if (b.prefillConsent) {
      const gate = await ageGate(userId, db);
      const declared = 'ageBand' in patch ? evaluateAge(patch.ageBand, { guardianVerified: false }) : gate;
      if (!declared.allowed) return ageRefusal(declared);
    }
    patch.prefillConsent = b.prefillConsent;
  }
  const [existing] = await db.select({ userId: CitizenProfile.userId, prefillConsent: CitizenProfile.prefillConsent }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  if (existing) await db.update(CitizenProfile).set(patch).where(eq(CitizenProfile.userId, userId));
  else await db.insert(CitizenProfile).values({ userId, ...patch });
  if ('prefillConsent' in patch && patch.prefillConsent !== (existing ? existing.prefillConsent : false)) await appendConsent({ userId, purpose: 'PROFILE_PREFILL', decision: patch.prefillConsent }, db);
  return { ok: true, status: 200, account: await getAccount(userId, db) };
}

// ───────────── household
export async function addHouseholdMember(userId, input, db = defaultDb) {
  const b = input && typeof input === 'object' ? input : {};
  if (!HOUSEHOLD_RELATIONS.includes(b.relation)) return bad('INVALID_RELATION', 'Lien inconnu.');
  if (b.ageBand != null && !AGE_BAND_KEYS.includes(b.ageBand)) return bad('INVALID_AGE_BAND', 'Tranche d’âge inconnue.');
  const label = b.label == null ? null : String(b.label).trim().slice(0, 30);
  const gate = await ageGate(userId, db);
  if (!gate.allowed) return ageRefusal(gate);
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "HouseholdMember" WHERE "userId" = ${userId}`)).rows;
  if (n >= MAX_HOUSEHOLD) return bad('HOUSEHOLD_FULL', `Un foyer compte au plus ${MAX_HOUSEHOLD} personnes.`, 409);
  const [row] = await db.insert(HouseholdMember).values({ userId, relation: b.relation, ageBand: b.ageBand ?? null, label }).returning();
  return { ok: true, status: 201, member: { id: row.id, relation: row.relation, ageBand: row.ageBand, label: row.label } };
}
export async function removeHouseholdMember(userId, id, db = defaultDb) {
  const rows = await db.delete(HouseholdMember).where(and(eq(HouseholdMember.id, String(id)), eq(HouseholdMember.userId, userId))).returning({ id: HouseholdMember.id });
  return rows.length ? { ok: true, status: 200 } : bad('NOT_FOUND', 'Membre introuvable.', 404);
}

// ───────────── notification preferences (server-enforced)
export async function getPreferences(userId, db = defaultDb) {
  const rows = await db.select().from(NotificationPreference).where(eq(NotificationPreference.userId, userId));
  const [u] = await db.select({ n: CitizenUser.notificationEmailEnabled }).from(CitizenUser).where(eq(CitizenUser.id, userId)).limit(1);
  const out = {};
  for (const channel of CHANNELS) for (const category of CATEGORIES) {
    const key = `${channel}.${category}`;
    const row = rows.find((r) => r.channel === channel && r.category === category);
    out[key] = row ? row.enabled : (key === 'email.service' && u ? u.n : DEFAULT_PREFS[key]);
  }
  return out;
}
export async function setPreference(userId, input, db = defaultDb) {
  const b = input && typeof input === 'object' ? input : {};
  if (!CHANNELS.includes(b.channel) || !CATEGORIES.includes(b.category)) return bad('INVALID_PREFERENCE', 'Canal ou catégorie inconnus.');
  if (typeof b.enabled !== 'boolean') return bad('INVALID_PREFERENCE', 'enabled doit être vrai ou faux.');
  const needsConsent = CONSENT_REQUIRED(b.channel, b.category);
  if (b.enabled && needsConsent) {
    if (b.consentGiven !== true) return bad('CONSENT_REQUIRED', 'Cette option nécessite votre consentement explicite, distinct de l’acceptation du service.');
    const gate = await ageGate(userId, db);
    if (!gate.allowed) return ageRefusal(gate);
  }
  if (b.enabled && unavailableChannels().includes(b.channel)) return bad('CHANNEL_UNAVAILABLE', 'Les notifications sur cet appareil ne sont pas disponibles sur ce service : rien ne serait envoyé.', 409);
  await db.insert(NotificationPreference).values({ userId, channel: b.channel, category: b.category, enabled: b.enabled })
    .onConflictDoUpdate({ target: [NotificationPreference.userId, NotificationPreference.channel, NotificationPreference.category], set: { enabled: b.enabled, updatedAt: new Date() } });
  if (b.channel === 'email' && b.category === 'service') await db.update(CitizenUser).set({ notificationEmailEnabled: b.enabled }).where(eq(CitizenUser.id, userId));   // the flag every existing sender already checks
  // PKG-11 audit: where the decision was collected and how the person was identified are recorded as they were (the passport page proves the owner secret,
  // not a session); unknown values fall back to the account session
  const collection = b.collection && typeof b.collection === 'object' ? b.collection : {};
  const proofLevel = ['AUTHENTICATED_SESSION', 'DOSSIER_OWNER_SECRET'].includes(collection.proofLevel) ? collection.proofLevel : 'AUTHENTICATED_SESSION';
  const channel = /^[a-z_]{2,40}$/.test(String(collection.channel || '')) ? String(collection.channel) : 'ui';
  if (needsConsent) await appendConsent({ userId, purpose: purposeOf(b.channel, b.category), decision: b.enabled, channel, proofLevel }, db);
  const preferences = await getPreferences(userId, db);
  // R12 (N04): when no push category is left on, the browser subscriptions (endpoints = personal data) are deleted, not only left unused
  let pushSubscriptionsRemoved;
  if (b.channel === 'push' && !b.enabled && !CATEGORIES.some((c) => preferences[`push.${c}`] === true)) pushSubscriptionsRemoved = (await removeSubscriptions(userId, null, { db })).removed;
  return { ok: true, status: 200, preferences, ...(pushSubscriptionsRemoved !== undefined ? { pushSubscriptionsRemoved } : {}) };
}
/** The single question every sender must ask. Marketing, SMS and push additionally need a recorded consent whose LATEST decision is "yes". */
export async function canNotify(userId, channel, category, db = defaultDb) {
  if (!CHANNELS.includes(channel) || !CATEGORIES.includes(category)) return false;
  if (await isRestricted(userId, db)) return false;   // PKG-11 / C21: no notification while the person restricts processing (art. 18); its own notices are sent apart
  const prefs = await getPreferences(userId, db);
  if (prefs[`${channel}.${category}`] !== true) return false;
  if (CONSENT_REQUIRED(channel, category)) return (await currentConsent(userId, purposeOf(channel, category), db)) === true;
  return true;
}

// ───────────── account-based ownership (beside the owner secret)
export async function listOwnedShares(userId, db = defaultDb) {
  const rows = (await db.execute(sql`
    SELECT s.id, s."createdAt", s."expiresAt",
           (SELECT count(*)::int FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = s.id AND g."revokedAt" IS NULL) AS "activeOrganizations"
    FROM "SharedDiagnostic" s WHERE s."ownerCitizenId" = ${userId} ORDER BY s."createdAt" DESC LIMIT 50`)).rows;
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, expiresAt: r.expiresAt, expired: new Date(r.expiresAt).getTime() <= Date.now(), activeOrganizations: r.activeOrganizations }));
}
/** Attach an account-free dossier to the account. Requires BOTH the session and the owner secret; any mismatch is the same uniform "not found". */
export async function claimShare(userId, shareId, ownerSecret, db = defaultDb) {
  const notFound = bad('not_found', 'Ce dossier est introuvable ou inaccessible.', 404);
  const gate = await ageGate(userId, db);
  if (!gate.allowed) return ageRefusal(gate);
  const [shared] = await db.select({ id: SharedDiagnostic.id, rightsSecretHash: SharedDiagnostic.rightsSecretHash, shareTokenHash: SharedDiagnostic.shareTokenHash, ownerCitizenId: SharedDiagnostic.ownerCitizenId, expiresAt: SharedDiagnostic.expiresAt })
    .from(SharedDiagnostic).where(eq(SharedDiagnostic.id, String(shareId))).limit(1);
  if (!shared || !holdsOwnerSecret(shared, String(ownerSecret || ''))) return notFound;
  if (shared.ownerCitizenId && shared.ownerCitizenId !== userId) return notFound;
  if (isExpired(shared)) return bad('expired', 'Ce dossier a expiré.', 410);
  // R12: a dossier attached while the person restricts processing (art. 18) gets its share link sealed like the others; a lost race is not reported as success
  const restricted = await isRestricted(userId, db);
  const claimed = await db.update(SharedDiagnostic).set({ ownerCitizenId: userId, privacySubjectId: userId,
    ...(restricted ? { shareTokenHash: sql`CASE WHEN "shareTokenHash" LIKE ${`${SHARE_SEAL}%`} THEN "shareTokenHash" ELSE ${SHARE_SEAL} || "shareTokenHash" END` } : {}) })
    .where(and(eq(SharedDiagnostic.id, shared.id), sql`("ownerCitizenId" IS NULL OR "ownerCitizenId" = ${userId})`)).returning({ id: SharedDiagnostic.id });
  if (!claimed.length) return notFound;
  return { ok: true, status: 200, shareId: shared.id, ...(restricted ? { shareLinkSuspended: true } : {}) };
}
