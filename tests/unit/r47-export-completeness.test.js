/**
 * R47 (art. 15) — the personal-data export says whether it is complete: a section whose read FAILS is counted and the export carries
 * complete:false with a notice, instead of silently showing an empty section. A missing query API on a database double is not a failure.
 */
import { describe, expect, it, vi } from 'vitest';
import { createPrivacyRightsService } from '../../api/_services/privacy.js';

const cryptoLib = { createHash() { let v = ''; return { update(x) { v += String(x); return this; }, digest() { return `sha256:${v}`; } }; } };
const ok = (rows = []) => ({ findMany: vi.fn().mockResolvedValue(rows) });
const dbWith = (overrides = {}, execute) => ({
  query: {
    CitizenUser: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', email: 'citizen@example.test', passwordHash: 'x' }) },
    ConversationLog: ok(), ProAppointment: ok(), AuthToken: ok(), SharedDiagnostic: ok(), ConsentLog: ok(), DSRRequest: ok(), RdvConversation: ok(),
    UserConsent: ok(), GuardianRelationship: ok(), LegalHold: ok(), AuditLog: ok(), ...overrides,
  },
  ...(execute ? { execute } : {}),
});

describe('R47 export completeness', () => {
  it('all reads succeed → complete:true', async () => {
    const out = await createPrivacyRightsService({ db: dbWith(), cryptoLib }).getExportData('u1');
    expect(out.exportInfo).toMatchObject({ complete: true });
    expect(out.exportInfo.failedSections).toBeUndefined();
  });
  it('a failed section read → complete:false, counted, with a notice; the rest is still exported', async () => {
    const db = dbWith({ ConsentLog: { findMany: vi.fn().mockRejectedValue(new Error('connection reset')) } });
    const out = await createPrivacyRightsService({ db, cryptoLib }).getExportData('u1');
    expect(out.exportInfo).toMatchObject({ complete: false, failedSections: 1 });
    expect(out.exportInfo.notice).toMatch(/Export incomplet/);
    expect(JSON.stringify(out)).not.toContain('connection reset');
  });
  it('a failed raw SQL section (execute) is counted too', async () => {
    const db = dbWith({}, vi.fn().mockRejectedValue(new Error('timeout')));
    const out = await createPrivacyRightsService({ db, cryptoLib }).getExportData('u1');
    expect(out.exportInfo.complete).toBe(false);
    expect(out.exportInfo.failedSections).toBeGreaterThan(0);
  });
  it('concurrent exports do not share their failure counts', async () => {
    const bad = dbWith({ AuthToken: { findMany: vi.fn().mockRejectedValue(new Error('x')) } });
    const [a, b] = await Promise.all([createPrivacyRightsService({ db: bad, cryptoLib }).getExportData('u1'), createPrivacyRightsService({ db: dbWith(), cryptoLib }).getExportData('u1')]);
    expect(a.exportInfo.complete).toBe(false); expect(b.exportInfo.complete).toBe(true);
  });
});
