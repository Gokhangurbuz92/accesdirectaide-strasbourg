// @ts-nocheck
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { SERVICE_EPCI } from './serviceTerritory.js';

/*
 * PKG-11 / D12 · P07 (official INSEE reference loaded, 2026-10-22):
 *  - names are compared without case, accents, ligatures or punctuation on both sides (« hoenheim » finds Hœnheim, « illkirch graffenstaden » finds
 *    Illkirch-Graffenstaden), an exact name ranking first (« Villé » is the Bas-Rhin commune, not Ville in the Oise); several territories at the best
 *    rank stay AMBIGUOUS — never the first one;
 *  - a name is read from the MESSAGE only after « à » (« aides logement à Strasbourg »): with the 34 875 French communes, ordinary words are commune names
 *    (Rue, Plan, Villé, Tours, Sens, Gap, Avril…) and « dans la rue » must not move the person to the Somme;
 *  - the hierarchy also carries the EPCI a commune is MEMBER_OF, between the commune and its département (narrowest first, deterministic order);
 *  - once the reference is loaded (the service EPCI exists), five digits are POSTAL_CODE (not resolved: postal and INSEE codes collide);
 *  - once the service territory (the Eurométropole de Strasbourg EPCI) is in the reference, a commune outside it is OUTSIDE_SERVICE_TERRITORY and a
 *    département / région / other EPCI is TOO_BROAD: the local catalogue is never presented as applying elsewhere.
 */
const TYPE_RANK = { MUNICIPAL_ARRONDISSEMENT: 0, COMMUNE_DELEGUEE: 1, COMMUNE_ASSOCIEE: 1, COMMUNE: 2, QPV: 2, EPCI: 3, ADMINISTRATIVE_ARRONDISSEMENT: 4, DEPARTEMENT: 5, SPECIAL_STATUS_COLLECTIVITY: 6, REGION: 7, COUNTRY: 8 };
const LOCAL_TYPES = new Set(['COMMUNE', 'MUNICIPAL_ARRONDISSEMENT', 'COMMUNE_DELEGUEE', 'COMMUNE_ASSOCIEE']);

const MAX_TERRITORY_INPUT = 160;
const MAX_MESSAGE_INPUT = 800;
const MAX_HIERARCHY_DEPTH = 8;

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows || []);
}

/**
 * @param {string | null | undefined} value
 * @param {number} maxLength
 */
function cleanInput(value, maxLength) {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > maxLength) return '';
  return cleaned;
}

