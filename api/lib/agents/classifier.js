// @ts-nocheck
import logger from '../../_utils/logger.js';

/**
 * Agent Classifier
 *
 * Mission : Catégoriser et taguer les aides
 * selon la taxonomie du projet.
 *
 * Appelle Gemini via generateText() pour classifier en temps réel.
 */

export const CLASSIFIER_SYSTEM_PROMPT = `Tu es un expert en classification des aides sociales françaises.

CATÉGORIES DISPONIBLES (choisis 1 à 3) :
- EMPLOI : travail, formation, insertion professionnelle
- LOGEMENT : loyer, hébergement, rénovation
- SANTE : soins, mutuelle, handicap médical
- FAMILLE : enfants, garde, parentalité
- HANDICAP : AAH, RQTH, accessibilité
- ETUDES : bourses, formation, apprentissage
- MOBILITE : transport, permis, véhicule
- ENERGIE : factures, rénovation énergétique
- ALIMENTATION : aide alimentaire, cantine
- NUMERIQUE : équipement, formation numérique
- JUSTICE : aide juridictionnelle, droits
- SENIORS : retraite, dépendance, APA

AUDIENCES (choisis 1 à 3) :
- JEUNES : moins de 26 ans
- SENIORS : plus de 60 ans
- FAMILLES : avec enfants
- HANDICAP : en situation de handicap
- DEMANDEURS_EMPLOI : sans emploi
- SALARIES : en activité
- ETUDIANTS : en études
- TOUS : tout public

RÉPONDS EN JSON STRICT :
{
  "categories": ["EMPLOI", "LOGEMENT"],
  "audiences": ["JEUNES", "DEMANDEURS_EMPLOI"],
  "besoins": ["trouver un emploi", "se loger"],
  "urgence": "NORMALE",
  "confiance": 0.85
}

Valeurs possibles pour urgence : "NORMALE", "HAUTE", "CRITIQUE"
Le champ confiance est un nombre entre 0 et 1.`;

export class Classifier {
    constructor() {
        this.name = 'classifier';
    }

    async classify(/** @type {{ description: string | number | boolean | null | undefined, id: string | number | boolean | null | undefined, organisme: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ aide) {
        const safeTitle = String(aide.titre || '').slice(0, 255);
        const safeDesc = String(aide.description || '').slice(0, 2000);

        const prompt = `Classifie cette aide sociale française.

Titre : ${safeTitle}
Description : ${safeDesc}
Organisme : ${String(aide.organisme || '').slice(0, 100)}

Réponds UNIQUEMENT en JSON valide.`;

        try {
            const { generateText } = await import('../gemini.js');

            const result = await generateText(
                CLASSIFIER_SYSTEM_PROMPT + '\n\n' + prompt,
                { metricType: 'classifier' },
            );

            // Extract JSON from response
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in classifier response');
            }

            const parsed = JSON.parse(jsonMatch[0]);

            logger.info({
                msg: 'agent.classifier.success',
                aideId: aide.id,
                categories: parsed.categories,
                confiance: parsed.confiance,
            });

            return { ok: true, ...parsed, aideId: aide.id };
        } catch (error) {
            logger.error({
                msg: 'agent.classifier.error',
                aideId: aide.id,
                error: error.message,
            });
            // @ts-ignore
            return { ok: false, error: error.message };
        }
    }
}
