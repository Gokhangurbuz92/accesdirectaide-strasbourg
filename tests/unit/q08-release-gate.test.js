/**
 * Q08 — the release gate: only the declared known failures may fail; the release script checks CI, runs the gate, deploys, smoke-tests and rolls back.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { gateDecision, KNOWN_FAILURES } from '../../scripts/unit-gate.mjs';

const file = (name, tests, status = 'passed') => ({ name: `/r/${name}`, status, assertionResults: tests.map(([t, s, anc = []]) => ({ title: t, status: s, ancestorTitles: anc })) });

describe('Q08 unit gate', () => {
  it('passes when only declared known failures fail, and says which known failures now pass', () => {
    const [f, ...rest] = KNOWN_FAILURES[0].split(' > ');
    const d = gateDecision({ testResults: [file(f, [[rest.at(-1), 'failed', rest.slice(0, -1)], ['ok', 'passed']]), file('tests/unit/a.test.js', [['x', 'passed']])] }, '/r');
    expect(d).toMatchObject({ ok: true, passed: 2, failed: 1, unexpected: [] });
    expect(d.nowPassing).toHaveLength(KNOWN_FAILURES.length - 1);
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
