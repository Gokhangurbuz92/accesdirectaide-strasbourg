// @ts-nocheck
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConnectorContract } from './ConnectorContract.js';

const MODULE_DIR = path.dirname(
  fileURLToPath(import.meta.url),
);

const DEFAULT_REPO_ROOT = path.resolve(
  MODULE_DIR,
  '../../..',
);

const DEFAULT_CSV_PATH = path.join(
  DEFAULT_REPO_ROOT,
  'data',
  'structures-alsace.csv',
);

const DEFAULT_MANIFEST_PATH = path.join(
  DEFAULT_REPO_ROOT,
  'data',
  'strasbourg',
  'ws2-source-manifest.json',
);

const POSTAL_CODE_PATTERN = /^\d{5}$/;

function detectDelimiter(/** @type {string} */ headerLine) {
  let commaCount = 0;
  let semicolonCount = 0;
  let quoted = false;

  for (let index = 0; index < headerLine.length; index += 1) {
    const character = headerLine[index];

    if (character === '"') {
      if (
        quoted &&
        headerLine[index + 1] === '"'
      ) {
        index += 1;
        continue;
      }

      quoted = !quoted;
      continue;
    }

    if (!quoted) {
      if (character === ',') {
        commaCount += 1;
      } else if (character === ';') {
        semicolonCount += 1;
      }
    }
  }

  return semicolonCount > commaCount
    ? ';'
    : ',';
}

/**
 * @param {string} text
 */
export function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new TypeError(
      'STRASBOURG_STRUCTURES_CSV_MUST_BE_STRING',
    );
  }

  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const firstLine = normalized.split('\n', 1)[0];

  if (!firstLine.trim()) {
    return [];
  }

  const delimiter = detectDelimiter(firstLine);

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '"') {
      if (
        quoted &&
        normalized[index + 1] === '"'
      ) {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (!quoted && character === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (!quoted && character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += character;
  }

  if (quoted) {
    throw new Error(
      'STRASBOURG_STRUCTURES_CSV_UNCLOSED_QUOTE',
    );
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter(
    (candidate) =>
      candidate.some(
        (value) =>
          String(value).trim() !== '',
      ),
  );

  if (nonEmptyRows.length === 0) {
    return [];
  }

  const headers = nonEmptyRows[0].map(
    (value) => String(value).trim(),
  );

  if (
    headers.length === 0 ||
    headers.some((header) => !header)
  ) {
    throw new Error(
      'STRASBOURG_STRUCTURES_CSV_INVALID_HEADER',
    );
  }

  return nonEmptyRows
    .slice(1)
    .map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(
          `STRASBOURG_STRUCTURES_CSV_COLUMN_COUNT_MISMATCH:${rowIndex + 2}`,
        );
      }

      return Object.fromEntries(
        headers.map(
          (header, columnIndex) => [
            header,
            String(values[columnIndex] ?? '').trim(),
          ],
        ),
      );
    });
}

/**
 * @param {null | undefined} value
 * @param {string} fieldName
 */
function normalizeOptionalCoordinate(
  value,
  fieldName,
) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {
    return {
      present: false,
      value: null,
    };
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(
      `STRASBOURG_STRUCTURE_INVALID_${fieldName.toUpperCase()}`,
    );
  }

  return {
    present: true,
    value: numeric,
  };
}

function findDatasetManifest(manifest) {
  if (
    !manifest ||
    manifest.schema !==
      'ADA_WS2_SOURCE_MANIFEST_V1' ||
    !Array.isArray(manifest.datasets)
  ) {
    return null;
  }

  return (
    manifest.datasets.find(
      (/** @type {{ entityType: string; path: string; }} */ entry) =>
        entry?.entityType === 'Structure' &&
        entry?.path ===
          'data/structures-alsace.csv',
    ) || null
  );
}

