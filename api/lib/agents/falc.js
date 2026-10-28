/**
 * FalcSpecialist — LLM Specialist
 *
 * Migrates FALC_SYSTEM_PROMPT from falc-writer.js.
 * Simplifies text to FALC (Facile à Lire et à Comprendre).
 * Output ALWAYS marked falcReviewStatus: PENDING.
 * On-demand only — not automatically triggered.
 * Never auto-published. Routes to ReviewQueue.
 */

import { z } from 'zod';
import { registerComponent } from './registry.js';

// Preserved from existing falc-writer.js
const FALC_SYSTEM_PROMPT = `Tu es un expert en rédaction FALC (Facile à Lire et à Comprendre).

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

IMPORTANT : Ta simplification est une aide à la compréhension.
Elle n'est PAS un texte officiel vérifié.
Elle sera marquée comme "simplification IA non vérifiée" et soumise à relecture.

FORMAT DE SORTIE JSON :
{
  "category": "FALC",
  "simplifiedTitle": "titre en mots simples",
  "simplifiedText": "texte simplifié en FALC",
  "targetAudience": "description du public cible",
  "keyActions": ["étape 1", "étape 2"],
  "falcReviewStatus": "PENDING",
  "humanActionRequired": true
}`;

const FALC_RESPONSE_SCHEMA = z.object({
  category: z.literal('FALC'),
  decisionSummary: z.string().optional().default('Simplification FALC générée'),
  simplifiedTitle: z.string(),
  simplifiedText: z.string(),
  targetAudience: z.string().optional().default('Tout public'),
  keyActions: z.array(z.string()).default([]),
  falcReviewStatus: z.literal('PENDING').default('PENDING'), // Always PENDING
  humanActionRequired: z.literal(true).default(true)          // Always requires review
});

export const FALC_DEFINITION = {
  name: 'falc',
  description: 'Simplification FALC — Facile à Lire et à Comprendre',
  systemPrompt: FALC_SYSTEM_PROMPT,
  responseSchema: FALC_RESPONSE_SCHEMA,
  tools: [], // No tools — text-only
  timeout: 60_000,
  enabled: true,
  requiresModel: true
};

export function registerFalc() {
  registerComponent(FALC_DEFINITION);
}

export { FALC_RESPONSE_SCHEMA, FALC_SYSTEM_PROMPT };
