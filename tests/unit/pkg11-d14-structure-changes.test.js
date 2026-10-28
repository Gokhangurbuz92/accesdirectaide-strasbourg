/**
 * PKG-11 / D14 — spec 002 change classification of directory records (pure): identity is never the content, formatting is not a change, a fact change names
 * its fields, and only a complete fetch may remove anything.
 */
import { describe, expect, it } from 'vitest';
import { classifyStructureChange, factValues, identityKey, isCompleteFetch, normalizedFacts } from '../../api/lib/ingestion/structureChanges.js';

const incoming = { nom: 'Espace Numérique', adresse: '1 rue de la Paix', code_postal: '67000', ville: 'Strasbourg', telephone: '03 88 12 34 56', email: 'Contact@Example.test', site_web: 'https://www.example.test/' };
const row = { ...factValues(incoming), source_document_id: 'doc-1' };

describe('PKG-11 / D14 structure change classification', () => {
  it('identity: SIRET when given, else name + postal code — never the phone, mail or address', () => {
    expect(identityKey('ds', { ...incoming, siret: '123 456 789 00012' })).toBe('ds|siret|12345678900012');
    expect(identityKey('ds', incoming)).toBe('ds|name|espace numerique|67000');
    expect(identityKey('ds', { ...incoming, telephone: 'x', adresse: 'y' })).toBe(identityKey('ds', incoming));
  });
  it('NEW / UNCHANGED / METADATA_ONLY_CHANGED / NORMALIZED_FACT_CHANGED', () => {
    expect(classifyStructureChange(null, incoming, 'doc-1')).toEqual({ state: 'NEW', changed: [] });
    expect(classifyStructureChange(row, incoming, 'doc-1')).toEqual({ state: 'UNCHANGED', changed: [] });
    expect(classifyStructureChange(row, { ...incoming, telephone: '+33 3 88 12 34 56', site_web: 'http://example.test' }, 'doc-2')).toEqual({ state: 'METADATA_ONLY_CHANGED', changed: [] });
    expect(classifyStructureChange(row, { ...incoming, telephone: '03 88 99 99 99', email: 'new@example.test' }, 'doc-3')).toEqual({ state: 'NORMALIZED_FACT_CHANGED', changed: ['telephone', 'email'] });
  });
  it('facts are compared on the stored full address, without accents, case or punctuation', () => {
    expect(normalizedFacts(row, { fromRow: true }).adresse).toBe(normalizedFacts(incoming).adresse);
    expect(normalizedFacts({ ...incoming, nom: 'ESPACE  numerique' }).nom).toBe(normalizedFacts(incoming).nom);
  });
  it('only a complete fetch (records received, all announced, no limit) may remove records', () => {
    expect(isCompleteFetch({ received: 250, announced: 250, limited: false })).toBe(true);
    expect(isCompleteFetch({ received: 100, announced: 250, limited: false })).toBe(false);
    expect(isCompleteFetch({ received: 0, announced: 0, limited: false })).toBe(false);
    expect(isCompleteFetch({ received: 5, announced: 250, limited: true })).toBe(false);
  });
});
