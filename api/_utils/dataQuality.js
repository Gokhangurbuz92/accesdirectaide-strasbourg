// @ts-nocheck
import { db as defaultDb } from '../../src/db/index.js';
import { Aide, Demarche, Structure, Actualite, ReviewQueueItem } from '../../src/db/schema.js';
import { isNull, isNotNull, asc, desc, eq, and } from 'drizzle-orm';
import { env } from './env.js';
import { randomUUID } from 'crypto';

export const REVIEW_QUEUE_OPEN_STATUS = 'open';

/** @type {{ aide: 'aide', demarche: 'demarche', structure: 'structure', actualite: 'actualite' }} */
const ENTITY_TYPES = {
  aide: 'aide',
  demarche: 'demarche',
  structure: 'structure',
  actualite: 'actualite',
};

const MAX_SCAN_LIMIT = 1000;

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function toBoundedPositiveInt(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const parsed = Math.trunc(Number(value));
  if (parsed <= 0) return fallback;
  return Math.min(parsed, MAX_SCAN_LIMIT);
}

/**
 * @param {Date | string | null | undefined} value
 * @returns {number | null}
 */
function ageDaysFrom(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * @param {string | null | undefined} slug
 * @returns {boolean}
 */
function isInvalidSlug(slug) {
  if (!slug) return false;
  return !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug));
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function safeString(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, 300);
}

/**
 * @param {Array<string> | null | undefined} values
 * @returns {boolean}
 */
function isEmptyStringArray(values) {
  if (!Array.isArray(values)) return true;
  return values.filter((value) => typeof value === 'string' && value.trim() !== '').length === 0;
}

/**
 * @param {string} entityType
 * @param {string} entityId
 * @param {string | null | undefined} entitySlug
 * @param {string | null | undefined} title
 * @param {string} reason
 * @param {'P0' | 'P1' | 'P2'} severity
 * @param {Record<string, unknown>=} details
 */
function createCandidate(entityType, entityId, entitySlug, title, reason, severity, details = {}) {
  return {
    entityType,
    entityId,
    entitySlug: safeString(entitySlug),
    title: safeString(title),
    reason,
    severity,
    details,
  };
}

/**
 * @param {Record<string, unknown>} details
 * @returns {object}
 */
function toJsonDetails(details) {
  return /** @type {object} */ (details);
}

/**
 * @param {{
 *   id: string,
 *   slug: string | null,
 *   titre: string,
 *   date_verification: Date | null,
 *   documents_necessaires: string[],
 *   source_document_id?: string | null,
 *   sourceDocument?: { source_url: string | null } | null,
 * }} aide
 * @param {{ staleDays: number }} thresholds
 */
function buildAideCandidates(aide, thresholds) {
  const out = [];
  const ageDays = ageDaysFrom(aide.date_verification);

  if (!aide.date_verification) {
    out.push(
      createCandidate(
        ENTITY_TYPES.aide,
        aide.id,
        aide.slug,
        aide.titre,
        'MISSING_VERIFICATION',
        'P1',
        { lastVerifiedAt: null },
      ),
    );
  } else if (typeof ageDays === 'number' && ageDays > thresholds.staleDays) {
    out.push(
      createCandidate(
        ENTITY_TYPES.aide,
        aide.id,
        aide.slug,
        aide.titre,
        'STALE_VERIFICATION',
        'P1',
        {
          lastVerifiedAt: aide.date_verification.toISOString(),
          ageDays,
          staleDays: thresholds.staleDays,
        },
      ),
    );
  }

  if (!aide.slug) {
    out.push(
      createCandidate(ENTITY_TYPES.aide, aide.id, aide.slug, aide.titre, 'MISSING_SLUG', 'P0'),
    );
  } else if (isInvalidSlug(aide.slug)) {
    out.push(
      createCandidate(ENTITY_TYPES.aide, aide.id, aide.slug, aide.titre, 'INVALID_SLUG', 'P1', { slug: aide.slug }),
    );
  }

  if (isEmptyStringArray(aide.documents_necessaires)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.aide,
        aide.id,
        aide.slug,
        aide.titre,
        'MISSING_REQUIRED_FIELD:documents_necessaires',
        'P0',
        { field: 'documents_necessaires' },
      ),
    );
  }

  if (!aide.source_document_id) {
    out.push(
      createCandidate(
        ENTITY_TYPES.aide,
        aide.id,
        aide.slug,
        aide.titre,
        'MISSING_SOURCE_DOCUMENT',
        'P1',
      ),
    );
  } else if (!safeString(aide.sourceDocument?.source_url)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.aide,
        aide.id,
        aide.slug,
        aide.titre,
        'MISSING_SOURCE_URL',
        'P1',
      ),
    );
  }

  return out;
}

