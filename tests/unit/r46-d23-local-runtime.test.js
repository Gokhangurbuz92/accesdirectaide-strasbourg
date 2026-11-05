/**
 * R46 (D23) — the local AI runtime behind the provider abstraction: status against a loopback STUB of Ollama's /api/tags (models present / missing /
 * unreachable), an external endpoint never contacted, and no cloud fallback even when AI_FALLBACK_PROVIDER=gemini and a Gemini key are configured: the
 * policy refuses the cloud provider for every audience, so a failing local model ends in UNAVAILABLE and no request leaves the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

let server;
const stubOllama = async (models) => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models })); return; }
    res.writeHead(500); res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
};
const KEYS = ['OLLAMA_BASE_URL', 'GEMINI_API_KEY', 'AI_FALLBACK_PROVIDER', 'AI_PRIMARY_PROVIDER', 'ALLOW_TRUSTED_INTERNAL_OLLAMA'];
let saved;
beforeEach(() => { vi.resetModules(); saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); });
afterEach(async () => { vi.unstubAllGlobals(); for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } if (server) await new Promise((r) => server.close(r)); server = null; });

describe('D23 local runtime status', () => {
  it('READY when both models are installed (digest shortened), never a cloud fallback', async () => {
    const url = await stubOllama([{ name: 'qwen3:8b', digest: 'abcdef0123456789' }, { name: 'nomic-embed-text:latest', digest: '0123456789abcdef' }]);
    const { localRuntimeStatus } = await import('../../api/lib/ai-foundation.js');
    expect(await localRuntimeStatus({ endpoint: url })).toEqual({ state: 'READY', locality: 'LOCAL_LOOPBACK', cloudFallback: false,
      models: { 'qwen3:8b': { present: true, digest: 'abcdef012345' }, 'nomic-embed-text': { present: true, digest: '0123456789ab' } } });
  });
  it('MODEL_MISSING when the embedding model is absent; UNREACHABLE when nothing listens', async () => {
    const url = await stubOllama([{ name: 'qwen3:8b' }]);
    const { localRuntimeStatus } = await import('../../api/lib/ai-foundation.js');
    expect(await localRuntimeStatus({ endpoint: url })).toMatchObject({ state: 'MODEL_MISSING', models: { 'nomic-embed-text': { present: false } } });
    expect(await localRuntimeStatus({ endpoint: 'http://127.0.0.1:9', timeoutMs: 500 })).toMatchObject({ state: 'UNREACHABLE', cloudFallback: false });
  });
  it('an external or unknown endpoint is refused by the policy and never contacted', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('must not be called'); }); vi.stubGlobal('fetch', fetchSpy);
    const { localRuntimeStatus } = await import('../../api/lib/ai-foundation.js');
    expect(await localRuntimeStatus({ endpoint: 'https://ollama.example.test' })).toMatchObject({ state: 'REFUSED_BY_POLICY', locality: 'EXTERNAL', policyReason: 'EXTERNAL_OLLAMA_DENIED_BY_DEFAULT' });
    expect(await localRuntimeStatus({ endpoint: 'not a url' })).toMatchObject({ state: 'REFUSED_BY_POLICY', locality: 'UNKNOWN' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('D23 no cloud fallback (provider abstraction)', () => {
  it('cloudFallbackAllowed() is false: the policy refuses Gemini for every audience', async () => {
    const { cloudFallbackAllowed } = await import('../../api/lib/ai-foundation.js');
    expect(cloudFallbackAllowed()).toBe(false);
  });
  it.each(['CITIZEN', 'PROFESSIONAL', 'ADMIN'])('local model down + AI_FALLBACK_PROVIDER=gemini + a key (%s): UNAVAILABLE, no request leaves loopback', async (audience) => {
    process.env.GEMINI_API_KEY = 'synthetic-not-a-key'; process.env.AI_FALLBACK_PROVIDER = 'gemini'; process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9'; delete process.env.AI_PRIMARY_PROVIDER;
    const hosts = [];
    vi.stubGlobal('fetch', vi.fn(async (u) => { hosts.push(new URL(String(u?.url || u)).hostname); throw new Error('ECONNREFUSED'); }));
    const { generateStructuredContent } = await import('../../api/lib/ai-foundation.js');
    const out = await generateStructuredContent({ prompt: 'question synthétique', audience, primaryProvider: 'ollama' });
    expect(out.content).toBeNull(); expect(out.safeErrorState).toBe('UNAVAILABLE');
    expect(hosts.every((h) => h === '127.0.0.1')).toBe(true);
  });
  it('a cloud provider asked as PRIMARY is refused too (no request)', async () => {
    process.env.GEMINI_API_KEY = 'synthetic-not-a-key';
    const fetchSpy = vi.fn(async () => { throw new Error('must not be called'); }); vi.stubGlobal('fetch', fetchSpy);
    const { generateStructuredContent } = await import('../../api/lib/ai-foundation.js');
    const out = await generateStructuredContent({ prompt: 'x', audience: 'PROFESSIONAL', primaryProvider: 'gemini', allowFallback: false });
    expect(out.safeErrorState).toBe('UNAVAILABLE'); expect(fetchSpy).not.toHaveBeenCalled();
  });
});
