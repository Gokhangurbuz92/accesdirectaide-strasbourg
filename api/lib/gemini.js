// @ts-nocheck
import { visibleSql } from './publicVisibility.js';
import { AIProviderPolicy, PROVIDER, AUDIENCE } from "./ai-policy.js";
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { env } from '../_utils/env.js';
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import { getChatBreaker } from './gemini-circuit-breaker.js';
import { recordMetric } from './gemini-metrics.js';
import { sql } from 'drizzle-orm';
import { generateEmbedding } from './EmbeddingProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('@google/generative-ai').GoogleGenerativeAI | null} */
let genAI = null;
let GoogleGenerativeAI_lib = null;

/** @returns {Promise<import('@google/generative-ai').GoogleGenerativeAI>} */
export async function getGenAI() {
    if (genAI) return genAI;

    const apiKey = env.ai.geminiKey;
    if (!apiKey) {
        throw new Error('[env] Missing required environment variable: GEMINI_API_KEY (or GOOGLE_API_KEY)');
    }

    if (!GoogleGenerativeAI_lib) {
        const mod = await import('@google/generative-ai');
        GoogleGenerativeAI_lib = mod.GoogleGenerativeAI;
    }

    genAI = new GoogleGenerativeAI_lib(apiKey);
    return genAI;
}

/**
 * Detects the intent of the message to load the correct RulePack
 */
/** @param {string} message */
function detectIntent(message) {
    const text = message.toLowerCase();
    if (text.match(/apl|aide au logement|loyer|caf|appartement|studio|logement/)) {
        return 'apl_v1';
    }
    return null;
}

/**
 * Loads a RulePack JSON from the data directory
 */
/** @param {string} id */
function loadRulePack(id) {
    try {
        const path = join(__dirname, '../../src/data/rulepacks', `${id}.json`);
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        logger.error(`Failed to load RulePack ${id}:`, e);
        return null;
    }
}

/**
 * RAG: Fetch similar Aides from the database using pgvector cosine distance.
 * Returns empty array if embeddings aren't available yet or pgvector isn't enabled.
 *
 * @param {string} message - User message to embed and search for
 * @param {number} [limit=5] - Max results
 * @returns {Promise<Array<{titre: string, cest_quoi: string|null, pour_qui: string|null, ce_que_ca_aide: string|null, summary_falc: string|null, similarity: number}>>}
 */
async function fetchRagContext(message, limit = 5) {
    try {
        const vector = await generateEmbedding(message);
        if (!vector) return [];
        const vectorStr = `[${vector.join(',')}]`;

        const results = await db.execute(sql`
            SELECT titre, cest_quoi, pour_qui, ce_que_ca_aide, summary_falc,
                    1 - (embedding <=> ${vectorStr}::vector) AS similarity
             FROM "Aide"
             WHERE embedding IS NOT NULL AND ${visibleSql('aide')}
             ORDER BY embedding <=> ${vectorStr}::vector ASC
             LIMIT ${limit}
        `);

        const rows = results.rows || results;
        return rows || [];
    } catch (err) {
        // Graceful fallback: pgvector not enabled, no embeddings, or Gemini quota exceeded
        logger.warn('[RAG] Vector search unavailable, will try lexical fallback:', err.message);
        return [];
    }
}

/**
 * Format RAG results into a text block for prompt injection
 * @param {Awaited<ReturnType<typeof fetchRagContext>>} aides
 */
function formatRagContext(aides) {
    if (!aides.length) return '';

    const lines = aides.map((a, i) => {
        const parts = [`[Aide ${i + 1}: ${a.titre}]`];
        if (a.cest_quoi) parts.push(`C'est quoi : ${a.cest_quoi}`);
        if (a.pour_qui) parts.push(`Pour qui : ${a.pour_qui}`);
        if (a.ce_que_ca_aide) parts.push(`Ce que ça aide : ${a.ce_que_ca_aide}`);
        if (a.summary_falc) parts.push(`Résumé : ${a.summary_falc}`);
        return parts.join('\n');
    });

    return `\n\nAIDES PERTINENTES (base de données) :\n---\n${lines.join('\n---\n')}\n---`;
}

/**
 * Lexical fallback: keyword search via Drizzle when vector search is unavailable.
 * Extracts meaningful words from the message and searches titre + cest_quoi fields.
 *
 * @param {string} message
 * @param {number} [limit=5]
 * @returns {Promise<Array<{titre: string, cest_quoi: string|null, pour_qui: string|null, ce_que_ca_aide: string|null, summary_falc: string|null}>>}
 */
