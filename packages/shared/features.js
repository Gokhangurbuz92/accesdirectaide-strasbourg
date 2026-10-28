/**
 * @ada/shared/features — Feature Flags
 *
 * Allows progressive rollout of features (AI agent, RAG, OpenFisca)
 * without redeployment. All flags default to false for safety.
 *
 * Usage:
 *   import { isEnabled, FEATURES } from '@ada/shared/features';
 *   if (isEnabled('AI_AGENT')) { ... }
 */

/**
 * Feature flag definitions.
 * Each flag maps to an environment variable.
 * @type {Record<string, boolean>}
 */
export const FEATURES = {
    /** Enable AI agent orchestrator (Gemini chat + RAG) */
    AI_AGENT: process.env.ENABLE_AI_AGENT === 'true',

    /** Enable RAG context retrieval (pgvector similarity search) */
    RAG: process.env.ENABLE_RAG === 'true',

    /** Enable real-time OpenFisca calculations */
    OPENFISCA: process.env.ENABLE_OPENFISCA === 'true',

    /** Enable response caching (Upstash/Memory) */
    CACHE: process.env.ENABLE_CACHE !== 'false', // Enabled by default

    /** Maintenance mode — all API endpoints return 503 */
    MAINTENANCE: ['1', 'true'].includes(String(process.env.MAINTENANCE_MODE || '')),   // R7: the same switch the middleware reads (docs: MAINTENANCE_MODE=1)

    /** Enable audit logging (RGPD compliance) */
    AUDIT_LOG: process.env.ENABLE_AUDIT_LOG === 'true',
};

/**
 * Check if a feature is enabled.
 *
 * @param {keyof typeof FEATURES} featureName
 * @returns {boolean}
 */
export function isEnabled(featureName) {
    return FEATURES[featureName] ?? false;
}

/**
 * Get all feature flag states (for /api/health or admin panels).
 * @returns {Record<string, boolean>}
 */
export function getAllFlags() {
    return { ...FEATURES };
}

export default { FEATURES, isEnabled, getAllFlags };
