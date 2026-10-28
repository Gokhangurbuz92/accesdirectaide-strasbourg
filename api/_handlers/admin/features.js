// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { getAllFlags } from '@ada/shared/features';

/**
 * GET /api/admin/features
 *
 * Returns the current state of all feature flags.
 * Read-only — flags are controlled via environment variables.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }

    try {
        const flags = getAllFlags();

        const flagDetails = [
            { id: 'AI_AGENT', label: 'Agent conversationnel (IA)', description: 'Active l’assistant conversationnel ; aucun fournisseur d’IA en ligne n’est approuvé pour la production (modèle local du LAB seulement).', enabled: flags.AI_AGENT },
            { id: 'RAG', label: 'Recherche Sémantique (RAG)', description: 'Utilise pgvector pour sourcer les réponses de l\'IA.', enabled: flags.RAG },
            { id: 'OPENFISCA', label: 'Calculateur OpenFisca', description: 'Interroge un moteur OpenFisca pour les simulations ; sans moteur déployé, le résultat reste une estimation non officielle.', enabled: flags.OPENFISCA },
            { id: 'CACHE', label: 'Cache Distribué', description: 'Réduit les coûts API en mémorisant les calculs.', enabled: flags.CACHE },
            { id: 'MAINTENANCE', label: 'Mode Maintenance', description: 'Chaque page affiche la page de maintenance (MAINTENANCE_MODE=1).', enabled: flags.MAINTENANCE },
            { id: 'AUDIT_LOG', label: 'Audit RGPD', description: 'Journalise les accès aux données sensibles.', enabled: flags.AUDIT_LOG },
        ];

        return res.status(200).json({
            success: true,
            data: {
                flags: flagDetails,
                note: 'Les flags sont pilotés par les variables d\'environnement. Modifiez .env.production ou la console cloud pour changer un flag de manière persistante.',
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        logger.error('[Admin Features Error]:', error);
        return res.status(500).json({ success: false, error: 'Erreur lors de la récupération des flags' });
    }
}
