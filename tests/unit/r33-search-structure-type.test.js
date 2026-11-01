/**
 * R33 — a query naming a kind of office asks for that kind (exact catalogue type), not for any place that mentions it.
 */
import { describe, expect, it } from 'vitest';
import { structureTypeHint } from '../../api/lib/search-structure-type.js';

describe('structureTypeHint', () => {
  it('maps office names and acronyms to the exact catalogue type and keeps the remaining words', () => {
    expect(structureTypeHint('accueil CCAS')).toEqual({ type: "CCAS (centre communal d'action sociale)", rest: '' });
    expect(structureTypeHint('CCAS Schiltigheim')).toEqual({ type: "CCAS (centre communal d'action sociale)", rest: 'schiltigheim' });
    expect(structureTypeHint('France Services Strasbourg')?.type).toBe('Espace France Services');
    expect(structureTypeHint('maison des solidarités')?.type).toBe('Maison des solidarités (Espace Solidarités)');
    expect(structureTypeHint('Centre communal d’action sociale')?.type).toBe("CCAS (centre communal d'action sociale)");
    expect(structureTypeHint('mission locale jeune')).toEqual({ type: 'Mission locale (jeunes de 16 à 25 ans)', rest: 'jeune' });
  });
  it('does not fire on a word that merely contains an acronym, nor on a need without an office name', () => {
    expect(structureTypeHint('accadémie')).toBeNull();
    expect(structureTypeHint('cadastre')).toBeNull();
    expect(structureTypeHint('aide au logement')).toBeNull();
    expect(structureTypeHint('curatelle tutelle')).toBeNull();
  });
});
