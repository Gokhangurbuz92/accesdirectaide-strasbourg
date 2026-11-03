/**
 * R41-IJ — coverage mappings measured on the published catalogue of 03/11/2026 (CONTROL/r41/R41_COVERAGE_REPORT.md, proposals P1 P2 P3 P4 P8 P9 P10).
 * Each change counts records that were already published and verified; P9 removes a false match. Synthetic records only.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { coverage } from '../../scripts/social-coverage.mjs';
import { SCOPE } from '../../api/_services/verification/finess-scope.js';

const REF = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
const RT = JSON.parse(fs.readFileSync('data/reference/service-response-types.v1.json', 'utf8')).subdomains;
const sub = (id) => REF.domains.flatMap((d) => d.subdomains).find((s) => s.id === id);
const one = (id) => ({ version: 't', domains: [{ id: 'x', letter: 'X', fr: 'X', lexicon: [], subdomains: [sub(id)] }] });
const empty = { aide: [], demarche: [], guide: [], dispositif: [], actualite: [], structures: [] };
const FINESS = 'https://finess.esante.gouv.fr/x';
const place = (type, extra = {}) => ({ id: `p-${type}`, slug: 'p', type_structure: type, ville: 'Strasbourg', code_postal: '67000', telephone: '03 00 00 00 00', services: [], source_url: FINESS, date_verification: new Date().toISOString(), ...extra });
const row = (id, data) => coverage(one(id), { ...empty, ...data }, new Set(), new Map(), RT).rows[0];

describe('R41 coverage mappings', () => {
  it('P1: a published sheet titled « Allocation de soutien familial » or naming « prestations familiales » is a title of prestations-familiales', () => {
    expect(row('prestations-familiales', { guide: [{ slug: 'g', titre: 'Allocation de soutien familial (ASF) : parents séparés' }] }).serviceStatus).toBe('SERVICE_VERIFIED');
    expect(row('prestations-familiales', { guide: [{ slug: 'g', titre: 'Faut-il signaler un changement quand on perçoit des prestations familiales ?' }] }).serviceStatus).toBe('SERVICE_VERIFIED');
  });

  it('P2: « Traitement de la toxicomanie » names the addictions need; with an official local service it is verified', () => {
    const csapa = place(SCOPE[197][0], { services: ['Soins en addictologie'] });
    expect(row('addictions', { guide: [{ slug: 'g', titre: 'Traitement de la toxicomanie' }], structures: [csapa] }).serviceStatus).toBe('SERVICE_VERIFIED');
  });

  it('P3 / P4: a FINESS CMP or sexual-health centre IS the public service (placeIsService); a building of another source is not; the title is still required', () => {
    for (const [id, type, titre] of [['psy', SCOPE[156][0], 'Consultation d’un psychologue'], ['sante-sexuelle', SCOPE[228][0], 'Contraception']]) {
      expect(RT[id], id).toMatchObject({ placeIsService: true, national: false });
      expect(row(id, { guide: [{ slug: 'g', titre }], structures: [place(type)] }).serviceStatus, id).toBe('SERVICE_VERIFIED');
      expect(row(id, { guide: [{ slug: 'g', titre }], structures: [place(type, { source_url: 'https://example.org/x' })] }).serviceStatus, id).not.toBe('SERVICE_VERIFIED');
      expect(row(id, { structures: [place(type)] }).serviceStatus, id).not.toBe('SERVICE_VERIFIED');
    }
  });

  it('P8: CAMSP, ITEP, SAMSAH, CAARUD and BAPU records are places of their subdomain (exact FINESS labels, no invented type)', () => {
    for (const [id, code] of [['enfants-handicap', 190], ['enfants-handicap', 186], ['vie-sociale', 445], ['addictions', 178], ['psy', 221]]) {
      expect(sub(id).structureTypes, `${id} ${code}`).toContain(SCOPE[code][0]);
      expect(row(id, { structures: [place(SCOPE[code][0])] }).places, `${id} ${code}`).toBe(1);
    }
  });

  it('P9: « Pass Culture » and « LOCA-PASS » are not a PASS (permanence d’accès aux soins de santé); the official name still matches', () => {
    expect(sub('pass').keywords).not.toContain('PASS');
    const culture = { demarche: [{ slug: 'd', titre: 'Pass Culture jeunes' }] };
    expect(row('pass', culture).titledSlugs).toEqual([]);
    const loca = { structures: [place('Organisme', { source_url: 'https://lannuaire.service-public.gouv.fr/x', services_externes: { services: [{ nom: "L'AVANCE LOCA-PASS®", themes: ['Louer un logement'] }] } })] };
    expect(row('pass', loca).services).toBe(0);
    expect(row('pass', { guide: [{ slug: 'g', titre: 'Les permanences d’accès aux soins de santé (PASS)' }] }).titledSlugs).toEqual(['guide:g']);
  });

  it('P10: 115 stated next to the need in a published Service-Public sheet makes the emergency-shelter need reachable (national hotline)', () => {
    expect(RT['hebergement-urgence']).toMatchObject({ types: ['national-hotline', 'physical-service'], national: true, channel: '115' });
    const sheet = { slug: 'g', titre: 'Quelles solutions d’hébergement existent ?', sources_urls: ['https://www.service-public.gouv.fr/particuliers/vosdroits/F2003'], contenu: 'Pour un hébergement d’urgence, appelez le 115 (numéro gratuit).' };
    const r = row('hebergement-urgence', { guide: [sheet] });
    expect(r.serviceStatus).toBe('SERVICE_VERIFIED');
    expect(r.serviceEvidence).toBe('OFFICIAL_SHEET_HOTLINE');
    expect(row('hebergement-urgence', { guide: [{ ...sheet, contenu: 'Pour un hébergement d’urgence, adressez-vous au service compétent.' }] }).serviceStatus).not.toBe('SERVICE_VERIFIED');
  });
});
