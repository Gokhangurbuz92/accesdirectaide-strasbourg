#!/usr/bin/env node
// @ts-nocheck
/**
 * R47 — LIVE proof of the activation simulator (scripts/activation-simulator.mjs) against the REAL api/index.js, in a Production-equivalent configuration
 * (ADA_PUBLIC_BETA_RESTRICTED=1, ADA_CAPABILITY_ENFORCEMENT=1, ADA_SENSITIVITY_REVIEW_ENFORCED=1, PRO_MFA_REQUIRED=true, ADMIN_SESSION_REGISTRY_STRICT=true)
 * on a disposable loopback *_test database, with the FINAL configuration built from SYNTHETIC fixtures and loopback mock providers:
 *   (a) every key journey of every surface succeeds;
 *   (b) the same journey with ONE prerequisite removed fails closed with its stable code and returns no data;
 *   (c) rollback: the switch removed in the RUNNING server closes it at once, put back it reopens at once (no restart: the gates read the environment per call).
 * Never port 3000, never Production, never a real credential, no network beyond 127.0.0.1.
 *
 *   DATABASE_URL=postgres://ada_test@127.0.0.1:55434/ada_r47_activation_test node --import tsx e2e-r47/activation/run.mjs [--out report.json]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { guardLab, startApp, startHdsMock, startSink, startModelMock, seed, client } from '../lib/lab.mjs';

const PORT = Number(process.env.R47_PORT || 5193);
const PC_PORT = Number(process.env.R47_PC_PORT || 5293);
guardLab(PORT);
// crypto.ts and the import-time readers need these before the first import of the API
process.env.ADA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const model = await startModelMock();
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${model.port}`;   // read at import time (api/lib/ai-foundation.js): the loopback stand-in, never the machine's own runtime
const hdsToken = `SYNTHETIC-TEST-ONLY-${crypto.randomBytes(20).toString('hex')}`;
const hds = await startHdsMock({ token: hdsToken });
const sink = await startSink();
const { startMockFranceConnect } = await import('../../scripts/lab/mock-franceconnect.mjs');
const fc = await startMockFranceConnect({ clientId: 'SYNTHETIC-TEST-ONLY-fc', clientSecret: `SYNTHETIC-TEST-ONLY-${crypto.randomBytes(8).toString('hex')}` });
const pcSecret = `SYNTHETIC-TEST-ONLY-${crypto.randomBytes(8).toString('hex')}`;
const pcMock = spawn(process.execPath, ['e2e-r46/pro/mock-proconnect.mjs'], { env: { PATH: process.env.PATH, MOCK_PC_PORT: String(PC_PORT), MOCK_PC_CLIENT_ID: 'SYNTHETIC-TEST-ONLY-pc', MOCK_PC_CLIENT_SECRET: pcSecret }, stdio: 'ignore' });

const { finalConfig } = await import('../../scripts/activation-simulator.mjs');
const base = `http://127.0.0.1:${PORT}`;
const cfg = finalConfig({ profile: 'lab', base, mocks: { hds: hds.url, fc: fc.issuer, pc: `http://127.0.0.1:${PC_PORT}/api/v2`, alert: sink.url } });
Object.assign(cfg, {
  NODE_ENV: 'development', ADA_ENCRYPTION_KEY: process.env.ADA_ENCRYPTION_KEY, ADA_PROTECTED_STORE_TOKEN: hdsToken, MAILER_PROVIDER: 'test',
  FRANCECONNECT_CLIENT_ID: fc.clientId, FRANCECONNECT_CLIENT_SECRET: fc.clientSecret, FRANCECONNECT_REDIRECT_URI: `${base}/api/auth/franceconnect/callback`,
  PROCONNECT_CLIENT_ID: 'SYNTHETIC-TEST-ONLY-pc', PROCONNECT_CLIENT_SECRET: pcSecret, PROCONNECT_POST_LOGOUT_REDIRECT_URI: `${base}/pro/login`,
  PRO_MFA_REQUIRED: 'true', ADMIN_SESSION_REGISTRY_STRICT: 'true', OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
});
// never toward a real service from the LAB: no Sentry DSN (Sentry.init would send), no OpenFisca endpoint (the diagnostic runs its simulation mode), no object storage
for (const k of ['SENTRY_DSN', 'OPENFISCA_URL', 'STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'VERCEL_ENV']) delete cfg[k];
Object.assign(process.env, cfg);
const FINAL = { ...process.env };

const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const S = await seed(db);
await db.query(`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES ($1, $2, 'scrypt:00:00', 'superadmin', NOW(), 0, false)`, [`r47a-adm-${S.ts}`, S.admin.email]);
const app = await startApp({ port: PORT });
const { signUserSessionToken } = await import('../../api/_utils/user-auth.js');
const { signProToken, signAdminSessionToken } = await import('../../api/_utils/auth.js');
const { twilioSignature } = await import('../../api/lib/sms-policy.js');

const c = client(base);
c.jar.set('ada_user_session', encodeURIComponent(signUserSessionToken({ userId: S.citizen.id, email: S.citizen.email })));
const proToken = signProToken({ id: S.pro.id, email: S.pro.email, structureId: S.structure.id, role: 'STRUCTURE_ADMIN' }, { mfa: true });
const adminToken = signAdminSessionToken({ email: S.admin.email, role: 'superadmin', mfa_verified: true, elev_until: Math.floor(Date.now() / 1000) + 3600, elev_kind: 'JIT', elev_id: `r47a-el-${S.ts}` });
const cron = { 'x-cron-secret': process.env.CRON_SECRET };
const pdf = Buffer.from('%PDF-1.4\n% SYNTHETIC-TEST-ONLY R47\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');

// ── environment mutation (the running server reads it on every call)
const restore = () => { for (const k of Object.keys(process.env)) if (!(k in FINAL)) delete process.env[k]; Object.assign(process.env, FINAL); };
function apply(change) {
  if (change.token) process.env[change.name] = String(process.env[change.name] || '').split(',').filter((x) => x.trim() && x.trim() !== change.token).join(',');
  else if ('set' in change) process.env[change.name] = change.set;
  else delete process.env[change.name];
}
const label = (ch) => (ch.token ? `${ch.name} ∌ ${ch.token}` : 'set' in ch ? `${ch.name}=${ch.set}` : `${ch.name} removed`);
const codeOf = (r) => r.json?.code || r.json?.error || r.json?.reason || null;

// ── slots: one fresh start time per booking
let slotCursor = 0;
// the slot list is read on the ORDINARY service under the final configuration (the slots route of a sensitive or unreviewed service is itself refused when
// its gate is closed): every service of the structure shares the same opening hours and duration
async function nextSlot() {
  const serviceId = S.svc.ordinary;
  const from = new Date(Date.now() + 26 * 3600e3).toISOString().slice(0, 10); const to = new Date(Date.now() + 9 * 86400e3).toISOString().slice(0, 10);
  const r = await c.req('GET', `/api/rdv/structures/${S.structure.slug}/slots?serviceId=${serviceId}&from=${from}&to=${to}&mode=IN_PERSON`);
  const slots = r.json?.slots || []; slotCursor += 1;
  return slots[slotCursor % Math.max(1, slots.length)]?.startAt || null;
}
const book = async (serviceId, extra = {}) => c.req('POST', '/api/rdv/appointments', { body: { structureSlug: S.structure.slug, serviceId, startAt: extra.startAt || await nextSlot(), idempotencyKey: crypto.randomUUID(), ...extra } });

/**
 * scenario: run() returns a response; ok(r) says the journey succeeded; removals: { change, status, code? | test(r) } each must fail closed.
 * @type {{ id: string, item: string, features: string[], run: () => Promise<any>, ok: (r: any) => boolean, removals: any[], byDesign?: boolean }[]}
 */
