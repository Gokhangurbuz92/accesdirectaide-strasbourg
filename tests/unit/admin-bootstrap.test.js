/**
 * Launch-readiness item 44 — the first production administrator is created by scripts/admin-bootstrap.mjs, never from environment variables.
 * The decisions before any write (pure functions; the database path is in tests/integration/admin-bootstrap-db.test.js).
 */
import { describe, expect, it } from 'vitest';
import { connectionOptions, databaseHost, planBootstrap, validateIdentity } from '../../scripts/admin-bootstrap.mjs';

const REMOTE = 'postgresql://owner:PLANTED-DB-PASSWORD@db.example.test:5432/prod?sslmode=no-verify';

describe('admin bootstrap (decisions, no database)', () => {
  it('names the database host without the credentials of the connection string', () => {
    expect(databaseHost(REMOTE)).toBe('db.example.test');
    expect(databaseHost('postgresql://u@[::1]:5432/x')).toBe('::1');
    expect(databaseHost('not a url')).toBe('');
  });
  it('requires the host typed again, and it must match', () => {
    expect(planBootstrap({ url: REMOTE, confirmHost: '', adminCount: 0 })).toMatchObject({ ok: false, reason: expect.stringContaining('--confirm-host db.example.test') });
    expect(planBootstrap({ url: REMOTE, confirmHost: 'other.example.test', adminCount: 0 })).toMatchObject({ ok: false, reason: expect.stringContaining('ne correspond pas') });
    expect(planBootstrap({ url: REMOTE, confirmHost: 'DB.example.test', adminCount: 0 })).toEqual({ ok: true, local: false });
    expect(planBootstrap({ url: '', confirmHost: 'x', adminCount: 0 }).ok).toBe(false);
  });
  it('creates only the FIRST account, unless a further named account is asked for explicitly', () => {
    expect(planBootstrap({ url: REMOTE, confirmHost: 'db.example.test', adminCount: 1 })).toMatchObject({ ok: false, reason: expect.stringContaining('--additional') });
    expect(planBootstrap({ url: REMOTE, confirmHost: 'db.example.test', adminCount: 1, additional: true }).ok).toBe(true);
  });
  it('a remote database is reached with a verified certificate, whatever sslmode the URL carries', () => {
    const o = connectionOptions(REMOTE);
    expect(o.ssl).toEqual({ rejectUnauthorized: true, servername: 'db.example.test' });
    expect(o.connectionString).not.toContain('sslmode');
    expect(connectionOptions('postgresql://u@127.0.0.1:5432/x').ssl).toBe(false);
  });
  it('one named person, one account', () => {
    const ok = { email: 'prenom.nom@example.test', name: 'Prénom Nom', role: 'admin', attest: 'oui' };
    expect(validateIdentity(ok)).toBeNull();
    expect(validateIdentity({ ...ok, email: 'nope' })).toMatch(/adresse/);
    expect(validateIdentity({ ...ok, name: 'X' })).toMatch(/nom et le prénom/);
    expect(validateIdentity({ ...ok, role: 'root' })).toMatch(/rôle/);
    expect(validateIdentity({ ...ok, attest: 'non' })).toMatch(/personnel/);
  });
});
