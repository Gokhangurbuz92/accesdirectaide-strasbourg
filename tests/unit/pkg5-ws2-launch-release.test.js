/**
 * PKG-5 / WS2 versioned launch-data release (scripts/ws2-launch-release.mjs), with injected ledger states (no database):
 *   - with no human decision every row is verifiedCurrent=false (self-declared CSV flags dropped) and the verifier still fails closed
 *   - a HUMAN_VERIFIED state is the only way to get verifiedCurrent=true; REJECTED / pending stay false
 *   - the shipped data/ files are byte-identical afterwards; an output inside data/ or an existing directory is refused
 * The injected VERIFIED states are synthetic test inputs, not WS2 human verifications.
 */
import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRelease } from '../../scripts/ws2-launch-release.mjs';
import { parseCsv } from '../../scripts/verify-ws2-data.mjs';

const ROOT = path.resolve(__dirname, '../..');
const FILES = ['data/aides-alsace.csv', 'data/demarches-alsace.csv', 'data/structures-alsace.csv', 'data/strasbourg/ws2-source-manifest.json', 'data/strasbourg/service-public-demarches.snapshot.json'];
const digest = () => Object.fromEntries(FILES.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2rel-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const rows = (dir, rel) => parseCsv(fs.readFileSync(path.join(dir, rel), 'utf8'));

describe('PKG-5 WS2 launch-data release', () => {
  it('without human decisions nothing is verified and the verifier still fails closed; shipped data untouched', async () => {
    const before = digest();
    const m = await buildRelease({ root: ROOT, outDir: path.join(tmp, 'r0'), states: new Map() });
    expect(digest()).toEqual(before);
    for (const rel of ['data/aides-alsace.csv', 'data/demarches-alsace.csv', 'data/structures-alsace.csv']) expect(rows(path.join(tmp, 'r0'), rel).every((r) => r.verifiedCurrent === 'false' && r.launchEligible === 'false')).toBe(true);
    expect(m.counts.aides.selfDeclaredFlagsDropped).toBe(15);
    expect(m.verifier.pass).toBe(false);
    expect(m.verifier.code).toMatch(/WS2_NOT_VERIFIED_CURRENT/);
    expect(m.decisions).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'r0/RELEASE_MANIFEST.json'), 'utf8')).inputs['data/aides-alsace.csv']).toBe(before['data/aides-alsace.csv']);
  });

  it('only HUMAN_VERIFIED rows become verifiedCurrent=true', async () => {
    const aides = rows(ROOT, 'data/aides-alsace.csv').map((r) => r.slug);
    const states = new Map([[`aides:${aides[0]}`, { state: 'HUMAN_VERIFIED', decision: { outcome: 'VERIFIED', at: '2026-10-20T10:00:00Z', source: 'https://www.service-public.fr/x' } }],
      [`aides:${aides[1]}`, { state: 'REJECTED', decision: { outcome: 'REJECTED' } }], [`aides:${aides[2]}`, { state: 'PENDING_HUMAN_VERIFICATION', decision: null }]]);
    const m = await buildRelease({ root: ROOT, outDir: path.join(tmp, 'r1'), states });
    const out = Object.fromEntries(rows(path.join(tmp, 'r1'), 'data/aides-alsace.csv').map((r) => [r.slug, r.verifiedCurrent]));
    expect([out[aides[0]], out[aides[1]], out[aides[2]]]).toEqual(['true', 'false', 'false']);
    expect(m.counts.aides.humanVerified).toBe(1);
    expect(m.decisions).toEqual([{ dataset: 'aides', slug: aides[0], outcome: 'VERIFIED', verifiedAt: '2026-10-20T10:00:00Z', source: 'https://www.service-public.fr/x' }]);
    expect(m.verifier.pass).toBe(false);
  });

  it('refuses an output inside data/ or an existing directory', async () => {
    await expect(buildRelease({ root: ROOT, outDir: path.join(ROOT, 'data/release-x'), states: new Map() })).rejects.toThrow('WS2_RELEASE_OUT_INSIDE_DATA');
    await expect(buildRelease({ root: ROOT, outDir: path.join(tmp, 'r0'), states: new Map() })).rejects.toThrow('WS2_RELEASE_OUT_EXISTS');
    expect(fs.existsSync(path.join(ROOT, 'data/release-x'))).toBe(false);
  });
});