/**
 * @param {{
 *   id: string,
 *   slug: string | null,
 *   titre: string,
 *   date_verification: Date | null,
 *   source_document_id?: string | null,
 *   sourceDocument?: { source_url: string | null } | null,
 * }} demarche
 * @param {{ staleDays: number }} thresholds
 */
function buildDemarcheCandidates(demarche, thresholds) {
  const out = [];
  const ageDays = ageDaysFrom(demarche.date_verification);

  if (!demarche.date_verification) {
    out.push(
      createCandidate(
        ENTITY_TYPES.demarche,
        demarche.id,
        demarche.slug,
        demarche.titre,
        'MISSING_VERIFICATION',
        'P1',
        { lastVerifiedAt: null },
      ),
    );
  } else if (typeof ageDays === 'number' && ageDays > thresholds.staleDays) {
    out.push(
      createCandidate(
        ENTITY_TYPES.demarche,
        demarche.id,
        demarche.slug,
        demarche.titre,
        'STALE_VERIFICATION',
        'P1',
        {
          lastVerifiedAt: demarche.date_verification.toISOString(),
          ageDays,
          staleDays: thresholds.staleDays,
        },
      ),
    );
  }

  if (!demarche.slug) {
    out.push(
      createCandidate(ENTITY_TYPES.demarche, demarche.id, demarche.slug, demarche.titre, 'MISSING_SLUG', 'P0'),
    );
  } else if (isInvalidSlug(demarche.slug)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.demarche,
        demarche.id,
        demarche.slug,
        demarche.titre,
        'INVALID_SLUG',
        'P1',
        { slug: demarche.slug },
      ),
    );
  }

  if (!demarche.source_document_id) {
    out.push(
      createCandidate(
        ENTITY_TYPES.demarche,
        demarche.id,
        demarche.slug,
        demarche.titre,
        'MISSING_SOURCE_DOCUMENT',
        'P1',
      ),
    );
  } else if (!safeString(demarche.sourceDocument?.source_url)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.demarche,
        demarche.id,
        demarche.slug,
        demarche.titre,
        'MISSING_SOURCE_URL',
        'P1',
      ),
    );
  }

  return out;
}

/**
 * @param {{
 *   id: string,
 *   slug: string | null,
 *   nom: string,
 *   date_verification: Date | null,
 *   source_document_id?: string | null,
 *   sourceDocument?: { source_url: string | null } | null,
 * }} structure
 * @param {{ staleDays: number }} thresholds
 */
function buildStructureCandidates(structure, thresholds) {
  const out = [];
  const ageDays = ageDaysFrom(structure.date_verification);

  if (!structure.date_verification) {
    out.push(
      createCandidate(
        ENTITY_TYPES.structure,
        structure.id,
        structure.slug,
        structure.nom,
        'MISSING_VERIFICATION',
        'P1',
        { lastVerifiedAt: null },
      ),
    );
  } else if (typeof ageDays === 'number' && ageDays > thresholds.staleDays) {
    out.push(
      createCandidate(
        ENTITY_TYPES.structure,
        structure.id,
        structure.slug,
        structure.nom,
        'STALE_VERIFICATION',
        'P1',
        {
          lastVerifiedAt: structure.date_verification.toISOString(),
          ageDays,
          staleDays: thresholds.staleDays,
        },
      ),
    );
  }

  if (!structure.slug) {
    out.push(
      createCandidate(ENTITY_TYPES.structure, structure.id, structure.slug, structure.nom, 'MISSING_SLUG', 'P0'),
    );
  } else if (isInvalidSlug(structure.slug)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.structure,
        structure.id,
        structure.slug,
        structure.nom,
        'INVALID_SLUG',
        'P1',
        { slug: structure.slug },
      ),
    );
  }

  if (!structure.source_document_id) {
    out.push(
      createCandidate(
        ENTITY_TYPES.structure,
        structure.id,
        structure.slug,
        structure.nom,
        'MISSING_SOURCE_DOCUMENT',
        'P1',
      ),
    );
  } else if (!safeString(structure.sourceDocument?.source_url)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.structure,
        structure.id,
        structure.slug,
        structure.nom,
        'MISSING_SOURCE_URL',
        'P1',
      ),
    );
  }

  return out;
}

