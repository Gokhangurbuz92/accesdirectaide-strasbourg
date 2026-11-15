/**
 * The nightly chain's automatic duplicate decision on a shared SIRET (mergeDuplicates): a record is put aside without a person only when the duplicate
 * register's own assessor (duplicate-evidence.assessPair) reads one establishment and finds nothing that tells the two records apart. The real case: one
 * manager's SIRET for two FINESS establishments (an EHPAD and its SSIAD) — the second record was withdrawn from the public site automatically.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { siretDuplicateVerdict } = await import('../../api/_services/verification/chain.js');

const SIRET = '77566789000012';
const rec = (id, over = {}) => ({ id, nom: `Structure ${id}`, type_structure: 'Association', adresse: '3 rue des Tilleuls', code_postal: '67000', siret: null,
  source_url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${SIRET}`, ...over });

describe('siretDuplicateVerdict: same SIRET is not enough when something tells the records apart', () => {
  it('two different FINESS numbers under one SIRET: never automatic', () => {
    const v = siretDuplicateVerdict(rec('a', { nom: 'EHPAD Les Tilleuls', siret: SIRET, numero_finess: '670000001' }), rec('b', { nom: 'SSIAD Les Tilleuls', numero_finess: '670000002' }), SIRET);
    expect(v).toEqual({ auto: false, basis: 'FINESS_DIFFERENT', why: 'deux numéros FINESS différents (670000001 et 670000002)' });
  });
  it('two functions under one SIRET (a point-justice in a mission locale; a dental and a medical centre): never automatic', () => {
    expect(siretDuplicateVerdict(rec('a', { nom: 'Mission locale de Strasbourg', siret: SIRET }), rec('b', { nom: 'Point-justice de la Mission locale' }), SIRET)).toMatchObject({ auto: false, basis: 'FUNCTIONS_DIFFER' });
    expect(siretDuplicateVerdict(rec('a', { nom: 'Centre de soins dentaires', siret: SIRET }), rec('b', { nom: 'Centre médical' }), SIRET)).toMatchObject({ auto: false, basis: 'DENTAL_VS_MEDICAL' });
  });
  it('two different Annuaire entries, or one FINESS establishment and one Annuaire office: never automatic', () => {
    expect(siretDuplicateVerdict(rec('a', { siret: SIRET, source_annuaire: 'office-1' }), rec('b', { source_annuaire: 'office-2' }), SIRET)).toMatchObject({ auto: false, basis: 'ANNUAIRE_DIFFERENT' });
    const finess = rec('a', { siret: SIRET, numero_finess: '670000001', source_url: 'https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFiness=670000001' });
    const office = rec('b', { source_annuaire: 'office-2', source_url: 'https://lannuaire.service-public.gouv.fr/grand-est/bas-rhin/office-2' });
    expect(siretDuplicateVerdict(finess, office, SIRET)).toMatchObject({ auto: false, basis: 'REGISTERS_DIFFERENT' });
  });
  it('the same FINESS number and another Annuaire entry contradict each other: never automatic', () => {
    expect(siretDuplicateVerdict(rec('a', { siret: SIRET, numero_finess: '670000001', source_annuaire: 'office-1' }), rec('b', { numero_finess: '670000001', source_annuaire: 'office-2' }), SIRET)).toMatchObject({ auto: false });
  });
  it('nothing tells them apart: automatic as before, whatever the wording of the second record\'s address (the chain compared it with SIRENE)', () => {
    expect(siretDuplicateVerdict(rec('a', { nom: 'Association Entraide', siret: SIRET }), rec('b', { nom: 'Association Entraide Strasbourg', adresse: '3, r. des Tilleuls', code_postal: '67100' }), SIRET))
      .toEqual({ auto: true, basis: 'SIRET_SAME_ONLY', why: '' });
    expect(siretDuplicateVerdict(rec('a', { siret: SIRET, numero_finess: '670000001' }), rec('b', { numero_finess: '670000001' }), SIRET)).toMatchObject({ auto: true, basis: 'FINESS_SAME' });
    expect(siretDuplicateVerdict(rec('a', { siret: SIRET, numero_finess: '670000001' }), rec('b'), SIRET)).toMatchObject({ auto: true, basis: 'SIRET_SAME_ONLY' });
  });
  it('a record without an address cannot be read as the same place: not automatic', () => {
    expect(siretDuplicateVerdict(rec('a', { siret: SIRET, adresse: '' }), rec('b'), SIRET).auto).toBe(false);
  });
});