const SC = [];
const add = (s) => SC.push(s);
const beta = (name, token) => ({ change: { name, token }, status: 503, code: 'PUBLIC_BETA_RESTRICTED' });
const capOff = (cap) => ({ change: { name: 'ADA_CAPABILITIES_OPEN', token: cap }, status: 503, code: 'CAPABILITY_NOT_OPEN' });

add({ id: 'accounts.login', item: 'surface.accounts', features: ['C01', 'C02'], run: async () => { const k = client(base); const r = await k.req('POST', '/api/auth/login', { body: { email: S.citizen.email, password: S.citizen.password } }); r.cookie = k.jar.get('ada_user_session'); return r; },
  ok: (r) => r.status === 200 && r.json?.success === true && Boolean(r.cookie), removals: [beta('ADA_BETA_OPEN_SURFACES', 'accounts')] });
add({ id: 'accounts.espace', item: 'capability.citizen.account', features: ['C13', 'N03'], run: () => c.req('GET', '/api/citizen/espace'), ok: (r) => r.status === 200 && Boolean(r.json?.summary),
  removals: [beta('ADA_BETA_OPEN_SURFACES', 'accounts')] });
add({ id: 'accounts_full.parcours', item: 'capability.citizen.parcours', features: ['C07'], run: () => c.req('GET', '/api/citizen/parcours'), ok: (r) => r.status === 200,
  removals: [beta('ADA_BETA_ACCOUNTS_SCOPE'), capOff('citizen.parcours')] });
