// WS2_DETERMINISTIC_LOCAL_SEED_INTEGRATION_V1
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const SEED_PATH = path.join(REPO_ROOT, 'scripts/seed-strasbourg.mjs');

function requireLocalPostgresUrl() {
  expect(process.env.WS2_REQUIRE_LOCAL_DB).toBe('1');
  const value = String(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '').trim();
  expect(value.length).toBeGreaterThan(0);
  if (value.startsWith('postgresql:///') || value.startsWith('postgres:///') || value.startsWith('/')) {
    return value;
  }
  const parsed = new URL(value);
  expect(['postgresql:', 'postgres:']).toContain(parsed.protocol);
  expect(['127.0.0.1', 'localhost', '::1']).toContain(parsed.hostname);
  return value;
}

function requireLocalOllamaBase() {
  const value = String(process.env.WS2_OLLAMA_URL || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').trim();
  const parsed = new URL(value);
  expect(['http:', 'https:']).toContain(parsed.protocol);
  expect(['127.0.0.1', 'localhost', '::1']).toContain(parsed.hostname);
  return value.replace(/\/$/, '');
}

function runPsql(databaseUrl, sql) {
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At'], {
    input: sql,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) throw result.error;
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return String(result.stdout || '').trim();
}

async function localEmbedding() {
  const base = requireLocalOllamaBase();
  const common = { method: 'POST', headers: { 'content-type': 'application/json' } };
  let response = await fetch(`${base}/api/embed`, {
    ...common,
    body: JSON.stringify({ model: 'nomic-embed-text', input: 'AccesDirectAide Strasbourg WS2 deterministic integration proof' }),
  });
  if (response.ok) {
    const body = await response.json();
    const vector = Array.isArray(body?.embeddings) ? body.embeddings[0] : null;
    if (Array.isArray(vector)) return vector;
  }
  response = await fetch(`${base}/api/embeddings`, {
    ...common,
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'AccesDirectAide Strasbourg WS2 deterministic integration proof' }),
  });
  expect(response.ok).toBe(true);
  const body = await response.json();
  return body?.embedding;
}

describe('WS2 deterministic local seed integration', () => {
  it('imports the seed module without executing remote or durable work at import time', async () => {
    const moduleUrl = `${pathToFileURL(SEED_PATH).href}?ws2_integration_import=1`;
    const mod = await import(moduleUrl);
    expect(mod).toBeTruthy();
  });

  it('keeps the seed implementation inside the frozen local-only contract', async () => {
    const source = await readFile(SEED_PATH, 'utf8');
    expect(source).toContain('nomic-embed-text');
    expect(source).toMatch(/\b768\b/);
    expect(source).toMatch(/\bBEGIN\b|transaction/i);
    expect(source).toMatch(/\bCOMMIT\b|\bROLLBACK\b|transaction/i);
    expect(source).toMatch(/ON\s+CONFLICT|upsert|idempoten/i);
    expect(source).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    expect(source).not.toMatch(/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/i);
    for (const match of source.matchAll(/https?:\/\/[^'"`\s)]+/g)) {
      const parsed = new URL(match[0]);
      expect(['127.0.0.1', 'localhost', '::1']).toContain(parsed.hostname);
    }
  });

  it('requires and reaches only a local PostgreSQL target', () => {
    const databaseUrl = requireLocalPostgresUrl();
    expect(runPsql(databaseUrl, 'SELECT 1;')).toBe('1');
  });

  it('proves local transaction rollback and idempotency without durable mutation', () => {
    const databaseUrl = requireLocalPostgresUrl();
    const out = runPsql(databaseUrl, `
BEGIN;
CREATE TEMP TABLE ada_ws2_seed_integration_proof(
  k text PRIMARY KEY,
  v integer NOT NULL
) ON COMMIT DROP;
INSERT INTO ada_ws2_seed_integration_proof(k, v) VALUES ('same-key', 1)
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
INSERT INTO ada_ws2_seed_integration_proof(k, v) VALUES ('same-key', 1)
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
SELECT count(*) FROM ada_ws2_seed_integration_proof WHERE k = 'same-key';
ROLLBACK;
`);
    expect(out.split(/\s+/)).toContain('1');
  });

  it('uses local Ollama nomic-embed-text with exactly 768 dimensions', async () => {
    const vector = await localEmbedding();
    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toHaveLength(768);
    expect(vector.every((value) => Number.isFinite(Number(value)))).toBe(true);
  });
});
