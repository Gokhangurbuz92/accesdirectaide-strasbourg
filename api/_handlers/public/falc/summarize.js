// @ts-nocheck
import { db } from '../../../../src/db/index.js';
import { Aide, Demarche, Actualite } from '../../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../../../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../../_utils/rateLimit.js';
import { decide } from '../../../lib/publicVisibility.js';

/**
 * FALC Summarize API (Public) — Multi-Entity
 *
 * POST /api/public/falc/summarize
 * Body: { aideId?: string, entityId?: string, type?: 'aide' | 'demarche' | 'actualite' }
 *
 * Returns the record's FALC text when it exists (with its review status), else a deterministic preview that is NOT stored (PKG-6 / D22: no model call, no write).
 * Supports: Aides, Démarches, and Actualités.
 */

/** Entity configuration map */
const ENTITY_CONFIG = {
    aide: {
        model: Aide,
        titleField: 'titre',
        sourceFields: ['cest_quoi', 'pour_qui', 'ce_que_ca_aide', 'description'],
        cacheFields: ['summary_falc', 'conditions_falc'],
        contextLabel: "une aide sociale",
    },
    demarche: {
        model: Demarche,
        titleField: 'titre',
        sourceFields: ['description_courte', 'pour_qui', 'contenu_detaille', 'ou_faire'],
        cacheFields: ['summary_falc'],
        contextLabel: "une démarche administrative",
    },
    actualite: {
        model: Actualite,
        titleField: 'titre',
        sourceFields: ['contenu', 'resume'],
        cacheFields: ['summary_falc'],
        contextLabel: "une actualité d'aide sociale",
    },
};

export default async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }
    // R12: rate limited (was unbounded)
    const limited = await checkRateLimit('FALC_SUMMARIZE', getClientIp(req));
    if (!limited.allowed) return res.status(getRateLimitStatus(limited)).json(limited.error || { error: 'rate_limited' });

    const body = req.body || {};
    // Support both { aideId } (backward compat) and { entityId, type }
    const type = body.type || 'aide';
    const entityId = body.entityId || body.aideId;

    if (!entityId) {
        return res.status(400).json({ error: 'entityId (ou aideId) requis' });
    }

    const config = Object.hasOwn(ENTITY_CONFIG, String(type)) ? ENTITY_CONFIG[type] : null;   // PKG-11 audit: '__proto__' / 'constructor' are not types
    if (!config) {
        return res.status(400).json({ error: `Type inconnu : ${type}. Types valides : aide, demarche, actualite` });
    }

    try {
        // 1. Fetch the entity
        // We use dynamic query fallback or standard
        const entityTableName = type === 'aide' ? 'Aide' : type === 'demarche' ? 'Demarche' : 'Actualite';
        // @ts-ignore
        const entity = await db.query[entityTableName].findFirst({ where: (/** @type {{ id: string | number | boolean | null | undefined }} */ t, { eq }) => eq(t.id, entityId) });
        // D-5: only what the public may see (an unpublished / unverified aide or démarche is « introuvable » here too)
        // PKG-11 audit: an actualité is public only once published (a draft or rejected RSS item used to be readable here by id)
        if (!entity || (type === 'actualite' ? entity.statut !== 'publie' : !decide(entity, type).visible)) {
            return res.status(404).json({ error: `${type} introuvable` });
        }

        // 2. Return cached FALC if available (cost optimization)
        const hasCachedFalc = config.cacheFields.every(/** @type {string | number} */ (/** @type {string | number} */ f) => !!entity[f]);
        if (hasCachedFalc) {
            logger.info(`[FALC] Cache hit pour ${type}=${entityId}`);
            return res.status(200).json({
                cached: true,
                reviewed: Boolean(entity.falc_reviewed_at),   // PKG-6 / D22: an imported text is NOT a reviewed text
                origin: entity.falc_origin || null,
                type,
                titre_simple: entity[config.titleField],
                summary_falc: entity.summary_falc,
                conditions_simples: entity.conditions_falc || null,
                montant_falc: entity.montant_falc || null,
                points_cles: entity.key_points_falc || [],
                action: 'En savoir plus',
            });
        }

        // 3. PKG-6 / D22: a PUBLIC request never calls a model and never writes to the record. Before D22 this path asked Gemini and wrote the answer straight into
        //    the public FALC columns with no human review (dormant only because ai-policy blocks Gemini). A FALC text reaches the record only through the
        //    administrator review queue (api/_services/falc-governance.js: draft -> named MFA reviewer -> approve). Here: a deterministic, unpersisted preview.
        const sourceText = config.sourceFields
            .map(/** @type {string | number} */ (/** @type {string | number} */ f) => entity[f])
            .filter(Boolean)
            .join('\n\n');

        if (!sourceText) {
            return res.status(422).json({ error: `Aucun contenu à simplifier pour ${type}` });
        }

        const { summarizeFALC } = await import('../../../lib/falc-summarizer.js');
        return res.status(200).json({
            cached: false,
            preview: true,
            persisted: false,
            reviewed: false,
            origin: 'DETERMINISTIC',
            type,
            titre_simple: entity[config.titleField],
            summary_falc: summarizeFALC(sourceText, 4),
            points_cles: [],
            conditions_simples: null,
            action: 'En savoir plus',
        });
    } catch (error) {
        logger.error({ err: error }, `[FALC] Erreur (${type})`);
        return res.status(500).json({ error: 'Simplification indisponible' });
    }
}