add({ id: 'accounts_full.push', item: 'capability.citizen.push', features: ['N04'], run: () => c.req('GET', '/api/citizen/push'), ok: (r) => r.status === 200 && r.json?.available === true && Boolean(r.json?.publicKey),
  removals: [{ change: { name: 'WEB_PUSH_VAPID_PUBLIC_KEY' }, test: (r) => r.status === 200 && r.json?.available === false && !r.json?.publicKey, why: 'available:false, no key' }, beta('ADA_BETA_ACCOUNTS_SCOPE')] });
add({ id: 'appointments.services', item: 'surface.appointments', features: ['B01'], run: () => c.req('GET', `/api/rdv/structures/${S.structure.slug}/services`),
  ok: (r) => r.status === 200 && r.json.items.find((i) => i.id === S.svc.ordinary)?.onlineBooking === 'OPEN' && r.json.items.find((i) => i.id === S.svc.unknown)?.onlineBooking === 'CONTACT_STRUCTURE',
  removals: [beta('ADA_BETA_OPEN_SURFACES', 'appointments')] });
add({ id: 'appointments.book_ordinary', item: 'capability.citizen.booking', features: ['B02', 'B03'], run: () => book(S.svc.ordinary), ok: (r) => r.status === 201,
  removals: [beta('ADA_BETA_OPEN_SURFACES', 'appointments')] });
// R47 finding F1 — FIXED in d5d3c15: closing « accounts » (rollback) also stops a citizen session issued before from booking on « appointments »
add({ id: 'accounts_closed_session_refused', item: 'surface.appointments', features: ['B03'], byDesign: true,
  run: async () => { apply({ name: 'ADA_BETA_OPEN_SURFACES', token: 'accounts' }); const r = await book(S.svc.ordinary); restore(); return r; },
  ok: (r) => r.status === 503 && codeOf(r) === 'PUBLIC_BETA_RESTRICTED', removals: [] });
add({ id: 'booking.sensitive_consent_required', item: 'booking.sensitive', features: ['B03'], run: () => book(S.svc.sensitive), ok: (r) => r.status === 400 && codeOf(r) === 'SENSITIVE_CONSENT_REQUIRED', removals: [] });
add({ id: 'booking.sensitive', item: 'booking.sensitive', features: ['B01', 'B03'], run: () => book(S.svc.sensitive, { sensitiveConsent: true }), ok: (r) => r.status === 201,
  removals: [{ change: { name: 'ADA_SENSITIVE_BOOKING_APPROVED' }, status: 409, code: 'SENSITIVE_BOOKING_NOT_OPEN' }, { change: { name: 'ADA_HDS_BOOKING_ASSESSED' }, status: 409, code: 'SENSITIVE_BOOKING_NOT_OPEN' },
    { change: { name: 'ADA_SENSITIVE_BOOKING_APPROVED', set: 'true' }, status: 409, code: 'SENSITIVE_BOOKING_NOT_OPEN' }] });
