import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalFilesystemStorage } from '../../api/lib/LocalFilesystemStorage.js';

describe('WS7 remediation evidence', () => {
  it('round-trips document bytes through isolated local storage and cleans up', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ada-ws7-doc-'));
    try {
      const root = path.join(temp, 'documents');
      const storage = new LocalFilesystemStorage(root);
      await storage.healthCheck();
      const payload = Buffer.from([0, 1, 2, 254, 255, 65, 68, 65]);
      const key = await storage.upload(payload, 'application/octet-stream');
      const downloaded = await storage.download(key);
      expect(Buffer.compare(downloaded, payload)).toBe(0);
      await storage.delete(key);
      await storage.delete(key);
      await expect(fs.readFile(path.join(root, key))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  it('keeps capability secrets out of query/path transport and requires DB atomicity primitives', async () => {
    const rdv = await fs.readFile(new URL('../../api/_handlers/rdv.js', import.meta.url), 'utf8');
    const app = await fs.readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
    const html = await fs.readFile(new URL('../../index.html', import.meta.url), 'utf8');
    expect(rdv).not.toMatch(/params\.set\(['"]token['"],\s*token\)/);
    expect(rdv).toContain("fragment.set('token', token)");
    expect(rdv).toContain('url.hash = fragment.toString()');
    expect(rdv).toContain('WS7_REQUIRE_DURABLE_RDV_SECRET');
    expect(rdv).toContain('pg_advisory_xact_lock');
    expect(rdv).toContain('.transaction(async (tx)');
    expect(app).not.toContain('/appointments/cancel/:token');
    expect(app).not.toContain('/appointments/reschedule/:token');
    expect(html).toContain('content="no-referrer"');
  });
});
