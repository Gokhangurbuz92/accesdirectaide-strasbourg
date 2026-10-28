/**
 * PKG-5 batch 2 — unit checks: A15 flags are fail-closed (unknown flag, environment off, override, database error); I03 periods are fixed calendar
 * periods (no free range); A12 the dossier purge skips records under an ACTIVE legal hold; A16 the admin login surface is separate from citizen login.
 */
import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import { isFeatureOn, resetFlagCache, FLAGS } from '../../api/_services/feature-flags.js';
import { periodWindow } from '../../api/_services/territorial-stats.js';

const dbWith = (keys) => ({ execute: async () => ({ rows: keys.map((key) => ({ key })) }) });
const broken = { execute: async () => { throw new Error('down'); } };

describe('PKG-5 batch 2', () => {
  afterEach(() => { resetFlagCache(); delete process.env.OPEN_DATA_EXPORT_ENABLED; delete process.env.PUBLIC_FEEDBACK_DISABLED; });

  it('A15: unknown flag OFF; environment OFF wins; an override forces OFF; a database error = OFF', async () => {
    expect(await isFeatureOn('NOPE', dbWith([]))).toBe(false);
    expect(await isFeatureOn('OPEN_DATA_EXPORT', dbWith([]))).toBe(false);
    process.env.OPEN_DATA_EXPORT_ENABLED = 'true'; resetFlagCache();
    expect(await isFeatureOn('OPEN_DATA_EXPORT', dbWith([]))).toBe(true);
    resetFlagCache(); expect(await isFeatureOn('OPEN_DATA_EXPORT', dbWith(['OPEN_DATA_EXPORT']))).toBe(false);
    resetFlagCache(); expect(await isFeatureOn('PUBLIC_FEEDBACK', broken)).toBe(false);
    process.env.PUBLIC_FEEDBACK_DISABLED = 'true'; resetFlagCache(); expect(await isFeatureOn('PUBLIC_FEEDBACK', dbWith([]))).toBe(false);
    expect(Object.keys(FLAGS).sort()).toEqual(['OPEN_DATA_EXPORT', 'PUBLIC_FEEDBACK', 'SUPPORT_FORM']);
  });

  it('I03: only complete calendar periods (month, quarter, year), whatever is asked', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    expect(periodWindow('month', now)).toMatchObject({ label: '2026-09' });
    expect(periodWindow('quarter', now)).toMatchObject({ label: '2026-T3' });
    expect(periodWindow('year', now)).toMatchObject({ label: '2025' });
    expect(periodWindow('quarter', new Date('2026-02-01T00:00:00Z'))).toMatchObject({ label: '2025-T4' });
    expect(periodWindow('month', new Date('2026-01-05T00:00:00Z'))).toMatchObject({ label: '2025-12' });
  });

  it('A12: the shared-dossier purge excludes records under an ACTIVE legal hold', () => {
    const src = fs.readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8');
    expect(src).toMatch(/NOT EXISTS \(SELECT 1 FROM "LegalHold" h WHERE h\.status = 'ACTIVE' AND h\."dataCategory" = 'SharedDiagnostic'/);
  });

  it('A16: the administrator login surface is its own route and the SPA uses it', () => {
    expect(fs.readFileSync('api/routes.js', 'utf8')).toMatch(/path: 'admin\/login'/);
    expect(fs.readFileSync('src/pages/AdminLogin.jsx', 'utf8')).toMatch(/adminLogin/);
    expect(fs.readFileSync('src/api/client.js', 'utf8')).toMatch(/'\/api\/admin\/login'/);
  });
});
