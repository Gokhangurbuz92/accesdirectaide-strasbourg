/**
 * Router Deterministic POC — Task 40
 *
 * Verifies ≥80% of clear-intent test prompts route deterministically (0 model calls).
 * Records routingConfidence and usedAIForRouting for each.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AI to prevent real calls
vi.mock('../../api/lib/ai-foundation.js', () => ({
  generateStructuredContent: vi.fn().mockResolvedValue({
    content: { intent: 'ORIENTATION', confidence: 0.8 },
    safeErrorState: null
  })
}));

vi.mock('../../api/lib/agents/base-specialist.js', () => ({
  BaseSpecialist: class {
    constructor(def) { this.definition = def; }
    async execute(dispatch) {
      const { createResponse } = await import('../../api/lib/agents/dispatch.js');
      return createResponse({
        componentName: this.definition.name,
        content: { mocked: true },
        componentLatency: 10,
        dispatchId: dispatch.executionId,
        routingMethod: 'LLM',
        modelCallCount: 1,
        safeErrorState: null
      });
    }
  }
}));

import { ADARouter } from '../../api/lib/agents/router.js';
import { clearRegistry } from '../../api/lib/agents/registry.js';
import { registerOrientation } from '../../api/lib/agents/orientation.js';
import { registerEligibility } from '../../api/lib/agents/eligibility.js';
import { registerProcedure } from '../../api/lib/agents/procedure.js';
import { registerDocument } from '../../api/lib/agents/document.js';
import { registerFalc } from '../../api/lib/agents/falc.js';

// Clear-intent test prompts — these should ALL route deterministically
const CLEAR_INTENT_PROMPTS = [
  // FALC (should → FALC)
  { prompt: 'Simplifie ce texte en FALC', expectedIntent: 'FALC' },
  { prompt: 'Rends ce document facile à lire et à comprendre', expectedIntent: 'FALC' },
  { prompt: 'Simplification FALC de cette notification', expectedIntent: 'FALC' },

  // PROCEDURE (should → PROCEDURE)
  { prompt: 'Comment faire une demande de RSA ?', expectedIntent: 'PROCEDURE' },
  { prompt: 'Quelles démarches pour obtenir l\'AAH ?', expectedIntent: 'PROCEDURE' },
  { prompt: 'Quelle est la procédure pour demander une aide au logement ?', expectedIntent: 'PROCEDURE' },
  { prompt: 'Comment demander un dossier MDPH ?', expectedIntent: 'PROCEDURE' },
  { prompt: 'Où faire ma demande de CMU-C ?', expectedIntent: 'PROCEDURE' },

  // ELIGIBILITY (should → ELIGIBILITY)
  { prompt: 'Ai-je droit au RSA ?', expectedIntent: 'ELIGIBILITY' },
  { prompt: 'Suis-je éligible à l\'AAH ?', expectedIntent: 'ELIGIBILITY' },
  { prompt: 'Puis-je bénéficier de la prime d\'activité ?', expectedIntent: 'ELIGIBILITY' },
  { prompt: 'Quelles sont les conditions pour l\'APL ?', expectedIntent: 'ELIGIBILITY' },

  // DOCUMENT (should → DOCUMENT)
  { prompt: 'J\'ai reçu un courrier de la CAF que je ne comprends pas', expectedIntent: 'DOCUMENT' },
  { prompt: 'Que signifie cette lettre de Pôle Emploi ?', expectedIntent: 'DOCUMENT' },
  { prompt: 'J\'ai reçu une notification de la CPAM', expectedIntent: 'DOCUMENT' },

  // ORIENTATION (should → ORIENTATION)
  { prompt: 'J\'ai perdu mon emploi et je cherche des aides', expectedIntent: 'ORIENTATION' },
  { prompt: 'Quelles aides pour une famille monoparentale ?', expectedIntent: 'ORIENTATION' },
  { prompt: 'J\'ai des difficultés financières, que faire ?', expectedIntent: 'ORIENTATION' },
  { prompt: 'Où trouver un centre d\'accueil près de chez moi ?', expectedIntent: 'ORIENTATION' },

  // SAFETY_ABSTENTION (should → SAFETY_ABSTENTION)
  { prompt: '', expectedIntent: 'SAFETY_ABSTENTION' },
];

describe('Router Deterministic POC — Task 40', () => {
  beforeEach(() => {
    clearRegistry();
    registerOrientation();
    registerEligibility();
    registerProcedure();
    registerDocument();
    registerFalc();
  });

  const results = [];

  it('≥80% of clear-intent prompts route deterministically', async () => {
    const router = new ADARouter();
    let deterministicCount = 0;
    const details = [];

    for (const testCase of CLEAR_INTENT_PROMPTS) {
      const response = await router.route({ prompt: testCase.prompt });
      const trace = response.traceMetadata || {};
      const isDeterministic = trace.usedAIForRouting === false;
      const routedCorrectly = trace.route === testCase.expectedIntent;

      if (isDeterministic) deterministicCount++;

      details.push({
        prompt: testCase.prompt.substring(0, 50),
        expected: testCase.expectedIntent,
        actual: trace.route,
        deterministic: isDeterministic,
        correct: routedCorrectly,
        confidence: trace.routingConfidence
      });
    }

    const deterministicRate = deterministicCount / CLEAR_INTENT_PROMPTS.length;

    // Log results for analysis
    console.log('\n=== Router Deterministic POC Results ===');
    console.log(`Deterministic rate: ${(deterministicRate * 100).toFixed(1)}% (${deterministicCount}/${CLEAR_INTENT_PROMPTS.length})`);
    for (const d of details) {
      console.log(`  ${d.deterministic ? '✓' : '✗'} [${d.expected}] ${d.prompt} → ${d.actual} (${d.confidence?.toFixed(2) || 'N/A'})`);
    }

    expect(deterministicRate).toBeGreaterThanOrEqual(0.8);
  });

  it('all deterministic routes are correct', async () => {
    const router = new ADARouter();
    for (const testCase of CLEAR_INTENT_PROMPTS) {
      const response = await router.route({ prompt: testCase.prompt });
      const trace = response.traceMetadata || {};
      if (trace.usedAIForRouting === false) {
        expect(trace.route).toBe(testCase.expectedIntent);
      }
    }
  });

  it('deterministic routing latency is under 50ms per prompt', async () => {
    const router = new ADARouter();
    for (const testCase of CLEAR_INTENT_PROMPTS) {
      const start = Date.now();
      await router.route({ prompt: testCase.prompt });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    }
  });
});
