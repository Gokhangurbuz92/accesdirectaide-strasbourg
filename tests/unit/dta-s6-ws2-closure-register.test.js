/**
 * DTA S6 — the WS2 closure register covers every launch-data record exactly once, stays consistent with the findings module, never promotes launchReady,
 * never reproduces an e-mail address and does not treat self-declared CSV flags as verification.
 */
import { describe, expect, it } from 'vitest';
import { buildRegister } from '../../scripts/ws2-closure-register.mjs';
import { collectWs2Findings } from '../../scripts/ws2-findings.mjs';

describe('WS2 closure register (real LAB data)', () => {
  it('49 records, unique ids, fail-closed, consistent with the findings ratchet', async () => {
    const r = await buildRegister(); const f = await collectWs2Findings();
    expect(r.summary.records).toBe(49); expect(r.summary.byDataset).toEqual({ aides: 15, demarches: 10, structures: 24 });
    expect(new Set(r.records.map((x) => x.id)).size).toBe(49);
    expect(r.launchReady).toBe(false);
    expect(r.records.flatMap((x) => x.defects)).toHaveLength(f.findings.length);
    expect(r.summary.findingsBySeverity).toEqual({ BLOCKING: 19, REVIEW: 19, PRIVACY_REVIEW: 4 });   // PKG-1 / N1: +1 PERSONAL_PHONE_REVIEW (mobile number in a structure record)
    expect(r.summary.withBlocking + r.summary.withoutTechnicalBlocker).toBe(49);
  });
  it('every record lists human verification still required and no technical correction is claimed (data files are not modified)', async () => {
    const r = await buildRegister();
    for (const x of r.records) { expect(x.humanVerificationRequired.length, x.id).toBeGreaterThanOrEqual(3); expect(x.technicalCorrectionMade, x.id).toBeNull(); expect(x.launchImpact, x.id).toMatch(/BLOCKING|NOT_LAUNCH_READY/); expect(x.evidence.note).toMatch(/NOT verification/); }
    expect(r.records.some((x) => x.launchImpact.startsWith('NOT_LAUNCH_READY'))).toBe(true);
  });
  it('no e-mail address appears anywhere in the register', async () => { expect(JSON.stringify(await buildRegister())).not.toMatch(/@/); });
});
