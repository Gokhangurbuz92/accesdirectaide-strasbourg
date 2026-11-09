#!/usr/bin/env node
// @ts-nocheck
/**
 * R47 — activation-readiness simulator. READ-ONLY, offline, never prints or reads a real secret.
 *
 * For every surface, gated capability, scheduled job and provider adapter it lists — DERIVED FROM THE CODE that decides it (api/_utils/public-beta.js,
 * api/_utils/capabilities.js, api/lib/service-sensitivity.js, api/lib/protected-store, api/_services/provider-status.js, api/_services/retention-policy.js,
 * src/lib/publicBeta.js, src/config/legal-drafts.js, scripts/release-preflight.mjs, config/activation-manifest.json) — what must be true to open it:
 * environment switches (evaluated), and the non-environment prerequisites (owner decisions, partner, legal approval, HDS, human review, migration,
 * code-recorded approval), with the rollback.
 *
 * It then PROVES each environment prerequisite with the same functions the API calls:
 *   (a) the FINAL configuration (built from SYNTHETIC fixtures, every value marked SYNTHETIC-TEST-ONLY, endpoints on *.example.test) opens the item;
 *   (b) removing ONE prerequisite closes it, with a stable code;
 *   (c) removing its rollback switch closes it again (the gates read the environment on every call).
 * The evaluation is done as Production evaluates it (VERCEL_ENV=production, restricted beta on). The live HTTP proof of the same configuration against
 * the real api/index.js is e2e-r47/activation/run.mjs.
 *
 *   node scripts/activation-simulator.mjs                 summary
 *   node scripts/activation-simulator.mjs --json          the full report as JSON
 *   node scripts/activation-simulator.mjs --out <dir>     writes R47_ACTIVATION_SIMULATOR.json and R47_ACTIVATION_PREREQUIS_FR.md into <dir>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SURFACES, NOT_OPENABLE, SCHEDULED_JOBS, isAllowedInPublicBeta, isSmsInboundRequest, openSurfaces, surfaceOf } from '../api/_utils/public-beta.js';
import { CAPABILITIES, capabilityState, hdsAttestation } from '../api/_utils/capabilities.js';
import { bookingDecision, SENSITIVE_BOOKING_APPROVAL_VALUE, SENSITIVE_BOOKING_CONSENT_VERSION } from '../api/lib/service-sensitivity.js';
import { protectedStoreState } from '../api/lib/protected-store/index.js';
import { RETENTION_POLICY, executionGate, POLICY_STATUS_APPROVED, stepApprovalProblem } from '../api/_services/retention-policy.js';
import { loadGuardianPolicy } from '../api/_services/guardianship.js';
import { isBetaRestrictedPath } from '../src/lib/publicBeta.js';
import { LEGAL_DRAFT_DOCUMENTS, draftVisibility } from '../src/config/legal-drafts.js';
import { evaluateReleasePreflight, outlookCheck } from './release-preflight.mjs';

export const SYNTHETIC = 'SYNTHETIC-TEST-ONLY';
/** the shipped migration that the appointment notices need (api/_utils/schema-features.js NOTICE_KINDS_0045) */
export const NOTICE_MIGRATION = '0045_r43_appointment_notice_kinds';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rnd = (n = 24) => crypto.randomBytes(n).toString('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
// provider-status.js imports modules that refuse to LOAD without a key and a database URL (api/lib/crypto.ts, src/db/index.ts); the simulator never queries a
// database: when absent, THIS process gets a random synthetic key and an unreachable loopback URL (port 9, connection is lazy and never opened)
if (!process.env.ADA_ENCRYPTION_KEY) process.env.ADA_ENCRYPTION_KEY = rnd(32);
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://synthetic@127.0.0.1:9/ada_simulator_never_connected_test';
const { providerStatuses } = await import('../api/_services/provider-status.js');

/** a well-formed, unexpired, unmistakably synthetic HDS attestation token (HDS_TOKEN_FORMAT of api/_utils/capabilities.js) */
export const syntheticHdsToken = () => `HDS1:synthetic-test-only:${SYNTHETIC}-0001:2099-12-31:${sha(SYNTHETIC)}`;

/** a fresh VAPID key pair (valid P-256 keys generated now, never stored) */
function syntheticVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }); const priv = privateKey.export({ format: 'jwk' });
  return { pub: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')])), priv: priv.d };
}

/** the publisher / controller identity of the legal pages (src/config/legal-documents.js LEGAL_PLACEHOLDERS; [À COMPLÉTER] while absent) */
export const LEGAL_IDENTITY_VARS = ['VITE_LEGAL_PUBLISHER_IDENTITY', 'VITE_LEGAL_CONTROLLER_IDENTITY', 'VITE_LEGAL_PUBLICATION_DIRECTOR', 'VITE_LEGAL_DATA_PROTECTION_CONTACT',
  'VITE_LEGAL_SECURITY_CONTACT', 'VITE_LEGAL_RIGHTS_HOLDER'];
const OPENABLE_SURFACES = Object.keys(SURFACES).filter((s) => !NOT_OPENABLE.includes(s));
const OUT_OF_AIPD = Object.entries(CAPABILITIES).filter(([, c]) => c.aipd === 'out' && c.openable !== false).map(([n]) => n);
const OPENABLE_JOBS = Object.entries(SCHEDULED_JOBS).filter(([, c]) => c !== 'D').map(([j]) => j);
const C_JOBS = Object.entries(SCHEDULED_JOBS).filter(([, c]) => c === 'C').map(([j]) => j);
const legalVersions = () => LEGAL_DRAFT_DOCUMENTS.map((d) => `${d.id}@${d.version}`).join(',');

/**
 * The FINAL activation configuration, from synthetic fixtures only.
 * profile 'production': evaluated as Production (VERCEL_ENV=production), https endpoints on *.example.test (never called).
 * profile 'lab': the live proof (no VERCEL_ENV, enforcement forced by ADA_CAPABILITY_ENFORCEMENT / ADA_SENSITIVITY_REVIEW_ENFORCED), loopback mocks.
 * @param {{ profile?: 'production' | 'lab', base?: string, mocks?: Record<string, string> }} [opts]
 */