function normalizedWords(/** @type {string | number | boolean | null | undefined} */ value) {
  return String(value || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} alias
 */
/** The same normalization as normalizedWords(), in SQL (no extension needed). @param {any} expr */
function normalizedSql(expr) {
  return sql`TRIM(REGEXP_REPLACE(
    TRANSLATE(REPLACE(REPLACE(LOWER(${expr}), 'œ', 'oe'), 'æ', 'ae'), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z0-9]+', ' ', 'g'))`;
}

function currentWindowSql(alias) {
  return sql`(${sql.raw(alias)}.valid_from IS NULL OR ${sql.raw(alias)}.valid_from <= NOW())
    AND (${sql.raw(alias)}.valid_to IS NULL OR ${sql.raw(alias)}.valid_to > NOW())`;
}

async function directCandidates(database, /** @type {string | number | boolean | null | undefined} */ raw) {
  const labelWindow = currentWindowSql('label');
  const result = await database.execute(sql`
    SELECT DISTINCT
      territory.id,
      territory.authority,
      territory.type::text AS type,
      territory.official_code,
      COALESCE((
        SELECT active_label.name
        FROM "TerritoryLabelHistory" active_label
        WHERE active_label.territory_id = territory.id
          AND (active_label.valid_from IS NULL OR active_label.valid_from <= NOW())
          AND (active_label.valid_to IS NULL OR active_label.valid_to > NOW())
        ORDER BY active_label.valid_from DESC NULLS LAST, active_label.id ASC
        LIMIT 1
      ), territory.official_code) AS label,
      CASE
        WHEN territory.id = ${raw} THEN 0
        WHEN LOWER(territory.official_code) = LOWER(${raw}) THEN 1
        WHEN LOWER(label.name) = LOWER(${raw}) AND ${labelWindow} THEN 2
        ELSE 3
      END AS match_rank
    FROM "Territory" territory
    LEFT JOIN "TerritoryLabelHistory" label ON label.territory_id = territory.id
    WHERE territory.status = 'CURRENT'
      AND (
        territory.id = ${raw}
        OR LOWER(territory.official_code) = LOWER(${raw})
        OR (
          ${normalizedSql(sql`label.name`)} = ${normalizedWords(raw)}
          AND ${labelWindow}
        )
      )
    ORDER BY match_rank ASC, territory.id ASC
    LIMIT 3
  `);
  return rowsOf(result);
}

async function messageCandidates(database, /** @type {string | number | boolean | null | undefined} */ message) {
  const normalized = normalizedWords(message);
  if (!normalized) return [];
  const paddedMessage = ` ${normalized} `;
  const result = await database.execute(sql`
    SELECT DISTINCT
      territory.id,
      territory.authority,
      territory.type::text AS type,
      territory.official_code,
      label.name AS label,
      3 AS match_rank
    FROM "Territory" territory
    JOIN "TerritoryLabelHistory" label ON label.territory_id = territory.id
    WHERE territory.status = 'CURRENT'
      AND (label.valid_from IS NULL OR label.valid_from <= NOW())
      AND (label.valid_to IS NULL OR label.valid_to > NOW())
      AND LENGTH(TRIM(label.name)) >= 3
      AND STRPOS(${paddedMessage}, ' a ' || ${normalizedSql(sql`label.name`)} || ' ') > 0
    ORDER BY territory.id ASC
    LIMIT 3
  `);
  return rowsOf(result);
}

async function hasHistoricalMatch(database, /** @type {string | number | boolean | null | undefined} */ raw) {
  if (!raw) return false;
  const result = await database.execute(sql`
    SELECT 1 AS found
    FROM "Territory" territory
    LEFT JOIN "TerritoryLabelHistory" label ON label.territory_id = territory.id
    WHERE territory.status = 'HISTORICAL'
      AND (
        territory.id = ${raw}
        OR LOWER(territory.official_code) = LOWER(${raw})
        OR ${normalizedSql(sql`label.name`)} = ${normalizedWords(raw)}
      )
    LIMIT 1
  `);
  return rowsOf(result).length > 0;
}

async function serviceTerritoryId(database) {
  const result = await database.execute(sql`
    SELECT territory.id FROM "Territory" territory
    WHERE territory.type = 'EPCI' AND territory.official_code = ${SERVICE_EPCI} AND territory.status = 'CURRENT'
    ORDER BY territory.id ASC
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  return row?.id ? String(row.id) : null;
}

async function hierarchyFor(database, /** @type {string | number | boolean | null | undefined} */ territoryId) {
  const result = await database.execute(sql`
    WITH RECURSIVE hierarchy AS (
      SELECT
        territory.id,
        territory.authority,
        territory.type::text AS type,
        territory.official_code,
        0::int AS depth,
        ARRAY[territory.id]::text[] AS path
      FROM "Territory" territory
      WHERE territory.id = ${territoryId}
        AND territory.status = 'CURRENT'

      UNION ALL

      SELECT
        parent.id,
        parent.authority,
        parent.type::text AS type,
        parent.official_code,
        hierarchy.depth + 1,
        hierarchy.path || parent.id
      FROM hierarchy
      JOIN "TerritoryRelation" relation
        ON relation.source_territory_id = hierarchy.id
       AND relation.type IN ('PART_OF', 'MEMBER_OF')
       AND (relation.valid_from IS NULL OR relation.valid_from <= NOW())
       AND (relation.valid_to IS NULL OR relation.valid_to > NOW())
      JOIN "Territory" parent
        ON parent.id = relation.target_territory_id
       AND parent.status = 'CURRENT'
      WHERE hierarchy.depth < ${MAX_HIERARCHY_DEPTH - 1}
        AND NOT parent.id = ANY(hierarchy.path)
    )
    SELECT
      hierarchy.id,
      hierarchy.authority,
      hierarchy.type,
      hierarchy.official_code,
      hierarchy.depth,
      COALESCE((
        SELECT active_label.name
        FROM "TerritoryLabelHistory" active_label
        WHERE active_label.territory_id = hierarchy.id
          AND (active_label.valid_from IS NULL OR active_label.valid_from <= NOW())
          AND (active_label.valid_to IS NULL OR active_label.valid_to > NOW())
        ORDER BY active_label.valid_from DESC NULLS LAST, active_label.id ASC
        LIMIT 1
      ), hierarchy.official_code) AS label
    FROM hierarchy
    ORDER BY hierarchy.depth ASC, hierarchy.id ASC
  `);

  const seen = new Set();
  const ordered = [];
  const rank = (/** @type {any} */ row) => TYPE_RANK[String(row.type)] ?? 9;
  const rows = rowsOf(result).slice().sort((a, b) => Number(a.depth) - Number(b.depth) || rank(a) - rank(b) || String(a.id).localeCompare(String(b.id)));
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    ordered.push({
      id: String(row.id),
      authority: row.authority ? String(row.authority) : null,
      type: row.type ? String(row.type) : null,
      officialCode: row.official_code ? String(row.official_code) : null,
      label: row.label ? String(row.label) : null,
      depth: Number(row.depth),
    });
  }
  return ordered;
}

/**
 * Resolve a citizen territory using the local canonical Territory catalog only.
 * No network lookup, no mutation, and no arbitrary first-match selection.
 *
 * @param {{rawTerritory?: string | null, message?: string | null}} input
 * @param {object} database Drizzle database; injectable only for isolated SQL tests.
 */
export async function resolveAssistantTerritory(input = {}, database = db) {
  const rawTerritory = cleanInput(input.rawTerritory, MAX_TERRITORY_INPUT);
  const message = cleanInput(input.message, MAX_MESSAGE_INPUT);
  if (!database?.execute) return { status: 'UNAVAILABLE' };
  if (!rawTerritory && !message) return { status: 'UNRESOLVED' };

  try {
    // With the national reference loaded, five digits are most often a POSTAL code, and many postal codes are the INSEE code of another commune
    // (67100: Strasbourg-Neudorf by post, Donnenheim for INSEE). They are never resolved; the person is asked for the commune's name.
    const serviceId = await serviceTerritoryId(database);
    if (serviceId && /^\d{5}$/.test(rawTerritory)) return { status: 'POSTAL_CODE' };

    let candidates = rawTerritory ? await directCandidates(database, rawTerritory) : [];
    let matchedBy = rawTerritory ? 'SUPPLIED_TERRITORY' : null;

    // Exact canonical IDs outrank official codes, which outrank labels. Ambiguity
    // is evaluated only among candidates at the same best match rank.
    if (candidates.length > 0 && rawTerritory) {
      const bestRank = Math.min(...candidates.map((/** @type {{ match_rank: string | number | boolean | null | undefined }} */ candidate) => Number(candidate.match_rank)));
      candidates = candidates.filter((/** @type {{ match_rank: string | number | boolean | null | undefined }} */ candidate) => Number(candidate.match_rank) === bestRank);
    }

    if (candidates.length === 0 && !rawTerritory && message) {
      candidates = await messageCandidates(database, message);
      matchedBy = candidates.length > 0 ? 'MESSAGE_LABEL' : null;
    }

    if (candidates.length === 0) {
      if (rawTerritory && await hasHistoricalMatch(database, rawTerritory)) {
        return { status: 'HISTORICAL_ONLY' };
      }
      return { status: 'UNRESOLVED' };
    }

    const unique = new Map();
    for (const candidate of candidates) unique.set(String(candidate.id), candidate);
    if (unique.size !== 1) return { status: 'AMBIGUOUS' };

    const candidate = [...unique.values()][0];
    const hierarchy = await hierarchyFor(database, String(candidate.id));
    if (hierarchy.length === 0 || hierarchy[0].id !== String(candidate.id)) {
      return { status: 'UNAVAILABLE' };
    }

    if (serviceId && !hierarchy.some((item) => item.id === serviceId)) {
      const named = { type: hierarchy[0].type, officialCode: hierarchy[0].officialCode, label: hierarchy[0].label };
      return { status: LOCAL_TYPES.has(String(hierarchy[0].type)) ? 'OUTSIDE_SERVICE_TERRITORY' : 'TOO_BROAD', matchedBy, territory: named };
    }

    const findCode = (/** @type {string | null} */ type) => hierarchy.find((item) => item.type === type)?.officialCode || null;
    return {
      status: 'RESOLVED',
      matchedBy,
      territory: {
        id: hierarchy[0].id,
        authority: hierarchy[0].authority,
        type: hierarchy[0].type,
        officialCode: hierarchy[0].officialCode,
        label: hierarchy[0].label,
        hierarchy,
        territoryIds: hierarchy.map((item) => item.id),
        communeCode: findCode('COMMUNE'),
        departmentCode: findCode('DEPARTEMENT'),
        regionCode: findCode('REGION'),
        epciCode: findCode('EPCI'),
        inServiceTerritory: serviceId ? true : null,
      },
    };
  } catch {
    return { status: 'UNAVAILABLE' };
  }
}

export default { resolveAssistantTerritory };
