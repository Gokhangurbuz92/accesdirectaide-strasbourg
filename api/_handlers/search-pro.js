// @ts-nocheck
import logger from '../_utils/logger.js';
import { describeDbError } from '../_utils/errors.js';
import { db } from '../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { visibleSql } from '../lib/publicVisibility.js';
import { fallbackNeeds } from '../lib/need-fallback.js';

// drizzle renders a bare JS array inside sql`` as a parenthesised row `($1, $2)`, which `= ANY(...)` rejects on a real PostgreSQL ("requires array on right side"): build an explicit IN list.
const idList = (/** @type {Array<string | number>} */ ids) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/**
 * POST /api/search-pro
 *
 * Citizen-facing search endpoint: find structures and professionals
 * matching a citizen's need, territory, audience and modality.
 */
export default async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const needs = Array.isArray(body.needs) ? body.needs.filter(Boolean) : [];
    const audiences = Array.isArray(body.audiences) ? body.audiences.filter(Boolean) : [];
    const modalities = Array.isArray(body.modalities) ? body.modalities.filter(Boolean) : [];
    const territory = (body.territory || '').trim();
    const q = (body.q || '').trim();
    const page = Math.max(1, parseInt(body.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(body.limit, 10) || 12));
    const offset = (page - 1) * limit;

    // ── 1. Fetch taxonomy data for facets ───────────────────
    const [needsResult, audiencesResult, modalitiesResult] = await Promise.all([
      db.execute(sql`SELECT id, slug, label, description, icon, color, keywords FROM "NeedCategory" WHERE "isActive" = true ORDER BY "sortOrder" ASC`),
      db.execute(sql`SELECT id, slug, label FROM "AudienceCategory" WHERE "isActive" = true ORDER BY "sortOrder" ASC`),
      db.execute(sql`SELECT id, slug, label, icon FROM "ModalityType" WHERE "isActive" = true ORDER BY "sortOrder" ASC`),
    ]);

    const allNeeds = (needsResult.rows || needsResult);
    const allAudiences = (audiencesResult.rows || audiencesResult);
    const allModalities = (modalitiesResult.rows || modalitiesResult);

    // ── 2. Build maps ───────────────────────────────────────
    const needMap = Object.fromEntries(allNeeds.map(n => [n.slug, n.id]));

    // ── 3. Find matching structure IDs via junction tables ───
    let structureIdFilter = null;

    // R7: needs without a taxonomy row (none seeded) are matched on the structures' declared categories and services (api/lib/need-fallback.js)
    let needsMatchedBy = needs.length ? 'taxonomy' : null;
    /** @type {any[]} */ let fallbackParts = [];
    if (needs.length > 0) {
      const needIds = needs.map(/** @type {string | number} */ (/** @type {string | number} */ s) => needMap[s]).filter(Boolean);
      if (needIds.length === 0) {
        const fb = fallbackNeeds(needs);
        needsMatchedBy = 'declared_categories';
        fallbackParts = fb.length ? fb.map((n) => sql`(s.categories_aidees && ${sql.raw(`ARRAY[${n.categories.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')}]::text[]`)}
          OR COALESCE(jsonb_exists_any(s.services_externes->'categories', ${sql.raw(`ARRAY[${n.categories.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')}]::text[]`)}), false)
          OR ${sql.join(n.keywords.map((k) => sql`(array_to_string(s.services, ' ') ILIKE ${`%${k}%`} OR s.description_courte ILIKE ${`%${k}%`})`), sql` OR `)})`) : [sql`FALSE`];
      }
      if (needIds.length > 0) {
        const result = await db.execute(
          sql`SELECT DISTINCT "structureId" FROM "StructureNeed" WHERE "needCategoryId" IN (${idList(needIds)})`
        );
        structureIdFilter = (result.rows || result).map(r => r.structureId);
      }
    }

    if (audiences.length > 0) {
      const audienceMap = Object.fromEntries(allAudiences.map(a => [a.slug, a.id]));
      const audienceIds = audiences.map(/** @type {string | number} */ (/** @type {string | number} */ s) => audienceMap[s]).filter(Boolean);
      if (audienceIds.length > 0) {
        const result = await db.execute(
          sql`SELECT DISTINCT "structureId" FROM "StructureAudience" WHERE "audienceCategoryId" IN (${idList(audienceIds)})`
        );
        const ids = (result.rows || result).map(r => r.structureId);
        structureIdFilter = structureIdFilter
          ? structureIdFilter.filter(id => ids.includes(id))
          : ids;
      }
    }

    if (modalities.length > 0) {
      const modalityMap = Object.fromEntries(allModalities.map(m => [m.slug, m.id]));
      const modalityIds = modalities.map(/** @type {string | number} */ (/** @type {string | number} */ s) => modalityMap[s]).filter(Boolean);
      if (modalityIds.length > 0) {
        const result = await db.execute(
          sql`SELECT DISTINCT "structureId" FROM "StructureModality" WHERE "modalityTypeId" IN (${idList(modalityIds)})`
        );
        const ids = (result.rows || result).map(r => r.structureId);
        structureIdFilter = structureIdFilter
          ? structureIdFilter.filter(id => ids.includes(id))
          : ids;
      }
    }

    // If filters active but no matches → return empty
    if (structureIdFilter !== null && structureIdFilter.length === 0) {
      return res.status(200).json({
        structures: [],
        pagination: { total: 0, page, limit, totalPages: 0, hasNext: false },
        facets: { needs: allNeeds, audiences: allAudiences, modalities: allModalities },
      });
    }

    // ── 4. Build WHERE conditions ───────────────────────────
    // PKG-1 / D-5: this citizen-facing directory search had no status filter at all (drafts were listed). Only active AND verified/current/eligible structures are public.
    const whereParts = [visibleSql('structure', { alias: 's' })];

    if (structureIdFilter) {
      whereParts.push(structureIdFilter.length ? sql`s.id IN (${idList(structureIdFilter)})` : sql`FALSE`);
    }
    if (fallbackParts.length) whereParts.push(sql`(${sql.join(fallbackParts, sql` OR `)})`);

    if (territory) {
      if (/^\d{2,3}$/.test(territory)) {
        whereParts.push(sql`s.departement = ${territory}`);
      } else {
        whereParts.push(sql`s.ville ILIKE ${`%${territory}%`}`);
      }
    }

    if (q && q.length >= 2) {
      const pattern = `%${q}%`;
      whereParts.push(sql`(s.nom ILIKE ${pattern} OR s.description_courte ILIKE ${pattern})`);
    }

    const whereClause = whereParts.length > 0
      ? sql`WHERE ${sql.join(whereParts, sql` AND `)}`
      : sql``;

    // ── 5. Count ────────────────────────────────────────────
    const countResult = await db.execute(
      sql`SELECT COUNT(*)::int AS total FROM "Structure" s ${whereClause}`
    );
    const total = (countResult.rows || countResult)[0]?.total || 0;

    // ── 6. Fetch structures ─────────────────────────────────
    const structuresResult = await db.execute(
      sql`SELECT s.id, s.slug, s.nom, s.description_courte, s.type_structure,
              s.adresse, s.code_postal, s.ville, s.departement,
              s.telephone, s.email, s.site_web, s.horaires, s.services,
              s."accessibilite_pmr", s."is_pro_enabled",
              s.latitude, s.longitude, s."quality_score", s."summary_falc"
       FROM "Structure" s
       ${whereClause}
       ORDER BY s."quality_score" DESC NULLS LAST, s."updatedAt" DESC, s.id ASC
       LIMIT ${limit} OFFSET ${offset}`
    );
    const structures = (structuresResult.rows || structuresResult);

    if (structures.length === 0) {
      return res.status(200).json({
        structures: [], needsMatchedBy,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: false },
        facets: { needs: allNeeds, audiences: allAudiences, modalities: allModalities },
      });
    }

    // ── 7. Enrich with taxonomy + pro profiles ──────────────
    const sIds = structures.map(s => s.id);

    const [structureNeeds, structureAudiences, structureModalities, proProfilesResult] = await Promise.all([
      db.execute(
        sql`SELECT sn."structureId", nc.slug, nc.label, nc.icon, nc.color
         FROM "StructureNeed" sn JOIN "NeedCategory" nc ON nc.id = sn."needCategoryId"
         WHERE sn."structureId" IN (${idList(sIds)})`
      ),
      db.execute(
        sql`SELECT sa."structureId", ac.slug, ac.label
         FROM "StructureAudience" sa JOIN "AudienceCategory" ac ON ac.id = sa."audienceCategoryId"
         WHERE sa."structureId" IN (${idList(sIds)})`
      ),
      db.execute(
        sql`SELECT sm."structureId", mt.slug, mt.label, mt.icon
         FROM "StructureModality" sm JOIN "ModalityType" mt ON mt.id = sm."modalityTypeId"
         WHERE sm."structureId" IN (${idList(sIds)})`
      ),
      db.execute(
        sql`SELECT pp.id, pp."displayName", pp."jobTitle", pp."descriptionPublic",
                pp."photoUrl", pp."acceptsNewClients", pp."contactMode",
                pu."structureId"
         FROM "ProProfile" pp JOIN "ProUser" pu ON pu.id = pp."proUserId"
         WHERE pu."structureId" IN (${idList(sIds)}) AND pp."isPubliclyVisible" = true AND pu.status = 'active'`
      ),
    ]);

    // Group by structure
    const needsByStructure = groupBy((structureNeeds.rows || structureNeeds), 'structureId');
    const audiencesByStructure = groupBy((structureAudiences.rows || structureAudiences), 'structureId');
    const modalitiesByStructure = groupBy((structureModalities.rows || structureModalities), 'structureId');
    const prosByStructure = groupBy((proProfilesResult.rows || proProfilesResult), 'structureId');

    // ── 8. Format response ──────────────────────────────────
    const results = structures.map(s => ({
      id: s.id,
      slug: s.slug,
      nom: s.nom,
      description_courte: s.description_courte,
      type_structure: s.type_structure,
      adresse: s.adresse,
      code_postal: s.code_postal,
      ville: s.ville,
      departement: s.departement,
      telephone: s.telephone,
      email: s.email,
      site_web: s.site_web,
      horaires: s.horaires,
      accessibilite_pmr: s.accessibilite_pmr,
      latitude: s.latitude,
      longitude: s.longitude,
      quality_score: s.quality_score,
      summary_falc: s.summary_falc,
      needs: (needsByStructure[s.id] || []).map(n => ({
        slug: n.slug, label: n.label, icon: n.icon, color: n.color,
      })),
      // @ts-ignore
      audiences: (audiencesByStructure[s.id] || []).map(a => ({
        slug: a.slug, label: a.label,
      })),
      // @ts-ignore
      modalities: (modalitiesByStructure[s.id] || []).map(m => ({
        slug: m.slug, label: m.label, icon: m.icon,
      })),
      rdv: { isPublished: s.is_pro_enabled || false, bookingMode: 'IN_PERSON' },
      // @ts-ignore
      professionals: (prosByStructure[s.id] || []).map(p => ({
        id: p.id,
        displayName: p.displayName,
        jobTitle: p.jobTitle,
        descriptionPublic: p.descriptionPublic,
        photoUrl: p.photoUrl,
        acceptsNewClients: p.acceptsNewClients,
        contactMode: p.contactMode,
      })),
    }));

    return res.status(200).json({
      structures: results, needsMatchedBy,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total },
      facets: {
        needs: allNeeds.map(n => ({ slug: n.slug, label: n.label, icon: n.icon, color: n.color })),
        audiences: allAudiences.map(a => ({ slug: a.slug, label: a.label })),
        modalities: allModalities.map(m => ({ slug: m.slug, label: m.label, icon: m.icon })),
      },
    });
  } catch (error) {
    // public endpoint: the driver message carries the SQL and its parameters (the visitor's own search terms), so it stays in the server log, without the parameters
    logger.error('search-pro handler error:', { err: describeDbError(error) });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
* @param {any} arr
*/
function groupBy(arr, /** @type {string | number} */ key) {
  const result = {};
  for (const item of arr) {
    const k = item[key];
    // @ts-ignore
    if (!result[k]) result[k] = [];
    // @ts-ignore
    result[k].push(item);
  }
  return result;
}
