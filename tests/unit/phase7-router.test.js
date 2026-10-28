/**
 * Router Unit Tests — Task 15
 *
 * Tests deterministic routing logic, budget enforcement, safety abstention.
 * Mocks BaseSpecialist.execute to avoid real AI calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock ai-foundation to prevent provider loading
vi.mock('../../api/lib/ai-foundation.js', () => ({
  generateStructuredContent: vi.fn().mockResolvedValue({
    content: { intent: 'ORIENTATION', confidence: 0.8 },
    safeErrorState: null,
    citations: [],
    confidence: 0.8,
    abstention: false,
    humanApprovalRequired: false
  })
}));

// Mock base-specialist to prevent real LLM calls
vi.mock('../../api/lib/agents/base-specialist.js', () => ({
  BaseSpecialist: class {
    constructor(def) { this.definition = def; }
    async execute(dispatch) {
      const { createResponse } = await import('../../api/lib/agents/dispatch.js');
      return createResponse({
        componentName: this.definition.name,
        content: { mocked: true },
        componentLatency: 50,
        dispatchId: dispatch.executionId,
        routingMethod: 'LLM',
        modelCallCount: 1,
        citations: [],
        confidence: 0.8,
        abstention: false,
        humanApprovalRequired: false,
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

function registerAllSpecialists() {
  clearRegistry();
  registerOrientation();
  registerEligibility();
  registerProcedure();
  registerDocument();
  registerFalc();
}

describe('Phase 7 Router Tests', () => {
  beforeEach(() => {
    registerAllSpecialists();
  });

  describe('Deterministic routing', () => {
    it('routes FALC request deterministically', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: 'Simplifie ce texte en FALC' });
      expect(response.traceMetadata?.usedAIForRouting).toBe(false);
      expect(response.traceMetadata?.route).toBe('FALC');
    });

    it('routes procedure question deterministically', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: 'Comment faire une demande de RSA ?' });
      expect(response.traceMetadata?.usedAIForRouting).toBe(false);
      expect(response.traceMetadata?.route).toBe('PROCEDURE');
    });

    it('routes document question deterministically', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: "J'ai reçu un courrier de la CAF" });
      expect(response.traceMetadata?.usedAIForRouting).toBe(false);
      expect(response.traceMetadata?.route).toBe('DOCUMENT');
    });

    it('routes eligibility question deterministically', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: "Ai-je droit à l'AAH ?" });
      expect(response.traceMetadata?.usedAIForRouting).toBe(false);
      expect(response.traceMetadata?.route).toBe('ELIGIBILITY');
    });

    it('routes general aide query to ORIENTATION', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: "J'ai perdu mon emploi et cherche des aides" });
      expect(response.traceMetadata?.route).toBe('ORIENTATION');
    });
  });

  describe('SAFETY_ABSTENTION', () => {
    it('returns abstention for empty prompt', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: '' });
      expect(response.abstention).toBe(true);
      expect(response.humanApprovalRequired).toBe(true);
    });
  });

  describe('Budget enforcement', () => {
    it('model call count never exceeds 2', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: 'Quelles aides pour le logement ?' });
      expect(response.modelCallCount).toBeLessThanOrEqual(2);
    });
  });

  describe('Dispatch trace', () => {
    it('trace contains routing metadata without sensitive content', async () => {
      const router = new ADARouter();
      const response = await router.route({ prompt: 'Quelles aides pour le logement ?' });
      const trace = response.traceMetadata;
      expect(trace).toBeDefined();
      expect(trace.requestId).toBeDefined();
      expect(trace.route).toBeDefined();
      expect(trace.routeReason).toBeDefined();
      expect(trace.routingConfidence).toBeGreaterThan(0);
      expect(trace.routingLatencyMs).toBeGreaterThanOrEqual(0);
      // Verify no raw prompt in trace
      expect(trace.rawPrompt).toBeUndefined();
      expect(trace.prompt).toBeUndefined();
    });
  });

  describe('Source conflict handling', () => {
    it('detects source conflicts and sets humanApprovalRequired', async () => {
      const router = new ADARouter();
      const response = await router.route({
        prompt: 'Quelles aides pour le logement ?',
        sourceEnvelope: [
          { sourceId: 's1', conflictState: 'SOURCE_CONFLICT', verificationStatus: 'VERIFIED', lastVerified: '2026-01-01T00:00:00Z' },
          { sourceId: 's2', conflictState: 'SOURCE_CONFLICT', verificationStatus: 'VERIFIED', lastVerified: '2026-06-01T00:00:00Z' }
        ]
      });
      expect(response.sourceConflict).toBe(true);
      expect(response.humanApprovalRequired).toBe(true);
    });
  });

  describe('Routing performance', () => {
    it('deterministic routing completes under 50ms', async () => {
      const router = new ADARouter();
      const start = Date.now();
      const response = await router.route({ prompt: 'Simplifie en FALC' });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });
});
