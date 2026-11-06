/**
 * R47 — scripts/feature-matrix-check.mjs: every rule on a synthetic 173-row matrix (ids are generated, no real row is copied), plus the CSV parser and the CLI
 * exit codes. A clean matrix gives no finding; each mutation gives exactly the expected code.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkMatrix, csvRecords, DEFERRED_IDS, isPlaceholder, parseCsv, STATUS_COLUMNS } from '../../scripts/feature-matrix-check.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const IDS = Array.from({ length: 173 }, (_, i) => `T${String(i + 1).padStart(3, '0')}`);
const SHA = 'cc02779';
const HEADER = ['id', 'tests', 'evidence', ...STATUS_COLUMNS, 'deployed_sha', 'remaining'];

/** a consistent row: ready, tested, deployed, nothing pending */
const row = (id) => ({ id, tests: 'unit-x', evidence: 'evidence/r47/x.json', IMPLEMENTED: 'Y', END_TO_END_TESTED: 'Y', SECURITY_VERIFIED: 'Y', LANGUAGES_VERIFIED: 'NA',
  TECHNICALLY_READY: 'Y', EXTERNAL_PROVIDER_PENDING: 'N', LEGAL_ACTIVATION_PENDING: 'N', REAL_PARTNER_PENDING: 'N', HDS_PENDING: 'N', HUMAN_REVIEW_PENDING: 'N',
  DEPLOYED: 'Y', PRODUCTION_ACTIVE: 'N', OPERATIONALLY_ACCEPTED: 'N', deployed_sha: SHA, remaining: 'none' });
const matrixOf = (records, header = HEADER) => ({ header, records });
const recon = () => ({ header: ['id', 'capability'], records: IDS.map((id) => ({ id, capability: 'x' })) });
const clean = () => IDS.map(row);
const codes = (findings) => findings.map((f) => f.code);
const mutate = (fn, header) => { const rs = clean(); fn(rs); return checkMatrix(matrixOf(rs, header), recon()); };