async function fetchLexicalContext(message, limit = 5) {
    try {
        // Extract meaningful keywords (>3 chars, skip common French stop words)
        const stopWords = new Set(['pour', 'dans', 'avec', 'sans', 'plus', 'elle', 'quel', 'quoi', 'comment', 'quelles', 'sont', 'être', 'avoir', 'faire', 'cette', 'tout', 'très']);
        const keywords = message
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w));

        if (!keywords.length) return [];

        // Build OR conditions using raw SQL with ILIKE for case-insensitive search
        const conditions = keywords.flatMap(kw => [
            sql`titre ILIKE ${'%' + kw + '%'}`,
            sql`cest_quoi ILIKE ${'%' + kw + '%'}`,
            sql`pour_qui ILIKE ${'%' + kw + '%'}`,
            sql`summary_falc ILIKE ${'%' + kw + '%'}`,
        ]);

        const orClause = sql.join(conditions, sql` OR `);

        const results = await db.execute(sql`
            SELECT titre, cest_quoi, pour_qui, ce_que_ca_aide, summary_falc
            FROM "Aide"
            WHERE (${orClause}) AND ${visibleSql('aide')}
            LIMIT ${limit}
        `);

        const rows = results.rows || results;
        logger.info(`[Lexical] Found ${rows.length} aides for keywords: ${keywords.join(', ')}`);
        return rows;
    } catch (err) {
        // @ts-ignore
        logger.error('[Lexical] Fallback search failed:', err.message);
        return [];
    }
}

/**
 * Chat with Gemini using RulePack injection + RAG context from pgvector.
 *
 * @typedef {{ role: string, content: string }} ChatMessage
 */

/**
 * @param {string} message
 * @param {ChatMessage[]=} history
 * @returns {Promise<{ answer: string, meta: { searchMode: string, sourceCount: number, intent: string|null } }>}
 */
/**
 * Simple text generation with Gemini (no RAG, no RulePack).
 * Used by AI repair agents for structured JSON extraction.
 *
 * @param {string} prompt - The prompt to send to Gemini
 * @param {{ useSearch?: boolean, audience?: string }} [options] - Generation options
 * @returns {Promise<string>} Raw text response
 */
export async function generateText(prompt, options = {}) {
    const audience = options.audience || AUDIENCE.PROFESSIONAL;
    const policy = AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience });
    if (!policy.allowed) {
        throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
    }

    // @ts-ignore
    const modelName = options.model || 'gemini-2.0-flash';
    // @ts-ignore
    const metricType = options.metricType || 'generate';
    const startTime = Date.now();
    const genAIClient = await getGenAI();
    const model = genAIClient.getGenerativeModel({
        model: modelName,
        generationConfig: {
            // @ts-ignore
            temperature: options.temperature ?? 0.1,
            topP: 0.9,
            topK: 40,
        },
    });

    const searchHint = options.useSearch
        ? '\nIMPORTANT : Utilise tes connaissances les plus récentes et les sources officielles françaises (.gouv.fr, service-public.fr).\n'
        : '';

    const breaker = getChatBreaker((/** @type {string} */ p) => model.generateContent(p));
    const result = await breaker.fire(searchHint + prompt);

    // Check for circuit breaker fallback
    if (result && result.fallback) {
        recordMetric({ type: metricType, model: modelName, latencyMs: Date.now() - startTime, success: false, circuitBreakerOpen: true });
        return result.message;
    }

    const response = await result.response;
    const usage = response.usageMetadata;
    recordMetric({
        type: metricType,
        model: modelName,
        promptTokens: usage?.promptTokenCount || 0,
        completionTokens: usage?.candidatesTokenCount || 0,
        totalTokens: usage?.totalTokenCount || 0,
        latencyMs: Date.now() - startTime,
        success: true,
    });
    return response.text();
}

