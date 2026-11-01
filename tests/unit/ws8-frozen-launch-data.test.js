/**
 * WS8 frozen Strasbourg launch-data gate — R33 rewrite of two assertions that could never pass under the PKG-5 design.
 *
 * Before R33 this file required the SHIPPED data/ files to be launch-ready (manifest launchReady=true, every dataset eligible). Since PKG-5
 * (scripts/ws2-launch-release.mjs) the shipped files are never written and never carry readiness: a launch set exists only as a separate,
 * versioned release whose verifiedCurrent flags come from human VERIFIED decisions (pkg5-ws2-launch-release.test.js). The old assertions
 * contradicted that test and dta-s4a (both require the shipped data to stay fail-closed). Production content does not come from these CSVs:
 * it is the D-5 verified database catalogue (api/lib/publicVisibility.js).
 *
 * What this gate now proves, against the real data:
 *   1. the shipped data/ set is fail-closed and the verifier refuses it;
 *   2. even if every row received a (synthetic) human VERIFIED decision, the frozen set would still NOT be launch-ready, and the ONLY reasons
 *      are the rows the source itself marks ineligible (2 démarches, 5 structures: closed or regional-only agencies, a mobile-number record) —
 *      so the gap is named, not hidden.
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRelease } from '../../scripts/ws2-launch-release.mjs';
import { parseCsv, verifyWs2Data } from '../../scripts/verify-ws2-data.mjs';

const ROOT = process.cwd();
const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/strasbourg/ws2-source-manifest.json'), 'utf8'));
const csv = (rel) => parseCsv(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws8-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('WS8 frozen Strasbourg launch-data gate', () => {
  it('the shipped data set is fail-closed: the manifest claims no readiness and the verifier refuses it', async () => {
    const m = manifest();
    expect(m.schema).toBe('ADA_WS2_SOURCE_MANIFEST_V1');
    expect(m.launchReady).toBe(false);
    expect(m.datasets.length).toBeGreaterThan(0);
    for (const d of m.datasets) expect(d.launchEligible, `${d.entityType}: launchEligible`).toBe(false);
    await expect(verifyWs2Data({ rootDir: ROOT })).rejects.toThrow(/WS2_/);
  });

  it('a fully human-verified release would still be refused, only because of the rows the source marks ineligible', async () => {
    const decision = { outcome: 'VERIFIED', at: '2026-10-20T10:00:00Z', source: 'https://www.service-public.fr/x' };   // synthetic, not a WS2 decision
    const states = new Map();
    for (const [ds, rel] of [['aides', 'data/aides-alsace.csv'], ['demarches', 'data/demarches-alsace.csv'], ['structures', 'data/structures-alsace.csv']]) {
      for (const r of csv(rel)) states.set(`${ds}:${r.slug}`, { state: 'HUMAN_VERIFIED', decision });
    }
    const m = await buildRelease({ root: ROOT, outDir: path.join(tmp, 'all-verified'), states });
    expect(m.counts.aides).toMatchObject({ rows: 15, humanVerified: 15 });
    expect(m.counts.demarches).toMatchObject({ rows: 10, humanVerified: 10 });
    expect(m.counts.structures.rows).toBeGreaterThanOrEqual(20);
    expect(m.verifier.pass).toBe(false);
    expect(m.verifier.code).toBe('WS2_NOT_LAUNCH_ELIGIBLE: demarches');
    const out = (rel) => parseCsv(fs.readFileSync(path.join(tmp, 'all-verified', rel), 'utf8'));
    expect(out('data/demarches-alsace.csv').filter((r) => r.launchEligible !== 'true').map((r) => r.slug).sort()).toEqual(['inscription-ccas', 'rdv-social-alsace']);
    expect(out('data/structures-alsace.csv').filter((r) => r.launchEligible !== 'true').map((r) => r.slug).sort()).toEqual(['agence-france-travail-strasbourg-seyboth-a71a98da', 'france-travail-direction-regionale-grand-est-b4a55f83', 'france-travail-dr-grand-est-siege-9f9c21ab', 'le-p-tit-home-a-l-etage-5a615b70', 'mission-locale-pour-l-emploi-89e0e6bd']);
    expect(out('data/aides-alsace.csv').every((r) => r.launchEligible === 'true')).toBe(true);
  });
});