/**
 * @param {{
 *   id: string,
 *   slug: string | null,
 *   titre: string,
 *   source_document_id?: string | null,
 *   sourceDocument?: { source_url: string | null } | null,
 * }} actualite
 */
function buildActualiteCandidates(actualite) {
  const out = [];

  if (!actualite.slug) {
    out.push(
      createCandidate(ENTITY_TYPES.actualite, actualite.id, actualite.slug, actualite.titre, 'MISSING_SLUG', 'P0'),
    );
  } else if (isInvalidSlug(actualite.slug)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.actualite,
        actualite.id,
        actualite.slug,
        actualite.titre,
        'INVALID_SLUG',
        'P1',
        { slug: actualite.slug },
      ),
    );
  }

  if (!actualite.source_document_id) {
    out.push(
      createCandidate(
        ENTITY_TYPES.actualite,
        actualite.id,
        actualite.slug,
        actualite.titre,
        'MISSING_SOURCE_DOCUMENT',
        'P1',
      ),
    );
  } else if (!safeString(actualite.sourceDocument?.source_url)) {
    out.push(
      createCandidate(
        ENTITY_TYPES.actualite,
        actualite.id,
        actualite.slug,
        actualite.titre,
        'MISSING_SOURCE_URL',
        'P1',
      ),
    );
  }

  return out;
}

/**
 * @param {import('drizzle-orm/pg-core').PgDatabase<any>} dbClient
 * @param {number} limit
 */
async function loadAidesForReview(dbClient, limit) {
  const missing = await dbClient.query.Aide.findMany({
    where: isNull(Aide.date_verification),
    columns: {
      id: true,
      slug: true,
      titre: true,
      date_verification: true,
      documents_necessaires: true,
      source_document_id: true,
    },
    with: {
      sourceDocument: {
        columns: {
          source_url: true,
        },
      },
    },
    orderBy: (/** @type {{ updatedAt: any; }} */ t, { desc }) => [desc(t.updatedAt)],
    limit,
  });

  const remaining = Math.max(0, limit - missing.length);
  if (remaining === 0) return missing;

  const oldest = await dbClient.query.Aide.findMany({
    where: isNotNull(Aide.date_verification),
    columns: {
      id: true,
      slug: true,
      titre: true,
      date_verification: true,
      documents_necessaires: true,
      source_document_id: true,
    },
    with: {
      sourceDocument: {
        columns: {
          source_url: true,
        },
      },
    },
    // @ts-ignore
    orderBy: (/** @type {{ date_verification: any; }} */ t, { asc }) => [asc(t.date_verification)],
    limit: remaining,
  });

  return [...missing, ...oldest];
}

/**
 * @param {import('drizzle-orm/pg-core').PgDatabase<any>} dbClient
 * @param {number} limit
 */
