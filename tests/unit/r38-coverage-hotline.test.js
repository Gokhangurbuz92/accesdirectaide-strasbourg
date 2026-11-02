/**
 * R38 — a national hotline is a verified service when a PUBLISHED official Service-Public sheet states its number for this need (OFFICIAL_SHEET_HOTLINE),
 * separately counted; nothing else changes: no number, a number far from the subject, a short number alone, a sheet without official provenance, or a
 * subdomain that is not a national hotline give nothing.
 */
import { describe, expect, it } from 'vitest';
import { coverage } from '../../scripts/social-coverage.mjs';

const SUB = { id: 'crise-suicide', fr: 'Crise', keywords: ['suicide', '3114', 'détresse'], structureTypes: [], casf: [], dataInclusion: [], emergency: ['3114', '15'] };
const ref = (sub = {}) => ({ version: 't', domains: [{ id: 'd', letter: 'A', fr: 'D', lexicon: [], subdomains: [{ ...SUB, ...sub }] }] });
const HOTLINE = { 'crise-suicide': { types: ['national-hotline'], national: true, channel: '3114' } };
const sheet = (text, extra = {}) => ({ slug: 'numeros-f33954', titre: 'Quels sont les numéros en cas d’urgence et les numéros d’écoute ?', sources_urls: ['https://www.service-public.gouv.fr/particuliers/vosdroits/F33954'],
  contenu_json: { provenance: { sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F33954' }, steps: [{ texte: text }] }, ...extra });
const row = (guides, { sub, responses = HOTLINE } = {}) => coverage(ref(sub), { aide: [], demarche: [], guide: guides, dispositif: [], actualite: [], structures: [] }, new Set(), new Map(), responses).rows[0];

describe('R38 OFFICIAL_SHEET_HOTLINE', () => {
  it('« Prévention du suicide : 31 14 » in a published official sheet → SERVICE_VERIFIED, typed', () => {
    const r = row([sheet('Prévention du suicide : 31 14. Ce numéro est gratuit, 24 h/24.')]);
    expect(r.evidence.verifiedRightsByTitle).toBe(false);
    expect(r.evidence.officialHotlineInSheet).toBe(true);
    expect(r.serviceStatus).toBe('SERVICE_VERIFIED'); expect(r.serviceEvidence).toBe('OFFICIAL_SHEET_HOTLINE');
    expect(r.hotlineSheets).toEqual(['guide:numeros-f33954']);
  });
  it('the number far from the subject, or the subject without the number → nothing', () => {
    expect(row([sheet(`Suicide : informations générales. ${'x '.repeat(400)} Appelez le 3114.`)]).serviceStatus).toBe('NO_VERIFIED_SERVICE');
    expect(row([sheet('Prévention du suicide : parlez-en à votre médecin.')]).serviceStatus).toBe('NO_VERIFIED_SERVICE');
  });
  it('a short number alone (« 15 ») never counts', () => {
    expect(row([sheet('En cas de détresse vitale appelez le 15.')], { sub: { emergency: ['15'] } }).serviceStatus).toBe('NO_VERIFIED_SERVICE');
  });
  it('a sheet without Service-Public provenance does not count', () => {
    expect(row([sheet('Prévention du suicide : 31 14', { sources_urls: ['https://exemple.org/x'], contenu_json: { steps: [{ texte: 'Prévention du suicide : 31 14' }] } })]).serviceStatus).toBe('NO_VERIFIED_SERVICE');
  });
  it('a subdomain that is not a national hotline is not affected', () => {
    expect(row([sheet('Prévention du suicide : 31 14')], { responses: {} }).serviceStatus).toBe('NO_VERIFIED_SERVICE');
  });
});
