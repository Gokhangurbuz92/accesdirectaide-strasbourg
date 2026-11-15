/**
 * RA-08 — the restore verifier no longer needs a hand-maintained RESTORE_EXPECT_MIGRATIONS: the expected migration history is derived from the journal
 * shipped with the release and the restored rows. (Before: a bare count, 43, to change by hand at every Production migration — forgotten, the monthly
 * verification failed; or worse, left unset, only « not longer than the journal » was checked.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { deriveMigrationExpectation, journalEntries, MAY_BE_ABSENT } from '../../scripts/cloud-restore-verify.mjs';
import { OBSOLETE_MIGRATIONS } from '../../scripts/db-migrate-guard.mjs';
import { checkEvidence } from '../../scripts/check-restore-evidence.mjs';
import { ATTESTATION } from '../../scripts/cloud-restore-verify.mjs';

const journal = journalEntries();
const whenOf = (tag) => journal.find((e) => e.tag.startsWith(tag)).when;
const upTo = (tag, skip = []) => journal.filter((e) => e.when <= whenOf(tag) && !skip.some((s) => e.tag.startsWith(s))).map((e) => e.when);

describe('RA-08 expected migrations derived from the journal', () => {
  it('the obsolete list is the migration guard’s list, and both are journal entries', () => {
    expect([...MAY_BE_ABSENT]).toEqual([...OBSOLETE_MIGRATIONS]);
    for (const t of MAY_BE_ABSENT) expect(journal.some((e) => e.tag === t), t).toBe(true);
  });
  it('Production at 0042: 43 rows, derived — and 44 after 0045 without touching any variable', () => {
    expect(deriveMigrationExpectation(journal, upTo('0042'))).toMatchObject({ derived: true, ok: true, expected: 43, highest: '0042_r31_orientation_funding_pilot', missing: [] });
    expect(deriveMigrationExpectation(journal, upTo('0045', ['0043', '0044']))).toMatchObject({ ok: true, expected: 44, highest: '0045_r43_appointment_notice_kinds' });
  });
  it('a LAB database with every migration (0043 / 0044 included) is whole too', () => {
    expect(deriveMigrationExpectation(journal, journal.map((e) => e.when))).toMatchObject({ ok: true, expected: journal.length });
  });
  it('a hole, an unknown row, a duplicate or an empty history fail', () => {
    const holed = upTo('0042').filter((w) => w !== whenOf('0020'));
    expect(deriveMigrationExpectation(journal, holed)).toMatchObject({ ok: false, expected: 43, missing: [journal.find((e) => e.tag.startsWith('0020')).tag] });
    expect(deriveMigrationExpectation(journal, [...upTo('0042'), 123])).toMatchObject({ ok: false, unknown: 1 });
    expect(deriveMigrationExpectation(journal, [...upTo('0042'), whenOf('0001')])).toMatchObject({ ok: false, duplicates: 1 });
    expect(deriveMigrationExpectation(journal, [])).toMatchObject({ derived: true, ok: false });
    expect(deriveMigrationExpectation(journal, upTo('0042').slice(0, 10))).toMatchObject({ ok: true, expected: 10 });   // an older dump: whole up to its own newest row
  });
  it('without a journal or without the restored rows nothing is derived (the explicit count and the plausibility check remain)', () => {
    expect(deriveMigrationExpectation(null, [1])).toMatchObject({ derived: false, ok: null });
    expect(deriveMigrationExpectation(journal, undefined)).toMatchObject({ derived: false, ok: null });
  });
  it('the job no longer requires the variable; the restore reports the history rows', () => {
    const sh = fs.readFileSync('ops/cloud-backup/job-entrypoint.sh', 'utf8');
    expect(sh).not.toMatch(/RESTORE_EXPECT_MIGRATIONS:\?/);
    expect(sh).toMatch(/\$\{RESTORE_EXPECT_MIGRATIONS:\+--expect-migrations "\$RESTORE_EXPECT_MIGRATIONS"\}/);
    expect(fs.readFileSync('scripts/db-restore.mjs', 'utf8')).toMatch(/migrationWhens: whens/);
    expect(fs.readFileSync('docs/database.md', 'utf8')).toMatch(/RESTORE_EXPECT_MIGRATIONS/);
  });
});

describe('RA-08 the evidence checker accepts a journal-derived record, never a contradicted one', () => {
  const base = (checks) => ({ kind: 'ada-restore-verification', ok: true, failures: [], verifiedAt: '2026-12-03T03:12:00.000Z', dump: 'prod/ada_prod_20261203T021700Z.dump.enc',
    backupTakenAt: '2026-12-03T02:17:00.000Z', backupAgeHours: 0.9, encryptedBytes: 266693, dumpSha256: 'a'.repeat(64), restoredTables: 108,
    checks: { sidecar: true, objectDigest: true, signatures: true, coreTablesMissing: [], migrationRows: 44, expectedMigrations: null, journalEntries: 46, migrationsMatch: null, migrationsPlausible: true, ledger: true, ...checks },
    erasureReplay: { mode: 'dry-run', ledgerEntries: 2, presentAgain: 0, holdsMissing: 0 }, seconds: 41, wiped: true,
    attestation: JSON.parse(JSON.stringify(ATTESTATION)), evidenceStored: 'evidence/ada_restore_evidence_20261203T031200123Z_0a1b2c3d_ok.json' });
  const derived = (o = {}) => ({ ok: true, expected: 44, highest: '0045_r43_appointment_notice_kinds', unknown: 0, duplicates: 0, missing: [], ...o });
  it('accepted when derived and whole', () => {
    expect(checkEvidence(base({ migrationsDerived: derived() }))).toMatchObject({ accepted: true, summary: { migrations: 44, expectedMigrations: 44 } });
  });
  it.each([
    ['nothing matched', {}],
    ['derived but a migration is missing', { migrationsDerived: derived({ ok: false, missing: ['0020_x'] }) }],
    ['derived count differs from the rows', { migrationsDerived: derived({ expected: 43 }) }],
    ['derived ok but the explicit count contradicts', { migrationsDerived: derived(), expectedMigrations: 43, migrationsMatch: false }],
  ])('refused: %s', (_n, checks) => { expect(checkEvidence(base(checks)).problems).toContain('MIGRATIONS_NOT_MATCHED'); });
});