export function finalConfig(opts = {}) {
  const profile = opts.profile || 'production';
  const base = opts.base || 'https://ada.example.test';
  const m = { fc: 'https://fc.example.test', pc: 'https://proconnect.example.test/api/v2', openfisca: 'https://openfisca.example.test', hds: 'https://hds.example.test',
    alert: 'https://alerts.example.test/hook', ...(opts.mocks || {}) };
  const v = syntheticVapid();
  const env = {
    ...(profile === 'production' ? { VERCEL_ENV: 'production' } : {}),
    ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_CAPABILITY_ENFORCEMENT: '1', ADA_SENSITIVITY_REVIEW_ENFORCED: '1',
    VITE_PUBLIC_BETA: 'true',
    // core (api/_utils/env.js, release preflight)
    AUTH_MODE: 'jwt', JWT_SECRET: `${SYNTHETIC}-${rnd()}`, AUTH_SECRET: `${SYNTHETIC}-${rnd()}`, ADA_ENCRYPTION_KEY: rnd(32), ADA_VAULT_KEY: rnd(32),
    CRON_SECRET: `${SYNTHETIC}-${rnd(16)}`, APP_BASE_URL: base, DATABASE_SSL_VERIFY: 'true',
    DATABASE_URL: profile === 'production' ? `postgres://synthetic:${SYNTHETIC}@db.example.test/ada` : '',
    KV_REST_API_URL: profile === 'production' ? 'https://kv.example.test' : '', KV_REST_API_TOKEN: profile === 'production' ? `${SYNTHETIC}-${rnd(12)}` : '',
    // surfaces: server and the build (screens)
    ADA_BETA_OPEN_SURFACES: OPENABLE_SURFACES.join(','), VITE_PUBLIC_BETA_OPEN_SURFACES: OPENABLE_SURFACES.join(','),
    ADA_BETA_ACCOUNTS_SCOPE: 'full', VITE_PUBLIC_BETA_ACCOUNTS_SCOPE: 'full',
    // capabilities outside the AIPD, HDS
    ADA_CAPABILITIES_OPEN: OUT_OF_AIPD.join(','), ADA_HDS_CERTIFIED_HOSTING: syntheticHdsToken(),
    ADA_PROTECTED_STORE: 'certified', ADA_PROTECTED_STORE_ENDPOINT: m.hds, ADA_PROTECTED_STORE_TOKEN: `${SYNTHETIC}-${rnd(20)}`,
    // art. 9 booking
    ADA_SENSITIVE_BOOKING_APPROVED: SENSITIVE_BOOKING_APPROVAL_VALUE, ADA_HDS_BOOKING_ASSESSED: '1',
    // guardians policy (DPO)
    ADA_AGE_POLICY_JSON: JSON.stringify({ status: 'CONFIGURED', guardianVerification: { strongMethods: ['PROFESSIONAL_ATTESTATION'], scopes: [] } }),
    // jobs
    ADA_BETA_OPEN_JOBS: OPENABLE_JOBS.join(','), ADA_JOBS_APPROVED: C_JOBS.join(','),
    GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version, GDPR_PURGE_APPROVED_STEPS: 'deletedTokensCount',
    // providers
    MAILER_PROVIDER: profile === 'production' ? 'mailjet' : 'test', MAILER_FROM: 'ne-pas-repondre@example.test',
    MAILER_API_KEY: `${SYNTHETIC}-public:${SYNTHETIC}-${rnd(8)}`,
    TWILIO_SID: `AC${SYNTHETIC}`, TWILIO_AUTH_TOKEN: `${SYNTHETIC}-${rnd(8)}`, TWILIO_FROM: '+33000000000', SMS_INBOUND_URL: `${base.replace(/^http:/, 'https:')}/api/monitor/sms-inbound/twilio`,
    WEB_PUSH_VAPID_PUBLIC_KEY: v.pub, WEB_PUSH_VAPID_PRIVATE_KEY: v.priv, WEB_PUSH_SUBJECT: 'mailto:ne-pas-repondre@example.test',
    OUTLOOK_ENABLED: 'true', CALENDAR_PRODUCTION_APPROVED: 'true', OUTLOOK_CLIENT_ID: `${SYNTHETIC}-client`, OUTLOOK_CLIENT_SECRET: `${SYNTHETIC}-${rnd(8)}`,
    OUTLOOK_REDIRECT_URI: `${base}/api/auth/callback/outlook`,
    VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'video.example.test', VIDEO_JITSI_APP_ID: `${SYNTHETIC}-app`, VIDEO_JITSI_SECRET: `${SYNTHETIC}-${rnd(16)}`,
    VIDEO_PRODUCTION_APPROVED: 'true',
    FRANCECONNECT_ISSUER: m.fc, FRANCECONNECT_CLIENT_ID: `${SYNTHETIC}-fc`, FRANCECONNECT_CLIENT_SECRET: `${SYNTHETIC}-${rnd(8)}`,
    FRANCECONNECT_REDIRECT_URI: `${base}/api/auth/franceconnect/callback`, FRANCECONNECT_PRODUCTION_APPROVED: 'true',
    PROCONNECT_ENABLED: 'true', PROCONNECT_ISSUER: m.pc, PROCONNECT_CLIENT_ID: `${SYNTHETIC}-pc`, PROCONNECT_CLIENT_SECRET: `${SYNTHETIC}-${rnd(8)}`,
    PROCONNECT_REDIRECT_URI: `${base}/api/pro/auth/proconnect/callback`,
    OPENFISCA_URL: m.openfisca, AIDES_TERRITOIRES_API_KEY: `${SYNTHETIC}-${rnd(8)}`,
    SENTRY_DSN: `https://${rnd(8)}@o0.ingest.de.sentry.io/0`, ALERT_WEBHOOK_URL: m.alert,
    OPEN_DATA_EXPORT_ENABLED: 'true',
    // object storage of message attachments (api/_services/message-attachments.js uses api/lib/storage.js directly, not the ProtectedStore)
    STORAGE_ENDPOINT: 'https://storage.example.test', STORAGE_BUCKET: 'synthetic-test-only', STORAGE_ACCESS_KEY_ID: `${SYNTHETIC}-id`, STORAGE_SECRET_ACCESS_KEY: `${SYNTHETIC}-${rnd(8)}`,
    // legal publisher identity (build-time, src/config/legal-documents.js)
    ...Object.fromEntries(LEGAL_IDENTITY_VARS.map((n) => [n, `${SYNTHETIC} ${n.slice('VITE_LEGAL_'.length).toLowerCase()}`])),
    // legal drafts approved (build-time), as « id@version »
    VITE_LEGAL_DOCS_APPROVED_VERSION: legalVersions(),
  };
  for (const k of Object.keys(env)) if (env[k] === '') delete env[k];
  return env;
}

// ───────────────────────────── items ─────────────────────────────

