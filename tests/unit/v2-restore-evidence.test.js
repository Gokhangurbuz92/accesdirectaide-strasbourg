// V2 C7 — restore-verification evidence checker (scripts/check-restore-evidence.mjs): the durable record (Healthchecks ping body, saved as
// CONTROL/v2/c7/EVIDENCE_<date>.json) is accepted only when the restore, the checks, the erasure replay and the wipe all succeeded, and it may carry
// counts, codes, digests and object names only.
import { describe, expect, it } from 'vitest';
import { checkEvidence } from '../../scripts/check-restore-evidence.mjs';
import { ATTESTATION, evidenceStoreConfig } from '../../scripts/cloud-restore-verify.mjs';

const good = () => ({ kind: 'ada-restore-verification', ok: true, failures: [], verifiedAt: '2026-12-03T03:12:00.000Z', dump: 'prod/ada_prod_20261203T021700Z.dump.enc',
  backupTakenAt: '2026-12-03T02:17:00.000Z', backupAgeHours: 0.9, encryptedBytes: 266693, dumpSha256: 'a'.repeat(64), restoredTables: 108,
  checks: { sidecar: true, objectDigest: true, signatures: true, coreTablesMissing: [], migrationRows: 43, expectedMigrations: 43, journalEntries: 46, migrationsMatch: true, migrationsPlausible: true, ledger: true },
  erasureReplay: { mode: 'dry-run', ledgerEntries: 2, presentAgain: 0, holdsMissing: 0 }, seconds: 41, wiped: true,
  attestation: JSON.parse(JSON.stringify(ATTESTATION)), evidenceStored: 'evidence/ada_restore_evidence_20261203T031200123Z_0a1b2c3d_ok.json' });

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
    ['producer signatures not checked (an older verifier)', (e) => { delete e.checks.signatures; }, 'SIGNATURES_NOT_CHECKED'],
    ['no attestation (record made before signing: e.g. the first synthetic sample)', (e) => { delete e.attestation; }, 'ATTESTATION_MISSING'],
    ['attestation without the ledger signature', (e) => { e.attestation.verified = ['dumpSha256', 'dumpSignature', 'gcmTag']; }, 'ATTESTATION_MISSING'],
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
  it('summary separates what was verified cryptographically from what was measured or read from the signed name', () => {
    const r = checkEvidence(good());
    expect(r.summary.cryptographicallyVerified).toEqual(['dumpSha256', 'dumpSignature', 'ledgerSignature', 'gcmTag']);
    expect(r.summary.fromSignedName).toEqual(['backupTakenAt', 'backupAgeHours']);
    expect(r.summary.notProven).toEqual(['dumpCompleteness']);
  });
  it('evidence store: optional, EU rules, never the backups bucket', () => {
    expect(evidenceStoreConfig({})).toBeNull();
    const base = { EVIDENCE_S3_ENDPOINT: 'https://abc123.eu.r2.cloudflarestorage.com', EVIDENCE_S3_BUCKET: 'ada-restore-evidence', EVIDENCE_S3_ACCESS_KEY_ID: 'k', EVIDENCE_S3_SECRET_ACCESS_KEY: 's', BACKUP_S3_BUCKET: 'ada-db-backups' };
    expect(evidenceStoreConfig(base)).toMatchObject({ ok: true, prefix: 'evidence/' });
    expect(evidenceStoreConfig({ ...base, EVIDENCE_S3_BUCKET: 'ada-db-backups' })).toMatchObject({ ok: false, reason: 'EVIDENCE_BUCKET_SAME_AS_BACKUPS' });
    expect(evidenceStoreConfig({ ...base, EVIDENCE_S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com' })).toMatchObject({ ok: false, reason: 'EVIDENCE_BUCKET_ENDPOINT_NOT_EU_JURISDICTION' });
    expect(evidenceStoreConfig({ ...base, EVIDENCE_S3_SECRET_ACCESS_KEY: '' })).toMatchObject({ ok: false, reason: 'EVIDENCE_BUCKET_CONFIG_MISSING' });
  });
});