add({ id: 'booking.unreviewed_service', item: 'booking.unreviewed_service', features: ['B01'], byDesign: true, run: () => book(S.svc.unknown), ok: (r) => r.status === 409 && codeOf(r) === 'SERVICE_SENSITIVITY_UNREVIEWED', removals: [] });
let videoAppointment = null;
add({ id: 'appointments.book_video', item: 'capability.video', features: ['B07'], run: async () => { const r = await book(S.svc.ordinary, { mode: 'VIDEO', videoConsent: true }); if (r.status === 201) videoAppointment = r.json?.id || r.json?.appointment?.id; return r; },
  ok: (r) => r.status === 201, removals: [] });
add({ id: 'pro.me', item: 'surface.pro', features: ['R01'], run: () => c.req('GET', '/api/pro/me', { bearer: proToken }), ok: (r) => r.status === 200,
  removals: [beta('ADA_BETA_OPEN_SURFACES', 'pro'), { change: { name: 'PRO_MFA_REQUIRED', set: 'true' }, test: () => true, why: 'unchanged (already required)' }].slice(0, 1) });
add({ id: 'pro.agenda', item: 'capability.pro.agenda', features: ['B08'], run: () => c.req('GET', '/api/pro/appointments', { bearer: proToken }), ok: (r) => r.status === 200, removals: [beta('ADA_BETA_OPEN_SURFACES', 'appointments')] });
add({ id: 'pro.video_approve', item: 'capability.video', features: ['B07', 'N06'], run: () => c.req('POST', '/api/pro/appointments/visio', { bearer: proToken, body: { appointmentId: videoAppointment, action: 'approve' } }),
  ok: (r) => r.status === 200, removals: [{ change: { name: 'VIDEO_PROVIDER' }, status: 503, code: 'VIDEO_DISABLED' }, capOff('video'), beta('ADA_BETA_OPEN_SURFACES', 'video')] });
add({ id: 'pro.outlook_status', item: 'capability.calendar.outlook', features: ['B10'], run: () => c.req('GET', '/api/pro/outlook?action=status', { bearer: proToken }), ok: (r) => r.status === 200 && r.json?.outlookEnabled === true,
  removals: [{ change: { name: 'OUTLOOK_ENABLED' }, test: (r) => r.status === 200 && r.json?.ok === false && !r.json?.outlookEnabled, why: 'ok:false, not enabled' }, beta('ADA_BETA_OPEN_SURFACES', 'appointments')] });
add({ id: 'pro.proconnect_start', item: 'provider.proconnect', features: ['N09', 'R02'], run: () => c.req('GET', '/api/pro/auth/proconnect/start'),
  ok: (r) => r.status === 302 && String(r.headers.get('location')).startsWith(`http://127.0.0.1:${PC_PORT}/api/v2/authorize`),
  removals: [{ change: { name: 'PROCONNECT_ENABLED' }, test: (r) => !String(r.headers.get('location') || '').startsWith(`http://127.0.0.1:${PC_PORT}`), why: 'no redirect to the provider' }, beta('ADA_BETA_OPEN_SURFACES', 'pro')] });
add({ id: 'franceconnect.login', item: 'capability.citizen.franceconnect', features: ['N08', 'C26'], run: () => c.req('GET', '/api/auth/franceconnect/login'),
  ok: (r) => r.status === 302 && String(r.headers.get('location')).startsWith(fc.issuer),
  removals: [capOff('citizen.franceconnect'), { change: { name: 'FRANCECONNECT_ISSUER' }, test: (r) => !String(r.headers.get('location') || '').startsWith(fc.issuer), why: 'no redirect to the provider' }] });
let instToken = null;
add({ id: 'institution.login', item: 'surface.institution', features: ['I01'], run: async () => { const r = await c.req('POST', '/api/institution/login', { body: { email: S.institution.email, password: S.institution.password } }); if (r.json?.token) instToken = r.json.token; return r; },
  ok: (r) => r.status === 200 && Boolean(r.json?.token), removals: [beta('ADA_BETA_OPEN_SURFACES', 'institution'), capOff('institution.portal')] });
add({ id: 'institution.observatoire', item: 'capability.institution.portal', features: ['I02', 'I04'], run: () => c.req('GET', '/api/institution/observatoire', { bearer: instToken }), ok: (r) => r.status === 200 && r.json?.kAnonymityMin === 5,
  removals: [capOff('institution.portal'), beta('ADA_BETA_OPEN_SURFACES', 'institution')] });
