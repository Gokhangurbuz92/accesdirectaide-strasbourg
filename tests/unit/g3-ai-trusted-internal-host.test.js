/**
 * G3 (19/11/2026) — LOCALITY.TRUSTED_INTERNAL_CONTROLLED was unreachable: classifyLocality only ever returned LOCAL_LOOPBACK / EXTERNAL / UNKNOWN, so the
 * policy branch for an approved, operator-controlled host (e.g. an EU-hosted Ollama) was dead code. It is now reachable ONLY through the explicit allow-list
 * AI_TRUSTED_INTERNAL_HOSTS (exact host[:port], https only, no wildcard, empty by default = fail-closed). Unset ⇒ behaviour identical to before.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AIProviderPolicy, AUDIENCE, LOCALITY, PROVIDER } from '../../api/lib/ai-policy.js';

const KEYS = ['AI_TRUSTED_INTERNAL_HOSTS', 'ALLOW_TRUSTED_INTERNAL_OLLAMA'];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const classify = (u) => AIProviderPolicy.classifyLocality(u);
const ollama = (u, audience = AUDIENCE.CITIZEN) => AIProviderPolicy.evaluate({ provider: PROVIDER.OLLAMA, audience, locality: classify(u) });

describe('trusted internal host allow-list', () => {
  it('unset: a remote https host stays EXTERNAL and is refused (production behaviour unchanged)', () => {
    expect(classify('https://ai.ada.example.eu')).toBe(LOCALITY.EXTERNAL);
    process.env.ALLOW_TRUSTED_INTERNAL_OLLAMA = 'true';
    expect(ollama('https://ai.ada.example.eu')).toEqual({ allowed: false, reason: 'EXTERNAL_OLLAMA_DENIED_BY_DEFAULT' });
    expect(classify('http://127.0.0.1:11434')).toBe(LOCALITY.LOCAL_LOOPBACK);
  });

  it('empty or blank list is the same as unset', () => {
    for (const v of ['', ' ', ',', ' , ']) { process.env.AI_TRUSTED_INTERNAL_HOSTS = v; expect(classify('https://ai.ada.example.eu')).toBe(LOCALITY.EXTERNAL); }
  });

  it('a listed exact host over https is TRUSTED_INTERNAL_CONTROLLED (case-insensitive, default port only unless the entry names a port)', () => {
    process.env.AI_TRUSTED_INTERNAL_HOSTS = 'AI.ada.example.eu, gpu.ada.example.eu:8443';
    expect(classify('https://ai.ada.example.eu')).toBe(LOCALITY.TRUSTED_INTERNAL_CONTROLLED);
    expect(classify('https://ai.ada.example.eu:443/api/tags')).toBe(LOCALITY.TRUSTED_INTERNAL_CONTROLLED);
    expect(classify('https://gpu.ada.example.eu:8443')).toBe(LOCALITY.TRUSTED_INTERNAL_CONTROLLED);
    expect(classify('https://gpu.ada.example.eu')).toBe(LOCALITY.EXTERNAL);
    expect(classify('https://ai.ada.example.eu:8443')).toBe(LOCALITY.EXTERNAL);
  });

  it('the policy still requires ALLOW_TRUSTED_INTERNAL_OLLAMA=true for a trusted host', () => {
    process.env.AI_TRUSTED_INTERNAL_HOSTS = 'ai.ada.example.eu';
    expect(ollama('https://ai.ada.example.eu')).toEqual({ allowed: false, reason: 'TRUSTED_INTERNAL_CONTROLLED_REQUIRES_EXPLICIT_CONFIG' });
    process.env.ALLOW_TRUSTED_INTERNAL_OLLAMA = 'true';
    expect(ollama('https://ai.ada.example.eu')).toEqual({ allowed: true });
  });

  it('lookalikes, subdomains, parents, http, userinfo and other schemes are refused', () => {
    process.env.AI_TRUSTED_INTERNAL_HOSTS = 'ai.ada.example.eu';
    process.env.ALLOW_TRUSTED_INTERNAL_OLLAMA = 'true';
    for (const u of [
      'http://ai.ada.example.eu', 'https://evil.ai.ada.example.eu', 'https://ada.example.eu', 'https://ai.ada.example.eu.attacker.net',
      'https://ai-ada.example.eu', 'https://aiada.example.eu', 'https://user:pw@ai.ada.example.eu', 'https://x@ai.ada.example.eu',
      'ws://ai.ada.example.eu', 'ftp://ai.ada.example.eu', 'https://ai.ada.example.eu.',
    ]) {
      expect(classify(u), u).not.toBe(LOCALITY.TRUSTED_INTERNAL_CONTROLLED);
      expect(ollama(u).allowed, u).toBe(false);
    }
  });

  it('wildcard, scheme, path or userinfo entries are ignored (never widen the list)', () => {
    process.env.ALLOW_TRUSTED_INTERNAL_OLLAMA = 'true';
    for (const entry of ['*.ada.example.eu', '*', 'https://ai.ada.example.eu', 'ai.ada.example.eu/api', 'u@ai.ada.example.eu', '.ada.example.eu']) {
      process.env.AI_TRUSTED_INTERNAL_HOSTS = entry;
      expect(classify('https://ai.ada.example.eu'), entry).toBe(LOCALITY.EXTERNAL);
      expect(classify('https://x.ada.example.eu'), entry).toBe(LOCALITY.EXTERNAL);
    }
  });

  it('Gemini is still refused for every audience, whatever the list says', () => {
    process.env.AI_TRUSTED_INTERNAL_HOSTS = 'generativelanguage.googleapis.com';
    process.env.ALLOW_TRUSTED_INTERNAL_OLLAMA = 'true';
    for (const audience of Object.values(AUDIENCE)) {
      expect(AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience, locality: classify('https://generativelanguage.googleapis.com') }).allowed).toBe(false);
    }
  });
});
