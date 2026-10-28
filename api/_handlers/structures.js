// @ts-nocheck
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import { Structure } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { searchStructuresSchema } from '../_utils/validators.js';
import { searchStructures } from '../lib/search-query.js';
import { buildProvenance } from '../_utils/provenance.js';
import { decide, stripReviewFields } from '../lib/publicVisibility.js';

const MALFORMED_SLUG = Symbol('malformed-slug');
/**
 * @param {string | null | undefined} url
 * @param {string | null | undefined} host
 * @returns {string | null | typeof MALFORMED_SLUG}
 */
function extractSlugFromPath(url, host = 'localhost') {
  if (!url) return null;
  try {
    const urlObj = new URL(url, `https://${host}`);
    const pathname = urlObj.pathname || '';
    // Support both `/api/structures/:slug` and `/structures/:slug` (depending on runtime rewrites).
    const match = pathname.match(/^\/(?:api\/)?structures\/([^/?#]+)/);
    if (!match) return null;
    // Q04: an undecodable segment (« %E0%A4%A ») is a malformed detail request, not « no slug » (it used to return the whole list, publicly cached)
    let slug; try { slug = decodeURIComponent(match[1] || '').trim(); } catch { return MALFORMED_SLUG; }
    return slug || null;
  } catch {
    return null;
  }
}
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */

/**
 * Generate a description_courte for a structure if missing or too short (<20 chars).
 * Uses only existing source fields — never invents information.
 * Templates are deliberately prudent and non-assertive.
 * @param {object} s - Structure record
 * @returns {object} - Structure with enriched description_courte + description_generated flag
 */
function enrichDescription(s) {
  if (s.description_courte && String(s.description_courte).trim().length >= 20) {
    return { ...s, description_generated: false };
  }

  const parts = [];
  const type = s.type_structure ? String(s.type_structure).trim() : '';
  const ville = s.ville ? String(s.ville).trim() : '';
  const cp = s.code_postal ? String(s.code_postal).trim() : '';
  const services = Array.isArray(s.services) ? s.services.filter(Boolean) : [];
  const publics = Array.isArray(s.publics_accueillis) ? s.publics_accueillis.filter(Boolean) : [];
  const categories = Array.isArray(s.categories_aidees) ? s.categories_aidees.filter(Boolean) : [];
  const pmr = s.accessibilite_pmr;

  // Template priority order (most specific first)
  if (services.length > 0 || categories.length > 0) {
    const tags = [...new Set([...services, ...categories])].slice(0, 5).join(', ');
    parts.push(`Cette structure est référencée pour des besoins liés à : ${tags}.`);
    parts.push('Pour savoir si vous êtes éligible et comment être accompagné, contactez-la (horaires et modalités à confirmer).');
  } else if (publics.length > 0) {
    const publicsList = publics.slice(0, 4).join(', ');
    parts.push(`Structure référencée pour accompagner : ${publicsList}.`);
    parts.push('Pour vérifier l\'accueil et les démarches possibles, contactez-la (sur place, par téléphone ou via le site si disponible).');
  } else if (type && ville) {
    parts.push(`Structure de type « ${type} » située à ${ville}${cp ? ` (${cp})` : ''}, référencée dans l'annuaire ADA.`);
    parts.push('Contactez-la pour connaître les services proposés, les horaires et les conditions d\'accès.');
  } else if (type) {
    parts.push(`Structure de type « ${type} » référencée dans l'annuaire ADA.`);
    parts.push('Elle peut vous orienter ou vous informer selon votre situation. Contactez-la pour vérifier l\'accueil, les horaires et les modalités.');
  } else if (ville) {
    parts.push(`Structure située à ${ville}${cp ? ` (${cp})` : ''}, référencée dans l'annuaire ADA.`);
    parts.push('Contactez-la pour connaître les services proposés, les horaires et les conditions d\'accès.');
  } else {
    parts.push('Structure locale référencée dans l\'annuaire ADA.');
    parts.push('Contactez-la pour connaître les services proposés, les conditions d\'accès et les horaires.');
  }

  // Bonus: PMR accessibility if available
  if (typeof pmr === 'boolean') {
    parts.push(`Accessibilité PMR : ${pmr ? 'oui' : 'non renseignée'}.`);
  }

  // Disclaimer suffix
  parts.push('Informations à confirmer.');

  return {
    ...s,
    description_courte: parts.join(' '),
    description_generated: true,
  };
}

async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('SEARCH_STRUCTURES', ip);
    if (!rateLimit.allowed) {
      return res.status(429).json(rateLimit.error);
    }

    // Validate Input
    const rawQuery = req.query || {};
    const slugFromPath = extractSlugFromPath(req.url, req.headers?.host);
    if (slugFromPath === MALFORMED_SLUG) return res.status(400).json({ error: 'Invalid parameters', details: { slug: 'malformed' } });
    const queryWithPath = { ...rawQuery };
    if (slugFromPath && !queryWithPath.slug && !queryWithPath.id) {
      queryWithPath.slug = slugFromPath;
    }

    const validation = searchStructuresSchema.safeParse(queryWithPath);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: validation.error.format() });
    }
    const params = validation.data;
    const effectiveParams = { ...params };

    // Query param aliases
    if (effectiveParams.limit != null) {
      effectiveParams.pageSize = effectiveParams.limit;
    }
    if (!effectiveParams.departement && effectiveParams.territory) {
      effectiveParams.departement = effectiveParams.territory;
    }
    if (!effectiveParams.departement && effectiveParams.geo) {
      effectiveParams.departement = effectiveParams.geo;
    }

    // Default sort:
    // - With q: relevance
    // - Without q: quality first (then recent)
    if (!effectiveParams.sort) {
      effectiveParams.sort = effectiveParams.q ? 'relevance' : 'quality';
    }

    // 1. Single Item (ID or Slug)
    if (effectiveParams.id || effectiveParams.slug) {
      let structure;
      try {
        structure = await db.query.Structure.findFirst({
          where: effectiveParams.id ? eq(Structure.id, effectiveParams.id) : eq(Structure.slug, effectiveParams.slug),
          columns: {
            raw_data_hash: false,
            content_hash: false,
            import_batch: false,
            import_status: false,
            geoloc_status: false,
            source_last_modified: false,
            retrieved_at: false,
            last_checked_at: false,
            source_document_id: false,
          },
          // DTA S4A: the Structure relations are `proRdvServices` (many) and `rdvSettings` (many, unique per structure). The former request for a `proServices` relation named one that does not exist:
          // Drizzle threw before any SQL, the catch below turned it into a 404 and EVERY single-structure read (slug or id) answered "Structure non trouvée" on the real stack (native S3B run 436e5e, DTA-B12).
          with: {
            proRdvServices: {
              columns: { id: true, name: true, durationMinutes: true },
              where: (t, { eq: eqOp }) => eqOp(t.isActive, true),
            },
            rdvSettings: {
              columns: {
                isPublished: true,
                bookingMode: true,
              },
            },
            sourceDocument: {
              columns: {
                fetched_at: true,
                source_url: true,
              },
            },
          }
        });
      } catch (findErr) {
        // A query fault is a server fault, not "not found": answering 404 here hid the missing-relation defect above from every test and every log line.
        logger.error(`Structure findFirst error: ${findErr && findErr.message ? String(findErr.message).slice(0, 300) : 'unknown'}`);
        return res.status(500).json({ error: 'Erreur serveur' });
      }

      // D-5: a structure page exists publicly only for an active AND verified/current/eligible record (same 404 as an unknown id).
      const visibility = decide(structure, 'structure');
      if (!structure || !visibility.visible) {
        return res.status(404).json({ error: "Structure non trouvée" });
      }
      const { sourceDocument, rdvSettings: rdvSettingsRaw, proRdvServices, ...structureRest } = structure;
      const safeStructure = stripReviewFields(structureRest);   // reviewer identity and hold reasons are internal
      const rdvSettings = Array.isArray(rdvSettingsRaw) ? rdvSettingsRaw[0] : rdvSettingsRaw;   // `many` relation → array (at most one row: unique structureId)
      const isRdvPublished =
        rdvSettings && typeof rdvSettings.isPublished === 'boolean'
          ? rdvSettings.isPublished
          : Boolean(safeStructure.is_pro_enabled);
      const bookingMode =
        rdvSettings && typeof rdvSettings.bookingMode === 'string'
          ? rdvSettings.bookingMode
          : 'IN_PERSON';

      return res.status(200).json({
        ...safeStructure,
        is_pro_enabled: isRdvPublished,
        proServices: isRdvPublished ? (proRdvServices || []) : [],   // public shape kept for PublicRdvEntry; only active services, no internal columns
        rdv: {
          isPublished: isRdvPublished,
          bookingMode,
        },
        provenance: {
          ...buildProvenance({
            verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeStructure.date_verification : null,
            fetchedAt: sourceDocument?.fetched_at,
            sourceUrl: sourceDocument?.source_url || safeStructure.source_url || safeStructure.source_url_exact,
          }),
          contentStatus: visibility.contentStatus,
          freshness: visibility.freshness,
        },
      });
    }

    // 2. Search / List
    let territoryFilter = null;
    // PKG-11 / P07: only an INSEE commune code selects a hierarchy — a postal code (zip) or a city name is not one, and many postal codes ARE the INSEE
    // code of another commune (67100: Strasbourg-Neudorf by post, Donnenheim for INSEE)
    const geoQuery = effectiveParams.geo || effectiveParams.territory || effectiveParams.territoire;
    if (geoQuery) {
        const { getHierarchy } = await import('../lib/geography/TerritoryService.js');
        const schemas = await import('../../src/db/schema.js');
        const { hierarchy } = await getHierarchy(geoQuery, db, schemas);
        if (hierarchy && hierarchy.length > 0) {
            territoryFilter = { userTerritoryIds: hierarchy.map(h => h.id) };
        }
    }

    const { items, total } = await searchStructures({
      ...effectiveParams,
      territoryFilter
    });

    // Enrich items with description_courte if missing
    const enrichedItems = items.map(enrichDescription);

    return res.status(200).json({
      items: enrichedItems,
      pagination: {
        total,
        page: effectiveParams.page,
        limit: effectiveParams.pageSize,
        pageSize: effectiveParams.pageSize,
        totalPages: Math.ceil(total / effectiveParams.pageSize),
        hasNext: effectiveParams.page * effectiveParams.pageSize < total
      }
    });
  } catch (error) {
    logger.error('Structures handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default handler;