// @ts-ignore
export async function chatWithRulePack(/** @type {string} */ message, history = []) {
    // chatWithRulePack is currently exclusively used by citizen routes (assistant/chat.js)
    const policy = AIProviderPolicy.evaluate({ 
        provider: PROVIDER.GEMINI, 
        audience: AUDIENCE.CITIZEN
    });
    
    const intent = detectIntent(message);
    const rulePack = intent ? loadRulePack(intent) : null;

    // ── 1. Fetch context: try RAG first, fall back to lexical search ──
    let contextAides = await fetchRagContext(message);
    let searchMode = 'rag';

    if (!contextAides.length) {
        // @ts-ignore
        contextAides = await fetchLexicalContext(message);
        searchMode = 'lexical';
    }

    const meta = { searchMode, sourceCount: contextAides.length, intent };

    // Enforce policy BEFORE generating AI response
    if (!policy.allowed) {
        logger.warn(`[Gemini] Chat generation blocked by policy: ${policy.reason}`);
        // Return structured static fallback since AI is prohibited for this audience
        meta.searchMode = 'static';
        if (contextAides.length > 0) {
            const aidesList = contextAides
                .map(a => `• "${a.titre}"${a.cest_quoi ? ` — ${a.cest_quoi.slice(0, 120)}` : ''}`)
                .join('\n');
            return {
                answer: `Le système d'assistance par intelligence artificielle est actuellement désactivé pour des raisons de conformité. \n\nCependant, voici les aides qui pourraient correspondre à votre recherche :\n\n${aidesList}\n\nPour plus de détails, consultez la fiche de chaque aide.`,
                meta,
            };
        }
        return {
            answer: `Le système d'assistance par intelligence artificielle est actuellement désactivé. Veuillez utiliser l'annuaire ou le moteur de recherche classique.`,
            meta,
        };
    }

    // ── 2. Try Gemini chat generation ──
    try {
        const genAIClient = await getGenAI();
        const model = genAIClient.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: {
                temperature: 0.2,
                topP: 0.8,
                topK: 40,
            }
        });

        let systemInstruction = `Tu es un assistant administratif expert pour AccesDirectAide.
    RÈGLES CRITIQUES :
    1. Utilise UNIQUEMENT les informations du RulePack et des Aides pertinentes fournis ci-dessous.
    2. Si une information manque, réponds : "Je n'ai pas cette information précise dans mes données actuelles."
    3. Pose UNE SEULE question à la fois pour vérifier l'éligibilité.
    4. Ne conclus jamais positivement sans avoir vérifié TOUTES les conditions.
    5. Explique toujours le résultat en langage simple (FALC).
    6. Cite toujours le titre exact de l'aide entre guillemets.`;

        if (rulePack) {
            systemInstruction += `\n\nRULEPACK ACTIF : ${JSON.stringify(rulePack)}`;
        }

        const ragContext = formatRagContext(contextAides);
        if (ragContext) {
            systemInstruction += ragContext;
        }

        const chat = model.startChat({
            history: history.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }],
            })),
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            }
        });

        const chatStartTime = Date.now();
        const result = await chat.sendMessage(message);
        const response = await result.response;
        const chatUsage = response.usageMetadata;
        recordMetric({
            type: 'chat',
            model: 'gemini-2.0-flash',
            promptTokens: chatUsage?.promptTokenCount || 0,
            completionTokens: chatUsage?.candidatesTokenCount || 0,
            totalTokens: chatUsage?.totalTokenCount || 0,
            latencyMs: Date.now() - chatStartTime,
            success: true,
        });
        return { answer: response.text(), meta };
    } catch (geminiError) {
        // ── 3. Static fallback when Gemini is down (429, network, etc.) ──
        // @ts-ignore
        logger.warn('[Gemini] Chat generation failed, using static fallback:', geminiError.message);

        meta.searchMode = 'static';

        if (contextAides.length > 0) {
            const aidesList = contextAides
                .map(a => `• "${a.titre}"${a.cest_quoi ? ` — ${a.cest_quoi.slice(0, 120)}` : ''}`)
                .join('\n');
            return {
                answer: `Je rencontre actuellement une forte affluence et ne peux pas générer une réponse personnalisée. ` +
                    `Cependant, voici les aides qui pourraient correspondre à votre recherche :\n\n${aidesList}\n\n` +
                    `Pour plus de détails, consultez la fiche de chaque aide sur notre plateforme ou contactez un travailleur social.`,
                meta,
            };
        }

        return {
            answer: `Je suis temporairement indisponible pour répondre de manière personnalisée. ` +
                `En attendant, vous pouvez consulter notre annuaire des aides ou contacter un travailleur social pour obtenir de l'aide.`,
            meta,
        };
    }
}

/**
* @param {string} text
* @param {any} voice
*/
export async function generateTTS(text, voice) {
    const policy = AIProviderPolicy.evaluate({ 
        provider: PROVIDER.GEMINI, 
        audience: AUDIENCE.PUBLIC,
        feature: 'tts'
    });
    if (!policy.allowed) {
        throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('IA non configurée.');

    const TTS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';
    
    const payload = {
        contents: [{ parts: [{ text: `Lis ceci de manière posée et rassurante, en français : ${text}` }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
    };

    const response = await fetch(`${TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`TTS Error: ${response.status} ${errorText.slice(0, 200)}`);
    }

    return await response.json();
}

/**
* @param {string | any[]} texts
*/
export async function generateEmbeddings(texts) {
    const policy = AIProviderPolicy.evaluate({ 
        provider: PROVIDER.GEMINI, 
        audience: AUDIENCE.PROFESSIONAL,
        feature: 'embeddings'
    });
    if (!policy.allowed) {
        throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
    }

    const genAIClient = await getGenAI();
    const model = genAIClient.getGenerativeModel({ model: 'text-embedding-004' });
    
    // Simplistic batch for brevity, assuming texts is array
    if (!Array.isArray(texts)) texts = [texts];
    
    const results = [];
    for (const text of texts) {
        const result = await model.embedContent(text);
        results.push(result.embedding.values);
    }
    
    return texts.length === 1 ? results[0] : results;
}
