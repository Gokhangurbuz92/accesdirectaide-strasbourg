import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { verifyWs2Data } from '../../scripts/verify-ws2-data.mjs';

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'data/strasbourg/ws2-source-manifest.json');

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
}

describe('WS8 frozen Strasbourg launch-data gate', () => {
  it('validates the actual frozen launch set with the WS2 verifier', async () => {
    const result = await verifyWs2Data({ rootDir: ROOT });

    expect(result).toMatchObject({
      launchReady: true,
      offlineOnly: true,
      counts: {
        aides: 15,
        demarches: 10,
      },
    });
    expect(result.counts.structures).toBeGreaterThanOrEqual(20);
    expect(result.requiredServicePublicIds).toBeGreaterThan(0);
  });

  it('requires the authoritative source manifest to agree that launch data is current and eligible', async () => {
    const manifest = await readManifest();

    expect(manifest.schema).toBe('ADA_WS2_SOURCE_MANIFEST_V1');
    expect(manifest.launchReady).toBe(true);
    expect(Array.isArray(manifest.datasets)).toBe(true);
    expect(manifest.datasets.length).toBeGreaterThan(0);

    for (const dataset of manifest.datasets) {
      expect(dataset.launchEligible, `${dataset.entityType}: launchEligible`).toBe(true);
      expect(dataset.freshnessStatus, `${dataset.entityType}: freshnessStatus`).not.toBe('UNKNOWN');
      expect(dataset.freshnessStatus, `${dataset.entityType}: freshnessStatus`).not.toBe('STALE');
      expect(dataset.verificationStatus, `${dataset.entityType}: verificationStatus`).not.toBe('UNVERIFIED');
      expect(dataset.verificationStatus, `${dataset.entityType}: verificationStatus`).not.toBe('UNAVAILABLE');
    }
  });
});