function findRecordProvenance(
  manifest,
  /** @type {string | number | boolean | null | undefined} */ recordKey,
) {
  if (!Array.isArray(manifest?.records)) {
    return null;
  }

  return (
    manifest.records.find(
      (/** @type {{ entityType: string | number | boolean | null | undefined, recordKey: string | number | boolean | null | undefined }} */ entry) =>
        entry?.entityType === 'Structure' &&
        entry?.recordKey === recordKey,
    ) || null
  );
}

/**
 * @param {{ launchEligible: boolean; freshnessStatus: string; sourceOwner: string; sourceUrl: string; sourceKind: string; verifiedAt: string; }} record
 */
function hasVerifiedProvenance(record) {
  return Boolean(
    record &&
      record.launchEligible === true &&
      record.freshnessStatus ===
        'VERIFIED_CURRENT' &&
      typeof record.sourceOwner === 'string' &&
      record.sourceOwner.trim() &&
      typeof record.sourceUrl === 'string' &&
      record.sourceUrl.trim() &&
      typeof record.sourceKind === 'string' &&
      record.sourceKind.trim() &&
      typeof record.verifiedAt === 'string' &&
      record.verifiedAt.trim(),
  );
}

export function validateStructureRecord(
  item,
  manifest = null,
) {
  const errors = [];

  if (
    !item ||
    typeof item !== 'object' ||
    Array.isArray(item)
  ) {
    return {
      valid: false,
      errors: [
        'STRASBOURG_STRUCTURE_INVALID_OBJECT',
      ],
    };
  }

  const nom = String(item.nom ?? '').trim();
  const slug = String(item.slug ?? '').trim();
  const codePostal = String(
    item.code_postal ?? '',
  ).trim();

  if (!nom) {
    errors.push(
      'STRASBOURG_STRUCTURE_NAME_REQUIRED',
    );
  }

  if (!slug) {
    errors.push(
      'STRASBOURG_STRUCTURE_SLUG_REQUIRED',
    );
  }

  if (
    !POSTAL_CODE_PATTERN.test(codePostal)
  ) {
    errors.push(
      'STRASBOURG_STRUCTURE_POSTAL_CODE_INVALID',
    );
  }

  const departement = String(
    item.departement ?? '',
  ).trim();

  if (
    departement &&
    departement !== '67'
  ) {
    errors.push(
      'STRASBOURG_STRUCTURE_DEPARTMENT_NOT_BAS_RHIN',
    );
  }

  let latitude = {
    present: false,
    value: null,
  };

  let longitude = {
    present: false,
    value: null,
  };

  try {
    latitude = normalizeOptionalCoordinate(
      item.latitude,
      'latitude',
    );
  } catch (error) {
    errors.push(error.message);
  }

  try {
    longitude = normalizeOptionalCoordinate(
      item.longitude,
      'longitude',
    );
  } catch (error) {
    errors.push(error.message);
  }

  const datasetManifest =
    findDatasetManifest(manifest);

  const recordProvenance =
    findRecordProvenance(
      manifest,
      slug,
    );

  const datasetVerified = Boolean(
    datasetManifest &&
      datasetManifest.launchEligible === true &&
      datasetManifest.freshnessStatus ===
        'VERIFIED_CURRENT',
  );

  const recordVerified =
    hasVerifiedProvenance(recordProvenance);

  const launchEligible =
    errors.length === 0 &&
    datasetVerified &&
    recordVerified;

  return {
    valid: errors.length === 0,

    errors,

    value: {
      ...item,

      nom,
      slug,
      code_postal: codePostal,

      ...(latitude.present
        ? { latitude: latitude.value }
        : {}),

      ...(longitude.present
        ? { longitude: longitude.value }
        : {}),

      launchEligible,

      ws2Verification: {
        datasetVerified,
        recordVerified,
        freshnessStatus:
          recordProvenance?.freshnessStatus ??
          datasetManifest?.freshnessStatus ??
          'UNKNOWN',
      },
    },
  };
}

