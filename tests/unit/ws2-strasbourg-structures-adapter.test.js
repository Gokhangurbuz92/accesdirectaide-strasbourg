import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  StrasbourgStructuresContractAdapter,
  validateStructureRecord,
} from '../../api/lib/ingestion/StrasbourgStructuresAdapter.js';

const tempRoots = [];

async function tempRoot() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'ada-ws2-structures-'),
  );

  tempRoots.push(root);

  await mkdir(
    path.join(root, 'data', 'strasbourg'),
    { recursive: true },
  );

  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();

  while (tempRoots.length > 0) {
    const root = tempRoots.pop();

    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

describe('WS2 Strasbourg structures adapter', () => {
  it('loads the local CSV without network and keeps unverified rows ineligible', async () => {
    const root = await tempRoot();

    await writeFile(
      path.join(root, 'data/structures-alsace.csv'),
      [
        'nom,slug,type_structure,adresse,code_postal,ville,departement,telephone,email,site_web,statut,summary_falc',
        'Structure test,structure-test,CCAS,1 rue Test,67000,Strasbourg,67,,,,actif,Résumé test',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      path.join(
        root,
        'data/strasbourg/ws2-source-manifest.json',
      ),
      JSON.stringify(
        {
          schema: 'ADA_WS2_SOURCE_MANIFEST_V1',
          launchReady: false,
          datasets: [
            {
              entityType: 'Structure',
              path: 'data/structures-alsace.csv',
              recordCount: 1,
              verificationStatus: 'UNVERIFIED',
              freshnessStatus: 'UNKNOWN',
              launchEligible: false,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(
        new Error('NETWORK_MUST_NOT_RUN'),
      );

    const adapter =
      new StrasbourgStructuresContractAdapter({
        repoRoot: root,
      });

    const result = await adapter.fetch();

    expect(result.items).toHaveLength(1);
    expect(result.networkUsed).toBe(false);
    expect(result.items[0].launchEligible).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty structure name', () => {
    const result = validateStructureRecord({
      nom: '',
      slug: 'missing-name',
      code_postal: '67000',
      departement: '67',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'STRASBOURG_STRUCTURE_NAME_REQUIRED',
    );
  });

  it('rejects a malformed postal code', () => {
    const result = validateStructureRecord({
      nom: 'Test',
      slug: 'bad-postal',
      code_postal: '67A00',
      departement: '67',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'STRASBOURG_STRUCTURE_POSTAL_CODE_INVALID',
    );
  });

  it('rejects non-finite coordinates', () => {
    const result = validateStructureRecord({
      nom: 'Test',
      slug: 'bad-coordinates',
      code_postal: '67000',
      departement: '67',
      latitude: 'not-a-number',
      longitude: '7.75',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'STRASBOURG_STRUCTURE_INVALID_LATITUDE',
    );
  });

  it('keeps a structurally valid row ineligible without verified provenance', () => {
    const result = validateStructureRecord(
      {
        nom: 'Test',
        slug: 'no-provenance',
        code_postal: '67000',
        departement: '67',
      },
      {
        schema: 'ADA_WS2_SOURCE_MANIFEST_V1',
        datasets: [
          {
            entityType: 'Structure',
            path: 'data/structures-alsace.csv',
            launchEligible: false,
            freshnessStatus: 'UNKNOWN',
          },
        ],
      },
    );

    expect(result.valid).toBe(true);
    expect(result.value.launchEligible).toBe(false);
  });
});