async function loadDemarchesForReview(dbClient, limit) {
  const missing = await dbClient.query.Demarche.findMany({
    where: isNull(Demarche.date_verification),
    columns: {
      id: true,
      slug: true,
      titre: true,
      date_verification: true,
      source_document_id: true,
    },
    with: {
      sourceDocument: {
        columns: {
          source_url: true,
        },
      },
    },
    // @ts-ignore
    orderBy: (/** @type {{ updatedAt: any; }} */ t, { desc }) => [desc(t.updatedAt)],
    limit,
  });

  const remaining = Math.max(0, limit - missing.length);
  if (remaining === 0) return missing;

  const oldest = await dbClient.query.Demarche.findMany({
    where: isNotNull(Demarche.date_verification),
    columns: {
      id: true,
      slug: true,
      titre: true,
      date_verification: true,
      source_document_id: true,
    },
    with: {
      sourceDocument: {
        columns: {
          source_url: true,
        },
      },
    },
    // @ts-ignore
    orderBy: (/** @type {{ date_verification: any; }} */ t, { asc }) => [asc(t.date_verification)],
    limit: remaining,
  });

  return [...missing, ...oldest];
}

/**
 * @param {import('drizzle-orm/pg-core').PgDatabase<any>} dbClient
 * @param {number} limit
 */
async function loadStructuresForReview(dbClient, limit) {
  const missing = await dbClient.query.Structure.findMany({
    where: isNull(Structure.date_verification),
    columns: {
      id: true,
      slug: true,
      nom: true,
      date_verification: true,
      source_document_id: true,
    },
    with: {
      sourceDocument: {
        columns: {
          source_url: true,
        },
      },
    },
    // @ts-ignore
    orderBy: (/** @type {{ updatedAt: any; }} */ t, { desc }) => [desc(t.updatedAt)],
    limit,
  });

  const remaining = Math.max(0, limit - missing.length);
  if (remaining === 0) return missing;

  const oldest = await dbClient.query.Structure.findMany({
    where: isNotNull(Structure.date_verification),
    columns: {
      id: true,
      slug: true,
      nom: true,
      date_verification: true,
      source_document_id: true,
    },
    with: {
      sourceDocument: {
        columns: {
          source_url: true,
        },
      },
    },
    // @ts-ignore
    orderBy: (/** @type {{ date_verification: any; }} */ t, { asc }) => [asc(t.date_verification)],
    limit: remaining,
  });

  return [...missing, ...oldest];
}

/**
 * @param {import('drizzle-orm/pg-core').PgDatabase<any>} dbClient
 * @param {number} limit
 */
async function loadRecentActualites(dbClient, limit) {
  return dbClient.query.Actualite.findMany({
    columns: {
      id: true,
      slug: true,
      titre: true,
      source_document_id: true,
    },
    with: {
      sourceDocument: {
        columns: {
          source_url: true,
        },
      },
    },
    // @ts-ignore
    orderBy: (/** @type {{ date_publication: any; }} */ t, { desc }) => [desc(t.date_publication)],
    limit,
  });
}

/**
 * @param {import('drizzle-orm/pg-core').PgDatabase<any>} dbClient
 * @param {ReturnType<typeof createCandidate>} candidate
 */
async function upsertOpenCandidate(dbClient, candidate) {
  const whereCondition = and(
    eq(ReviewQueueItem.entityType, candidate.entityType.toUpperCase()),
    eq(ReviewQueueItem.entityId, candidate.entityId),
    eq(ReviewQueueItem.reason, candidate.reason),
    eq(ReviewQueueItem.status, REVIEW_QUEUE_OPEN_STATUS.toUpperCase()),
  );

  const existingRows = await dbClient.query.ReviewQueueItem.findMany({
    where: whereCondition,
    columns: { id: true },
    limit: 1,
  });

  if (existingRows.length > 0) {
    await dbClient.update(ReviewQueueItem).set({
      entitySlug: candidate.entitySlug,
      title: candidate.title,
      severity: candidate.severity,
      details: toJsonDetails(candidate.details),
      updatedAt: new Date(),
    }).where(eq(ReviewQueueItem.id, existingRows[0].id));
    return 'updated';
  }

  await dbClient.insert(ReviewQueueItem).values({
    id: randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    entityType: candidate.entityType.toUpperCase(),
    entityId: candidate.entityId,
    entitySlug: candidate.entitySlug,
    title: candidate.title,
    reason: candidate.reason,
    severity: candidate.severity,
    status: REVIEW_QUEUE_OPEN_STATUS.toUpperCase(),
    details: toJsonDetails(candidate.details),
  });
  return 'created';
}