export class StrasbourgStructuresContractAdapter
  extends ConnectorContract {
  constructor(options = {}) {
    super({
      sourceId: 'strasbourg-structures',
      name: 'Strasbourg Structures Connector',
      version: '1.0.0',
      entityType: 'Structure',
      capabilities: ['DIRECTORY'],
    });

    this.repoRoot =
      options.repoRoot ??
      DEFAULT_REPO_ROOT;

    this.csvPath =
      options.csvPath ??
      path.join(
        this.repoRoot,
        'data',
        'structures-alsace.csv',
      );

    this.manifestPath =
      options.manifestPath ??
      path.join(
        this.repoRoot,
        'data',
        'strasbourg',
        'ws2-source-manifest.json',
      );
  }

  async _loadManifest() {
    try {
      const raw = await readFile(
        this.manifestPath,
        'utf8',
      );

      const parsed = JSON.parse(raw);

      if (
        parsed?.schema !==
        'ADA_WS2_SOURCE_MANIFEST_V1'
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  async discover() {
    return {
      sourceId: 'strasbourg-structures',
      name:
        'Strasbourg local curated structures dataset',
      sourceKind: 'LOCAL_CURATED_SNAPSHOT',
      path: this.csvPath,
      networkRequired: false,
    };
  }

  async fetch() {
    const raw = await readFile(
      this.csvPath,
      'utf8',
    );

    const manifest =
      await this._loadManifest();

    const parsed = parseCsv(raw);

    const items = parsed.map(
      (item) => {
        const result =
          validateStructureRecord(
            item,
            manifest,
          );

        return (
          result.value ?? {
            ...item,
            launchEligible: false,
          }
        );
      },
    );

    return {
      items,
      fetchedAt: new Date(),
      syncRunId: crypto.randomUUID(),
      sourceId: 'strasbourg-structures',
      networkUsed: false,
    };
  }

  // @ts-ignore
  async validate(items) {
    if (!Array.isArray(items)) {
      return {
        valid: [],
        rejected: [],
        errors: [
          'STRASBOURG_STRUCTURES_ITEMS_MUST_BE_ARRAY',
        ],
      };
    }

    const manifest =
      await this._loadManifest();

    const valid = [];
    const rejected = [];
    const errors = [];

    items.forEach(
      (item, index) => {
        const result =
          validateStructureRecord(
            item,
            manifest,
          );

        if (result.valid) {
          valid.push(result.value);
          return;
        }

        const rejection = {
          index,
          item,
          errors: result.errors,
        };

        rejected.push(rejection);

        for (const message of result.errors) {
          errors.push({
            index,
            message,
          });
        }
      },
    );

    return {
      valid,
      rejected,
      errors,
    };
  }

  // @ts-ignore
  async normalize(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    const manifest =
      await this._loadManifest();

    return items.map(
      (item) => {
        const result =
          validateStructureRecord(
            item,
            manifest,
          );

        return (
          result.value ?? {
            ...item,
            launchEligible: false,
          }
        );
      },
    );
  }

  async diff(items) {
    return items.map(
      (/** @type {Record<string, string | number | boolean | null | undefined>} */ item) => ({
        ...item,
        _diffState: 'NEW',
      }),
    );
  }

  async persist(items) {
    const unsafe = items.filter(
      (/** @type {{ launchEligible: boolean; }} */ item) =>
        item?.launchEligible !== true,
    );

    if (unsafe.length > 0) {
      throw new Error(
        'STRASBOURG_STRUCTURES_NOT_LAUNCH_ELIGIBLE',
      );
    }

    return items;
  }

  // @ts-ignore
  async verify(items) {
    const failed = items.filter(
      (/** @type {{ launchEligible: boolean; }} */ item) =>
        item?.launchEligible !== true,
    ).length;

    return {
      verified:
        items.length - failed,
      failed,
    };
  }

  async report(
    id,
    state,
    stats,
  ) {
    return {
      syncRunId: id,
      state,
      stats,
    };
  }
}