describe('R47 feature-matrix-check', () => {
  it('a consistent matrix has no finding', () => {
    expect(checkMatrix(matrixOf(clean()), recon(), { expectSha: 'cc027790eeb5678d2a6b63e80a2c62d0c3189b17' })).toEqual([]);
  });

  it('ids: duplicate, missing, extra, deferred, and a reconciliation that is not 173', () => {
    expect(codes(mutate((rs) => { rs[1].id = rs[0].id; }))).toEqual(expect.arrayContaining(['DUPLICATE_ID', 'MISSING_ID']));
    expect(codes(mutate((rs) => { rs.push(row('Z99')); }))).toEqual(expect.arrayContaining(['EXTRA_ID', 'ROW_COUNT']));
    const d = mutate((rs) => { rs[0].id = DEFERRED_IDS[0]; });
    expect(d).toEqual(expect.arrayContaining([{ code: 'DEFERRED_ID', id: 'E09' }, { code: 'MISSING_ID', id: 'T001' }]));
    expect(codes(mutate((rs) => { rs.pop(); }))).toEqual(['MISSING_ID', 'ROW_COUNT']);
    const r = recon(); r.records.pop();
    expect(codes(checkMatrix(matrixOf(clean().slice(0, 172)), r))).toEqual(['CANONICAL_COUNT', 'ROW_COUNT']);
    const r2 = recon(); r2.records[5].id = 'X06';
    expect(checkMatrix(matrixOf(clean()), r2)).toEqual(expect.arrayContaining([{ code: 'CANONICAL_COUNT', id: 'X06', detail: 'deferred id in the reconciliation' }]));
  });

  it('status values are Y / N / NA only; a missing column is reported', () => {
    expect(mutate((rs) => { rs[3].DEPLOYED = 'yes'; })).toEqual([{ code: 'BAD_STATUS', id: 'T004', detail: 'DEPLOYED="yes"' }]);
    expect(codes(mutate((rs) => { rs[3].HDS_PENDING = ''; }))).toEqual(['BAD_STATUS']);
    expect(codes(checkMatrix(matrixOf(clean(), HEADER.filter((h) => h !== 'OPERATIONALLY_ACCEPTED')), recon()))).toEqual(['MISSING_COLUMN']);
  });

  it('impossible combinations', () => {
    expect(codes(mutate((rs) => { rs[0].IMPLEMENTED = 'N'; }))).toEqual(['READY_NOT_IMPLEMENTED']);
    expect(codes(mutate((rs) => { rs[0].PRODUCTION_ACTIVE = 'Y'; rs[0].DEPLOYED = 'N'; rs[0].deployed_sha = ''; }))).toEqual(['ACTIVE_NOT_DEPLOYED']);
    expect(codes(mutate((rs) => { rs[0].PRODUCTION_ACTIVE = 'Y'; rs[0].TECHNICALLY_READY = 'N'; }))).toEqual(['ACTIVE_NOT_READY']);
    expect(codes(mutate((rs) => { rs[9].OPERATIONALLY_ACCEPTED = 'Y'; }))).toEqual(['OPERATIONALLY_ACCEPTED']);
    expect(codes(mutate((rs) => { rs[0].IMPLEMENTED = 'NA'; rs[0].TECHNICALLY_READY = 'N'; }))).toEqual(['NA_INCONSISTENT']);
  });

  it('ready without an end-to-end test needs a real non-software justification', () => {
    expect(mutate((rs) => { rs[2].END_TO_END_TESTED = 'N'; })).toEqual([{ code: 'READY_WITHOUT_E2E', id: 'T003', detail: 'no non_software_justification column' }]);
    const H = [...HEADER, 'non_software_justification'];
    expect(codes(mutate((rs) => { rs[2].END_TO_END_TESTED = 'N'; rs[2].non_software_justification = 'TBD'; }, H))).toEqual(['READY_WITHOUT_E2E']);
    expect(mutate((rs) => { rs[2].END_TO_END_TESTED = 'N'; rs[2].non_software_justification = 'document deliverable: docs/x.md verified by checksum and link check'; }, H)).toEqual([]);
    // not ready: no journey required
    expect(mutate((rs) => { rs[2].END_TO_END_TESTED = 'N'; rs[2].TECHNICALLY_READY = 'N'; })).toEqual([]);
  });

  it('deployed SHA: present, one value, the expected one, absent when not deployed', () => {
    expect(codes(mutate((rs) => { rs[0].deployed_sha = ''; }))).toEqual(['DEPLOYED_WITHOUT_SHA']);
    expect(codes(mutate((rs) => { rs[0].deployed_sha = 'b5c3cea'; }))).toEqual(['SHA_INCONSISTENT']);
    expect(codes(mutate((rs) => { rs[0].deployed_sha = 'see above'; }))).toEqual(['DEPLOYED_WITHOUT_SHA']);
    expect(codes(mutate((rs) => { rs[0].DEPLOYED = 'N'; }))).toEqual(['SHA_WITHOUT_DEPLOY']);
    expect(codes(checkMatrix(matrixOf(clean()), recon(), { expectSha: 'b5c3cea' }))).toEqual(['SHA_INCONSISTENT']);
  });

  it('placeholder evidence and tests', () => {
    for (const p of ['', '—', '-', 'TBD', 'see above', 'See work.', 'n/a', '?', 'TODO']) expect(isPlaceholder(p)).toBe(true);
    for (const p of ['tests/unit/r47-x.test.js 3/3', 'evidence/r47/audit/matrix', 'DTA-B19']) expect(isPlaceholder(p)).toBe(false);
    expect(mutate((rs) => { rs[4].evidence = 'see above'; })).toEqual([{ code: 'PLACEHOLDER_EVIDENCE', id: 'T005', detail: 'evidence="see above"' }]);
    expect(codes(mutate((rs) => { rs[4].tests = ''; }))).toEqual(['E2E_WITHOUT_TESTS']);
  });

  it('remaining agrees with the pending flags', () => {
    expect(codes(mutate((rs) => { rs[0].HDS_PENDING = 'Y'; }))).toEqual(['REMAINING_MISMATCH']);
    expect(mutate((rs) => { rs[0].HDS_PENDING = 'Y'; rs[0].remaining = 'hds'; })).toEqual([]);
    expect(codes(mutate((rs) => { rs[0].remaining = 'legal_activation'; }))).toEqual(['REMAINING_MISMATCH']);
    expect(codes(mutate((rs) => { rs[0].remaining = 'later'; }))).toEqual(['REMAINING_MISMATCH']);
  });

  it('CSV parser: quotes, doubled quotes, embedded commas and new lines, BOM, CRLF', () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""","line1\nline2"\r\n')).toEqual([['a', 'b'], ['x, "y"', 'line1\nline2']]);
    expect(csvRecords('id,v\nA, 1 \n').records).toEqual([{ id: 'A', v: '1' }]);
    expect(() => parseCsv('a,"b')).toThrow('CSV_UNTERMINATED_QUOTE');
  });

  it('CLI: exit 0 on a clean matrix, 1 with findings, 2 on usage error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-matrix-'));
    const toCsv = (header, rs) => [header.join(','), ...rs.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    fs.writeFileSync(path.join(dir, 'm.csv'), toCsv(HEADER, clean()));
    fs.writeFileSync(path.join(dir, 'r.csv'), toCsv(['id'], IDS.map((id) => ({ id }))));
    const bad = clean(); bad[0].OPERATIONALLY_ACCEPTED = 'Y';
    fs.writeFileSync(path.join(dir, 'bad.csv'), toCsv(HEADER, bad));
    const run = (...a) => spawnSync(process.execPath, [path.join(root, 'scripts/feature-matrix-check.mjs'), ...a], { encoding: 'utf8' });
    const ok = run(path.join(dir, 'm.csv'), path.join(dir, 'r.csv'), '--expect-sha', SHA);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('FEATURE_MATRIX_CHECK {"ok":true,"rows":173,"findings":0');
    const ko = run(path.join(dir, 'bad.csv'), path.join(dir, 'r.csv'), '--json');
    expect(ko.status).toBe(1);
    expect(JSON.parse(ko.stdout).findings).toEqual([{ code: 'OPERATIONALLY_ACCEPTED', id: 'T001' }]);
    expect(run(path.join(dir, 'm.csv')).status).toBe(2);
    expect(run(path.join(dir, 'nope.csv'), path.join(dir, 'r.csv')).status).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
