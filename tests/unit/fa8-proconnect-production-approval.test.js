/**
 * FA-D8 — ProConnect gets the same explicit production switch as FranceConnect: a deployment (production / preview) with complete credentials stays
 * DISCONNECTED until PROCONNECT_PRODUCTION_APPROVED=true (the owner's switch after the DataPass agreement and the eligibility check — a private service may
 * only authenticate public-sector agents through ProConnect). The LAB (no VERCEL_ENV) and the mock issuer are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { proConnectConfig, proConnectStatus, PROCONNECT_OPTIONAL_ENV } from '../../api/lib/proconnect-oidc.js';
import { franceConnectConfig } from '../../api/lib/franceconnect/oidc-client.js';
import { providerStatuses } from '../../api/_services/provider-status.js';

const PC = { PROCONNECT_ENABLED: 'true', PROCONNECT_ISSUER: 'https://idp.example.test/api/v2', PROCONNECT_CLIENT_ID: 'lab-client', PROCONNECT_CLIENT_SECRET: 'lab-secret-not-real',
  PROCONNECT_REDIRECT_URI: 'https://lab.example.test/api/pro/auth/proconnect/callback' };

describe('FA-D8 ProConnect production approval', () => {
  it('LAB: complete configuration is CONFIGURED without the switch (unchanged)', () => {
    expect(proConnectConfig(PC).configured).toBe(true);
    expect(proConnectStatus(PC).available).toBe(true);
  });
  it('production / preview: complete credentials alone stay DISCONNECTED; the explicit switch opens the adapter', () => {
    for (const VERCEL_ENV of ['production', 'preview']) {
      const c = proConnectConfig({ ...PC, VERCEL_ENV });
      expect(c.configured).toBe(false); expect(c.invalid).toEqual(['PROCONNECT_PRODUCTION_APPROVED']); expect(c.productionApprovalPending).toBe(true);
      expect(proConnectConfig({ ...PC, VERCEL_ENV, PROCONNECT_PRODUCTION_APPROVED: 'yes' }).configured).toBe(false);
      expect(proConnectConfig({ ...PC, VERCEL_ENV, PROCONNECT_PRODUCTION_APPROVED: 'true' }).configured).toBe(true);
    }
    // an incomplete configuration is reported as incomplete, not as « approval pending »
    expect(proConnectConfig({ VERCEL_ENV: 'production', PROCONNECT_ENABLED: 'true' }).productionApprovalPending).toBe(false);
    expect(PROCONNECT_OPTIONAL_ENV).toContain('PROCONNECT_PRODUCTION_APPROVED');
  });
  it('the provider-status page says « production activation pending », like FranceConnect, and never prints a value', () => {
    const pc = providerStatuses({ ...PC, VERCEL_ENV: 'production' }).find((r) => r.id === 'proconnect');
    expect(pc.state).toBe('NOT_CONFIGURED'); expect(pc.reasonCode).toBe('PRODUCTION_ACTIVATION_PENDING');
    expect(JSON.stringify(pc)).not.toContain('lab-secret-not-real');
    expect(franceConnectConfig({ FRANCECONNECT_ISSUER: 'https://fc.example.test', FRANCECONNECT_CLIENT_ID: 'c', FRANCECONNECT_CLIENT_SECRET: 's', VERCEL_ENV: 'production' }))
      .toEqual({ ok: false, reason: 'PRODUCTION_NOT_APPROVED' });
  });
});
