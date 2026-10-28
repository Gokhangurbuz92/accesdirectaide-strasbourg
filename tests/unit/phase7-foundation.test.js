import { describe, it, expect, beforeEach } from 'vitest';

import { SourceEnvelope, AgentDispatch, AgentResponse, createDispatch, createResponse } from '../../api/lib/agents/dispatch.js';
import { MAX_MODEL_CALLS_INTERACTIVE, MAX_TOOL_CALLS, MAX_AGENT_HOPS, GLOBAL_TIMEOUT, PER_PROVIDER_TIMEOUT, MAX_RETRIES, DETERMINISTIC_ROUTING_CONFIDENCE_THRESHOLD, DEFAULT_FRESHNESS_TTL_DAYS, BudgetTracker } from '../../api/lib/agents/budget.js';
import { registerComponent, getComponent, listComponents, hasComponent, clearRegistry } from '../../api/lib/agents/registry.js';
import { classifyIntent, classifyCategories, CATEGORIES, INTENTS } from '../../api/lib/services/classification.js';
import { isAllowedSource, validateUrlSafety, createSourceEnvelope, validateCitations, detectSourceConflicts, ALLOWED_DOMAINS } from '../../api/lib/services/official-sources.js';
import { evaluateFreshness, batchEvaluateFreshness, getItemsNeedingReview } from '../../api/lib/services/freshness.js';

