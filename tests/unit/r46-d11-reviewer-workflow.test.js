/**
 * R46 (D11) — the reviewer workflow end to end through the real CLI (scripts/d11-review.mjs) on a COPY of the register: blank form → filled by a SYNTHETIC
 * reviewer (this test only) → dry run → --write → status → the product's gate (api/lib/validatedRules.js). Plus the explained gate (gateStatus) and the
 * lapse rule: an official page revised after the review closes the gate again. The committed register is never touched and no right is validated in it:
 * real validation needs a named qualified human reviewer (HUMAN_REVIEW_PENDING).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GATE_REASONS, gateStatus, validatedRight } from '../../api/lib/validatedRules.js';
import { evaluateForm, parseCsv, renderForm } from '../../scripts/d11-review.mjs';

const REG_FILE = 'data/rules/rights-rules.v1.json';
const committed = fs.readFileSync(REG_FILE, 'utf8');
const reg = JSON.parse(committed);
const proposed = JSON.parse(fs.readFileSync('data/rules/reference-cases.proposed.v1.json', 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-d11-'));
const cli = (...args) => spawnSync(process.execPath, ['scripts/d11-review.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC' } });
const SYNTH = { reviewer_name: 'Relecteur fictif (test R46)', reviewer_role: 'juriste fictif', review_date: '2026-11-05' };
const q = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows) => `${Object.keys(rows[0]).join(',')}\n${rows.map((r) => Object.values(r).map(q).join(',')).join('\n')}\n`;
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); expect(fs.readFileSync(REG_FILE, 'utf8')).toBe(committed); });

describe('D11 gate explained (gateStatus)', () => {
  it('today every right of the committed register is closed for one reason: no expert validation', () => {
    for (const r of reg.rights) expect(gateStatus(reg, r.id)).toEqual({ code: r.id, passes: false, reasons: [GATE_REASONS.NOT_EXPERT_VALIDATED] });
    expect(gateStatus(reg, 'inconnu').reasons).toEqual([GATE_REASONS.UNKNOWN_RIGHT]);
  });
  it('a status set by hand without a complete review or accepted cases is refused, with the reasons', () => {
    const forged = JSON.parse(committed); const r = forged.rights.find((x) => x.id === 'apl');
    r.status = 'EXPERT_VALIDATED'; r.expertReview = { name: 'X', role: '', date: '2026-11-05' };
    expect(gateStatus(forged, 'apl').reasons).toEqual([GATE_REASONS.REVIEWER_INCOMPLETE, GATE_REASONS.NO_ACCEPTED_CASE]);
    r.expertReview.role = 'juriste'; r.referenceCases = [{ id: 'c', facts: {}, expected: {} }];
    expect(gateStatus(forged, 'apl').reasons).toEqual([GATE_REASONS.CASE_NOT_ACCEPTED]);
    expect(validatedRight(forged, 'apl')).toBeNull();
  });
});

describe('D11 reviewer workflow through the CLI, on a copy of the register', () => {
  const copy = path.join(dir, 'register.json');
  fs.writeFileSync(copy, committed);
  const form = cli('form', '--register', copy);
  const rows = parseCsv(form.stdout).map((r) => (r.right !== 'apl' ? r
    : { ...r, ...SYNTH, decision: r.item_type === 'ambiguity' ? 'DECIDED' : 'ACCEPT', correction_or_decision: r.item_type === 'ambiguity' ? 'tranché (synthétique)' : '' }));
  const filled = path.join(dir, 'filled.csv');
  fs.writeFileSync(filled, toCsv(rows));

  it('form: the CLI prints the same blank form as the committed one', () => {
    expect(form.status).toBe(0); expect(form.stdout).toBe(renderForm(reg, proposed)); expect(form.stdout).toBe(fs.readFileSync('docs/rules/D11_REVIEW_FORM.csv', 'utf8'));
  });
  it('apply (dry run) says what the form allows and writes nothing', () => {
    const r = cli('apply', filled, '--register', copy);
    expect(r.status).toBe(0); expect(r.stdout).toMatch(/^apl: VALIDABLE$/m); expect(r.stdout).toMatch(/^rsa: reste non validée$/m);
    expect(fs.readFileSync(copy, 'utf8')).toBe(committed);
  });
  it('apply --write records the review in the copy; status and the product gate agree; the committed register is untouched', () => {
    const w = cli('apply', filled, '--write', '--register', copy);
    expect(w.status).toBe(0);
    const next = JSON.parse(fs.readFileSync(copy, 'utf8'));
    expect(next.rights.find((x) => x.id === 'apl')).toMatchObject({ status: 'EXPERT_VALIDATED', expertReview: { name: SYNTH.reviewer_name, role: SYNTH.reviewer_role, date: SYNTH.review_date } });
    expect(validatedRight(next, 'apl')).not.toBeNull();
    const st = JSON.parse(cli('status', '--json', '--register', copy).stdout);
    expect(st.validated).toEqual(['apl']);
    expect(JSON.parse(cli('status', '--json').stdout).validated).toEqual([]);
    expect(fs.readFileSync(REG_FILE, 'utf8')).toBe(committed);
  });
  it('lapse: once the official page is revised after the review date, the gate closes and a new form cannot validate on the old date', () => {
    const next = JSON.parse(fs.readFileSync(copy, 'utf8'));
    next.rights.find((x) => x.id === 'apl').sources[0].pageVerifiedOn = '2026-12-01';
    expect(gateStatus(next, 'apl')).toMatchObject({ passes: false, reasons: [GATE_REASONS.SOURCE_REVISED_AFTER_REVIEW] });
    const again = evaluateForm(next, proposed, rows).find((x) => x.right === 'apl');
    expect(again.validated).toBe(false); expect(again.open.join(' ')).toMatch(/révisée le 2026-12-01, après la relecture/);
  });
  it('a wrong command answers the usage with exit 2', () => {
    expect(cli('valider').status).toBe(2);
  });
});
