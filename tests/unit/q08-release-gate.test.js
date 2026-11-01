/**
 * Q08 — the release gate: no test may fail (the known-failure list is empty since R33); the release script checks CI, runs the gate, deploys, smoke-tests and rolls back.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { gateDecision, KNOWN_FAILURES } from '../../scripts/unit-gate.mjs';

const file = (name, tests, status = 'passed') => ({ name: `/r/${name}`, status, assertionResults: tests.map(([t, s, anc = []]) => ({ title: t, status: s, ancestorTitles: anc })) });

describe('Q08 unit gate', () => {
  it('declares no known failure since R33: a clean run passes, and any failing test stops the release', () => {
    expect(KNOWN_FAILURES).toEqual([]);
    const d = gateDecision({ testResults: [file('tests/unit/a.test.js', [['x', 'passed'], ['y', 'passed', ['d']]])] }, '/r');
    expect(d).toMatchObject({ ok: true, passed: 2, failed: 0, unexpected: [], nowPassing: [] });
    expect(gateDecision({ testResults: [file('tests/unit/dta-s4a-ws2-findings.test.js', [['x', 'failed', ['d']]])] }, '/r').ok).toBe(false);
  });
  it('stops on any other failure, on a file that did not load, and on an empty run', () => {
    expect(gateDecision({ testResults: [file('tests/unit/a.test.js', [['x', 'failed', ['d']]])] }, '/r')).toMatchObject({ ok: false, unexpected: ['tests/unit/a.test.js > d > x'] });
    expect(gateDecision({ testResults: [file('tests/unit/b.test.js', [], 'failed')] }, '/r').ok).toBe(false);
    expect(gateDecision({ testResults: [] }, '/r').ok).toBe(false);
  });
});

describe('Q08 release script and CI workflow', () => {
  const sh = fs.readFileSync('scripts/release-production.sh', 'utf8');
  it('requires the pushed tip, CI success when the workflow exists, the local gate, then smoke-tests and rolls back', () => {
    expect(sh).toMatch(/is not the pushed tip of origin\/main/);
    expect(sh).toMatch(/completed\/success/);
    expect(sh).toMatch(/node scripts\/unit-gate\.mjs/);
    expect(sh).toMatch(/npm audit --omit=dev --audit-level=high/);
    expect(sh).toMatch(/x-release-sha/);
    expect(sh).toMatch(/\$VERCEL rollback "\$PREV" --yes/);
  });
  it('the CI workflow never deploys and has read-only permissions', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toMatch(/permissions:\n {2}contents: read/);
    expect(ci).not.toMatch(/vercel|secrets\./i);
    expect(ci).toMatch(/node scripts\/unit-gate\.mjs/);
  });
});
