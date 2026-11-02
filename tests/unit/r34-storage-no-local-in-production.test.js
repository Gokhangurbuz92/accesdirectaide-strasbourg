/**
 * R34 (R33 audit G11): with ADA_LOCAL_STORAGE_DIR set, production must not write the Coffre or attachments to the hosting's ephemeral disk — it ignores
 * the local store and requires object storage (503 when it is not configured). In the LAB the local store keeps working.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STORAGE_KEYS = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'];
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.resetModules(); });

async function load(envOverrides) {
  vi.resetModules();
  for (const k of STORAGE_KEYS) delete process.env[k];
  Object.assign(process.env, envOverrides);
  return (await import('../../api/lib/storage.js')).storage;
}

describe('storage — no local disk in production', () => {
  it('production with ADA_LOCAL_STORAGE_DIR and no object storage: refused (503), nothing written to the directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-g11-'));
    const storage = await load({ VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://u@db.example.test/x', ADA_LOCAL_STORAGE_DIR: dir });
    await expect(storage.upload(Buffer.from('x'), 'text/plain')).rejects.toMatchObject({ statusCode: 503 });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it('the LAB (not production) still uses the local store', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-g11-lab-'));
    const storage = await load({ VERCEL_ENV: 'development', NODE_ENV: 'test', ADA_LOCAL_STORAGE_DIR: dir });
    const key = await storage.upload(Buffer.from('lab'), 'text/plain');
    expect(typeof key).toBe('string');
    expect(fs.readdirSync(dir).length).toBeGreaterThan(0);
  });
});