/** @param {Record<string, string | undefined>} env */
const viteOpen = (env) => String(env.VITE_PUBLIC_BETA_OPEN_SURFACES || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const viteSub = (env) => ({ accountsScope: String(env.VITE_PUBLIC_BETA_ACCOUNTS_SCOPE || '').trim().toLowerCase() === 'full' ? 'full' : 'booking',
  proSelfRegistration: String(env.VITE_PUBLIC_BETA_PRO_SELF_REGISTRATION || '').trim().toLowerCase() === 'open' });
const screenClosed = (env, screen) => String(env.VITE_PUBLIC_BETA || '') === 'true' && isBetaRestrictedPath(screen, viteOpen(env), viteSub(env));
const ok = { open: true, code: null };
const no = (code) => ({ open: false, code });
const tok = (name, token) => ({ name, token });
const eqv = (name, why) => ({ name, why });

/**
 * other (non-environment) prerequisites: type ∈ owner_decision | legal_approval | partner | hds | human_review | migration | code_record | provider_account | operator
 * @typedef {{ type: string, what: string, ref: string }} Other
 * @typedef {{ id: string, kind: string, label: string, features: string[], env: { name: string, token?: string, why?: string }[], requires?: string[], other?: Other[],
 *   rollback: string, probe: (env: any) => { open: boolean, code: string | null }, finalExpected?: 'open' | 'closed', note?: string }} Item
 */

/** route / screen of each surface used by its probe */
const SURFACE_PROBES = {
  accounts: { route: 'citizen/espace', method: 'GET', screen: '/compte', features: ['C01', 'C02', 'C04', 'C13', 'C21', 'C22', 'N03'] },
  pro: { route: 'pro/me', method: 'GET', screen: '/pro', features: ['R01', 'R03', 'R19', 'R20', 'E01', 'E02', 'E03', 'E07'] },
  institution: { route: 'institution/me', method: 'GET', screen: '/institution', features: ['I01', 'I02', 'I03', 'I04'] },
  appointments: { route: 'rdv/structures/x/services', method: 'GET', screen: '/rdv', features: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B08', 'B09', 'B11', 'B12', 'C19'] },
  video: { route: 'pro/appointments/visio', method: 'POST', screen: null, features: ['B07', 'N06'] },
  communications: { route: 'contact', method: 'POST', screen: '/contact', features: ['P19', 'P20', 'C18', 'R14', 'A11'] },
  documents: { route: 'citizen/coffre', method: 'GET', screen: '/share', features: ['C09', 'C14', 'C15', 'C16', 'C17', 'R13'] },
  diagnostic: { route: 'diagnostic', method: 'POST', screen: '/diagnostic', features: ['P13', 'P16', 'P17', 'D10', 'D20'] },
  admin: { route: 'admin/provider-status', method: 'GET', screen: '/admin', features: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A12', 'A13', 'A14', 'A15', 'A16', 'A19', 'M04'] },
};
const SURFACE_OTHER = {
  accounts: [
    { type: 'owner_decision', what: 'D1-P, D2–D6 : bases légales et durées (dont A7 : 1 an ou 2 ans)', ref: 'CONTROL/r44/R44_DECISIONS_RGPD_D1_D6_FR_v2.md' },
    { type: 'owner_decision', what: 'AIPD signée (options S1, A8, A9)', ref: 'CONTROL/r45 paquet décisions § 3' },
    { type: 'legal_approval', what: 'CGU citoyen et notice de confidentialité approuvées (VITE_LEGAL_DOCS_APPROVED_VERSION, au build)', ref: 'src/config/legal-drafts.js' },
    { type: 'operator', what: 'rotation des secrets A1–A8 avant ouverture', ref: 'CONTROL/r45/R45_SECRET_ROTATION_EXECUTION_PLAN_FR.md' },
  ],
  pro: [{ type: 'partner', what: 'structure partenaire signée (art. 26/28) et professionnels invités (le Pro s’ouvre par invitation)', ref: 'scripts/pro-superadmin-bootstrap.mjs' },
    { type: 'legal_approval', what: 'CGU professionnel et conditions structures approuvées', ref: 'src/config/legal-drafts.js' }],
  institution: [{ type: 'partner', what: 'convention institution signée (PartnerAgreement SIGNED) et comptes créés par un administrateur élevé', ref: 'api/_services/institutions.js' },
    { type: 'owner_decision', what: 'extension de l’AIPD à l’espace institution (capability institution.portal)', ref: 'api/_utils/capabilities.js' }],
  appointments: [{ type: 'migration', what: `${NOTICE_MIGRATION} (accord du propriétaire) : sans elle les avis BOOKED_BY_CITIZEN / REQUEST_* sont envoyés mais NI enregistrés au registre NI visibles dans le centre de notifications`, ref: 'api/_services/appointment-notices.js recordNotice; api/_services/citizen-inbox.js' },
    { type: 'partner', what: 'structure partenaire avec services, horaires et classement de chaque service', ref: 'api/_handlers/admin/service-sensitivity.js' },
    { type: 'operator', what: 'les personnes se connectent par « accounts » ; fermer « accounts » (retour arrière) arrête aussi les actions de rendez-vous des sessions déjà ouvertes (constat R47 F1 corrigé)', ref: 'e2e-r47/activation/run.mjs accounts_closed_session_refused' },
    { type: 'human_review', what: 'classement « ordinaire / sensible » de CHAQUE service par un administrateur (non classé = refus SERVICE_SENSITIVITY_UNREVIEWED en Production)', ref: 'api/lib/service-sensitivity.js' }],
  video: [{ type: 'provider_account', what: 'compte Jitsi/JaaS hébergé UE + DPA', ref: 'api/lib/video-provider.js' }, { type: 'owner_decision', what: 'AIPD visio (capability video)', ref: 'api/_utils/capabilities.js' }],
  communications: [{ type: 'owner_decision', what: 'modération et réponse aux messages (personne désignée)', ref: 'R46 activation plan § 6.4' }],
  documents: [{ type: 'hds', what: 'contrat avec un hébergeur certifié HDS (le jeton n’est qu’une déclaration)', ref: 'api/lib/protected-store/CONTRACT.md' },
    { type: 'owner_decision', what: 'extension de l’AIPD (coffre, dossiers partagés)', ref: 'api/_utils/capabilities.js' }],
  diagnostic: [{ type: 'owner_decision', what: 'extension de l’AIPD au questionnaire / assistant', ref: 'api/_utils/capabilities.js' },
    { type: 'human_review', what: 'expert D11 : aucune règle n’est validée (le résultat reste indicatif)', ref: 'docs/rules/D11_PROCEDURE_VALIDATION_EXPERTE.md' }],
  admin: [{ type: 'operator', what: 'comptes administrateurs nominatifs avec MFA (pas de jeton hérité)', ref: 'scripts/admin-bootstrap.mjs' }],
};
const SURFACE_REQUIRES = { accounts: ['provider.mail'], pro: ['provider.mail'], institution: ['capability.institution.portal'], appointments: ['provider.mail'],
  communications: ['provider.mail', 'storage.object'], documents: ['capability.citizen.vault', 'protected_store'], video: ['capability.video'] };

/** @returns {Item[]} */
export function buildItems() {
  /** @type {Item[]} */
  const items = [];
  for (const s of OPENABLE_SURFACES) {
    const p = SURFACE_PROBES[s];
    items.push({ id: `surface.${s}`, kind: 'surface', label: `Surface « ${s} »`, features: p.features,
      env: [tok('ADA_BETA_OPEN_SURFACES', s), ...(p.screen ? [tok('VITE_PUBLIC_BETA_OPEN_SURFACES', s)] : [])],
      requires: SURFACE_REQUIRES[s] || [], other: SURFACE_OTHER[s] || [],
      rollback: `retirer « ${s} » de ADA_BETA_OPEN_SURFACES (effet immédiat côté API ; l’écran se referme au build suivant sans VITE_PUBLIC_BETA_OPEN_SURFACES)`,
      probe: (env) => {
        if (!isAllowedInPublicBeta(p.method, p.route, env)) return no('PUBLIC_BETA_RESTRICTED');
        if (p.screen && screenClosed(env, p.screen)) return no('SCREEN_BETA_NOTICE');
        return ok;
      } });
  }
  items.push({ id: 'surface.accounts_full', kind: 'surface', label: 'Comptes : périmètre complet (foyer, tuteurs, push, parcours, favoris…)', features: ['C03', 'C05', 'C07', 'C08', 'C10', 'C11', 'C23', 'N04'],
    env: [tok('ADA_BETA_OPEN_SURFACES', 'accounts'), eqv('ADA_BETA_ACCOUNTS_SCOPE', 'full'), eqv('VITE_PUBLIC_BETA_ACCOUNTS_SCOPE', 'full')], requires: ['surface.accounts'],
    rollback: 'retirer ADA_BETA_ACCOUNTS_SCOPE (retour au périmètre étroit)',
    probe: (env) => (!isAllowedInPublicBeta('GET', 'citizen/parcours', env) ? no('ACCOUNTS_SCOPE_NARROW') : screenClosed(env, '/compte/parcours') ? no('SCREEN_BETA_NOTICE') : ok) });
  items.push({ id: 'surface.jobs', kind: 'surface', label: 'Surface « jobs » (jamais ouvrable en bloc)', features: [], env: [], rollback: '—', finalExpected: 'closed',
    note: 'NOT_OPENABLE : les tâches s’ouvrent une à une (ADA_BETA_OPEN_JOBS)', probe: (env) => (openSurfaces({ ...env, ADA_BETA_OPEN_SURFACES: 'jobs' }).has('jobs') ? ok : no('NOT_OPENABLE')) });

  // capabilities (every entry of CAPABILITIES, derived)
  const CAP_REQUIRES = { 'citizen.push': ['provider.push'], 'calendar.outlook': ['provider.outlook'], video: ['provider.video'], 'citizen.franceconnect': ['provider.franceconnect'],
    'citizen.vault': ['protected_store'], 'citizen.shared_dossier': ['protected_store'], 'citizen.guardians': ['policy.guardians'] };
  const CAP_FEATURES = { 'citizen.account': ['C01', 'C02', 'C13', 'C21'], 'citizen.booking': ['B02', 'B03', 'B04', 'B05', 'C19'], 'citizen.booking_message': ['C18'], 'citizen.push': ['N04'],
    'pro.account': ['R01', 'R20'], 'pro.structure_admin': ['E01', 'E02', 'E03', 'E07'], 'pro.agenda': ['B08', 'B09', 'B11', 'B12'], 'pro.platform_ops': ['A17'], 'calendar.outlook': ['B10'],
    'citizen.household': ['C03'], 'citizen.guardians': ['C05'], 'citizen.parcours': ['C07', 'C08'], 'citizen.favorites': ['C10'], 'citizen.history': ['C11'],
    'citizen.franceconnect': ['C26', 'N08'], 'citizen.delegations': ['C23'], 'citizen.orientation_records': ['R09', 'R10'], 'citizen.vault': ['C09'],
    'citizen.shared_dossier': ['C14', 'C15', 'C16', 'C17', 'R13', 'R15'], 'citizen.saved_diagnostic': ['C12'], 'diagnostic.questionnaire': ['P13', 'D10', 'D20'],
    'pro.case_management': ['R03', 'R05', 'R06', 'R07', 'R08', 'R11', 'R12'], 'pro.referrals': ['R09', 'R10', 'E06'], 'pro.orientation_selections': ['R18'], 'pro.siao_interop': ['R22'],
    'ai.processing': ['P17', 'D17', 'D18', 'R17', 'R23', 'P18'], 'institution.portal': ['I01', 'I02', 'I03', 'I04'], video: ['B07', 'N06'], 'citizen.minor_accounts': [] };
  for (const [name, cap] of Object.entries(CAPABILITIES)) {
    const env = [tok('ADA_BETA_OPEN_SURFACES', cap.surface)];
    if (cap.accountsFull) env.push(eqv('ADA_BETA_ACCOUNTS_SCOPE', 'full'));
    if (cap.aipd === 'out') env.push(tok('ADA_CAPABILITIES_OPEN', name));
    if (cap.requiresHds) env.push(eqv('ADA_HDS_CERTIFIED_HOSTING', 'jeton HDS1 valide et non expiré'));
    /** @type {Other[]} */
    const other = [];
    if (cap.aipd === 'out') other.push({ type: 'owner_decision', what: `extension de l’AIPD (${cap.aipdRef})`, ref: 'api/_utils/capabilities.js' });
    if (cap.requiresHds) other.push({ type: 'hds', what: `hébergement certifié HDS — ${cap.hdsNote || ''}`.trim(), ref: 'CONTROL/r45/R45_HDS_FEATURE_MATRIX_FR.md' });
    if (cap.hdsDependsOnStructure) other.push({ type: 'human_review', what: 'classement ESSMS / NOT_ESSMS revu de chaque structure (inconnu = HDS exigé)', ref: 'api/_utils/capabilities.js hdsDependsOnStructure' });
    if (name === 'pro.siao_interop') other.push({ type: 'partner', what: 'spécification et convention SI-SIAO ; adaptateur réel à écrire (aujourd’hui fiche de transmission manuelle)', ref: 'api/_handlers/pro/interop-siao.js' });
    if (name === 'ai.processing') other.push({ type: 'code_record', what: 'aucun modèle local joignable sur Vercel (OLLAMA_BASE_URL doit être en boucle locale) : un fournisseur d’IA approuvé (DPIA, DPA) demande une modification du code', ref: 'api/lib/ai-foundation.js' },
      { type: 'human_review', what: 'revue de sécurité du jeu d’évaluation de l’IA', ref: 'scripts/ai-eval.mjs' });
    if (name === 'citizen.franceconnect') other.push({ type: 'provider_account', what: 'habilitation DataPass FranceConnect', ref: 'api/lib/franceconnect/oidc-client.js' });
    items.push({ id: `capability.${name}`, kind: 'capability', label: cap.description, features: CAP_FEATURES[name] || [], env, requires: CAP_REQUIRES[name] || [], other,
      finalExpected: cap.openable === false ? 'closed' : 'open', note: cap.openable === false ? 'NOT_OPENABLE : aucun interrupteur (politique d’âge)' : undefined,
      rollback: cap.aipd === 'out' ? `retirer « ${name} » de ADA_CAPABILITIES_OPEN` : `fermer la surface « ${cap.surface} »`,
      probe: (e) => { const s = capabilityState(name, e); return s.open ? ok : no(s.reason); } });
  }

  // art. 9 booking and the per-service review rule
  items.push({ id: 'booking.sensitive', kind: 'gate', label: 'Réservation d’un service sensible (art. 9 RGPD) avec consentement explicite', features: ['B01', 'B03'],
    env: [eqv('ADA_SENSITIVE_BOOKING_APPROVED', SENSITIVE_BOOKING_APPROVAL_VALUE), eqv('ADA_HDS_BOOKING_ASSESSED', '1')], requires: ['surface.appointments', 'capability.citizen.booking'],
    other: [{ type: 'legal_approval', what: `texte du consentement explicite (version ${SENSITIVE_BOOKING_CONSENT_VERSION}, BROUILLON) confirmé par le responsable / conseil`, ref: 'api/lib/service-sensitivity.js' },
      { type: 'owner_decision', what: 'évaluation HDS de la réservation (ADA_HDS_BOOKING_ASSESSED=1 = décision enregistrée)', ref: 'CONTROL/r45/R45_HDS_FEATURE_MATRIX_FR.md' },
      { type: 'human_review', what: 'service classé « sensible » par un administrateur', ref: 'api/_handlers/admin/service-sensitivity.js' }],
    rollback: 'retirer ADA_SENSITIVE_BOOKING_APPROVED (refus SENSITIVE_BOOKING_NOT_OPEN immédiat)',
    probe: (e) => { const d = bookingDecision('sensitive', e); return d.allowed ? ok : no(d.code); } });
  items.push({ id: 'booking.unreviewed_service', kind: 'rule', label: 'Service non classé (inconnu)', features: ['B01'], env: [], finalExpected: 'closed', rollback: '—',
    note: 'refusé partout où la revue est imposée (Production, Preview, bêta) : seul le classement par un administrateur l’ouvre', other: [{ type: 'human_review', what: 'classer le service', ref: 'api/lib/service-sensitivity.js' }],
    probe: (e) => { const d = bookingDecision('unknown', e); return d.allowed ? ok : no(d.code); } });

  // ProtectedStore, guardians policy
  items.push({ id: 'protected_store', kind: 'gate', label: 'ProtectedStore (coffre, fichiers des dossiers partagés)', features: ['C09', 'C14', 'C17', 'R13'],
    env: [eqv('ADA_PROTECTED_STORE', 'certified'), eqv('ADA_PROTECTED_STORE_ENDPOINT', 'https://<hébergeur HDS>'), eqv('ADA_PROTECTED_STORE_TOKEN', '≥ 32 caractères'), eqv('ADA_HDS_CERTIFIED_HOSTING', 'jeton HDS1')],
    other: [{ type: 'hds', what: 'hébergeur certifié implémentant api/lib/protected-store/CONTRACT.md', ref: 'api/lib/protected-store/CONTRACT.md' }],
    rollback: 'retirer ADA_HDS_CERTIFIED_HOSTING (PROTECTED_STORE_REFUSED immédiat ; l’effacement reste possible)',
    probe: (e) => { const s = protectedStoreState(e); return s.ok ? ok : no(s.reason); } });
  items.push({ id: 'policy.guardians', kind: 'gate', label: 'Politique de vérification renforcée des représentants légaux (DPO)', features: ['C05'],
    env: [eqv('ADA_AGE_POLICY_JSON', '{"status":"CONFIGURED","guardianVerification":{"strongMethods":[…]}}')],
    other: [{ type: 'owner_decision', what: 'méthodes de vérification forte choisies par le DPO', ref: 'api/_services/guardianship.js' }],
    rollback: 'retirer ADA_AGE_POLICY_JSON (POLICY_PENDING)', probe: (e) => (loadGuardianPolicy(e).configured && loadGuardianPolicy(e).strongMethods.length ? ok : no('POLICY_PENDING')) });

  // scheduled jobs (SCHEDULED_JOBS, derived)
  const JOB_REQUIRES = { 'rdv-reminder': ['provider.mail', 'surface.appointments'], 'parcours-reminder': ['provider.mail'], 'referral-timeouts': ['provider.mail'],
    'health-alert': ['provider.alert'], 'ingest-aids': ['provider.aides-territoires'] };
  const JOB_FEATURES = { veille: ['D04', 'D07', 'D14'], actualites: ['P10'], 'health-alert': ['Q07'], 'ingest-structures': ['D05'], 'ingest-aids': ['D08'], 'parcours-reminder': ['C08'],
    'referral-timeouts': ['R10'], 'rdv-reminder': ['B06'], 'gdpr-purge': ['Q03', 'A12'] };
  const vercelCrons = (() => { try { return new Set((JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'vercel.json'), 'utf8')).crons || []).map((c) => c.path)); } catch { return new Set(); } })();
  for (const [job, cat] of Object.entries(SCHEDULED_JOBS)) {
    const env = cat === 'D' ? [] : [tok('ADA_BETA_OPEN_JOBS', job), ...(cat === 'C' ? [tok('ADA_JOBS_APPROVED', job)] : []), eqv('CRON_SECRET', '≥ 24 caractères')];
    /** @type {Other[]} */
    const other = [];
    if (cat === 'C') other.push({ type: 'owner_decision', what: 'approbation enregistrée de la tâche (base légale, durée, fournisseur d’e-mail en service)', ref: 'api/_utils/public-beta.js SCHEDULED_JOBS' });
    if (cat !== 'D' && !vercelCrons.has(`/api/cron/${job}`)) other.push({ type: 'code_record', what: `aucune planification dans vercel.json pour /api/cron/${job} (ajout = modification de configuration)`, ref: 'vercel.json' });
    if (job === 'gdpr-purge') {
      env.push(eqv('GDPR_PURGE_ENABLED', 'true'), eqv('GDPR_PURGE_POLICY_VERSION', RETENTION_POLICY.version), eqv('GDPR_PURGE_APPROVED_STEPS', 'liste d’étapes'));
      other.push({ type: 'code_record', what: `RETENTION_POLICY statut « ${RETENTION_POLICY.status} » : l’approbation (status APPROVED, approvedPolicyVersion, choix A7 dans la version, approvedSteps avec date de revue du dry-run et sauvegarde vérifiée) s’enregistre DANS LE CODE — aucune variable ne l’ouvre`, ref: 'api/_services/retention-policy.js' });
    }
    items.push({ id: `job.${job}`, kind: 'job', label: `Tâche planifiée ${job} (catégorie ${cat})`, features: JOB_FEATURES[job] || [], env, requires: JOB_REQUIRES[job] || [], other,
      finalExpected: cat === 'D' || job === 'gdpr-purge' ? 'closed' : 'open', note: cat === 'D' ? 'LEGACY_CLOSED : remplacée par la veille, jamais ouvrable' : job === 'gdpr-purge' ? 'politique approuvée (phase 1) ; aucune étape n’exécute tant que son propre enregistrement d’approbation n’est pas dans le code (6c : après la phase 4)' : undefined,
      rollback: `retirer « ${job} » de ADA_BETA_OPEN_JOBS`,
      probe: (e) => {
        if (!isAllowedInPublicBeta('POST', `cron/${job}`, e)) return no(cat === 'D' ? 'LEGACY_CLOSED' : cat === 'C' && String(e.ADA_BETA_OPEN_JOBS || '').includes(job) ? 'AWAITING_APPROVAL' : 'JOB_CLOSED');
        if (String(e.CRON_SECRET || '').length < 24) return no('CRON_SECRET_MISSING');
        if (job === 'gdpr-purge') {
          const g = executionGate(RETENTION_POLICY, e); if (!g.execute) return no(g.reason);
          // V2 phase 1: the policy is approved, but a step executes only with its OWN approval record in the policy (none yet)
          return [...g.approvedSteps].some((id) => !stepApprovalProblem(RETENTION_POLICY, { id })) ? ok : no('STEP_NOT_APPROVED_IN_POLICY');
        }
        return ok;
      } });
  }

  // providers (provider-status.js rows, derived), plus the STOP webhook and the alert channel
  const PROVIDER_ENV = {
    mail: ['MAILER_PROVIDER', 'MAILER_FROM', 'MAILER_API_KEY'], sms: ['TWILIO_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'], push: ['WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_SUBJECT'],
    outlook: ['OUTLOOK_ENABLED', 'OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_REDIRECT_URI', 'ADA_VAULT_KEY', 'CALENDAR_PRODUCTION_APPROVED'],
    video: ['VIDEO_PROVIDER', 'VIDEO_JITSI_DOMAIN', 'VIDEO_JITSI_APP_ID', 'VIDEO_JITSI_SECRET', 'VIDEO_PRODUCTION_APPROVED'],
    openfisca: ['OPENFISCA_URL'], 'aides-territoires': ['AIDES_TERRITOIRES_API_KEY'],
    franceconnect: ['FRANCECONNECT_ISSUER', 'FRANCECONNECT_CLIENT_ID', 'FRANCECONNECT_CLIENT_SECRET', 'FRANCECONNECT_PRODUCTION_APPROVED'],
    proconnect: ['PROCONNECT_ENABLED', 'PROCONNECT_ISSUER', 'PROCONNECT_CLIENT_ID', 'PROCONNECT_CLIENT_SECRET', 'PROCONNECT_REDIRECT_URI'], sentry: ['SENTRY_DSN'],
  };
  const PROVIDER_OTHER = {
    mail: [{ type: 'provider_account', what: 'Mailjet : domaine, DKIM, sous-clé, DPA', ref: 'scripts/mail-provider-check.mjs' }],
    sms: [{ type: 'provider_account', what: 'Twilio : compte, numéro, DPA', ref: 'api/_utils/twilio-sms.js' }],
    push: [{ type: 'operator', what: 'clés VAPID générées par l’opérateur (scripts/web-push-keys.mjs)', ref: 'api/_services/web-push.js' }],
    outlook: [{ type: 'provider_account', what: 'inscription d’application Microsoft (Calendars.ReadBasic), avis DPO', ref: 'scripts/release-preflight.mjs outlookCheck' }],
    video: [{ type: 'provider_account', what: 'Jitsi/JaaS UE', ref: 'api/lib/video-provider.js' }],
    openfisca: [{ type: 'operator', what: 'instance OpenFisca épinglée (176.1.6) hébergée hors prototype public', ref: 'scripts/openfisca-local.sh' }, { type: 'human_review', what: 'aucune règle D11 validée par un expert', ref: 'data/rules/rights-rules.v1.json' }],
    'aides-territoires': [{ type: 'provider_account', what: 'clé Aides-territoires et conditions acceptées', ref: 'api/lib/ingestion/AidesTerritoiresConnector.js' }],
    franceconnect: [{ type: 'provider_account', what: 'DataPass + identifiants de production', ref: 'api/lib/franceconnect/oidc-client.js' }],
    proconnect: [{ type: 'provider_account', what: 'inscription du service ProConnect', ref: 'api/lib/proconnect-oidc.js' }],
    sentry: [{ type: 'provider_account', what: 'projet Sentry région UE + DPA (facultatif)', ref: 'scripts/obs-smoke.mjs' }],
  };
  const PROVIDER_FEATURES = { mail: ['N01'], sms: ['N02'], push: ['N04'], outlook: ['B10'], video: ['N06', 'B07'], openfisca: ['D10'], 'aides-territoires': ['D08'], franceconnect: ['N08', 'C26'],
    proconnect: ['N09', 'R02'], sentry: ['N10'] };
  for (const id of Object.keys(PROVIDER_ENV)) {
    items.push({ id: `provider.${id}`, kind: 'provider', label: `Fournisseur ${id}`, features: PROVIDER_FEATURES[id] || [], env: PROVIDER_ENV[id].map((n) => eqv(n)), other: PROVIDER_OTHER[id] || [],
      rollback: id === 'mail' ? 'MAILER_PROVIDER=noop' : `retirer ${PROVIDER_ENV[id][0]}`,
      probe: (e) => {
        const row = providerStatuses(e).find((r) => r.id === id);
        if (!row || row.state !== 'CONNECTED') return no(row ? row.reasonCode : 'UNKNOWN_PROVIDER');
        if (id === 'outlook') { const [st, d] = outlookCheck(e, { get: (k) => String(e[k] ?? '').trim(), betaOn: true, opened: openSurfaces(e) }); if (st !== 'PASS') return no(`OUTLOOK_PREFLIGHT: ${d.slice(0, 60)}`); }
        return ok;
      } });
  }
  items.push({ id: 'provider.sms_stop', kind: 'provider', label: 'Webhook SMS entrant (STOP)', features: ['N02'], env: [eqv('SMS_INBOUND_URL', 'https://…/api/monitor/sms-inbound/twilio'), eqv('TWILIO_AUTH_TOKEN')],
    requires: ['provider.sms'], rollback: 'retirer SMS_INBOUND_URL', probe: (e) => (isSmsInboundRequest('POST', 'monitor/sms-inbound/twilio', e) ? ok : no('SMS_INBOUND_CLOSED')) });
  items.push({ id: 'provider.alert', kind: 'provider', label: 'Canal d’alerte opérationnelle', features: ['Q07'], env: [eqv('ALERT_WEBHOOK_URL', 'https://… (ou ALERT_EMAIL avec un vrai fournisseur d’e-mail)')],
    other: [{ type: 'operator', what: 'choisir le canal et la personne qui reçoit les alertes', ref: 'api/_handlers/cron/health-alert.js' }], rollback: 'retirer ALERT_WEBHOOK_URL',
    probe: (e) => (/^https:\/\//.test(String(e.ALERT_WEBHOOK_URL || '')) || (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e.ALERT_EMAIL || '')) && ['resend', 'mailjet', 'msgraph'].includes(String(e.MAILER_PROVIDER || '').toLowerCase())) ? ok : no('ALERT_CHANNEL_MISSING')) });
  items.push({ id: 'institution.export', kind: 'gate', label: 'Export statistique territorial (CSV)', features: ['I03'], env: [eqv('OPEN_DATA_EXPORT_ENABLED', 'true')], requires: ['surface.institution'],
    other: [{ type: 'owner_decision', what: 'licence des données exportées (aujourd’hui PENDING_OWNER_DECISION)', ref: 'api/_services/territorial-stats.js' }], rollback: 'retirer OPEN_DATA_EXPORT_ENABLED (ou forcer OFF par admin/platform)',
    probe: (e) => (String(e.OPEN_DATA_EXPORT_ENABLED || '') === 'true' ? ok : no('EXPORT_NOT_OPEN')) });

  items.push({ id: 'storage.object', kind: 'provider', label: 'Stockage objet UE (pièces jointes des messages)', features: ['C18', 'R14'],
    env: ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'].map((n) => eqv(n)),
    other: [{ type: 'provider_account', what: 'compartiment S3 compatible en UE sous DPA (le contrôle de mise en production l’exige aussi pour « documents »)', ref: 'scripts/release-preflight.mjs storage.configured' }],
    rollback: 'retirer STORAGE_ENDPOINT', probe: (e) => (['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'].every((k) => String(e[k] || '').trim()) ? ok : no('STORAGE_NOT_CONFIGURED')) });
  items.push({ id: 'legal.publisher', kind: 'legal', label: 'Identité de l’éditeur et du responsable (mentions légales, LCEN / RGPD art. 13)', features: ['P21'],
    env: LEGAL_IDENTITY_VARS.map((n) => eqv(n)), other: [{ type: 'owner_decision', what: 'option A-I ou A-II (VITE_LEGAL_PUBLISHER_MODE) après avis écrit', ref: 'R45_PAQUET_DECISIONS_PROPRIETAIRE_FR.md § 1' }],
    rollback: 'retirer les variables et reconstruire (les pages gardent « [À COMPLÉTER] » et le contrôle de mise en production échoue)',
    probe: (e) => (LEGAL_IDENTITY_VARS.every((n) => String(e[n] || '').trim()) ? ok : no('LEGAL_PUBLISHER_INCOMPLETE')) });
  // legal drafts (build-time approval)
  for (const d of LEGAL_DRAFT_DOCUMENTS) {
    items.push({ id: `legal.${d.id}`, kind: 'legal', label: `Document juridique ${d.id} (${d.path})`, features: ['P21', 'Q03'], env: [tok('VITE_LEGAL_DOCS_APPROVED_VERSION', `${d.id}@${d.version}`)],
      other: [{ type: 'legal_approval', what: `approbation par le propriétaire de la version ${d.version} (statut ${d.status})`, ref: 'src/config/legal-drafts.js' }],
      rollback: 'retirer la version de VITE_LEGAL_DOCS_APPROVED_VERSION et reconstruire', probe: (e) => (draftVisibility(d, { approved: e.VITE_LEGAL_DOCS_APPROVED_VERSION, production: true }) === 'IN_FORCE' ? ok : no('LEGAL_DRAFT_HIDDEN')) });
  }
  return items;
}

// ───────────────────────────── evaluation ─────────────────────────────

/** remove one prerequisite from a copy of env @param {Record<string, string>} env @param {{ name: string, token?: string }} p */
export function without(env, p) {
  const e = { ...env };
  if (p.token) e[p.name] = String(e[p.name] || '').split(',').map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== p.token.toLowerCase()).join(',');
  else delete e[p.name];
  if (e[p.name] === '') delete e[p.name];
  return e;
}

/** evaluate an item and its dependencies @param {Item} item @param {Record<string, string>} env @param {Map<string, Item>} byId */
export function evaluate(item, env, byId, seen = new Set()) {
  if (seen.has(item.id)) return ok;
  seen.add(item.id);
  const own = item.probe(env);
  if (!own.open) return { open: false, code: own.code, at: item.id };
  for (const r of item.requires || []) {
    const dep = byId.get(r); if (!dep) return { open: false, code: `UNKNOWN_DEPENDENCY:${r}`, at: item.id };
    const d = evaluate(dep, env, byId, seen);
    if (!d.open) return { open: false, code: d.code, at: d.at };
  }
  return { open: true, code: null, at: null };
}

/** all env prerequisites of an item including its dependencies (deduplicated) */
function envClosure(item, byId, seen = new Set()) {
  if (seen.has(item.id)) return [];
  seen.add(item.id);
  return [...item.env, ...(item.requires || []).flatMap((r) => (byId.get(r) ? envClosure(byId.get(r), byId, seen) : []))]
    .filter((p, i, a) => a.findIndex((q) => q.name === p.name && q.token === p.token) === i);
}

/** run the whole simulation @param {{ env?: Record<string, string> }} [opts] */
export function simulate(opts = {}) {
  const env = opts.env || finalConfig({ profile: 'production' });
  const items = buildItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const results = items.map((item) => {
    const final = evaluate(item, env, byId);
    const expected = item.finalExpected || 'open';
    const removals = expected === 'open' ? envClosure(item, byId).map((p) => {
      const r = evaluate(item, without(env, p), byId);
      return { removed: p.token ? `${p.name} ∌ ${p.token}` : p.name, closed: !r.open, code: r.code, at: r.at };
    }) : [];
    return { id: item.id, kind: item.kind, label: item.label, features: item.features, expected, final: { open: final.open, code: final.code, at: final.at },
      passed: (expected === 'open') === final.open && removals.every((x) => x.closed),
      env: item.env.map((p) => ({ name: p.name, value: p.token || p.why || null })), requires: item.requires || [], other: item.other || [], rollback: item.rollback, note: item.note || null, removals };
  });
  // the gdpr-purge env part, proved against a synthetic APPROVED policy record (the shipped one is PROPOSED)
  // (a synthetic record of the controller's decision: A7 chosen and named in the version, as retention-policy.js requires; the deployment pins that version)
  const approvedVersion = `${RETENTION_POLICY.version}-a7-365d`;
  const approvedPolicy = { ...RETENTION_POLICY, version: approvedVersion, status: POLICY_STATUS_APPROVED, approvedPolicyVersion: approvedVersion, approvedChoices: { A7: 365 } };
  const pinned = { ...env, GDPR_PURGE_POLICY_VERSION: approvedVersion };
  const purgeEnv = executionGate(approvedPolicy, pinned);
  const purgeMinus = ['GDPR_PURGE_ENABLED', 'GDPR_PURGE_POLICY_VERSION', 'GDPR_PURGE_APPROVED_STEPS'].map((n) => ({ removed: n, ...executionGate(approvedPolicy, without(pinned, { name: n })) }));
  // the legal pages are built from the VITE_LEGAL_* of the build: give the gate the text this configuration would produce
  const legalText = LEGAL_IDENTITY_VARS.map((n) => env[n] || '[À COMPLÉTER]').join(' ');
  const preflight = evaluateReleasePreflight(env, { legalText }).filter((c) => c.status !== 'PASS').map((c) => ({ id: c.id, status: c.status, detail: c.detail }));
  return {
    generatedAt: new Date().toISOString(), basis: 'code (api/_utils/public-beta.js, api/_utils/capabilities.js, api/lib/service-sensitivity.js, api/lib/protected-store, api/_services/provider-status.js, api/_services/retention-policy.js, src/lib/publicBeta.js, src/config/legal-drafts.js, scripts/release-preflight.mjs)',
    evaluatedAs: 'VERCEL_ENV=production, ADA_PUBLIC_BETA_RESTRICTED=1, ADA_CAPABILITY_ENFORCEMENT=1, ADA_SENSITIVITY_REVIEW_ENFORCED=1; synthetic fixtures only',
    hdsTokenValid: hdsAttestation(env).valid,
    summary: { items: results.length, passed: results.filter((r) => r.passed).length, openInFinal: results.filter((r) => r.final.open).length,
      closedByDesign: results.filter((r) => r.expected === 'closed').map((r) => r.id), removalsChecked: results.reduce((n, r) => n + r.removals.length, 0) },
    gdprPurgeWithApprovedPolicyRecord: { execute: purgeEnv.execute, reason: purgeEnv.reason, minusOne: purgeMinus.map((x) => ({ removed: x.removed, execute: x.execute, reason: x.reason })) },
    releasePreflightNonPass: preflight,
    surfaceWideAudit: auditReadyRows(),
    results,
  };
}

/**
 * R46 counted 38 matrix rows « technically ready with nothing outside pending ». This evaluates the routes and screens each row needs under the CURRENT
 * Production switches (restricted beta on, no surface or job opened, build with VITE_PUBLIC_BETA=true) and names the surface-wide gate that closes it.
 */
export const READY_ROWS = {
  P02: { routes: ['aides'] }, P04: { routes: ['demarches'] }, P08: { routes: ['search'], post: ['search'] }, P09: { routes: ['dispositifs'] }, P10: { routes: ['actualites'], jobs: ['actualites'] },
  P16: { routes: ['search', 'assistant/recommendations'], screens: ['/besoins', '/orientation'] }, P22: { routes: ['sitemap.xml', 'public/page'] }, P24: { routes: ['status', 'health'] },
  P26: { routes: [], screens: [] }, C13: { routes: ['citizen/espace', 'citizen/notifications'], screens: ['/compte'] },
  A01: { routes: ['admin/login', 'admin/mfa-verify'], screens: ['/admin/login'] }, A02: { routes: ['admin/content'], screens: ['/admin'] }, A03: { routes: ['admin/content-verification'], screens: ['/admin/ws2'] },
  A04: { routes: ['admin/review-queue'], screens: ['/admin/review-queue'] }, A05: { routes: ['admin/content-verification'], screens: ['/admin/ws2'] }, A06: { routes: ['admin/veille'], screens: ['/admin/veille'] },
  A07: { routes: ['admin/content-versions'], screens: ['/admin/versions'] }, A08: { routes: ['admin/data-quality'], screens: ['/admin'] }, A10: { routes: ['admin/content'], screens: ['/admin'] },
  A11: { routes: ['admin/support', 'reports'], screens: ['/admin/signalements'] }, A14: { routes: ['admin/ai-metrics'], screens: ['/admin'] }, A15: { routes: ['admin/platform'], screens: ['/admin/operations'] },
  A16: { routes: ['admin/elevation'], screens: ['/admin/operations'] }, A19: { routes: ['admin/support'], screens: ['/admin'] },
  D01: { routes: ['admin/content-verification'], screens: ['/admin/ws2'] }, D02: { routes: ['aides'] }, D03: { routes: ['aides'] }, D04: { jobs: ['veille'] }, D07: { jobs: ['veille'] }, D09: { routes: [] },
  D13: { routes: ['admin/organizations'], screens: ['/admin'] }, D14: { jobs: ['veille', 'ingest-structures'] }, M01: { routes: [] }, M04: { routes: ['admin/provider-status', 'admin/security-signals'], screens: ['/admin/fournisseurs', '/admin/securite'] },
  X10: { routes: ['territory/postal', 'territory/qpv'] }, X11: { routes: ['admin/privacy', 'auth/export-data', 'admin/dsr-erasure'], screens: ['/admin/privacy'] }, Q08: { routes: [] }, Q10: { routes: [] },
};
const SURFACE_OF_SCREEN = { '/compte': 'accounts', '/orientation': 'diagnostic', '/admin': 'admin' };
export function auditReadyRows(env = { ADA_PUBLIC_BETA_RESTRICTED: '1', VITE_PUBLIC_BETA: 'true', VERCEL_ENV: 'production' }) {
  return Object.entries(READY_ROWS).map(([id, r]) => {
    /** @type {string[]} */
    const gates = [];
    for (const route of r.routes || []) {
      const allowed = isAllowedInPublicBeta((r.post || []).includes(route) ? 'POST' : 'GET', route, env);
      if (!allowed) gates.push(`API ${route} fermée : surface « ${surfaceOf(route) || 'aucune (refusée)'} » (ADA_BETA_OPEN_SURFACES)`);
    }
    for (const s of r.screens || []) if (screenClosed(env, s)) gates.push(`écran ${s} : avis bêta (VITE_PUBLIC_BETA_OPEN_SURFACES doit nommer « ${Object.entries(SURFACE_OF_SCREEN).find(([k]) => s.startsWith(k))?.[1] || '?'} », au build)`);
    for (const j of r.jobs || []) if (!isAllowedInPublicBeta('POST', `cron/${j}`, env)) gates.push(`tâche ${j} fermée (ADA_BETA_OPEN_JOBS)${j === 'veille' ? ' et sans planification dans vercel.json' : ''}`);
    if (id === 'D09') gates.push('différé par le propriétaire : aucun client API Particulier dans le code (rien à activer)');
    return { id, closedInProduction: gates.length > 0, gates };
  });
}

// ───────────────────────────── French table ─────────────────────────────

const TYPE_FR = { owner_decision: 'Décision', legal_approval: 'Texte juridique', partner: 'Partenaire', hds: 'HDS', human_review: 'Revue humaine', migration: 'Migration',
  code_record: 'Code / config', provider_account: 'Compte fournisseur', operator: 'Opérateur' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** @param {ReturnType<typeof simulate>} rep */
export function toMarkdown(rep, live = []) {
  const L = [];
  L.push('# R47 — Prérequis d’activation par surface et par fonction (simulateur)', '');
  L.push(`Généré le ${rep.generatedAt} par \`scripts/activation-simulator.mjs\`, à partir du code (${rep.basis.replace(/^code \(|\)$/g, '')}).`);
  L.push(`Évalué comme la Production : ${rep.evaluatedAs}. Aucune valeur réelle ; les valeurs de test contiennent « ${SYNTHETIC} ».`, '');
  L.push(`**Résultat** : ${rep.summary.passed}/${rep.summary.items} éléments conformes — chaque prérequis d’environnement est nécessaire (le retirer ferme l’élément avec un code stable) et l’ensemble suffit ; ${rep.summary.removalsChecked} retraits vérifiés. Fermés par conception : ${rep.summary.closedByDesign.join(', ')}.`, '');
  L.push('## 1. Tableau des prérequis', '', '| Élément | Fonctions | Variables (interrupteurs) | Dépend de | Autres prérequis | Code si absent | Retour arrière |', '|---|---|---|---|---|---|---|');
  for (const r of rep.results) {
    const vars = r.env.map((v) => `\`${v.name}\`${v.value ? ` ∋ ${v.value}` : ''}`).join('<br>') || '—';
    const other = r.other.map((o) => `**${TYPE_FR[o.type] || o.type}** : ${o.what}`).join('<br>') || '—';
    const codes = [...new Set(r.removals.map((x) => x.code))].join(', ') || (r.final.code || '—');
    L.push(`| \`${r.id}\`${r.note ? `<br>_${cell(r.note)}_` : ''} | ${r.features.join(' ') || '—'} | ${cell(vars)} | ${r.requires.map((x) => `\`${x}\``).join(' ') || '—'} | ${cell(other)} | ${cell(codes)} | ${cell(r.rollback)} |`);
  }
  L.push('', '## 2. Purge RGPD (gdpr-purge)', '', `Avec la politique livrée (statut « ${RETENTION_POLICY.status} », aucune étape approuvée dans le code) aucune étape n’exécute, quelles que soient les variables. Avec un enregistrement d’approbation synthétique : exécution = ${rep.gdprPurgeWithApprovedPolicyRecord.execute} ; retrait d’une variable → ${rep.gdprPurgeWithApprovedPolicyRecord.minusOne.map((m) => `${m.removed} : ${m.reason}`).join(' ; ')}.`, '');
  L.push('## 3. Contrôle de mise en production sur la configuration finale (hors PASS)', '');
  for (const c of rep.releasePreflightNonPass) L.push(`- ${c.status} \`${c.id}\` — ${cell(c.detail)}`);
  L.push('', '## 4. Les 38 lignes « prêtes, rien en attente » de R46 : verrous de surface encore fermés en Production', '', '| Ligne | Fermée aujourd’hui | Verrous |', '|---|---|---|');
  for (const a of rep.surfaceWideAudit) L.push(`| ${a.id} | ${a.closedInProduction ? 'OUI' : 'non'} | ${cell(a.gates.join('<br>') || '—')} |`);
  for (const lv of live) {
    L.push('', `## 5. Preuve en direct — API réelle (e2e-r47/activation/run.mjs), base ${lv.database}, migration 0045 ${lv.schema0045 ? 'appliquée' : 'NON appliquée (niveau Production 0042)'}`, '');
    L.push(`${lv.summary.passed}/${lv.summary.scenarios} parcours réussis avec la configuration finale ; ${lv.summary.removalsPassed}/${lv.summary.removals} retraits fermés avec leur code ; chaque parcours rouvert immédiatement en remettant la variable (même serveur, sans redémarrage). Registre des avis : ${lv.noticeLedger.map((k) => `${k.kind} ${k.n}`).join(', ') || 'vide'} ; le centre de notifications liste BOOKED_BY_CITIZEN : ${lv.notificationCentreShowsCitizenBookings ? 'oui' : 'non'}.`, '');
    L.push('| Parcours | Élément | Résultat final | Retraits (→ code) |', '|---|---|---|---|');
    for (const r of lv.results) L.push(`| ${r.id}${r.finding ? ' (constat)' : ''} | \`${r.item}\` | ${r.final.status}${r.final.code ? ` ${r.final.code}` : ''} ${r.pass ? '✔' : '✘'} | ${cell(r.removals.map((x) => `${x.removed} → ${x.status} ${x.code || ''}`.trim()).join('<br>') || '—')} |`);
  }
  return `${L.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  const rep = simulate();
  const strip = (r) => ({ ...r, results: r.results });
  // --live a.json,b.json: the reports of e2e-r47/activation/run.mjs (one per schema level) are folded into the outputs
  const live = arg('--live') ? String(arg('--live')).split(',').filter(Boolean).map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) : [];
  if (arg('--out')) {
    const dir = String(arg('--out'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'R47_ACTIVATION_SIMULATOR.json'), `${JSON.stringify({ ...strip(rep), live }, null, 1)}\n`);
    fs.writeFileSync(path.join(dir, 'R47_ACTIVATION_PREREQUIS_FR.md'), toMarkdown(rep, live));
  }
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(strip(rep), null, 1)}\n`);
  else {
    for (const r of rep.results) process.stdout.write(`${r.passed ? 'OK  ' : 'FAIL'} ${r.id.padEnd(40)} final=${r.final.open ? 'open' : `closed(${r.final.code})`} removals=${r.removals.length}${r.removals.some((x) => !x.closed) ? ' NOT-ALL-CLOSED' : ''}\n`);
    process.stdout.write(`\n${rep.summary.passed}/${rep.summary.items} items pass; ${rep.summary.removalsChecked} removals; closed by design: ${rep.summary.closedByDesign.join(', ')}\n`);
    process.stdout.write(`ready rows still closed in Production: ${rep.surfaceWideAudit.filter((a) => a.closedInProduction).map((a) => a.id).join(' ')}\n`);
  }
  process.exit(rep.summary.passed === rep.summary.items ? 0 : 1);
}
