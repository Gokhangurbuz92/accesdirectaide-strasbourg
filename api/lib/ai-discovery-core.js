// @ts-nocheck
import logger from '../_utils/logger.js';
import { createGeminiBreaker } from './gemini-circuit-breaker.js';
import { recordMetric } from './gemini-metrics.js';
import { AIProviderPolicy, PROVIDER, AUDIENCE } from './ai-policy.js';

/**
 * Shared AI discovery core — used by agent-discovery, agent-scheduler, and hive-scan.
 *
 * Calls Gemini 2.0 Flash to find new social aid updates for a given category.
 * Returns parsed findings array.
 *
 * @param {string} category - The aid category to scan
 * @param {object} [options]
 * @param {string} [options.metricType='discovery'] - Metric type for recording
 * @param {number} [options.limit=5] - Number of results to request
 * @returns {Promise<Array<{title: string, source: string, summary: string, confidence?: number}>>}
 */

import { getGenAI } from './gemini.js';

/**
 * @param {string} category
 * @param {object} [options]
 * @returns {Promise<{findings: Array, metrics: object, fallback: boolean}>}
 */
export async function discoverByCategory(category, options = {}) {
    const policyDecision = AIProviderPolicy.evaluate({
        provider: PROVIDER.GEMINI,
        audience: AUDIENCE.PROFESSIONAL
    });
    if (!policyDecision.allowed) {
        throw new Error('AI_PROVIDER_NOT_ALLOWED');
    }

    // @ts-ignore
    const { metricType = 'discovery', limit = 5 } = options;

    const safeCategory = String(category).replace(/<[^>]*>/g, '').slice(0, 100);

    const prompt = `Trouve les ${limit} dernières nouveautés ou changements concernant les aides sociales en France pour la catégorie "${safeCategory}". Pour chaque aide, donne : titre, source officielle, résumé court des critères d'éligibilité, et un score de confiance (0-100). Réponds en JSON : un tableau d'objets avec les clés "title", "source", "summary", "confidence".`;

    const ai = await getGenAI();
    const model = ai.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: {
            parts: [{
                text: "Tu es l'Agent Chercheur de AccesDirectAide, une plateforme solidaire. Fournis des informations sociales vérifiées et sourcées. Réponds UNIQUEMENT en JSON valide.",
            }],
        },
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
        },
    });

    const breaker = createGeminiBreaker((/** @type {import("./gemini-types.js").GeminiPrompt} */ p) => model.generateContent(p));
    const startTime = Date.now();
    const result = await breaker.fire(prompt);

    // Check for circuit breaker fallback
    if (result && result.fallback) {
        recordMetric({ type: metricType, model: 'gemini-2.0-flash', latencyMs: Date.now() - startTime, success: false, circuitBreakerOpen: true });
        return { findings: [], metrics: { latencyMs: Date.now() - startTime }, fallback: true };
    }

    const response = await result.response;
    const raw = response.text() || '[]';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    const metrics = {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
        latencyMs: Date.now() - startTime,
    };

    recordMetric({
        type: metricType,
        model: 'gemini-2.0-flash',
        ...metrics,
        success: true,
    });

    let findings = [];
    try {
        const parsed = JSON.parse(cleaned);
        findings = Array.isArray(parsed) ? parsed : [];
    } catch {
        findings = [{ title: 'Résultat brut', source: 'Gemini', summary: cleaned, confidence: 50 }];
    }

    return { findings, metrics, fallback: false };
}
