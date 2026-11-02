/**
 * R34 — the strict service measurement: a keyword buried in a text, or a building of the right type, does not make a need « served ».
 */
import { describe, expect, it } from 'vitest';
import { coverage } from '../../scripts/social-coverage.mjs';

const ref = (sub) => ({ version: 't', domains: [{ id: 'd', letter: 'A', fr: 'D', lexicon: [], subdomains: [{ id: 'x', fr: 'X', keywords: ['curatelle'], structureTypes: ['CCAS'], casf: [], dataInclusion: [], emergency: [], ...sub }] }] });
const place = (extra = {}) => ({ id: 'p', type_structure: 'CCAS', ville: 'Strasbourg', code_postal: '67000', telephone: '03', horaires: 'lundi 9h-12h', services: [], date_verification: new Date().toISOString(), ...extra });
const row = (data, sub) => coverage(ref(sub), { aide: [], demarche: [], guide: [], dispositif: [], actualite: [], structures: [], ...data }, new Set()).rows[0];

describe('service coverage ladder', () => {
  it('a keyword only in the body is content coverage, not an official title', () => {
    const r = row({ guide: [{ slug: 'g', titre: 'Autre sujet', contenu_json: { intro: 'la curatelle…' } }], structures: [place()] });
    expect(r.status).toBe('COVERED_VERIFIED');                 // the broad measure counts it
    expect(r.evidence.verifiedRightsByTitle).toBe(false);
    expect(r.serviceStatus).toBe('NO_VERIFIED_SERVICE');       // the strict one does not
  });
  it('a building of the right type without a declared service is an establishment, not a service', () => {
    const r = row({ guide: [{ slug: 'g', titre: 'La curatelle' }], structures: [place()] });
    expect(r.evidence.verifiedEstablishment).toBe(true);
    expect(r.evidence.verifiedSpecificService).toBe(false);
    expect(r.serviceStatus).toBe('SERVICE_PARTIAL');
  });
  it('a declared service in the Eurométropole with contact and hours is a verified service', () => {
    const r = row({ guide: [{ slug: 'g', titre: 'La curatelle' }], structures: [place({ services: ['Information sur la curatelle'] })] });
    expect(r.evidence.verifiedSpecificService && r.evidence.territorialEligibility && r.evidence.accessModality && r.evidence.currentAvailability).toBe(true);
    expect(r.serviceStatus).toBe('SERVICE_VERIFIED');
  });
  it('the same service outside the Eurométropole, or without hours, is not', () => {
    expect(row({ guide: [{ slug: 'g', titre: 'La curatelle' }], structures: [place({ services: ['curatelle'], ville: 'Sarrewerden', code_postal: '67260' })] }).serviceStatus).toBe('SERVICE_PARTIAL');
    expect(row({ guide: [{ slug: 'g', titre: 'La curatelle' }], structures: [place({ services: ['curatelle'], horaires: null })] }).serviceStatus).toBe('SERVICE_PARTIAL');
  });
  it('a need served remotely by nature counts through its official channel', () => {
    const r = row({ guide: [{ slug: 'g', titre: 'La curatelle' }] }, { emergency: ['3919'] });
    expect(r.serviceStatus).toBe('SERVICE_VERIFIED');
    expect(r.evidence.currentAvailability).toBe(false);        // never claimed for a national channel
  });
});