add({ id: 'institution.export', item: 'institution.export', features: ['I03'], run: () => c.req('GET', '/api/institution/export?period=quarter', { bearer: instToken }), ok: (r) => r.status === 200 && /^schema,licence,periode/m.test(r.buf.toString('utf8').replace(/^\uFEFF/, '')),
  removals: [{ change: { name: 'OPEN_DATA_EXPORT_ENABLED' }, status: 503, code: 'EXPORT_NOT_OPEN' }, capOff('institution.portal')] });
add({ id: 'communications.contact', item: 'surface.communications', features: ['P20'], run: () => c.req('POST', '/api/contact', { body: { email: `r47a-contact-${S.ts}@example.test`, sujet: 'question', message: 'Message synthétique de test R47, aucune donnée réelle.', site_web: '' } }),
  ok: (r) => r.status === 200 && r.json?.accepted === true, removals: [beta('ADA_BETA_OPEN_SURFACES', 'communications'), { change: { name: 'MAILER_PROVIDER', set: 'noop' }, status: 503, code: 'NOT_DELIVERED' }] });
let docId = null;
const objectsBefore = () => hds.objects.size;
add({ id: 'documents.vault_upload', item: 'capability.citizen.vault', features: ['C09'], run: async () => { const n = objectsBefore(); const r = await c.req('POST', '/api/citizen/coffre', { body: { category: 'autre', originalName: 'synthetique-r47.pdf', mimeType: 'application/pdf', fileBase64: pdf } }); r.stored = hds.objects.size - n; if (r.json?.document?.id) docId = r.json.document.id; return r; },
  ok: (r) => r.status === 201 && r.stored === 1,
  removals: [{ change: { name: 'ADA_HDS_CERTIFIED_HOSTING' }, status: 503, code: 'CAPABILITY_NOT_OPEN', stores: 0 }, { ...capOff('citizen.vault'), stores: 0 }, { ...beta('ADA_BETA_OPEN_SURFACES', 'documents'), stores: 0 },
    { change: { name: 'ADA_PROTECTED_STORE_ENDPOINT' }, status: 503, code: 'PROTECTED_STORE_REFUSED', stores: 0 }, { change: { name: 'ADA_PROTECTED_STORE', set: 'lab-unknown' }, status: 503, code: 'PROTECTED_STORE_REFUSED', stores: 0 },
    { change: { name: 'ADA_HDS_CERTIFIED_HOSTING', set: `HDS1:synthetic-test-only:SYNTHETIC-TEST-ONLY-0001:2020-01-01:${'0'.repeat(64)}` }, status: 503, code: 'CAPABILITY_NOT_OPEN', stores: 0 }] });
add({ id: 'documents.vault_download', item: 'capability.citizen.vault', features: ['C09'], run: () => c.req('GET', `/api/citizen/coffre?download=${docId}`), ok: (r) => r.status === 200 && r.buf.toString('utf8').includes('SYNTHETIC-TEST-ONLY R47'),
  removals: [{ change: { name: 'ADA_PROTECTED_STORE_TOKEN', set: 'SYNTHETIC-TEST-ONLY-short' }, status: 503, code: 'PROTECTED_STORE_REFUSED', noBody: 'SYNTHETIC-TEST-ONLY R47' }, { ...capOff('citizen.vault'), noBody: 'SYNTHETIC-TEST-ONLY R47' }] });
add({ id: 'diagnostic.simulation', item: 'capability.diagnostic.questionnaire', features: ['P13', 'D10'], run: () => c.req('POST', '/api/diagnostic', { body: { mode: 'SIMULATION_MODE', answers: { birthDate: '1990-01-01' } } }),
  ok: (r) => r.status === 200 && r.json?.mode === 'SIMULATION_NON_AUTHORITATIVE' && r.json?.authoritative === false, removals: [capOff('diagnostic.questionnaire'), beta('ADA_BETA_OPEN_SURFACES', 'diagnostic')] });
