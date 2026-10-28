// @ts-nocheck
/**
 * Degradation Mode — Task 29
 *
 * When AI subsystem is unavailable (Ollama down, budget exhausted):
 * - Deterministic services continue working
 * - AI-dependent specialists return degraded responses
 * - Router detects degradation and adapts
 */

/**
 * Check if the AI subsystem is reachable.
 * @returns {Promise<{ available: boolean, reason?: string }>}
 */
export async function checkAIAvailability() {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) {
        return { available: true };
      }
      return { available: false, reason: `HTTP_${response.status}` };
    } catch (fetchError) {
      clearTimeout(timer);
      throw fetchError;
    }
  } catch (error) {
    if (/** @type {Error} */ (error).name === 'AbortError') {
      return { available: false, reason: 'TIMEOUT' };
    }
    // @ts-ignore
    return { available: false, reason: error.code || error.message };
  }
}

/**
 * Create a degraded response for when AI is unavailable.
 * @param {{ intent: string, categories: string[] }} classification
 * @returns {{ degraded: true, intent: string, categories: string[], message: string, suggestions: string[] }}
 */
export function createDegradedResponse(classification) {
  const suggestions = [];

  // Deterministic suggestions based on category
  if (classification.categories?.includes('EMPLOI')) {
    suggestions.push('francetravail.fr — Pôle emploi / France Travail');
  }
  if (classification.categories?.includes('LOGEMENT')) {
    suggestions.push('service-public.fr — Aides au logement');
    suggestions.push('caf.fr — Caisse d\'allocations familiales');
  }
  if (classification.categories?.includes('SANTE')) {
    suggestions.push('ameli.fr — Assurance maladie');
  }
  if (classification.categories?.includes('HANDICAP')) {
    suggestions.push('service-public.fr — Droits des personnes handicapées');
  }
  if (classification.categories?.includes('FAMILLE')) {
    suggestions.push('caf.fr — Prestations familiales');
  }

  if (suggestions.length === 0) {
    suggestions.push('mesdroitssociaux.gouv.fr — Simulateur de droits');
    suggestions.push('service-public.fr — Portail de l\'administration');
  }

  return {
    degraded: true,
    intent: classification.intent,
    categories: classification.categories || [],
    message: 'Le service d\'intelligence artificielle est temporairement indisponible. Voici des ressources officielles qui peuvent vous aider :',
    suggestions
  };
}
