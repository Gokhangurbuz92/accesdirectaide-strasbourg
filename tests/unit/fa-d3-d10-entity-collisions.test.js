/**
 * FA D3 / D10 (18/11/2026) — known entity collisions, replayed on the decision logic (pure functions, no network, no database):
 *  - the three automatic SIRET decisions of Production (CONTROL/catalogue/SIRET_AUTO_MERGE_REVIEW.json), with the identifiers the official registers give
 *    (recherche-entreprises SIRENE and FINESS+ daily file of 17/11/2026, data·inclusion export of 09/11/2026, read 18/11/2026);
 *  - an owner change at one site (an association closed in SIRENE, a new legal unit at the same address);
 *  - one address shared by several operators (a health centre and liberal practitioners);
 *  - premises with several services (two public functions under one SIRET);
 *  - several FINESS establishments (ET) under one SIRET, and a FINESS establishment next to a record without a FINESS number.
 * Only organisations' public identifiers; the liberal practitioners of the shared address are synthetic.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { siretDuplicateVerdict } = await import('../../api/_services/verification/chain.js');
const { assessPair } = await import('../../api/_services/duplicate-evidence.js');
const { establishmentOf, organisationOf } = await import('../../api/lib/structure-model.js');

const ENV = {};
const sirenePage = (siret) => `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}`;
const finessPage = (n) => `https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFinesset=${n}`;

describe('D3 — the three automatic SIRET decisions of Production, replayed on today\'s rule', () => {
  // Emmaüs Connect, SIRET 79227291600059 (SIREN 792272916, the only open establishment of that SIREN in the Bas-Rhin, 33 rue Kageneck, opened 2021-04-01):
  // three data·inclusion records of the same place (mediation-numerique 9259 and 2080, dora d36472f6…), none a FINESS or Annuaire record
  const EC = '79227291600059';
  const ec = (id, nom, over = {}) => ({ id, nom, adresse: '33 Rue Kageneck', code_postal: '67000', ville: 'Strasbourg', source_url: sirenePage(EC), ...over });
  it('cases 1 and 2 (Emmaüs Connect): one establishment in SIRENE and nothing tells the records apart — the automatic decision still applies', () => {
    expect(siretDuplicateVerdict(ec('a', 'Emmaus Connect', { siret: EC }), ec('b', 'Emmaus Connect - Strasbourg'), EC, { env: ENV })).toEqual({ auto: true, basis: 'SIRET_SAME_ONLY', why: '' });
    expect(siretDuplicateVerdict(ec('a', 'Emmaus Connect', { siret: EC }), ec('c', 'EMMAUS CONNECT FONDATEUR ABBE PIERRE'), EC, { env: ENV })).toEqual({ auto: true, basis: 'SIRET_SAME_ONLY', why: '' });
  });

  // Maison Urbaine de Santé du Neuhof: SIRET 79088427400016, FINESS ET 670016864 (category 603 « Maison de santé (L.6223-3) »), FINESS EJ 670016856,
  // 2 A rue de Brantôme 67100. The other record (« Maison de santé du Neuhof ») carries no FINESS number.
  const MUS = '79088427400016';
  const mus = (id, nom, over = {}) => ({ id, nom, adresse: '2 A rue de Brantôme', code_postal: '67100', ville: 'Strasbourg', ...over });
  it('case 3 (Neuhof): a FINESS establishment and a record without a FINESS number — no longer decided without a person', () => {
    const a = mus('a', 'Maison Urbaine de Sante du Neuhof', { siret: MUS, numero_finess: '670016864', source_url: finessPage('670016864') });
    const b = mus('b', 'Maison de santé du Neuhof', { source_url: sirenePage(MUS) });
    expect(siretDuplicateVerdict(a, b, MUS, { env: ENV })).toEqual({ auto: false, basis: 'FINESS_ONE_SIDED', why: 'une seule des deux fiches est un établissement FINESS (n° 670016864)' });
    expect(siretDuplicateVerdict(b, a, MUS, { env: ENV })).toMatchObject({ auto: false, basis: 'FINESS_ONE_SIDED' });
    // a person still gets the assessor's reading (same SIRET at one address) in the duplicate register
    expect(assessPair({ ...a }, { ...b, siret: MUS }, { env: ENV })).toMatchObject({ suggestion: 'SAME_ENTITY', basis: 'SIRET_SAME' });
  });
});

describe('D10 — historical collisions never destroy distinct establishments', () => {
  it('several FINESS establishments under one SIRET (an EHPAD and its SSIAD): two establishments, never automatic, never suggested as one', () => {
    const S = '77566789000012';
    const ehpad = { id: 'e', nom: 'EHPAD Les Tilleuls', adresse: '3 rue des Tilleuls', code_postal: '67000', siret: S, numero_finess: '670000001', source_url: finessPage('670000001') };
    const ssiad = { id: 's', nom: 'SSIAD Les Tilleuls', adresse: '3 rue des Tilleuls', code_postal: '67000', numero_finess: '670000002', source_url: finessPage('670000002') };
    expect(siretDuplicateVerdict(ehpad, ssiad, S, { env: ENV })).toMatchObject({ auto: false, basis: 'FINESS_DIFFERENT' });
    expect(assessPair(ehpad, { ...ssiad, siret: S }, { env: ENV })).toMatchObject({ suggestion: 'DISTINCT', basis: 'FINESS_DIFFERENT' });
    // the model keeps them as two establishments of one organisation
    expect(organisationOf({ id: 'e', siret: S }).key).toBe(organisationOf({ id: 's', siret: S }).key);
    expect(establishmentOf(ehpad).identifiers.finessEt).not.toBe(establishmentOf(ssiad).identifiers.finessEt);
  });

  it('owner change at one site: the closed association and the new legal unit are two SIRET, two legal entities — never one', () => {
    // 2 A rue de Brantôme: « MAISON DE SANTE DE NEUHOF » (SIREN 522718220, establishment closed 2012-01-01) then SIREN 790884274 (2012-06-12)
    const old = { id: 'o', nom: 'Maison de santé de Neuhof', adresse: '2 A rue de Brantôme', code_postal: '67100', siret: '52271822000018', source_url: sirenePage('52271822000018') };
    const cur = { id: 'n', nom: 'Maison Urbaine de Santé du Neuhof', adresse: '2 A rue de Brantôme', code_postal: '67100', siret: '79088427400016', source_url: sirenePage('79088427400016') };
    expect(assessPair(old, cur, { env: ENV })).toMatchObject({ suggestion: 'DISTINCT', basis: 'SIRET_DIFFERENT' });
    expect(assessPair(old, cur, { env: ENV }).note).toMatch(/Entités juridiques différentes/);
    expect(organisationOf(old).key).not.toBe(organisationOf(cur).key);
  });

  it('one address shared by several operators (a health centre and a liberal practitioner): the address is never evidence', () => {
    const centre = { id: 'c', nom: 'Maison de santé', adresse: '2 A rue de Brantôme', code_postal: '67100', siret: '79088427400016', source_url: sirenePage('79088427400016') };
    const nurse = { id: 'p', nom: 'Cabinet infirmier', adresse: '2 A rue de Brantôme', code_postal: '67100', siret: '11111111100011', source_url: sirenePage('11111111100011') };
    const r = assessPair(centre, nurse, { env: ENV });
    expect(r).toMatchObject({ suggestion: 'DISTINCT', basis: 'SIRET_DIFFERENT' });
    expect(r.warnings.map((w) => w.code)).toContain('SAME_ADDRESS_NOT_PROOF');
    // same name, same address, no identifier: no suggestion at all
    expect(assessPair({ id: 'x', nom: 'Accueil', adresse: '1 rue A', code_postal: '67000' }, { id: 'y', nom: 'Accueil', adresse: '1 rue A', code_postal: '67000' }, { env: ENV }).suggestion).toBeNull();
  });

  it('premises with several services under one SIRET (a CCAS and a France services; a mission locale and a point-justice): never automatic', () => {
    const S = '21670482500019';
    const rec = (id, nom) => ({ id, nom, adresse: '1 place de l\'Étoile', code_postal: '67000', source_url: sirenePage(S) });
    expect(siretDuplicateVerdict({ ...rec('a', 'CCAS de Strasbourg'), siret: S }, rec('b', 'France services Strasbourg'), S, { env: ENV })).toMatchObject({ auto: false, basis: 'FUNCTIONS_DIFFER' });
    expect(siretDuplicateVerdict({ ...rec('a', 'Mission locale'), siret: S }, rec('b', 'Point-justice de la mission locale'), S, { env: ENV })).toMatchObject({ auto: false, basis: 'FUNCTIONS_DIFFER' });
  });

  it('the same FINESS establishment on both records is still the same establishment (no regression of the safe automatic case)', () => {
    const S = '79088427400016';
    const a = { id: 'a', nom: 'MUS Neuhof', adresse: '2 A rue de Brantôme', code_postal: '67100', siret: S, numero_finess: '670016864', source_url: finessPage('670016864') };
    const b = { id: 'b', nom: 'Maison Urbaine de Santé du Neuhof', adresse: '2 A rue de Brantôme', code_postal: '67100', numero_finess: '67 001 6864', source_url: finessPage('670016864') };
    expect(siretDuplicateVerdict(a, b, S, { env: ENV })).toMatchObject({ auto: true, basis: 'FINESS_SAME' });
  });
});
