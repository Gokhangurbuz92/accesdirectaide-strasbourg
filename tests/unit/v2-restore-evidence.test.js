// V2 C7 — restore-verification evidence checker (scripts/check-restore-evidence.mjs): the durable record (Healthchecks ping body, saved as
// CONTROL/v2/c7/EVIDENCE_<date>.json) is accepted only when the restore, the checks, the erasure replay and the wipe all succeeded, and it may carry
// counts, codes, digests and object names only.
import { describe, expect, it } from 'vitest';
import { checkEvidence } from '../../scripts/check-restore-evidence.mjs';

const good = () => ({ kind: 'ada-restore-verification', ok: true, failures: [], verifiedAt: '2026-12-03T03:12:00.000Z', dump: 'prod/ada_prod_20261203T021700Z.dump.enc',
  backupTakenAt: '2026-12-03T02:17:00.000Z', backupAgeHours: 0.9, encryptedBytes: 266693, dumpSha256: 'a'.repeat(64), restoredTables: 108,
  checks: { sidecar: true, objectDigest: true, coreTablesMissing: [], migrationRows: 43, expectedMigrations: 43, journalEntries: 46, migrationsMatch: true, migrationsPlausible: true, ledger: true },
  erasureReplay: { mode: 'dry-run', ledgerEntries: 2, presentAgain: 0, holdsMissing: 0 }, seconds: 41, wiped: true });

describe('V2 C7 restore evidence checker', () => {
  it('accepts a complete, wiped, matching record and summarises it', () => {
    const r = checkEvidence(good());
    expect(r).toMatchObject({ accepted: true, problems: [], summary: { wiped: true, migrations: 43, expectedMigrations: 43, erasedPeoplePresentAgain: 0 } });
  });
  it.each([
    ['not wiped', (e) => { e.wiped = false; }, 'NOT_WIPED'],
    ['no expected migration count', (e) => { e.checks.migrationsMatch = null; e.checks.expectedMigrations = null; }, 'MIGRATIONS_NOT_MATCHED'],
    ['no erasure replay', (e) => { e.erasureReplay = null; }, 'ERASURE_REPLAY'],
    ['failed run', (e) => { e.ok = false; e.failures = ['LEDGER_MISSING']; }, 'FAILURES_PRESENT'],
    ['sidecar not checked', (e) => { e.checks.sidecar = false; }, 'SIDECAR_NOT_CHECKED'],
    ['bad digest', (e) => { e.dumpSha256 = 'xyz'; }, 'DUMP_SHA256'],
    ['not a dump object', (e) => { e.dump = 'prod/ada_erasures_20261203T021700Z.json.enc'; }, 'DUMP_NAME'],
  ])('refuses: %s', (_n, mutate, code) => {
    const e = good(); mutate(e);
    const r = checkEvidence(e);
    expect(r.accepted).toBe(false);
    expect(r.problems).toContain(code);
  });
  it('privacy: any field outside the known counts/codes/digests is refused (row content, e-mail, credential)', () => {
    for (const extra of [{ email: 'someone@example.invalid' }, { rows: [{ id: 1 }] }, { BACKUP_PRIVATE_KEY_PASSPHRASE: 'x' }]) {
      const r = checkEvidence({ ...good(), ...extra });
      expect(r.accepted).toBe(false);
      expect(r.problems.some((p) => p.startsWith('UNKNOWN_FIELD:'))).toBe(true);
    }
    const nested = good(); nested.checks.sample = 'x';
    expect(checkEvidence(nested).problems).toContain('UNKNOWN_FIELD:checks.sample');
  });
  it('a failure record from the job (code + wiped) is reported as not accepted with its code', () => {
    const r = checkEvidence({ kind: 'ada-restore-verification', ok: false, code: 'RESTORE_FAILED', stage: 'db-restore.mjs', wiped: true, verifiedAt: '2026-12-03T03:12:00.000Z' });
    expect(r.accepted).toBe(false);
    expect(r.problems).toContain('NOT_OK:RESTORE_FAILED');
  });
});
