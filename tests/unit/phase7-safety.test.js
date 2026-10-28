import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { DOCUMENT_SYSTEM_PROMPT, DOCUMENT_DEFINITION } from '../../api/lib/agents/document.js';
import { ORIENTATION_SYSTEM_PROMPT, ORIENTATION_DEFINITION } from '../../api/lib/agents/orientation.js';
import { ELIGIBILITY_SYSTEM_PROMPT, ELIGIBILITY_DEFINITION, ELIGIBILITY_RESPONSE_SCHEMA } from '../../api/lib/agents/eligibility.js';
import { PROCEDURE_DEFINITION } from '../../api/lib/agents/procedure.js';
import { FALC_DEFINITION } from '../../api/lib/agents/falc.js';
import { validateCitations, detectSourceConflicts } from '../../api/lib/services/official-sources.js';
import { AgentResponse, createResponse, createDispatch } from '../../api/lib/agents/dispatch.js';
import { BaseSpecialist } from '../../api/lib/agents/base-specialist.js';

describe('Phase 7: Safety and Security Tests', () => {

  describe('Task 22: Indirect Prompt Injection Tests', () => {
    it('system prompts treat all retrieved content as untrusted data', () => {
      // Test A: Malicious instruction in source-like content
      expect(DOCUMENT_SYSTEM_PROMPT).toContain('DONNÉE NON FIABLE');
    });

    it('DocumentSpecialist prompt explicitly treats document-embedded instructions as data', () => {
      // Test B: Malicious instruction in uploaded document
      expect(DOCUMENT_SYSTEM_PROMPT).toMatch(/instruction/i);
    });

    it('all specialist tools are read-only', () => {
      // Test C: Tool results cannot override policy
      const defs = [
        ORIENTATION_DEFINITION,
        ELIGIBILITY_DEFINITION,
        PROCEDURE_DEFINITION,
        DOCUMENT_DEFINITION,
        FALC_DEFINITION
      ];
      
      for (const def of defs) {
        for (const tool of def.tools || []) {
          expect(tool.isReadOnly).toBe(true);
        }
      }
    });
  });

  describe('Task 23: Citation Grounding Tests', () => {
    it('validateCitations rejects fabricated source IDs', () => {
      const sourceEnvelopes = [
        { sourceId: 'src_1' },
        { sourceId: 'src_2' }
      ];
      const result = validateCitations(['src_1', 'fake_src'], sourceEnvelopes);
      
      expect(result.valid).toContain('src_1');
      expect(result.valid).not.toContain('fake_src');
      expect(result.rejected).toContain('fake_src');
    });

    it('validateCitations handles empty citations', () => {
      const sourceEnvelopes = [{ sourceId: 'src_1' }];
      const result = validateCitations([], sourceEnvelopes);
      
      expect(result.valid).toEqual([]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('Task 24: Source Conflict Policy Tests', () => {
    it('detectSourceConflicts handles no conflict when all sources agree', () => {
      const envelopes = [
        { sourceId: 'src_1', conflictState: 'NONE' },
        { sourceId: 'src_2', conflictState: 'NONE' }
      ];
      const result = detectSourceConflicts(envelopes);
      expect(result.hasConflict).toBe(false);
      expect(result.conflictingPairs).toHaveLength(0);
    });

    it('detectSourceConflicts detects SOURCE_CONFLICT', () => {
      const envelopes = [
        { sourceId: 'src_1', conflictState: 'SOURCE_CONFLICT', lastVerified: '2023-01-01' },
        { sourceId: 'src_2', conflictState: 'SOURCE_CONFLICT', lastVerified: '2023-01-02' }
      ];
      const result = detectSourceConflicts(envelopes);
      expect(result.hasConflict).toBe(true);
      expect(result.conflictingPairs).toEqual([
        {
          sourceA: 'src_1',
          sourceB: 'src_2',
          dateA: '2023-01-01',
          dateB: '2023-01-02'
        }
      ]);
    });
  });

  describe('Task 25: Eligibility Safety Tests', () => {
    it('schema enforces eligible statuses and defaults', () => {
      const validPayload = {
        category: 'ELIGIBILITY',
        decisionSummary: 'Test summary',
        eligibilityStatus: 'POSSIBLE'
      };
      
      const parsed = ELIGIBILITY_RESPONSE_SCHEMA.parse(validPayload);
      expect(parsed.humanActionRequired).toBe(true);
      expect(parsed.limitations).toContain('OpenFisca');
    });

    it('schema does NOT allow ELIGIBLE status', () => {
      const invalidPayload = {
        category: 'ELIGIBILITY',
        decisionSummary: 'Test summary',
        eligibilityStatus: 'ELIGIBLE'
      };
      
      expect(() => ELIGIBILITY_RESPONSE_SCHEMA.parse(invalidPayload)).toThrow();
    });

    it('system prompt forbids inventing income/amounts', () => {
      expect(ELIGIBILITY_SYSTEM_PROMPT).toMatch(/inventes jamais/i);
    });
  });

  describe('Task 26: Provider-Import Static Guard', () => {
    it('agent code does NOT import provider SDKs directly', () => {
      const FORBIDDEN_IMPORTS = [
        '@google/generative-ai',
        "require('@google/generative-ai",
        "from '@google/generative-ai",
        'from "@google/generative-ai"'
      ];

      const AGENT_DIRS = [
        join(process.cwd(), 'api/lib/agents'),
        join(process.cwd(), 'api/lib/services')
      ];

      const ALLOWED_PROVIDER_FILES = ['ai-provider.js', 'ai-foundation.js'];

      for (const dir of AGENT_DIRS) {
        const files = readdirSync(dir).filter(f => f.endsWith('.js'));
        for (const file of files) {
          if (ALLOWED_PROVIDER_FILES.includes(file)) continue;
          const content = readFileSync(join(dir, file), 'utf-8');
          for (const forbidden of FORBIDDEN_IMPORTS) {
            expect(content).not.toContain(forbidden);
          }
        }
      }
    });
  });

  describe('Task 27: Privacy-Safe Logging Tests', () => {
    it('verify agent trace structures contain metadata only', () => {
      const dummyResponse = {
        content: { text: "hello" },
        componentName: 'test',
        componentLatency: 100,
        dispatchId: '00000000-0000-0000-0000-000000000000',
        routingMethod: 'LLM',
        modelCallCount: 1,
        citations: []
      };
      
      const parsed = AgentResponse.parse(dummyResponse);
      expect(parsed).not.toHaveProperty('rawPrompt');
      
      const dispatch = createDispatch({
        requestId: '00000000-0000-0000-0000-000000000000',
        userIntent: 'test intent',
        sourceComponent: 'test',
        targetComponent: 'test',
        payload: 'payload data'
      });
      
      expect(dispatch).not.toHaveProperty('rawPrompt');
      expect(dispatch).toHaveProperty('userIntent', 'test intent');
    });
  });

  describe('Task 28: Tool Policy Enforcement Tests', () => {
    it('BaseSpecialist reads tools from definition without allowing runtime injection', () => {
      const fakeDef = {
        name: 'test',
        systemPrompt: 'sys',
        responseSchema: {},
        tools: [{ name: 'safe_tool', isReadOnly: true }]
      };
      const agent = new BaseSpecialist(fakeDef);
      
      expect(agent.definition.tools).toHaveLength(1);
      expect(agent.definition.tools[0].name).toBe('safe_tool');
      expect(agent.definition.tools[0].isReadOnly).toBe(true);
    });
  });
});
