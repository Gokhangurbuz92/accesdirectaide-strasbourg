/**
 * R12 — P26: POST /api/tts is retired (410, no provider is ever called: the voice is the device's own). P19: the PUBLIC_FEEDBACK kill switch also closes
 * /api/feedback (it files a ContentReport like /api/reports).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_services/feature-flags.js', () => ({ isFeatureOn: async () => false }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get: () => { throw new Error('DB_TOUCHED'); } }) }));
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });

describe('R12 tts / feedback', () => {
  it('/api/tts answers 410 and imports no voice provider', async () => {
    const { default: tts } = await import('../../api/_handlers/tts.js');
    const r = mk(); await tts({ method: 'POST', body: { text: 'Bonjour' }, headers: {} }, r);
    expect(r.statusCode).toBe(410); expect(r.body.error).toBe('SERVER_TTS_RETIRED');
    expect(readFileSync('api/_handlers/tts.js', 'utf8')).not.toMatch(/gemini|fetch\(/);
  });
  it('/api/feedback is closed by the kill switch before anything is stored', async () => {
    const { default: feedback } = await import('../../api/_handlers/feedback.js');
    const r = mk(); await feedback({ method: 'POST', body: { contentType: 'AIDE', contentId: 'x', reason: 'AUTRE' }, headers: {} }, r);
    expect(r.statusCode).toBe(503); expect(r.body.error).toBe('FEATURE_DISABLED');
  });
});
