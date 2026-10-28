import { describe, expect, it } from 'vitest';
import { evaluateReleasePreflight } from '../../scripts/release-preflight.mjs';

const GOOD = {
  MAILER_PROVIDER: 'resend', MAILER_FROM: 'noreply@example.test', MAILER_API_KEY: 'k-synthetic', AUTH_MODE: 'jwt',
  AUTH_SECRET: 's'.repeat(40), JWT_SECRET: 'j'.repeat(40), ADA_ENCRYPTION_KEY: 'ab'.repeat(32), CRON_SECRET: 'c'.repeat(32), DATABASE_URL: 'postgresql://u@db.example.test/prod',
  // launch-readiness campaign (items 41-44): what production fails closed without
  APP_BASE_URL: 'https://www.example.test', ADA_VAULT_KEY: 'cd'.repeat(32), KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'kv-synthetic',
  STORAGE_ENDPOINT: 'https://s3.example.test', STORAGE_BUCKET: 'b', STORAGE_ACCESS_KEY_ID: 'a', STORAGE_SECRET_ACCESS_KEY: 's', DATABASE_SSL_VERIFY: 'true',
  ALERT_WEBHOOK_URL: 'https://alerts.example.test/hook', SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/1',
};
const LEGAL_DONE = 'export const LEGAL = { publisher: "Association X, inscrite au registre des associations du tribunal judiciaire de Strasbourg" };';
const run = (env) => evaluateReleasePreflight(env, { legalText: LEGAL_DONE });
const by = (rs, id) => rs.find((r) => r.id === id).status;

describe('release preflight (synthetic env, values never printed)', () => {
  it('a complete production-like config has no FAIL', () => {
    expect(run(GOOD).filter((r) => r.status === 'FAIL')).toEqual([]);
  });
  it('defaults fail closed: noop mail, token auth mode, missing keys', () => {
    const rs = run({});
    for (const id of ['env.boot_required', 'mail.deliverable', 'auth.mode_jwt', 'auth.session_secret', 'crypto.encryption_key', 'cron.secret', 'db.url_present_not_local', 'app.base_url_https',
      'crypto.vault_key', 'kv.configured', 'storage.configured', 'db.tls_verified', 'alerts.webhook']) expect(by(rs, id), id).toBe('FAIL');
  });
  it('flags legacy token, mocks, Outlook and unused bypass secret', () => {
    const rs = run({ ...GOOD, ADMIN_TOKEN: 'legacy', USE_MOCKS: 'true', OUTLOOK_ENABLED: 'true', BYPASS_SECRET: 'x', MAILER_PROVIDER: 'smtp' });
    expect(by(rs, 'auth.legacy_admin_token_unset')).toBe('FAIL');   // bypasses MFA: a blocker since the launch-readiness campaign
    expect(by(rs, 'flags.no_mocks')).toBe('FAIL');
    expect(by(rs, 'outlook.disabled_until_redesign')).toBe('FAIL');
    expect(by(rs, 'unused.bypass_secret')).toBe('FAIL');
    expect(by(rs, 'mail.deliverable')).toBe('FAIL');
  });
  it('never echoes secret values', () => {
    const planted = { ...GOOD, AUTH_SECRET: 'PLANTED-SECRET-VALUE-1234567890-ABCDEFGH', ADMIN_TOKEN: 'PLANTED-ADMIN', DATABASE_URL: 'postgresql://user:PLANTED-PW@db.example.test/x', MAILER_API_KEY: 'PLANTED-KEY' };
    const text = JSON.stringify(run(planted));
    for (const v of ['PLANTED-SECRET', 'PLANTED-ADMIN', 'PLANTED-PW', 'PLANTED-KEY']) expect(text).not.toContain(v);
  });
  it('refuses what must not exist in production: plain-text admin password, unapproved AI keys, lab content mode, legacy shares, session replay, a localhost link base', () => {
    const rs = run({ ...GOOD, ADMIN_PASSWORD: 'p', GEMINI_API_KEY: 'g', ADA_PUBLIC_CONTENT_MODE: 'lab', ADA_LEGACY_SHARE_READ: '1', VITE_SENTRY_REPLAY: 'true', APP_BASE_URL: 'http://localhost:3000', VITE_DEV_LOGIN_ENABLED: 'true', VITE_SKIP_DB: 'true' });
    for (const id of ['auth.no_env_admin_password', 'ai.no_unapproved_provider_key', 'content.strict_mode', 'share.legacy_off', 'observability.no_session_replay', 'app.base_url_https', 'flags.no_dev_tools', 'flags.no_mocks']) expect(by(rs, id), id).toBe('FAIL');
    for (const k of ['VITE_PUBLIC_DIAGNOSTICS', 'ALLOW_DEV_TOOLS']) expect(by(run({ ...GOOD, [k]: 'true' }), 'flags.no_dev_tools'), k).toBe('FAIL');
    expect(by(run({ ...GOOD, ADA_ALLOW_LEGACY_ADMIN_TOKEN: '1' }), 'flags.no_dev_tools')).toBe('FAIL');
    expect(by(run({ ...GOOD, VITE_SENTRY_DSN: 'https://k@o1.ingest.us.sentry.io/1' }), 'observability.sentry_eu')).toBe('FAIL');   // only the EU region (CSP + DPA)
    expect(by(run({ ...GOOD, ADA_VAULT_KEY: GOOD.ADA_ENCRYPTION_KEY }), 'crypto.vault_key')).toBe('FAIL');            // the vault key is not the data key
    expect(by(run({ ...GOOD, ADA_VAULT_KEY: '', OUTLOOK_TOKEN_ENCRYPTION_KEY: 'ef'.repeat(32) }), 'crypto.vault_key')).toBe('PASS');   // former name still read
  });
  it('the legal identity is part of the gate: the real legal pages still carry « [À COMPLÉTER] » (association not registered yet)', () => {
    expect(by(evaluateReleasePreflight(GOOD), 'legal.publisher_complete')).toBe('FAIL');
    expect(by(run(GOOD), 'legal.publisher_complete')).toBe('PASS');
  });
});
