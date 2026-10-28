// @ts-nocheck
import logger from '../../../_utils/logger.js';
import { requireProAuth, requireProStructureContext } from '../../../_utils/auth.js';
import { generateText } from '../../../lib/gemini.js';
import { AUDIENCE } from '../../../lib/ai-policy.js';

const PROMPTS = {
    'summarize': `Tu es un assistant pour travailleur social. 
Analyse cet historique de conversation et réalise un résumé psychologique et social concis en 3 à 5 points à puces.
Garde un ton professionnel, neutre et bienveillant.`,

    'detect-urgency': `Tu es une IA spécialisée dans la détection des vulnérabilités sociales et psychologiques.
Lis cette conversation et évalue si la situation présente un risque immédiat (violences, risque suicidaire, perte imminente de logement, précarité vitale).
Réponds uniquement au format JSON : { "isUrgent": boolean, "reasons": ["raison 1", "raison 2"], "recommendedAction": "Action à prendre" }.`,

    'suggest-reply': `Tu es un travailleur social empathique. 
En te basant sur cette dernière conversation, rédige 2 propositions de réponse courte pour l'usager.
La réponse doit être chaleureuse, déculpabilisante et claire.
Format JSON uniquement: { "suggestions": ["Reponse 1", "Reponse 2"] }`
};

async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { messages, action } = req.body || {};
    if (!messages || !Array.isArray(messages) || !action || !PROMPTS[action]) {
        return res.status(400).json({ error: 'Payload invalide ou action inconnue.' });
    }

    if (messages.length > 50) messages.splice(0, messages.length - 50);

    try {
        const conversationText = messages.map(m => `[${m.role === 'pro' ? 'Travailleur Social' : 'Usager'}]: ${m.body}`).join('\n');
        // @ts-ignore
        const userQuery = `${PROMPTS[action]}\n\nVoici la conversation entre le travailleur social et l'usager :\n\n${conversationText}`;

        const rawText = await generateText(userQuery, {
            audience: AUDIENCE.PROFESSIONAL,
            model: 'gemini-2.0-flash',
            metricType: 'assist',
            temperature: action === 'suggest-reply' ? 0.7 : 0.2
        });

        let finalData = rawText;

        if (action === 'detect-urgency' || action === 'suggest-reply') {
            const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                try {
                    finalData = JSON.parse(jsonMatch[0]);
                } catch {
                    logger.warn('[AI Assist] JSON Parse failed from Gemini');
                }
            }
        }

        return res.status(200).json({ ok: true, result: finalData });
    } catch (error) {
        logger.error({ err: error }, '[AI Assist] Erreur');
        // @ts-ignore
        if (error.message && error.message.includes('AI_PROVIDER_NOT_ALLOWED')) {
            return res.status(403).json({ error: 'IA_BLOCKED_PENDING_REVIEW' });
        }
        return res.status(500).json({ error: 'Échec de l\'analyse IA.' });
    }
}

export default requireProAuth(handler);