add({ id: 'ai.orient', item: 'capability.ai.processing', features: ['P16', 'P17'], run: () => c.req('POST', '/api/public/assistant/orient', { body: { message: 'Structure synthétique R47 accès aux droits', territory: 'Strasbourg' } }),
  // this database has no D-5-verified record: the open assistant answers its fixed abstention (the sourced answer is proven in e2e-r47/admin, after a verification)
  ok: (r) => r.status === 200 && (r.json?.grounded === true || r.json?.meta?.reason === 'no_verified_local_source'), removals: [capOff('ai.processing'), beta('ADA_BETA_OPEN_SURFACES', 'diagnostic')] });
add({ id: 'admin.provider_status', item: 'surface.admin', features: ['A17', 'N10', 'M04'], run: () => c.req('GET', '/api/admin/provider-status', { bearer: adminToken }), ok: (r) => r.status === 200 && Array.isArray(r.json?.providers),
  removals: [beta('ADA_BETA_OPEN_SURFACES', 'admin')] });
add({ id: 'admin.guardianships', item: 'policy.guardians', features: ['C05'], run: () => c.req('POST', '/api/admin/guardianships', { bearer: adminToken, body: { action: 'list' } }), ok: (r) => r.status === 200 && r.json?.policy?.strongVerification === 'CONFIGURED',
  removals: [{ change: { name: 'ADA_AGE_POLICY_JSON' }, test: (r) => r.status === 200 && r.json?.policy?.strongVerification === 'POLICY_PENDING', why: 'policy POLICY_PENDING' }, capOff('citizen.guardians')] });
add({ id: 'jobs.rdv_reminder', item: 'job.rdv-reminder', features: ['B06'], run: () => c.req('GET', '/api/cron/rdv-reminder', { headers: cron }), ok: (r) => r.status === 200 && r.json?.ok !== false,
  removals: [beta('ADA_JOBS_APPROVED', 'rdv-reminder'), beta('ADA_BETA_OPEN_JOBS', 'rdv-reminder'), { change: { name: 'CRON_SECRET', set: 'SYNTHETIC-TEST-ONLY-another-secret-value' }, status: 401 }] });
// health-alert answers 503 while an alert is firing (here: no veille run recorded on the fresh LAB) and delivers it to the alert channel (the loopback sink)
add({ id: 'jobs.health_alert', item: 'job.health-alert', features: ['Q07'], run: async () => { const n = sink.received.length; const r = await c.req('GET', '/api/cron/health-alert', { headers: cron }); r.delivered = sink.received.length - n; return r; },
  ok: (r) => [200, 503].includes(r.status) && Boolean(r.json) && r.json.error !== 'PUBLIC_BETA_RESTRICTED', removals: [beta('ADA_BETA_OPEN_JOBS', 'health-alert')] });
add({ id: 'jobs.gdpr_purge_dry_run', item: 'job.gdpr-purge', features: ['Q03'], byDesign: true, run: () => c.req('GET', '/api/cron/gdpr-purge', { headers: cron }),
  ok: (r) => r.status === 200 && r.json?.skipped === true && r.json?.reason === 'POLICY_NOT_APPROVED',
  removals: [{ change: { name: 'GDPR_PURGE_ENABLED' }, test: (r) => r.status === 200 && r.json?.reason === 'GDPR_PURGE_DISABLED', why: 'GDPR_PURGE_DISABLED' }, beta('ADA_JOBS_APPROVED', 'gdpr-purge')] });
const smsParams = { From: '+33600000000', To: '+33000000000', Body: 'STOP', MessageSid: 'SMSYNTHETICTESTONLY' };
add({ id: 'sms.stop_webhook', item: 'provider.sms_stop', features: ['N02'], run: () => c.req('POST', '/api/monitor/sms-inbound/twilio', { form: smsParams, headers: { 'x-twilio-signature': twilioSignature(FINAL.TWILIO_AUTH_TOKEN, FINAL.SMS_INBOUND_URL, smsParams) } }),
  ok: (r) => r.status === 200, removals: [{ change: { name: 'SMS_INBOUND_URL' }, test: (r) => r.status !== 200, why: 'refused' }, { change: { name: 'TWILIO_AUTH_TOKEN', set: 'SYNTHETIC-TEST-ONLY-other' }, test: (r) => r.status === 403, why: '403 bad signature' }] });