describe('Phase 7 Foundation Infrastructure Tests', () => {

  // ─── 1. dispatch.js ────────────────────────────
  describe('1. dispatch.js tests', () => {
    it('SourceEnvelope Zod validation — valid', () => {
      const result = SourceEnvelope.safeParse({
        sourceId: 'src-1',
        verificationStatus: 'VERIFIED',
        url: 'https://www.service-public.fr/aide'
      });
      expect(result.success).toBe(true);
    });

    it('SourceEnvelope Zod validation — invalid (missing required field)', () => {
      const result = SourceEnvelope.safeParse({ url: 'not-a-url' });
      expect(result.success).toBe(false);
    });

    it('AgentDispatch creation via createDispatch()', () => {
      const dispatch = createDispatch({
        requestId: '11111111-1111-1111-1111-111111111111',
        userIntent: 'PROCEDURE',
        sourceComponent: 'ada-router',
        targetComponent: 'procedure',
        payload: 'Comment demander AAH ?',
        sourceEnvelope: [],
        toolPermissions: ['search_procedures'],
        timeoutMs: 45_000
      });
      expect(dispatch.executionId).toBeDefined();
      expect(dispatch.requestId).toBe('11111111-1111-1111-1111-111111111111');
      expect(dispatch.userIntent).toBe('PROCEDURE');
      expect(dispatch.targetComponent).toBe('procedure');
      expect(dispatch.deadline).toBeGreaterThan(Date.now());
    });

    it('AgentResponse creation via createResponse() with defaults', () => {
      const response = createResponse({
        componentName: 'orientation',
        content: { test: true },
        componentLatency: 1234,
        dispatchId: '11111111-1111-1111-1111-111111111111',
        routingMethod: 'DETERMINISTIC',
        modelCallCount: 0
      });
      expect(response.componentName).toBe('orientation');
      expect(response.content).toEqual({ test: true });
      expect(response.abstention).toBe(false);
      expect(response.humanApprovalRequired).toBe(false);
      expect(response.safeErrorState).toBe(null);
    });

    it('AgentDispatch rejects missing required fields', () => {
      const result = AgentDispatch.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ─── 2. budget.js ─────────────────────────────
  describe('2. budget.js tests', () => {
    it('constants have correct values', () => {
      expect(MAX_MODEL_CALLS_INTERACTIVE).toBe(2);
      expect(MAX_TOOL_CALLS).toBe(3);
      expect(MAX_AGENT_HOPS).toBe(1);
      expect(GLOBAL_TIMEOUT).toBe(90_000);
      expect(PER_PROVIDER_TIMEOUT).toBe(60_000);
      expect(MAX_RETRIES).toBe(1);
      expect(DETERMINISTIC_ROUTING_CONFIDENCE_THRESHOLD).toBe(0.8);
      expect(DEFAULT_FRESHNESS_TTL_DAYS).toBe(90);
    });

    it('BudgetTracker: initial state allows calls', () => {
      const tracker = new BudgetTracker();
      expect(tracker.canCallModel()).toBe(true);
      expect(tracker.canCallTool()).toBe(true);
      expect(tracker.canHop()).toBe(true);
      expect(tracker.isExpired()).toBe(false);
    });

    it('BudgetTracker: exhausting model calls', () => {
      const tracker = new BudgetTracker();
      tracker.recordModelCall();
      expect(tracker.canCallModel()).toBe(true); // 1 < 2
      tracker.recordModelCall();
      expect(tracker.canCallModel()).toBe(false); // 2 >= 2
    });

    it('BudgetTracker: exhausting tool calls', () => {
      const tracker = new BudgetTracker();
      tracker.recordToolCall();
      tracker.recordToolCall();
      tracker.recordToolCall();
      expect(tracker.canCallTool()).toBe(false); // 3 >= 3
    });

    it('BudgetTracker: exhausting hops', () => {
      const tracker = new BudgetTracker();
      tracker.recordHop();
      expect(tracker.canHop()).toBe(false); // 1 >= 1
    });

    it('BudgetTracker: getSummary() returns correct counts', () => {
      const tracker = new BudgetTracker();
      tracker.recordModelCall();
      tracker.recordToolCall();
      tracker.recordHop();
      const summary = tracker.getSummary();
      expect(summary.modelCalls).toBe(1);
      expect(summary.toolCalls).toBe(1);
      expect(summary.agentHops).toBe(1);
      expect(summary.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── 3. registry.js ───────────────────────────
  describe('3. registry.js tests', () => {
    beforeEach(() => clearRegistry());

    const mockDef = {
      name: 'test-specialist',
      description: 'Test',
      systemPrompt: 'You are a test specialist.',
      responseSchema: {},
      tools: [],
      timeout: 45_000,
      enabled: true,
      requiresModel: true
    };

    it('registerComponent() and getComponent()', () => {
      registerComponent(mockDef);
      const retrieved = getComponent('test-specialist');
      expect(retrieved.name).toBe('test-specialist');
    });

    it('duplicate registration throws', () => {
      registerComponent(mockDef);
      expect(() => registerComponent(mockDef)).toThrow(/already registered/);
    });

    it('unknown component throws', () => {
      expect(() => getComponent('nonexistent')).toThrow(/Unknown component/);
    });

    it('listComponents() returns all', () => {
      registerComponent(mockDef);
      registerComponent({ ...mockDef, name: 'another' });
      expect(listComponents()).toHaveLength(2);
    });

    it('hasComponent()', () => {
      registerComponent(mockDef);
      expect(hasComponent('test-specialist')).toBe(true);
      expect(hasComponent('nonexistent')).toBe(false);
    });

    it('clearRegistry()', () => {
      registerComponent(mockDef);
      clearRegistry();
      expect(hasComponent('test-specialist')).toBe(false);
      expect(listComponents()).toHaveLength(0);
    });
  });

  // ─── 4. classification.js ─────────────────────
  describe('4. classification.js tests', () => {
    it('classifyIntent: procedure question', () => {
      const res = classifyIntent("Comment faire une demande d'AAH ?");
      expect(res.intent).toBe('PROCEDURE');
      expect(res.method).toBe('DETERMINISTIC');
      expect(res.confidence).toBeGreaterThan(0.5);
    });

    it('classifyIntent: orientation/employment', () => {
      const res = classifyIntent("J'ai perdu mon emploi et je cherche des aides");
      expect(res.intent).toBe('ORIENTATION');
      expect(res.categories).toContain('EMPLOI');
    });

    it('classifyIntent: FALC request', () => {
      const res = classifyIntent('Simplifier ce texte en FALC');
      expect(res.intent).toBe('FALC');
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('classifyIntent: eligibility question', () => {
      const res = classifyIntent("Ai-je droit à l'AAH ?");
      expect(res.intent).toBe('ELIGIBILITY');
    });

    it('classifyIntent: structure search maps to ORIENTATION', () => {
      const res = classifyIntent('Où se trouve la CAF ?');
      expect(res.intent).toBe('ORIENTATION');
    });

    it('classifyIntent: document question', () => {
      const res = classifyIntent("J'ai reçu un courrier de la CAF que je ne comprends pas");
      expect(res.intent).toBe('DOCUMENT');
    });

    it('classifyIntent: empty string → SAFETY_ABSTENTION', () => {
      const res = classifyIntent('');
      expect(res.intent).toBe('SAFETY_ABSTENTION');
      expect(res.confidence).toBe(0);
    });

    it('classifyCategories returns correct categories', () => {
      const cats = classifyCategories("aide au logement et à l'emploi");
      expect(cats).toContain('LOGEMENT');
      expect(cats).toContain('EMPLOI');
    });

    it('all intents return DETERMINISTIC method', () => {
      const prompts = ['FALC', "procédure", "courrier", "éligible", "aides"];
      for (const p of prompts) {
        expect(classifyIntent(p).method).toBe('DETERMINISTIC');
      }
    });
  });

  // ─── 5. official-sources.js ───────────────────
  describe('5. official-sources.js tests', () => {
    it('isAllowedSource: service-public.fr → true', () => {
      expect(isAllowedSource('https://www.service-public.fr/aide')).toBe(true);
    });

    it('isAllowedSource: evil.com → false', () => {
      expect(isAllowedSource('https://evil.com/fake')).toBe(false);
    });

    it('isAllowedSource: null → false', () => {
      expect(isAllowedSource(null)).toBe(false);
    });

    it('validateUrlSafety: allowed domain → safe', () => {
      const res = validateUrlSafety('https://www.service-public.fr/aide');
      expect(res.safe).toBe(true);
    });

    it('validateUrlSafety: localhost → LOOPBACK_ADDRESS', () => {
      const res = validateUrlSafety('http://localhost:3000/api');
      expect(res.safe).toBe(false);
      expect(res.reason).toBe('LOOPBACK_ADDRESS');
    });

    it('validateUrlSafety: 127.0.0.1 → LOOPBACK_ADDRESS', () => {
      const res = validateUrlSafety('http://127.0.0.1:8080');
      expect(res.safe).toBe(false);
      expect(res.reason).toBe('LOOPBACK_ADDRESS');
    });

    it('validateUrlSafety: 192.168.x.x → PRIVATE_NETWORK', () => {
      const res = validateUrlSafety('http://192.168.1.1/admin');
      expect(res.safe).toBe(false);
      expect(res.reason).toBe('PRIVATE_NETWORK');
    });

    it('validateUrlSafety: ftp:// → FORBIDDEN_SCHEME', () => {
      const res = validateUrlSafety('ftp://files.gouv.fr/data');
      expect(res.safe).toBe(false);
      expect(res.reason).toBe('FORBIDDEN_SCHEME');
    });

    it('createSourceEnvelope: valid data', () => {
      const envelope = createSourceEnvelope({
        sourceId: 'src-1',
        url: 'https://www.service-public.fr/aide',
        organisation: 'Service Public',
        verificationStatus: 'VERIFIED'
      });
      expect(envelope.sourceId).toBe('src-1');
      expect(envelope.domain).toBe('www.service-public.fr');
      expect(envelope.verificationStatus).toBe('VERIFIED');
    });

    it('validateCitations: known IDs pass, unknown rejected', () => {
      const sources = [{ sourceId: 'src1' }, { sourceId: 'src2' }];
      const res = validateCitations(['src1', 'src3'], sources);
      expect(res.valid).toContain('src1');
      expect(res.rejected).toContain('src3');
    });

    it('detectSourceConflicts: no conflict', () => {
      const sources = [
        { sourceId: 's1', conflictState: 'NONE' },
        { sourceId: 's2', conflictState: 'NONE' }
      ];
      expect(detectSourceConflicts(sources).hasConflict).toBe(false);
    });

    it('detectSourceConflicts: conflicted sources', () => {
      const sources = [
        { sourceId: 's1', conflictState: 'SOURCE_CONFLICT', lastVerified: '2026-01-01T00:00:00Z' },
        { sourceId: 's2', conflictState: 'SOURCE_CONFLICT', lastVerified: '2026-06-01T00:00:00Z' }
      ];
      const res = detectSourceConflicts(sources);
      expect(res.hasConflict).toBe(true);
      expect(res.conflictingPairs.length).toBeGreaterThan(0);
    });
  });

  // ─── 6. freshness.js ──────────────────────────
  describe('6. freshness.js tests', () => {
    it('evaluateFreshness: item verified 10 days ago → FRESH', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const item = { lastVerified: tenDaysAgo };
      const res = evaluateFreshness(item);
      expect(res.state).toBe('FRESH');
    });

    it('evaluateFreshness: item verified 100 days ago → STALE (TTL_EXCEEDED)', () => {
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const item = { lastVerified: hundredDaysAgo };
      const res = evaluateFreshness(item);
      expect(res.state).toBe('STALE');
      expect(res.reason).toBe('TTL_EXCEEDED');
    });

    it('evaluateFreshness: item never verified → UNKNOWN', () => {
      const item = {};
      const res = evaluateFreshness(item);
      expect(res.state).toBe('UNKNOWN');
      expect(res.reason).toBe('NEVER_VERIFIED');
    });

    it('evaluateFreshness: content hash changed → STALE (CONTENT_HASH_CHANGED)', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const item = { lastVerified: tenDaysAgo, contentHash: 'new-hash', previousContentHash: 'old-hash' };
      const res = evaluateFreshness(item);
      expect(res.state).toBe('STALE');
      expect(res.reason).toBe('CONTENT_HASH_CHANGED');
    });

    it('evaluateFreshness: category-specific TTL (BENEFIT_RULE=30 days)', () => {
      const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      const item = { sourceType: 'BENEFIT_RULE', lastVerified: thirtyFiveDaysAgo };
      const res = evaluateFreshness(item);
      expect(res.state).toBe('STALE');
      expect(res.ttlDays).toBe(30);
    });

    it('evaluateFreshness: STRUCTURE uses 180-day TTL', () => {
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const item = { sourceType: 'STRUCTURE', lastVerified: hundredDaysAgo };
      const res = evaluateFreshness(item);
      expect(res.state).toBe('FRESH');
      expect(res.ttlDays).toBe(180);
    });

    it('batchEvaluateFreshness returns correct array', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const items = [
        { lastVerified: tenDaysAgo },
        { lastVerified: hundredDaysAgo }
      ];
      const res = batchEvaluateFreshness(items);
      expect(res).toHaveLength(2);
      expect(res[0].freshness.state).toBe('FRESH');
      expect(res[1].freshness.state).toBe('STALE');
    });

    it('getItemsNeedingReview filters out FRESH items', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const items = [
        { id: '1', lastVerified: tenDaysAgo },
        { id: '2', lastVerified: hundredDaysAgo },
        { id: '3' } // UNKNOWN — no lastVerified
      ];
      const res = getItemsNeedingReview(items);
      expect(res).toHaveLength(2);
    });
  });

});
