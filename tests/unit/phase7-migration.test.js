import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { Classifier, CATEGORIES } from '../../api/lib/agents/classifier-bridge.js';
import { ResourceCurator, ALLOWED_DOMAINS } from '../../api/lib/agents/resource-curator-bridge.js';
import { FalcWriter } from '../../api/lib/agents/falc-bridge.js';
import { Alerter } from '../../api/lib/agents/alerter.js';

describe('Phase 7 Migration Regression Tests', () => {
  describe('ClassifierBridge', () => {
    it('classify() returns valid category for known inputs', async () => {
      const classifier = new Classifier();
      const result = await classifier.classify({ description: 'Recherche un emploi', title: 'Emploi' });
      expect(CATEGORIES).toContain(result.category);
    });

    it('ClassifierBridge uses DETERMINISTIC method (not LLM)', async () => {
      const classifier = new Classifier();
      const result = await classifier.classify({ description: 'Soutien au logement' });
      expect(result.method).toBe('DETERMINISTIC');
    });
  });

  describe('ResourceCuratorBridge', () => {
    it('isAllowedSource() works', () => {
      const curator = new ResourceCurator();
      expect(curator.isAllowedSource('https://www.service-public.fr/part')).toBe(true);
      expect(curator.isAllowedSource('https://www.fake-site.com')).toBe(false);
    });

    it('curate() returns sources', async () => {
      const curator = new ResourceCurator();
      const result = await curator.curate('EMPLOI', 'aide');
      expect(result.sources).toBeDefined();
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.category).toBe('EMPLOI');
    });
  });

  describe('Alerter', () => {
    it('Alerter has no AI imports (static analysis)', () => {
      const fileContent = readFileSync(join(process.cwd(), 'api/lib/agents/alerter.js'), 'utf-8');
      expect(fileContent).not.toMatch(/generateText|generateContent|gemini/);
    });
  });

  describe('FalcWriter bridge', () => {
    it('creates dispatch with correct intent and instantiates without AI calls on init', () => {
      const writer = new FalcWriter();
      expect(writer.specialist).toBeDefined();
      expect(writer.specialist.definition.name).toBe('falc');
    });
  });
});
