/**
 * D8 — the read-only adapter api/lib/structure-model.js (Organisation / Établissement / Service views of the one Structure table). Pure functions:
 * every value comes from the record, with its basis; nothing is inferred from a name or an address; unknown stays null.
 */
import { describe, expect, it } from 'vitest';
import { contributorKey, establishmentOf, organisationOf, servicesOf, sirenOf } from '../../api/lib/structure-model.js';

describe('D8 structure model adapter (pure)', () => {
  it('SIREN only from a 14-digit SIRET (formatting ignored)', () => {
    expect(sirenOf('246 700 488 00017')).toBe('246700488');
    expect(sirenOf('246700488')).toBeNull();
    expect(sirenOf(null)).toBeNull();
  });

  it('organisation: SIREN first, then the record the duplicate register keeps, then RNA, else the record alone — never a name', () => {
    expect(organisationOf({ id: 'a', siret: '24670048800017' })).toEqual({ key: 'siren:246700488', basis: 'SIREN', siren: '246700488', rna: null });
    expect(organisationOf({ id: 'b', siret: null, keptId: 'k', keptSiret: '24670048800025' }).key).toBe('siren:246700488');
    expect(organisationOf({ id: 'b', siret: '13000548100010', keptId: 'k', keptSiret: null })).toMatchObject({ key: 'id:k', basis: 'DUPLICATE_DECISION' });
    expect(organisationOf({ id: 'c', rna_id: 'w 673 000 123' })).toMatchObject({ key: 'rna:W673000123', basis: 'RNA' });
    expect(organisationOf({ id: 'd', nom: 'Centre médico-social' })).toEqual({ key: 'id:d', basis: 'RECORD', siren: null, rna: null });
  });

  it('observatory contributor: SIREN or the kept record, never RNA (unchanged for records without SIRET)', () => {
    expect(contributorKey({ id: 'x1', siret: '98765432100011' })).toBe(contributorKey({ id: 'x2', siret: '98765432100029' }));
    expect(contributorKey({ id: 'c', rna_id: 'W673000123' })).toBe('id:c');
    expect(contributorKey({ id: 'd1', keptId: 'a1' })).toBe('id:a1');
  });

  it('establishment: identifiers as stored; the FINESS EJ is reported missing; the kind of site is never guessed', () => {
    const e = establishmentOf({ id: 's', nom: 'EHPAD X', adresse: '3 rue des Tilleuls 67000 Strasbourg', code_postal: '67000', ville: 'Strasbourg', siret: '12345678900011', numero_finess: '67 000 1234', type_structure: 'Siège administratif' });
    expect(e.identifiers).toEqual({ siret: '12345678900011', finessEt: '670001234', finessEj: null, annuaire: null });
    expect(e.missing).toEqual(['finessEj']);
    expect(e.siteKind).toBeNull();
    expect(e.kindText).toBe('Siège administratif');
    expect(establishmentOf({ id: 't', nom: '115', adresse: '' }).addressState).toBe('NONE');
  });

  it('services: each with its origin (register activity, data·inclusion producer, ADA Pro bookable), nothing merged or added', () => {
    const r = { id: 's', numero_finess: '670001234', services: ['Hébergement complet'], services_externes: { services: [{ name: 'Aide administrative', producerLabel: 'Producteur X' }] } };
    const out = servicesOf(r, [{ id: 'svc1', name: 'Accueil', isActive: true, modes: ['IN_PERSON'] }, { id: 'svc2', name: 'Ancien', isActive: false }]);
    expect(out.map((s) => [s.origin, s.label, s.bookable])).toEqual([['FINESS_ACTIVITY', 'Hébergement complet', false], ['DATA_INCLUSION', 'Aide administrative', false], ['ADA_PRO', 'Accueil', true]]);
    expect(out[1].producer).toBe('Producteur X');
    expect(servicesOf({ id: 'e', services: [] })).toEqual([]);
  });
});
