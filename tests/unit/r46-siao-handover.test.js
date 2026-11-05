/**
 * R46 / R22 — the SI-SIAO adapter is honestly DISCONNECTED: documented handover format ada.siao-handover/1 (structure, no extra field, keyed pseudonym,
 * nothing invented), status line, GET status for a professional, and the capability gate (closed in production → 503 before authentication).
 */
import { describe, expect, it, vi } from 'vitest';
import { buildSiaoHandover, siaoAdapterStatus, siaoPseudonym, validateSiaoHandover, SIAO_HANDOVER_FORMAT } from '../../api/lib/siao-handover.js';

describe('R46 R22 SIAO handover format', () => {
  it('a complete situation: valid document, no missing element, the pseudonym is stable per dossier and keyed', () => {
    const a = buildSiaoHandover({ shareId: 'd-1', situation: { zipCode: '67000', isUrgent: false, nom: 'Jamais transmis' }, createdAt: '2026-10-01T00:00:00Z', secret: 'k1', now: new Date('2026-11-05T10:00:00Z') });
    expect(validateSiaoHandover(a)).toEqual([]);
    expect(a).toMatchObject({ format: SIAO_HANDOVER_FORMAT, generatedAt: '2026-11-05T10:00:00.000Z', transmission: 'MANUAL_BY_PROFESSIONAL', missing: [], consent: { purpose: 'PURP-07' } });
    expect(a.request).toMatchObject({ postalCode: '67000', urgent: false, dossierDate: '2026-10-01T00:00:00.000Z' });
    expect(JSON.stringify(a)).not.toMatch(/Jamais transmis|d-1/);
    expect(siaoPseudonym('d-1', 'k1')).toBe(a.request.pseudonym);
    expect(siaoPseudonym('d-1', 'k2')).not.toBe(a.request.pseudonym);
    expect(siaoPseudonym('d-2', 'k1')).not.toBe(a.request.pseudonym);
    expect(a.notice).toMatch(/n’est pas le format national SI-SIAO/);
  });
  it('nothing is invented: an absent or malformed postal code / urgency is null and listed as missing', () => {
    const b = buildSiaoHandover({ shareId: 'd-1', situation: { zipCode: '6700', isUrgent: 'oui' }, createdAt: null, secret: 'k' });
    expect(b.request).toMatchObject({ postalCode: null, urgent: null, dossierDate: null }); expect(b.missing).toEqual(['postalCode', 'urgent']);
    expect(validateSiaoHandover(b)).toEqual([]);
    expect(buildSiaoHandover({ shareId: 'd', situation: ['x'], secret: 'k' }).missing).toEqual(['postalCode', 'urgent']);
    expect(() => buildSiaoHandover({ shareId: 'd', situation: {}, secret: '' })).toThrow();
  });
  it('the validator refuses another format, an extra field or a raw identifier', () => {
    const ok = buildSiaoHandover({ shareId: 'd', situation: {}, secret: 'k' });
    expect(validateSiaoHandover({ ...ok, format: 'dgcs/2.0' })).toContain('format');
    expect(validateSiaoHandover({ ...ok, situation: {} })).toContain('extra-field');
    expect(validateSiaoHandover({ ...ok, request: { ...ok.request, shareId: 'd' } })).toContain('extra-request-field');
    expect(validateSiaoHandover({ ...ok, request: { ...ok.request, pseudonym: 'd' } })).toContain('pseudonym');
  });
  it('status: DISCONNECTED because no official interface specification exists (never CONNECTED without a transport)', () => {
    expect(siaoAdapterStatus()).toEqual({ provider: 'si-siao', status: 'DISCONNECTED', reason: 'NO_OFFICIAL_INTERFACE_SPEC', transmission: 'MANUAL_BY_PROFESSIONAL', format: SIAO_HANDOVER_FORMAT });
  });
});

describe('R46 R22 SIAO route', () => {
  const mk = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });
  it('production behaviour: the capability is closed — 503 CAPABILITY_NOT_OPEN, before authentication (no session read)', async () => {
    vi.resetModules();
    const old = { ...process.env };
    process.env.ADA_CAPABILITY_ENFORCEMENT = '1';   // production behaviour (VERCEL_ENV=production would also demand the production variables)
    try {
      const { default: handler } = await import('../../api/_handlers/pro/interop-siao.js');
      const r = mk(); await handler({ method: 'GET', headers: {}, url: '/api/pro/interop-siao' }, r);
      expect(r.statusCode).toBe(503); expect(r.body.code).toBe('CAPABILITY_NOT_OPEN');
    } finally { process.env = old; }
  });
});
