import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ServicePublicDemarchesConnector,
} from '../../api/lib/ingestion/ServicePublicDemarchesConnector.js';

const tempRoots = [];

async function tempFile(name, contents) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'ada-ws2-service-public-'),
  );

  tempRoots.push(root);

  const file = path.join(root, name);

  if (contents !== undefined) {
    await writeFile(file, contents, 'utf8');
  }

  return file;
}

afterEach(async () => {
  vi.restoreAllMocks();

  while (tempRoots.length > 0) {
    await rm(tempRoots.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function connector(snapshotPath, fetchImpl) {
  return new ServicePublicDemarchesConnector({
    mode: 'local-snapshot',
    snapshotPath,
    fetchImpl,
  });
}

describe('WS2 Service-Public local snapshot mode', () => {
  it('fails closed on a missing snapshot and never calls remote fetch', async () => {
    const pathMissing = await tempFile(
      'missing.json',
      undefined,
    );

    const injectedFetch = vi.fn();

    await expect(
      connector(
        pathMissing,
        injectedFetch,
      ).getDetailUrls(),
    ).rejects.toThrow(
      'SERVICE_PUBLIC_LOCAL_SNAPSHOT_MISSING',
    );

    expect(injectedFetch).not.toHaveBeenCalled();
  });

  it('fails closed on malformed JSON without remote fallback', async () => {
    const snapshotPath = await tempFile(
      'malformed.json',
      '{broken',
    );

    const injectedFetch = vi.fn();

    await expect(
      connector(
        snapshotPath,
        injectedFetch,
      ).getDetailUrls(),
    ).rejects.toThrow(
      'SERVICE_PUBLIC_LOCAL_SNAPSHOT_MALFORMED',
    );

    expect(injectedFetch).not.toHaveBeenCalled();
  });

  it('fails closed on an unsupported snapshot schema', async () => {
    const snapshotPath = await tempFile(
      'wrong-schema.json',
      JSON.stringify({
        schema: 'WRONG_SCHEMA',
        items: [],
      }),
    );

    const injectedFetch = vi.fn();

    await expect(
      connector(
        snapshotPath,
        injectedFetch,
      ).getDetailUrls(),
    ).rejects.toThrow(
      'SERVICE_PUBLIC_LOCAL_SNAPSHOT_SCHEMA_UNSUPPORTED',
    );

    expect(injectedFetch).not.toHaveBeenCalled();
  });

  it('requires provenance and a valid source hash', async () => {
    const missingProvenance = await tempFile(
      'missing-provenance.json',
      JSON.stringify({
        schema: 'ADA_SERVICE_PUBLIC_DEMARCHES_SNAPSHOT_V1',
        items: [],
      }),
    );

    await expect(
      connector(
        missingProvenance,
        vi.fn(),
      ).getDetailUrls(),
    ).rejects.toThrow(
      'SERVICE_PUBLIC_SNAPSHOT_PROVENANCE_MISSING',
    );

    const badHash = await tempFile(
      'bad-hash.json',
      JSON.stringify({
        schema: 'ADA_SERVICE_PUBLIC_DEMARCHES_SNAPSHOT_V1',
        provenance: {
          sourceOwner: 'TEST_FIXTURE_ONLY',
          sourceUrl: 'https://example.invalid/test',
          sourceKind: 'TEST_FIXTURE',
          verifiedAt: '2026-09-16T00:00:00.000Z',
          freshnessStatus: 'VERIFIED_CURRENT',
          sourceSha256: 'bad-hash',
        },
        items: [],
      }),
    );

    await expect(
      connector(
        badHash,
        vi.fn(),
      ).getDetailUrls(),
    ).rejects.toThrow(
      'SERVICE_PUBLIC_SNAPSHOT_SOURCE_SHA256_INVALID',
    );
  });

  it('requires VERIFIED_CURRENT provenance', async () => {
    const snapshotPath = await tempFile(
      'unknown-freshness.json',
      JSON.stringify({
        schema: 'ADA_SERVICE_PUBLIC_DEMARCHES_SNAPSHOT_V1',
        provenance: {
          sourceOwner: 'TEST_FIXTURE_ONLY',
          sourceUrl: 'https://example.invalid/test',
          sourceKind: 'TEST_FIXTURE',
          verifiedAt: '2026-09-16T00:00:00.000Z',
          freshnessStatus: 'UNKNOWN',
          sourceSha256: 'a'.repeat(64),
        },
        items: [],
      }),
    );

    await expect(
      connector(
        snapshotPath,
        vi.fn(),
      ).getDetailUrls(),
    ).rejects.toThrow(
      'SERVICE_PUBLIC_SNAPSHOT_NOT_VERIFIED_CURRENT',
    );
  });

  it('uses a valid local test fixture without invoking remote fetch', async () => {
    const snapshotPath = await tempFile(
      'valid-test-fixture.json',
      JSON.stringify({
        schema: 'ADA_SERVICE_PUBLIC_DEMARCHES_SNAPSHOT_V1',
        provenance: {
          sourceOwner: 'TEST_FIXTURE_ONLY',
          sourceUrl: 'https://example.invalid/test',
          sourceKind: 'TEST_FIXTURE',
          verifiedAt: '2026-09-16T00:00:00.000Z',
          freshnessStatus: 'VERIFIED_CURRENT',
          sourceSha256: 'b'.repeat(64),
        },
        items: [
          {
            id: 'fixture-1',
            titre: 'Fixture administrative locale',
            audience: 'Particuliers',
          },
        ],
      }),
    );

    const injectedFetch = vi.fn();

    const urls = await connector(
      snapshotPath,
      injectedFetch,
    ).getDetailUrls();

    expect(urls).toHaveLength(1);
    expect(injectedFetch).not.toHaveBeenCalled();
  });
});