import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';
import {
  generateWebPageSchema,
  generateArticleSchema,
  generateOrganizationSchema,
  generateGovernmentServiceSchema,
  generateHowToSchema,
  generateFAQSchema,
  generateItemListSchema
} from '../../src/lib/jsonld.js';

describe('JSON-LD Schema Utilities', () => {
  describe('generateWebPageSchema', () => {
    it('should generate valid WebPage schema', () => {
      const schema = generateWebPageSchema({
        title: 'Test Page',
        description: 'Test description',
        path: '/test',
        datePublished: '2026-01-01',
      });

      expect(schema['@type']).toBe('WebPage');
      expect(schema.name).toBe('Test Page');
      expect(schema.description).toBe('Test description');
      expect(schema.url).toBe('https://www.accesdirectaide.fr/test');
      expect(schema.datePublished).toBe('2026-01-01');
    });
  });

  describe('generateArticleSchema', () => {
    it('should generate valid Article schema', () => {
      const actualite = {
        titre: 'Test Article',
        summary_falc: 'Test summary',
        date_publication: '2026-01-01',
        source_nom: 'Test Source',
        slug: 'test-article',
      };

      const schema = generateArticleSchema(actualite);

      expect(schema['@type']).toBe('Article');
      expect(schema.headline).toBe('Test Article');
      expect(schema.description).toBe('Test summary');
      expect(schema.datePublished).toBe('2026-01-01');
      expect(schema.author.name).toBe('Test Source');
    });
  });

  describe('generateOrganizationSchema', () => {
    it('should generate valid Organization schema', () => {
      const structure = {
        nom: 'Test Organization',
        description: 'Test description',
        type: 'association',
        adresse: '123 Test St',
        ville: 'Paris',
        code_postal: '75001',
        telephone: '0123456789',
        email: 'test@example.com',
        slug: 'test-org',
      };

      const schema = generateOrganizationSchema(structure);

      expect(schema['@type']).toBe('Organization');
      expect(schema.name).toBe('Test Organization');
      expect(schema.address.streetAddress).toBe('123 Test St');
      expect(schema.address.addressLocality).toBe('Paris');
      expect(schema.telephone).toBe('0123456789');
    });

    it('should use GovernmentOrganization for non-association types', () => {
      const structure = {
        nom: 'Test Gov Org',
        type: 'service_public',
      };

      const schema = generateOrganizationSchema(structure);

      expect(schema['@type']).toBe('GovernmentOrganization');
    });
  });

  describe('generateGovernmentServiceSchema', () => {
    it('should generate valid GovernmentService schema', () => {
      const aide = {
        titre: 'Test Aide',
        summary_falc: 'Test summary',
        theme: 'Logement',
        organisme: 'CAF',
        territoire: 'France',
        public_cible: 'Familles',
        slug: 'test-aide',
      };

      const schema = generateGovernmentServiceSchema(aide);

      expect(schema['@type']).toBe('GovernmentService');
      expect(schema.name).toBe('Test Aide');
      expect(schema.serviceType).toBe('Logement');
      expect(schema.provider.name).toBe('CAF');
    });
  });

  describe('generateHowToSchema', () => {
    it('should generate valid HowTo schema', () => {
      const demarche = {
        titre: 'Test Demarche',
        summary_falc: 'Test summary',
        slug: 'test-demarche',
        etapes: [
          { titre: 'Step 1', description: 'Do this' },
          { titre: 'Step 2', description: 'Do that' },
        ],
      };

      const schema = generateHowToSchema(demarche);

      expect(schema['@type']).toBe('HowTo');
      expect(schema.name).toBe('Test Demarche');
      expect(schema.step).toHaveLength(2);
      expect(schema.step[0].name).toBe('Step 1');
      expect(schema.step[0].position).toBe(1);
    });

    it('should work without steps', () => {
      const demarche = {
        titre: 'Test Demarche',
        description: 'Test description',
      };

      const schema = generateHowToSchema(demarche);

      expect(schema['@type']).toBe('HowTo');
      expect(schema.step).toBeUndefined();
    });
  });

  describe('generateFAQSchema', () => {
    it('should generate valid FAQPage schema', () => {
      const faqs = [
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
      ];

      const schema = generateFAQSchema(faqs);

      expect(schema['@type']).toBe('FAQPage');
      expect(schema.mainEntity).toHaveLength(2);
      expect(schema.mainEntity[0]['@type']).toBe('Question');
      expect(schema.mainEntity[0].name).toBe('Q1?');
      expect(schema.mainEntity[0].acceptedAnswer.text).toBe('A1');
    });
  });

  describe('generateItemListSchema', () => {
    it('should generate valid ItemList schema', () => {
      const items = [
        { titre: 'Item 1', slug: 'item-1' },
        { titre: 'Item 2', slug: 'item-2' },
      ];

      const schema = generateItemListSchema({
        name: 'Test List',
        description: 'Test description',
        items,
        path: '/test',
      });

      expect(schema['@type']).toBe('ItemList');
      expect(schema.name).toBe('Test List');
      expect(schema.numberOfItems).toBe(2);
      expect(schema.itemListElement).toHaveLength(2);
      expect(schema.itemListElement[0].name).toBe('Item 1');
    });

    it('should limit to 10 items', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        titre: `Item ${i + 1}`,
        slug: `item-${i + 1}`,
      }));

      const schema = generateItemListSchema({
        name: 'Test List',
        description: 'Test description',
        items,
        path: '/test',
      });

      expect(schema.numberOfItems).toBe(20);
      expect(schema.itemListElement).toHaveLength(10);
    });
  });
});
