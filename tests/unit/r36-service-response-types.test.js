/**
 * R36 — the kind of answer each need calls for (data/reference/service-response-types.v1.json) in the strict service measurement: a need served by an
 * official national channel is not a missing local establishment; where the place IS the public service (a mairie, a CCAS) its official directory record
 * counts, a building of another source does not; the official title is still required.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { coverage } from '../../scripts/social-coverage.mjs';
import { OFFICIAL_GUIDES } from '../../scripts/official-guides.mjs';

const RT = JSON.parse(fs.readFileSync('data/reference/service-response-types.v1.json', 'utf8'));
const REF = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
const ref = (id, sub = {}) => ({ version: 't', domains: [{ id: 'd', letter: 'A', fr: 'D', lexicon: [], subdomains: [{ id, fr: 'X', keywords: ['mairie'], structureTypes: ['Mairie'], casf: [], dataInclusion: [], emergency: [], ...sub }] }] });
const place = (extra = {}) => ({ id: 'p', type_structure: 'Mairie', ville: 'Strasbourg', code_postal: '67000', telephone: '03', services: [], date_verification: new Date().toISOString(), ...extra });
const row = (id, data, responses, sub) => coverage(ref(id, sub), { aide: [], demarche: [], guide: [], dispositif: [], actualite: [], structures: [], ...data }, new Set(), new Map(), responses).rows[0];
const ANNUAIRE = 'https://lannuaire.service-public.gouv.fr/grand-est/bas-rhin/x';

describe('service response types', () => {
  it('covers exactly the 23 subdomains without a verified service in R35, each with known types; every cited sheet is curated', () => {
    const ids = REF.domains.flatMap((d) => d.subdomains.map((s) => s.id));
    expect(Object.keys(RT.subdomains)).toHaveLength(24);   // R40: + acces-au-droit (Point-justice records of the Annuaire)
    for (const [id, x] of Object.entries(RT.subdomains)) {
      expect(ids).toContain(id);
      expect(x.types.length).toBeGreaterThan(0);
      for (const t of x.types) expect(Object.keys(RT.types)).toContain(t);
      for (const f of x.officialSheets || []) expect([id, f, OFFICIAL_GUIDES.some((g) => g.id === f)]).toEqual([id, f, true]);
    }
  });
  it('a mairie of the Annuaire is the public service only where the need says so (placeIsService); the official title is still required', () => {
    const titled = { guide: [{ slug: 'g', titre: 'La mairie' }] };
    expect(row('x', { ...titled, structures: [place({ source_url: ANNUAIRE })] }, {}).serviceStatus).toBe('SERVICE_PARTIAL');
    expect(row('x', { ...titled, structures: [place({ source_url: ANNUAIRE })] }, { x: { types: ['public-authority'], placeIsService: true } }).serviceStatus).toBe('SERVICE_VERIFIED');
    // the same building from another source, or no contact, or no official title: not verified
    expect(row('x', { ...titled, structures: [place({ source_url: 'https://example.org' })] }, { x: { types: ['public-authority'], placeIsService: true } }).serviceStatus).toBe('SERVICE_PARTIAL');
    expect(row('x', { ...titled, structures: [place({ source_url: ANNUAIRE, telephone: null })] }, { x: { types: ['public-authority'], placeIsService: true } }).serviceStatus).toBe('SERVICE_PARTIAL');
    expect(row('x', { structures: [place({ source_url: ANNUAIRE })] }, { x: { types: ['public-authority'], placeIsService: true } }).serviceStatus).toBe('SERVICE_PARTIAL');
  });
  it('a national procedure is reachable through its official channel, not through a local place; without an official title it stays partial or empty', () => {
    const r = row('y', { guide: [{ slug: 'g', titre: 'Déclaration à la mairie' }] }, { y: { types: ['administrative-procedure'], national: true } }, { structureTypes: [] });
    expect(r.remoteByNature).toBe(true);
    expect(r.serviceStatus).toBe('SERVICE_VERIFIED');
    expect(row('y', {}, { y: { types: ['administrative-procedure'], national: true } }, { structureTypes: [] }).serviceStatus).toBe('NO_VERIFIED_SERVICE');
    expect(row('y', { guide: [{ slug: 'g', titre: 'Déclaration à la mairie' }] }, {}, { structureTypes: [] }).serviceStatus).toBe('SERVICE_PARTIAL');
  });
});