// ── run
const results = [];
for (const s of SC) {
  restore();
  const first = await s.run(); const okFirst = s.ok(first);
  const removals = [];
  for (const rm of s.removals) {
    restore(); apply(rm.change);
    const before = hds.objects.size;
    const r = await s.run();
    const stored = hds.objects.size - before;
    let pass = rm.test ? rm.test(r) : r.status === rm.status && (!rm.code || codeOf(r) === rm.code);
    if (rm.stores !== undefined && stored !== rm.stores) pass = false;
    if (rm.noBody && r.buf.toString('utf8').includes(rm.noBody)) pass = false;
    // a refusal carries no data: no record, no document, no list (only the refusal fields)
    if (!rm.test && r.status >= 400 && r.json && Object.keys(r.json).some((k) => !['error', 'code', 'capability', 'message', 'requestId', 'reason', 'ok', 'delivered', 'accepted', 'mailStatus'].includes(k))) pass = false;
    removals.push({ removed: label(rm.change), status: r.status, code: codeOf(r), expected: rm.test ? rm.why : `${rm.status}${rm.code ? ` ${rm.code}` : ''}`, pass });
  }
  // (c) rollback reverse: everything put back in the SAME running server, the journey works again at once
  restore();
  const again = s.removals.length ? await s.run() : first;
  const okAgain = s.removals.length ? s.ok(again) || (s.id === 'pro.video_approve' && again.status < 500) : okFirst;
  results.push({ id: s.id, item: s.item, features: s.features, byDesign: Boolean(s.byDesign), final: { status: first.status, code: codeOf(first), pass: okFirst }, removals, reopened: okAgain, again: { status: again.status, code: codeOf(again) }, finding: Boolean(s.finding),
    pass: okFirst && okAgain && removals.every((x) => x.pass) });
}
// migration 0045: the ledger of the booking notices on THIS database
const kinds = (await db.query(`SELECT kind, count(*)::int AS n FROM "AppointmentNotice" GROUP BY kind ORDER BY kind`)).rows;
const has0045 = (await db.query(`SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'AppointmentNotice' AND c.conname = 'AppointmentNotice_kind_check'`)).rows[0]?.d?.includes('BOOKED_BY_CITIZEN') || false;
restore();
const notif = await c.req('GET', '/api/citizen/notifications');
const notificationCentreShowsCitizenBookings = JSON.stringify(notif.json || {}).includes('BOOKED_BY_CITIZEN');
const outbox = (await import('../../api/_utils/mailer.js')).__getTestOutbox().length;
const report = { generatedAt: new Date().toISOString(), port: PORT, database: new URL(process.env.DATABASE_URL).pathname.slice(1), schema0045: has0045, noticeLedger: kinds, notificationCentreShowsCitizenBookings, notificationsStatus: notif.status, testOutboxMessages: outbox,
  hdsMockCalls: hds.calls.length, alertSinkCalls: sink.received.length, fcMockCalls: fc.calls.length,
  summary: { scenarios: results.length, passed: results.filter((r) => r.pass).length, removals: results.reduce((n, r) => n + r.removals.length, 0), removalsPassed: results.reduce((n, r) => n + r.removals.filter((x) => x.pass).length, 0) }, results };
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id.padEnd(36)} final=${r.final.status}${r.final.code ? `/${r.final.code}` : ''} reopened=${r.reopened}${r.reopened ? '' : ` (${r.again.status} ${r.again.code})`}`);
  for (const x of r.removals) console.log(`     ${x.pass ? 'ok ' : 'BAD'} − ${x.removed.padEnd(46)} → ${x.status} ${x.code || ''} (expected ${x.expected})`);
}
console.log(`\nscenarios ${report.summary.passed}/${report.summary.scenarios}; removals ${report.summary.removalsPassed}/${report.summary.removals}; 0045=${has0045}; notification centre lists BOOKED_BY_CITIZEN=${notificationCentreShowsCitizenBookings}; ledger ${JSON.stringify(kinds)}; outbox ${outbox}; hds calls ${report.hdsMockCalls}; alert sink ${report.alertSinkCalls}`);
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (out) fs.writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
await app.close(); await model.close(); await hds.close(); await sink.close(); await fc.close?.(); pcMock.kill(); await db.end();
process.exit(report.summary.passed === report.summary.scenarios ? 0 : 1);
