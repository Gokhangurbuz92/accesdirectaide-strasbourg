// R6 — the data·inclusion open-data import: territory filter, thématique → need mapping, matching (strong evidence only), plan, provenance, licence and
// attribution. Small synthetic fixtures only (never the real weekly files).
import { describe, it, expect } from 'vitest';
import { serviceOf, servicesValue, growthRefusal } from '../../api/_services/verification/datainclusion.js';
import { needRules, needsOfThemeCodes, needsOfServices, themeCodeOf } from '../../api/_services/verification/datainclusion-needs.js';
import { loadTerritory, placeTerritory, nameAgreement, buildIndex, matchPlace, planImport, fingerprint, provenanceOf, renderReportTr, pgTextArray, isPublic,
  LICENCE, ACCEPTED_LICENCES, REVIEW_REASON } from '../../scripts/lib/datainclusion-import.mjs';

const territory = loadTerritory();
// a valid SIRET (Luhn) and two others built for the tests
const luhn = (base13) => { for (let k = 0; k < 10; k += 1) { const d = `${base13}${k}`; let s = 0; for (let i = 0; i < 14; i += 1) { let n = Number(d[13 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } s += n; } if (s % 10 === 0) return d; } return null; };
const S1 = luhn('1234567890123'); const S2 = luhn('9876543210987'); const S3 = luhn('5555555555555'); const S4 = luhn('4444444444444');

const place = (o) => ({ id: o.id, source: o.source || 'dora', nom: o.nom, siret: o.siret ?? null, adresse: o.adresse ?? null, code_postal: o.code_postal ?? '67000', commune: o.commune ?? 'Strasbourg',
  code_insee: o.code_insee === undefined ? '67482' : o.code_insee, latitude: null, longitude: null, updatedAt: '2026-11-01', link: null, finess: o.finess ?? null });
const svc = (id, structureId, o = {}) => serviceOf({ id, structure_id: structureId, source: o.source || 'dora', nom: o.nom || `Service ${id}`, thematiques: o.themes || ['numerique--acceder-a-des-services-en-ligne'], date_maj: o.date || '2026-10-01' });

describe('territory: the 33 communes of the Eurométropole', () => {
  it('reads the INSEE composition (33 communes, Strasbourg 67482)', () => {
    expect(territory.communes.size).toBe(33);
    expect(territory.communes.get('67482')).toBe('Strasbourg');
    expect(territory.epci).toBe('246700488');
  });
  it('keeps a place by its INSEE code, refuses another commune of the Bas-Rhin', () => {
    expect(placeTerritory(place({ id: 'a', nom: 'x', code_insee: '67218' }), territory)).toEqual({ in: true, code: '67218', basis: 'INSEE' });
    expect(placeTerritory(place({ id: 'b', nom: 'x', code_insee: '67180' }), territory)).toEqual({ in: false, reason: 'HORS_EUROMETROPOLE' });
  });
  it('without an INSEE code, locates by name + postal code (one commune only), else « not located »', () => {
    const locate = (a) => (a.ville === 'Schiltigheim' ? { code: '67447', nom: 'Schiltigheim' } : a.ville === 'Haguenau' ? { code: '67180', nom: 'Haguenau' } : null);
    expect(placeTerritory(place({ id: 'c', nom: 'x', code_insee: null, commune: 'Schiltigheim', code_postal: '67300' }), territory, { locate })).toEqual({ in: true, code: '67447', basis: 'ADRESSE' });
    expect(placeTerritory(place({ id: 'd', nom: 'x', code_insee: null, commune: 'Haguenau', code_postal: '67500' }), territory, { locate }).reason).toBe('HORS_EUROMETROPOLE');
    expect(placeTerritory(place({ id: 'e', nom: 'x', code_insee: null, commune: 'Nulle-part' }), territory, { locate }).reason).toBe('COMMUNE_NON_LOCALISEE');
  });
});

describe('thématiques → the 20 × 86 needs, from the taxonomy’s own correspondence only', () => {
  const reference = { domains: [{ id: 'logement', subdomains: [{ id: 'hebergement-urgence', dataInclusion: ['logement-hebergement--rechercher-une-solution-dhebergement-temporaire'] }, { id: 'vide', dataInclusion: [] }] },
    { id: 'numerique', subdomains: [{ id: 'illettrisme', dataInclusion: ['lecture-ecriture-calcul--'] }] }] };
  const rules = needRules({ reference });
  it('an exact code and a « theme-- » prefix map; anything else maps to nothing', () => {
    expect(needsOfThemeCodes(['logement-hebergement--rechercher-une-solution-dhebergement-temporaire'], rules)).toEqual(['hebergement-urgence']);
    expect(needsOfThemeCodes(['lecture-ecriture-calcul--maitriser-le-francais', 'lecture-ecriture-calcul--x'], rules)).toEqual(['illettrisme']);
    expect(needsOfThemeCodes(['logement-hebergement--louer-un-logement', 'sante--acces-aux-soins'], rules)).toEqual([]);
  });
  it('the stored labels are turned back into codes; unmapped thématiques are counted, never guessed', () => {
    const s = svc('s1', 'p1', { themes: ['lecture-ecriture-calcul--maitriser-le-francais', 'numerique--acceder-a-des-services-en-ligne'] });
    expect(themeCodeOf(s.themes[0])).toBe('lecture-ecriture-calcul--maitriser-le-francais');
    const r = needsOfServices([s], rules);
    expect(r.needs).toEqual(['illettrisme']);
    expect(r.unmapped).toEqual({ 'numerique--acceder-a-des-services-en-ligne': 1 });
  });
  it('the real taxonomy carries a correspondence (≥ 20 subdomains) and servicesValue writes the needs', () => {
    expect(needRules().length).toBeGreaterThanOrEqual(20);
    const servicesOf = new Map([['p1', [svc('s1', 'p1', { themes: ['famille--garde-denfants'] })]]]);
    const v = servicesValue({ version: '2026-11-23', placeList: [place({ id: 'p1', nom: 'Crèche' })], servicesOf });
    expect(v.needs).toEqual(['garde-enfants']);
  });
});

describe('matching: strong evidence only, uncertain → review', () => {
  const rows = [
    { id: 'r1', nom: 'Centre social Hautepierre', adresse: '10 rue Jean Monnet', code_postal: '67200', ville: 'Strasbourg', siret: S1 },
    { id: 'r2', nom: 'Mission locale Strasbourg', adresse: '3 rue Ste Marguerite', code_postal: '67000', ville: 'Strasbourg', siret: null, numero_finess: '670000001' },
    { id: 'r3', nom: 'Epicerie solidaire Neudorf', adresse: '5 rue de Rathsamhausen', code_postal: '67100', ville: 'Strasbourg', siret: S2 },
    { id: 'r4', nom: 'Point conseil budget Cronenbourg', adresse: '1 rue du Rieth', code_postal: '67200', ville: 'Strasbourg', siret: null },
  ];
  const idx = buildIndex(rows);
  it('same SIRET + same name in the same postal code → MATCH', () => {
    expect(matchPlace(place({ id: 'a', nom: 'Centre Social de Hautepierre', siret: S1, code_postal: '67200', adresse: '10 rue Jean-Monnet' }), idx)).toEqual({ kind: 'MATCH', by: 'SIRET', id: 'r1' });
  });
  it('same SIRET but another name and street (another site of the organisation) → UNCERTAIN, never merged', () => {
    const m = matchPlace(place({ id: 'b', nom: 'Antenne Koenigshoffen', siret: S1, code_postal: '67200', adresse: '40 route des Romains' }), idx);
    expect(m).toMatchObject({ kind: 'UNCERTAIN', reason: 'SIRET_IDENTIQUE_AUTRE_NOM_OU_ADRESSE', candidates: ['r1'] });
  });
  it('same FINESS number in the same postal code → MATCH', () => {
    expect(matchPlace(place({ id: 'c', nom: 'ML', finess: '670000001', code_postal: '67000' }), idx)).toEqual({ kind: 'MATCH', by: 'FINESS', id: 'r2' });
  });
  it('same name AND same street in the same postal code → MATCH (no SIRET on either side)', () => {
    expect(matchPlace(place({ id: 'd', nom: 'Point Conseil Budget - Cronenbourg', code_postal: '67200', adresse: '1 rue du Rieth' }), idx)).toEqual({ kind: 'MATCH', by: 'NOM_ADRESSE', id: 'r4' });
  });
  it('same name and street but a contradicting SIRET → UNCERTAIN', () => {
    expect(matchPlace(place({ id: 'e', nom: 'Epicerie solidaire Neudorf', siret: S3, code_postal: '67100', adresse: '5 rue de Rathsamhausen' }), idx).reason).toBe('NOM_ADRESSE_IDENTIQUES_SIRET_DIFFERENT');
  });
  it('same name without a comparable street → UNCERTAIN; nothing alike → NONE', () => {
    expect(matchPlace(place({ id: 'f', nom: 'Point conseil budget Cronenbourg', code_postal: '67200', adresse: null }), idx).reason).toBe('NOM_OU_ADRESSE_PARTIELLEMENT_IDENTIQUES');
    expect(matchPlace(place({ id: 'g', nom: 'Atelier vélo', code_postal: '67200', adresse: '9 rue X' }), idx)).toEqual({ kind: 'NONE' });
  });
  it('generic words identify nothing on their own', () => {
    expect(nameAgreement('Association Strasbourg', 'Association de Strasbourg')).toBeNull();
    expect(nameAgreement('Épicerie solidaire Neudorf', 'Epicerie Solidaire du Neudorf')).toBe(1);
  });
});

describe('plan: what the import would do, with provenance', () => {
  const source = { date: '2026-11-23', licence: 'lov2', publisher: 'Plateforme de l’inclusion',
    structures: { title: 'structures-inclusion-2026-11-23.json', sha1: 'a'.repeat(40), url: 'https://static.data.gouv.fr/x/structures.json' },
    services: { title: 'services-inclusion-2026-11-23.json', sha1: 'b'.repeat(40), url: 'https://static.data.gouv.fr/x/services.json' } };
  const places = [
    place({ id: 'dora--m1', nom: 'Centre social Hautepierre', siret: S1, code_postal: '67200', adresse: '10 rue Jean Monnet' }),          // MATCH public record → veille
    place({ id: 'dora--m2', nom: 'Epicerie solidaire Neudorf', siret: S2, code_postal: '67100', adresse: '5 rue de Rathsamhausen' }),     // MATCH draft → import writes
    place({ id: 'dora--u1', nom: 'Antenne Koenigshoffen', siret: S1, code_postal: '67200', adresse: '40 route des Romains' }),           // UNCERTAIN
    place({ id: 'france-travail--n1', source: 'france-travail', nom: 'France Travail Strasbourg Hautepierre', siret: S3, code_postal: '67200', adresse: '2 rue X' }), // NEW
    place({ id: 'dora--n2', nom: 'Atelier numérique', siret: S4, code_postal: '67000', adresse: '7 rue Y' }),                           // NEW but only a stale service
    place({ id: 'monenfant--k1', source: 'monenfant', nom: 'Crèche Les Lutins', siret: luhn('1111111111111'), code_postal: '67000', adresse: '1 rue Z' }), // producer without growth
    place({ id: 'dora--s1', nom: 'Sans siret', code_postal: '67000', adresse: '8 rue W' }),                                                // no SIRET
    place({ id: 'dora--h1', nom: 'Hors EMS', siret: luhn('2222222222222'), code_insee: '67180', code_postal: '67500' }),               // outside the territory
    place({ id: 'dora--e1', nom: 'École élémentaire du Centre', siret: luhn('3333333333333'), code_postal: '67000', adresse: '1 rue V' }), // not a place
  ];
  const servicesOf = new Map([
    ['dora--m1', [svc('s-m1', 'dora--m1', { themes: ['famille--garde-denfants'] })]],
    ['dora--m2', [svc('s-m2', 'dora--m2', { themes: ['equipement-et-alimentation--alimentation'] })]],
    ['france-travail--n1', [svc('s-n1', 'france-travail--n1', { source: 'france-travail', nom: 'Accompagnement emploi', themes: ['trouver-un-emploi--suivre-ses-candidatures-et-relancer-les-employeurs'] })]],
    ['dora--n2', [svc('s-n2', 'dora--n2', { date: '2020-01-01' })]],
    ['dora--e1', [svc('s-e1', 'dora--e1')]],
  ]);
  const read = { places: new Map(places.map((p) => [p.id, p])), servicesOf, counts: { structures: 9, services: 5, inScope: 9 }, unknown: {} };
  const rows = [
    { id: 'r1', nom: 'Centre social Hautepierre', adresse: '10 rue Jean Monnet', code_postal: '67200', ville: 'Strasbourg', siret: S1, statut: 'actif', verification_status: 'VERIFIED', publication_hold: null, services_externes: null, categories_aidees: [] },
    { id: 'r3', nom: 'Epicerie solidaire Neudorf', adresse: '5 rue de Rathsamhausen', code_postal: '67100', ville: 'Strasbourg', siret: S2, statut: 'brouillon', verification_status: 'UNVERIFIED', publication_hold: null, services_externes: null, categories_aidees: [] },
  ];
  const plan = planImport({ read, rows, source, territory, fetchedAt: '2026-11-25T02:58:00.000Z' });

  it('counts every place once, with the reason of every skip', () => {
    expect(plan.counts).toMatchObject({ inTerritory: 8, matchedPlaces: 2, matchedRecords: 2, toWrite: 1, toVeille: 1, review: 1, newCandidates: 1 });
    expect(plan.skipped).toEqual({ HORS_EUROMETROPOLE: 1, SIRET_ABSENT_OU_INVALIDE: 1, 'PRODUCTEUR_SANS_CREATION:monenfant': 1, NOM_QUI_N_EST_PAS_UN_LIEU: 1, AUCUN_SERVICE_A_JOUR: 1 });
  });
  it('a public record is left to the veille, a draft is written by the import', () => {
    expect(plan.matched.find((m) => m.recordId === 'r1')).toMatchObject({ public: true, path: 'VEILLE', changed: true, newServices: 1 });
    expect(plan.matched.find((m) => m.recordId === 'r3')).toMatchObject({ public: false, path: 'IMPORT', changed: true, needs: ['aide-alimentaire'] });
    expect(isPublic(rows[0])).toBe(true); expect(isPublic(rows[1])).toBe(false);
  });
  it('the uncertain place goes to the review queue with its evidence, not merged', () => {
    expect(REVIEW_REASON).toBe('DATA_INCLUSION_DOUBLON_POSSIBLE');
    expect(plan.review).toHaveLength(1);
    expect(plan.review[0]).toMatchObject({ recordId: 'r1', reason: 'SIRET_IDENTIQUE_AUTRE_NOM_OU_ADRESSE', places: [{ id: 'dora--u1', producer: 'dora' }] });
  });
  it('the new candidate keeps its producer, the attribution, the needs and the full provenance', () => {
    const c = plan.candidates[0];
    expect(c).toMatchObject({ siret: S3, producers: ['france-travail'], authority: 'OPERATEUR_PUBLIC', code_insee: '67482' });
    expect(c.value.services[0]).toMatchObject({ producer: 'france-travail', attribution: 'selon France Travail', authority: 'OPERATEUR_PUBLIC' });
    expect(c.value.createdFromDataInclusion).toBe(true);
    expect(c.value.import).toEqual(provenanceOf(source, '2026-11-25T02:58:00.000Z'));
    expect(c.value.import).toMatchObject({ source: 'data·inclusion', export: '2026-11-23', fetchedAt: '2026-11-25T02:58:00.000Z', licence: 'Licence Ouverte 2.0', licenceId: 'lov2',
      dataset: 'https://www.data.gouv.fr/datasets/referentiel-de-loffre-dinsertion-sociale-et-professionnelle-data-inclusion',
      files: [{ title: 'structures-inclusion-2026-11-23.json', sha1: 'a'.repeat(40), url: 'https://static.data.gouv.fr/x/structures.json' }, { title: 'services-inclusion-2026-11-23.json', sha1: 'b'.repeat(40), url: 'https://static.data.gouv.fr/x/services.json' }] });
    expect(c.value.places).toEqual([{ id: 'france-travail--n1', producer: 'france-travail', link: null }]);
  });
  it('the fingerprint changes when the records change (the apply refuses a stale plan)', () => {
    const fp = fingerprint(source, plan);
    expect(fingerprint(source, planImport({ read, rows, source, territory, fetchedAt: '2026-11-26T00:00:00.000Z' }))).toBe(fp);   // the fetch time is not a change
    const rows2 = rows.map((r) => (r.id === 'r3' ? { ...r, services_externes: { origin: 'DATA_INCLUSION', services: [] } } : r));
    expect(fingerprint(source, planImport({ read, rows: rows2, source, territory }))).not.toBe(fp);
  });
  it('the report credits data·inclusion, its licence and the date, in Turkish', () => {
    const md = renderReportTr(plan, { generatedAt: '2026-11-25', fingerprint: fingerprint(source, plan), publisher: source.publisher, licenceId: 'lov2', licenceCheckedAt: '2026-11-25',
      files: [{ title: 'structures-inclusion-2026-11-23.json', sha1: 'a'.repeat(40) }], referenceLabel: 'test', referenceRows: 2, commands: ['node scripts/datainclusion-import.mjs'] });
    expect(md).toContain(LICENCE.attribution); expect(md).toContain('Licence Ouverte / Open Licence version 2.0 (Etalab)'); expect(md).toContain('2026-11-23');
    expect(md).toContain('Belirsiz eşleşme'); expect(md).not.toMatch(/@|\+33|\b0[67]\d{8}\b/);
  });
});

describe('licence, growth rule, SQL helper', () => {
  it('only the Licence Ouverte 2.0 is accepted; any other stops the import', () => {
    expect([...ACCEPTED_LICENCES]).toEqual(['lov2']);
    expect(LICENCE.url).toBe('https://www.etalab.gouv.fr/licence-ouverte-open-licence/');
  });
  it('growthRefusal: the veille’s rule (shared)', () => {
    const pl = { code_postal: '67200' };
    expect(growthRefusal({ found: false }, pl, '67')).toBe('SIRET inconnu du répertoire SIRENE');
    expect(growthRefusal({ found: true, open: false }, pl, '67')).toBe('établissement fermé selon SIRENE');
    expect(growthRefusal({ found: true, open: true, legalForm: '1000' }, pl, '67')).toBe('entrepreneur individuel (une personne)');
    expect(growthRefusal({ found: true, open: true, legalForm: '9220', postalCode: '67000' }, pl, '67')).toBe('adresse SIRENE dans une autre commune');
    expect(growthRefusal({ found: true, open: true, legalForm: '9220', postalCode: '67200' }, pl, '67')).toBeNull();
  });
  it('text[] literals are quoted and escaped', () => {
    expect(pgTextArray(['Accès aux droits', 'a"b', 'c\\d'])).toBe('{"Accès aux droits","a\\"b","c\\\\d"}');
    expect(pgTextArray([])).toBe('{}');
  });
});
