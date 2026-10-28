// @ts-nocheck
import logger from '../../_utils/logger.js';

/**
 * Agent FALC Writer
 *
 * Mission : Simplifier les textes en FALC
 * (Facile à Lire et à Comprendre)
 *
 * Appelle Gemini via generateText() pour simplifier en temps réel.
 */

export const FALC_SYSTEM_PROMPT = `Tu es un expert en rédaction FALC (Facile à Lire et à Comprendre).

RÈGLES STRICTES :
1. Phrases courtes : maximum 15 mots par phrase
2. Mots simples : pas de jargon administratif
3. Une seule idée par phrase
4. Utilise la voix active
5. Pas de double négation
6. Explique chaque acronyme la première fois
7. Utilise des exemples concrets
8. Structure avec des listes à puces
9. Commence par l'information la plus importante
10. Termine par "Comment faire" (les étapes)

FORMAT DE SORTIE :
TITRE SIMPLIFIÉ : [titre en mots simples]
DESCRIPTION FALC : [3-5 phrases FALC]
POUR QUI : [liste des personnes concernées]
COMMENT FAIRE : [étapes numérotées, max 5]
MONTANT : [en chiffres simples]`;

export class FalcWriter {
    constructor() {
        this.name = 'falc-writer';
    }

    async simplify(/** @type {{ conditions: string | number | boolean | null | undefined, description: string | number | boolean | null | undefined, id: string | number | boolean | null | undefined, montant: string | number | boolean | null | undefined, organisme: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ aide) {
        const safeTitle = String(aide.titre || '').slice(0, 255);
        const safeDesc = String(aide.description || '').slice(0, 2000);

        const prompt = `Simplifie cette aide en FALC :

Titre : ${safeTitle}
Description : ${safeDesc}
Organisme : ${String(aide.organisme || 'Non précisé').slice(0, 100)}
Montant : ${String(aide.montant || 'Non précisé').slice(0, 100)}
Conditions : ${String(aide.conditions || 'Non précisé').slice(0, 500)}`;

        try {
            const { generateText } = await import('../gemini.js');

            const result = await generateText(
                FALC_SYSTEM_PROMPT + '\n\n' + prompt,
                { metricType: 'falc-writer' },
            );

            logger.info({
                msg: 'agent.falc-writer.success',
                aideId: aide.id,
                inputLength: safeDesc.length,
                outputLength: result?.length || 0,
            });

            return { ok: true, falcText: result, aideId: aide.id };
        } catch (error) {
            logger.error({
                msg: 'agent.falc-writer.error',
                aideId: aide.id,
                error: error.message,
            });
            // @ts-ignore
            return { ok: false, error: error.message };
        }
    }
}
