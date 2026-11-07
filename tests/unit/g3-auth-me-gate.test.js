/**
 * G-3 (07/11/2026, V1a) — the identity probe « auth/me » is not gated as a whole by citizen.account any more (it refused the administrator console with
 * 503 whenever « accounts » was closed); every other accounts route keeps its capability, and the beta allowlist is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOfRoute, closedCapabilityOfRoute } from '../../api/_utils/capabilities.js';
import { isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';

const PROD_ADMIN_ONLY = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin' };

describe('G-3 — auth/me route gate', () => {
  it('auth/me carries no route-level capability; its siblings keep citizen.account', () => {
    expect(capabilitiesOfRoute('auth/me')).toEqual([]);
    expect(closedCapabilityOfRoute('auth/me', PROD_ADMIN_ONLY)).toBeNull();
    for (const p of ['auth/login', 'auth/register', 'auth/logout', 'auth/export-data', 'auth/verify-email', 'auth/me-not-a-route']) {
      expect(capabilitiesOfRoute(p), p).toContain('citizen.account');
      expect(closedCapabilityOfRoute(p, PROD_ADMIN_ONLY), p).toBe('citizen.account');
    }
    expect(capabilitiesOfRoute('auth/franceconnect')).toEqual(['citizen.account', 'citizen.franceconnect']);
  });

  it('the beta allowlist still serves GET auth/me only, and keeps every citizen route closed with only « admin » open', () => {
    expect(isAllowedInPublicBeta('GET', 'auth/me', PROD_ADMIN_ONLY)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'auth/me', PROD_ADMIN_ONLY)).toBe(false);
    for (const p of ['auth/login', 'auth/register', 'citizen/espace', 'citizen/profile', 'citizen/notifications', 'rdv/appointments', 'pro/me', 'pro/notifications',
      'institution/me', 'diagnostic', 'messages', 'contact', 'share/x', 'citizen/coffre', 'cron/actualites', 'cron/veille', 'cron/gdpr-purge']) {
      expect(isAllowedInPublicBeta('GET', p, PROD_ADMIN_ONLY), p).toBe(false);
    }
    expect(isAllowedInPublicBeta('GET', 'admin/provider-status', PROD_ADMIN_ONLY)).toBe(true);
  });
});
