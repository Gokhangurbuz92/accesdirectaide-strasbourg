/**
 * V2 — the release gate opens citizen accounts and Mailjet TOGETHER or not at all, only under terms in force, never with the Mailjet sandbox; e-mail
 * addresses never reach the rate-limit store in clear; the closed-function message no longer says « no account » once accounts are open.
 */
import { describe, expect, it } from 'vitest';
import { evaluateReleasePreflight } from '../../scripts/release-preflight.mjs';
import { pseudonymiseRateIdentifier } from '../../api/_utils/rateLimit.js';
import { publicBetaMessage } from '../../api/_utils/public-beta.js';
import { citizenTermsInForce } from '../../api/_utils/terms-in-force.js';
import { LEGAL_DRAFTS_VERSION } from '../../src/config/legal-drafts.js';

const APPROVED = `cgu-citoyen@${LEGAL_DRAFTS_VERSION},notice-confidentialite@${LEGAL_DRAFTS_VERSION}`;
const BASE = {
  ADA_PUBLIC_BETA_RESTRICTED: 'true', AUTH_MODE: 'jwt', AUTH_SECRET: 's'.repeat(40), JWT_SECRET: 'j'.repeat(40), ADA_ENCRYPTION_KEY: 'ab'.repeat(32), CRON_SECRET: 'c'.repeat(32),
  DATABASE_URL: 'postgresql://u@db.example.test/prod', APP_BASE_URL: 'https://www.example.test', ADA_VAULT_KEY: 'cd'.repeat(32), KV_REST_API_URL: 'https://kv.example.test',
  KV_REST_API_TOKEN: 'kv-synthetic', DATABASE_SSL_VERIFY: 'true',
};
const MAILJET = { MAILER_PROVIDER: 'mailjet', MAILER_FROM: 'Accès Direct Aide <noreply@example.test>', MAILER_API_KEY: 'pub-synthetic:sec-synthetic', ALERT_EMAIL: 'ops@example.test' };
const LEGAL = 'export const LEGAL = { publisher: "complete" };';
const st = (env, id) => evaluateReleasePreflight(env, { legalText: LEGAL }).find((r) => r.id === id)?.status;
const fails = (env) => evaluateReleasePreflight(env, { legalText: LEGAL }).filter((r) => r.status === 'FAIL').map((r) => r.id);

describe('V2 — atomic activation of accounts and Mailjet (release preflight)', () => {
  it('the V1a state (admin only, noop) passes; Mailjet alone (accounts closed) fails', () => {
    expect(fails({ ...BASE, ADA_BETA_OPEN_SURFACES: 'admin' })).toEqual([]);
    expect(st({ ...BASE, ADA_BETA_OPEN_SURFACES: 'admin', ...MAILJET }, 'beta.mailer_noop')).toBe('FAIL');
  });
  it('accounts without a deliverable provider fail, with the sandbox too', () => {
    expect(st({ ...BASE, ADA_BETA_OPEN_SURFACES: 'admin,accounts', VITE_LEGAL_DOCS_APPROVED_VERSION: APPROVED }, 'mail.deliverable')).toBe('FAIL');
    expect(st({ ...BASE, ADA_BETA_OPEN_SURFACES: 'admin,accounts', VITE_LEGAL_DOCS_APPROVED_VERSION: APPROVED, ...MAILJET, MAILER_MAILJET_SANDBOX: '1' }, 'mail.deliverable')).toBe('FAIL');
  });
  it('accounts + Mailjet without the approved terms fail; with them the V2 target configuration has no FAIL', () => {
    expect(st({ ...BASE, ADA_BETA_OPEN_SURFACES: 'admin,accounts', ...MAILJET }, 'legal.citizen_terms_in_force')).toBe('FAIL');
    expect(st({ ...BASE, ADA_BETA_OPEN_SURFACES: 'admin,accounts', ...MAILJET, VITE_LEGAL_DOCS_APPROVED_VERSION: `cgu-citoyen@${LEGAL_DRAFTS_VERSION}` }, 'legal.citizen_terms_in_force')).toBe('FAIL');
    expect(fails({ ...BASE, ADA_BETA_OPEN_SURFACES: 'admin,accounts', ...MAILJET, VITE_LEGAL_DOCS_APPROVED_VERSION: APPROVED })).toEqual([]);
  });
  it('the terms check is a Production rule only', () => {
    expect(citizenTermsInForce({ VERCEL_ENV: 'production' })).toBe(false);
    expect(citizenTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: APPROVED })).toBe(true);
    expect(citizenTermsInForce({ VERCEL_ENV: 'preview' })).toBe(true);
  });
});

describe('V2 / D3 — rate-limit identifiers and the closed-function message', () => {
  it('an identifier carrying an e-mail address is pseudonymised (keyed hash, prefix kept, case-insensitive); others are unchanged', () => {
    const a = String(pseudonymiseRateIdentifier('email:Person@Example.test'));
    expect(a).toMatch(/^email:h:[0-9a-f]{32}$/);
    expect(a).not.toContain('example');
    expect(pseudonymiseRateIdentifier('email:person@example.test')).toBe(a);
    expect(String(pseudonymiseRateIdentifier('institution-forgot-to:x@y.test'))).toMatch(/^institution-forgot-to:h:[0-9a-f]{32}$/);
    expect(pseudonymiseRateIdentifier('ip:203.0.113.7')).toBe('ip:203.0.113.7');
    expect(pseudonymiseRateIdentifier('user-123')).toBe('user-123');
  });
  it('the refusal of a closed function says « no account » only while accounts are closed', () => {
    expect(publicBetaMessage({ ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin' })).toMatch(/aucun compte/);
    const v2 = publicBetaMessage({ ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' });
    expect(v2).not.toMatch(/aucun compte/);
    expect(v2).toMatch(/créer un compte personnel ; les rendez-vous, les messages et les documents ne sont pas encore ouverts/);
  });
});