/**
 * @param {Record<string, number>} counter
 * @param {string} key
 */
function increment(counter, key) {
  counter[key] = (counter[key] || 0) + 1;
}

/**
 * @param {{
 *   db?: typeof defaultDb,
 *   limitPerType?: number,
 * }} options
 */
export async function scanDataQuality(options = {}) {
  const dbClient = options.db || defaultDb;
  const defaultLimit = env.dataQuality.reviewScanLimitPerType;
  const effectiveLimit = toBoundedPositiveInt(options.limitPerType, defaultLimit);

  const staleThresholds = {
    aide: env.dataQuality.aidesStaleDays,
    demarche: env.dataQuality.demarchesStaleDays,
    structure: env.dataQuality.structuresStaleDays,
  };

  const [aides, demarches, structures, actualites] = await Promise.all([
    loadAidesForReview(dbClient, effectiveLimit),
    loadDemarchesForReview(dbClient, effectiveLimit),
    loadStructuresForReview(dbClient, effectiveLimit),
    loadRecentActualites(dbClient, effectiveLimit),
  ]);

  /** @type {Array<ReturnType<typeof createCandidate>>} */
  const candidates = [];

  for (const aide of aides) {
    candidates.push(
      ...buildAideCandidates(aide, {
        staleDays: staleThresholds.aide,
      }),
    );
  }

  for (const demarche of demarches) {
    candidates.push(
      ...buildDemarcheCandidates(demarche, {
        staleDays: staleThresholds.demarche,
      }),
    );
  }

  for (const structure of structures) {
    candidates.push(
      ...buildStructureCandidates(structure, {
        staleDays: staleThresholds.structure,
      }),
    );
  }

  for (const actualite of actualites) {
    candidates.push(...buildActualiteCandidates(actualite));
  }

  let created = 0;
  let updated = 0;
  /** @type {Record<string, number>} */
  const byReason = {};
  /** @type {Record<string, number>} */
  const bySeverity = {};
  /** @type {Record<string, number>} */
  const byEntityType = {};

  for (const candidate of candidates) {
    const action = await upsertOpenCandidate(dbClient, candidate);
    if (action === 'created') created += 1;
    else updated += 1;

    increment(byReason, candidate.reason);
    increment(bySeverity, candidate.severity);
    increment(byEntityType, candidate.entityType);
  }

  const openTotalRows = await dbClient.query.ReviewQueueItem.findMany({
    where: eq(ReviewQueueItem.status, REVIEW_QUEUE_OPEN_STATUS.toUpperCase()),
    columns: { id: true }
  });
  const openTotal = openTotalRows.length;

  return {
    scanned: {
      aides: aides.length,
      demarches: demarches.length,
      structures: structures.length,
      actualites: actualites.length,
    },
    created,
    updated,
    openTotal,
    byReason,
    bySeverity,
    byEntityType,
    limitPerType: effectiveLimit,
  };
}

/**
 * @param {unknown} raw
 * @param {'open' | 'resolved' | 'ignored'=} fallback
 * @returns {'open' | 'resolved' | 'ignored'}
 */
export function normalizeReviewStatus(raw, fallback = 'open') {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'resolved' || normalized === 'ignored') {
    return normalized;
  }
  return fallback;
}

/**
 * @param {unknown} raw
 * @returns {'resolved' | 'ignored' | 'resolved_by_ai' | null}
 */
export function parsePatchStatus(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'resolved' || normalized === 'ignored' || normalized === 'resolved_by_ai') return normalized;
  return null;
}

/**
 * @param {unknown} raw
 * @returns {'aide' | 'demarche' | 'structure' | 'actualite' | null}
 */
export function normalizeEntityType(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (value === ENTITY_TYPES.aide) return ENTITY_TYPES.aide;
  if (value === ENTITY_TYPES.demarche) return ENTITY_TYPES.demarche;
  if (value === ENTITY_TYPES.structure) return ENTITY_TYPES.structure;
  if (value === ENTITY_TYPES.actualite) return ENTITY_TYPES.actualite;
  return null;
}
