/**
 * R46 / Q07 + N10 — pure rules: security thresholds and alert evaluation; the provider status rows (honest states, names never values); the help form's
 * security category (server allow-list, six-language label, the security.txt contact).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { securityThresholds, evaluateSecuritySignals, recordCitizenLoginFailure, ipDigest } from '../../api/_services/security-signals.js';
import { providerStatuses, summarizeProviders, PROVIDER_REASON_CODES, PROVIDER_STATES } from '../../api/_services/provider-status.js';
import { validateContact } from '../../api/_handlers/contact.js';

const root = path.resolve(import.meta.dirname, '../..');
const counts = (o = {}) => ({ thresholds: securityThresholds({}), failedLogins: { count: 0, sources: 0, byAction: {} }, mfaFailures: { count: 0, sources: 0, actors: 0, byAction: {} },
  exports: { count: 0, actors: 0, maxPerActor: 0, byAction: {} }, ...o });

describe('Q07 security signals', () => {
  it('thresholds: defaults, valid overrides, invalid values ignored', () => {
    expect(securityThresholds({})).toEqual({ windowMinutes: 15, failedLogins: 30, mfaFailures: 10, exportsPerHour: 20, exportsPerActorPerHour: 8 });
    expect(securityThresholds({ ALERT_FAILED_LOGIN_BURST: '5', ALERT_SECURITY_WINDOW_MINUTES: '60' })).toMatchObject({ failedLogins: 5, windowMinutes: 60 });
    expect(securityThresholds({ ALERT_FAILED_LOGIN_BURST: '0', ALERT_MFA_FAILURE_BURST: 'x', ALERT_SECURITY_WINDOW_MINUTES: '99999' })).toMatchObject({ failedLogins: 30, mfaFailures: 10, windowMinutes: 15 });
  });
  it('no alert under the thresholds; one per signal at the threshold, in French, counts only', () => {
    expect(evaluateSecuritySignals(counts())).toEqual([]);
    const a = evaluateSecuritySignals(counts({ failedLogins: { count: 30, sources: 4, byAction: { LOGIN_FAILED: 30 } }, mfaFailures: { count: 10, sources: 1, actors: 1, byAction: { ADMIN_MFA_FAILED: 10 } },
      exports: { count: 2, actors: 1, maxPerActor: 8, byAction: { AUDIT_EXPORTED: 2 } } }));
    expect(a.map((x) => x.name)).toEqual(['security.failed_login_burst', 'security.mfa_failure_burst', 'security.export_burst']);
    expect(a[0].message).toMatch(/^Sécurité : 30 connexions refusées en 15 minutes \(seuil 30\), depuis 4 source\(s\)/);
    expect(JSON.stringify(a)).not.toMatch(/@/);
  });
  it('the citizen refusal row carries no identifier and never throws', async () => {
    const rows = []; const db = { insert: () => ({ values: async (v) => { rows.push(v); } }) };
    await recordCitizenLoginFailure(db, { ip: '198.51.100.4', reason: 'password' });
    await recordCitizenLoginFailure(db, { ip: null, reason: 'whatever' });
    expect(rows[0]).toMatchObject({ action: 'CITIZEN_LOGIN_FAILED', actor: null, actor_id: null, ip_hash: ipDigest('198.51.100.4'), details: { reason: 'password' } });
    expect(rows[1]).toMatchObject({ ip_hash: null, details: { reason: 'other' } });
    await expect(recordCitizenLoginFailure({ insert: () => { throw new Error('down'); } }, { reason: 'unknown' })).resolves.toBeUndefined();
    await expect(recordCitizenLoginFailure({}, { reason: 'unknown' })).resolves.toBeUndefined();
  });
});

describe('N10 provider status', () => {
  const ids = ['mail', 'graph-mail', 'sms', 'push', 'outlook', 'video', 'openfisca', 'aides-territoires', 'franceconnect', 'proconnect', 'maps', 'sentry', 'upstash', 'hosting', 'database'];
  it('an empty environment: every adapter listed, nothing claimed connected except the keyless public map services', () => {
    const rows = providerStatuses({});
    expect(rows.map((r) => r.id)).toEqual(ids);
    for (const r of rows) { expect(PROVIDER_STATES).toContain(r.state); expect(PROVIDER_REASON_CODES).toContain(r.reasonCode); }
    expect(rows.filter((r) => r.state === 'CONNECTED').map((r) => r.id)).toEqual(['maps']);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.state]))).toMatchObject({ mail: 'NOT_CONFIGURED', openfisca: 'SIMULATED', upstash: 'SIMULATED', hosting: 'SIMULATED', franceconnect: 'NOT_CONFIGURED' });
    expect(rows.find((r) => r.id === 'proconnect').adapter).toBe('ABSENT');
    expect(summarizeProviders(rows)).toEqual({ CONNECTED: 1, SIMULATED: 3, NOT_CONFIGURED: 11 });
  });
  it('sandbox / test / prototype configurations are SIMULATED, complete ones CONNECTED — and no value is ever returned', () => {
    const secret = 'Zz-synthetic-value-9876543210-abcdefghijklmnop';
    const env = { MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: `${secret}:${secret}`, MAILER_FROM: 'noreply@example.test', MAILER_MAILJET_SANDBOX: '1',
      TWILIO_SID: secret, TWILIO_AUTH_TOKEN: secret, TWILIO_FROM: '+33600000000', VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'meet.example.test', VIDEO_JITSI_APP_ID: 'app', VIDEO_JITSI_SECRET: secret, VIDEO_SANDBOX: 'true',
      OPENFISCA_URL: 'https://api.fr.openfisca.org/latest', SENTRY_DSN: `https://${secret}@sentry.example.test/1`, KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: secret, VERCEL_ENV: 'preview', DATABASE_URL: `postgres://u:${secret}@db.example.test/x` };
    const rows = providerStatuses(env); const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect([by.mail.state, by.mail.reasonCode]).toEqual(['SIMULATED', 'SANDBOX']);
    expect([by.video.state, by.video.reasonCode]).toEqual(['SIMULATED', 'SANDBOX']);
    expect([by.openfisca.state, by.openfisca.reasonCode]).toEqual(['SIMULATED', 'PUBLIC_PROTOTYPE']);
    expect(by.sms.state).toBe('CONNECTED'); expect(by.sentry.state).toBe('CONNECTED'); expect(by.upstash.state).toBe('CONNECTED'); expect(by.database.state).toBe('CONNECTED');
    expect(by.hosting.reason).toContain('preview');
    const json = JSON.stringify(rows);
    expect(json).not.toContain(secret); expect(json).not.toContain('example.test'); expect(json).not.toContain('+336');
    expect(by.mail.variables).toContainEqual({ name: 'MAILER_API_KEY', set: true });
    // without the sandbox, the same mail configuration is CONNECTED (configured — not « verified »)
    expect(providerStatuses({ ...env, MAILER_MAILJET_SANDBOX: '' }).find((r) => r.id === 'mail')).toMatchObject({ state: 'CONNECTED', reasonCode: 'COMPLETE' });
    expect(providerStatuses({ MAILER_PROVIDER: 'test' }).find((r) => r.id === 'mail')).toMatchObject({ state: 'SIMULATED', reasonCode: 'TEST_OUTBOX' });
  });
  it('the page translates every state and reason code it can receive', () => {
    const page = fs.readFileSync(path.join(root, 'src/pages/admin/k5/Providers.jsx'), 'utf8');
    for (const code of [...PROVIDER_REASON_CODES, ...PROVIDER_STATES]) expect(page, code).toMatch(new RegExp(`\\b${code}:`));
    for (const id of ids) expect(page, id).toMatch(new RegExp(`(^|\\s|')${id}'?:`, 'm'));
  });
});

describe('Q07 help form security category and security.txt', () => {
  it('the server accepts the « securite » subject', () => {
    expect(validateContact({ email: 'x@example.test', sujet: 'securite', message: 'Faille XSS sur /recherche' })).toMatchObject({ ok: true, value: { sujet: 'securite' } });
    expect(validateContact({ email: 'x@example.test', sujet: 'hack', message: 'm' }).ok).toBe(false);
  });
  it('the security option and its note exist in the five target languages', () => {
    for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
      const j = JSON.parse(fs.readFileSync(path.join(root, `src/i18n/locales/${lang}/contact.json`), 'utf8'));
      expect(j['subject.security'], lang).toBeTruthy(); expect(j['security.note'], lang).toBeTruthy();
    }
  });
  it('/.well-known/security.txt follows RFC 9116 (Contact, future Expires, Canonical) and points to the security category', () => {
    const txt = fs.readFileSync(path.join(root, 'public/.well-known/security.txt'), 'utf8');
    expect(txt).toMatch(/^Contact: https:\/\/accesdirectaide\.fr\/contact\?sujet=securite$/m);
    const exp = txt.match(/^Expires: (.+)$/m)[1];
    expect(new Date(exp).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(exp).getTime() - Date.now()).toBeLessThan(366 * 86400_000);
    expect(txt).toMatch(/^Canonical: https:\/\/accesdirectaide\.fr\/\.well-known\/security\.txt$/m);
    expect(txt).toMatch(/^Preferred-Languages: fr, en$/m);
    expect([...txt].every((ch) => ch === "\n" || (ch >= " " && ch <= "~"))).toBe(true);
  });
});
