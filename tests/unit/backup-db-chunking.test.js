/**
 * Launch-readiness item 52 — cron/backup-db is RETIRED: it used to write a partial JSON copy of a few tables (conversations, audit lines with IP addresses) in
 * clear into the object storage, never expired and never restorable. Called now, it still checks the cron authentication and reads / uploads NOTHING.
 * (This file tested the chunked export; the replacement — provider PITR + scripts/db-backup.mjs, encrypted — is tested in tests/integration/db-backup-restore-db.test.js.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbTouched, mockUpload, auth } = vi.hoisted(() => ({ dbTouched: vi.fn(), mockUpload: vi.fn(), auth: { ok: true, reason: null } }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get: () => { dbTouched(); throw new Error('DB_TOUCHED'); } }) }));
vi.mock('../../api/lib/storage.js', () => ({ storage: { upload: (...a) => mockUpload(...a) } }));
vi.mock('../../api/lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: vi.fn(() => ({ ...auth })) }));

const mk = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe('cron/backup-db (retired)', () => {
  beforeEach(() => { dbTouched.mockClear(); mockUpload.mockClear(); auth.ok = true; auth.reason = null; });
  it('authenticated: answers « retired » and reads or uploads nothing', async () => {
    const { default: handler } = await import('../../api/_handlers/cron/backup-db.js');
    const r = mk(); await handler({ method: 'GET', headers: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ skipped: 'retired' });
    expect(dbTouched).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
  it('still refuses an unauthenticated call', async () => {
    const { default: handler } = await import('../../api/_handlers/cron/backup-db.js');
    auth.ok = false; auth.reason = 'bad_secret';
    const r = mk(); await handler({ method: 'GET', headers: {} }, r);
    expect(r.statusCode).toBe(401);
  });
  it('is no longer scheduled', async () => {
    const { readFileSync } = await import('node:fs');
    expect(JSON.parse(readFileSync('vercel.json', 'utf8')).crons.map((c) => c.path)).not.toContain('/api/cron/backup-db');
  });
});
