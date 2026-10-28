import { describe, it, expect } from 'vitest';
import { createExtendedSourceEnvelope, validateEnvelopeForGrounding, isEnvelopeFresh } from '../../api/lib/services/source-envelope.js';

describe('Phase 8 Source Envelope', () => {
  it('creates complete Phase 8 envelope and preserves Phase 7 fields', () => {
    const envelope = createExtendedSourceEnvelope({
      url: 'https://service-public.fr/particuliers/vosdroits/F123',
      title: 'RSA',
      section: 'Conditions',
      sourceId: 'src-123',
      documentId: 'doc-123',
      territory: 'FR',
      authority: 'CAF',
      capabilities: ['BENEFIT_RULE'],
      effectiveDate: '2023-01-01',
      sourceUpdatedAt: '2023-02-01',
      retrievedAt: new Date('2023-03-01T12:00:00Z'),
      freshnessState: 'FRESH',
      contentHash: 'hash123',
      version: 'v1'
    });

    // legacy
    expect(envelope.url).toBe('https://service-public.fr/particuliers/vosdroits/F123');
    expect(envelope.title).toBe('RSA');
    expect(envelope.section).toBe('Conditions');
    expect(envelope.domain).toBe('service-public.fr'); // from legacy extractor
    expect(envelope.conflictState).toBe('NONE'); // default from legacy
    expect(envelope.verificationStatus).toBe('UNVERIFIED'); // default from legacy

    // new phase 8
    expect(envelope.sourceId).toBe('src-123');
    expect(envelope.documentId).toBe('doc-123');
    expect(envelope.territory).toBe('FR');
    expect(envelope.authority).toBe('CAF');
    expect(envelope.capabilities).toEqual(['BENEFIT_RULE']);
    expect(envelope.effectiveDate).toBe('2023-01-01');
    expect(envelope.sourceUpdatedAt).toBe('2023-02-01');
    expect(envelope.retrievedAt).toBe('2023-03-01T12:00:00.000Z');
    expect(envelope.freshnessState).toBe('FRESH');
    expect(envelope.contentHash).toBe('hash123');
    expect(envelope.version).toBe('v1');
    expect(envelope.language).toBe('fr');
  });

  describe('validateEnvelopeForGrounding', () => {
    it('returns valid for complete envelope', () => {
      const result = validateEnvelopeForGrounding({
        url: 'http://gouv.fr',
        sourceId: 'src',
        authority: 'auth',
        retrievedAt: '2023-01-01'
      });
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('returns invalid without url', () => {
      const result = validateEnvelopeForGrounding({
        sourceId: 'src',
        authority: 'auth',
        retrievedAt: '2023-01-01'
      });
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing source URL');
    });

    it('returns invalid without sourceId', () => {
      const result = validateEnvelopeForGrounding({
        url: 'http://gouv.fr',
        authority: 'auth',
        retrievedAt: '2023-01-01'
      });
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing sourceId');
    });
  });

  describe('isEnvelopeFresh', () => {
    it('returns true for FRESH and AGING', () => {
      expect(isEnvelopeFresh({ freshnessState: 'FRESH' })).toBe(true);
      expect(isEnvelopeFresh({ freshnessState: 'AGING' })).toBe(true);
    });

    it('returns false for STALE, EXPIRED, BROKEN, UNKNOWN', () => {
      expect(isEnvelopeFresh({ freshnessState: 'STALE' })).toBe(false);
      expect(isEnvelopeFresh({ freshnessState: 'EXPIRED' })).toBe(false);
      expect(isEnvelopeFresh({ freshnessState: 'BROKEN' })).toBe(false);
      expect(isEnvelopeFresh({ freshnessState: 'UNKNOWN' })).toBe(false);
    });
  });
});
