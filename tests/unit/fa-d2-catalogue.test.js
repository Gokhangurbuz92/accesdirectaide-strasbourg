/**
 * FA-D2 (18/11/2026) — 20 × 86 catalogue evidence: the defects found against the DILA 3.5 archive of 17/11/2026 and the LAB catalogue.
 *  1. a « next step » link sent a person in Strasbourg to another territory's online service (F18005 Dalo → the Île-de-France extranet; F11994 / F11996
 *     livret de famille → a Ville de Paris PDF; F1361 / F16828 → the Nouvelle-Calédonie electoral site);
 *  2. the audience « agents-publics » was given to a benefit for everyone (F2882 « Prime d'activité : salarié ou fonctionnaire ») and to a sheet that describes
 *     court staff to the public (F2176);
 *  3. the accessibility-and-mobility need was measured empty although the official sheet F34049 (CMI) serves it;
 *  4. a need with services declared by published places was reported TAXONOMY_ONLY (« nothing published matches »);
 *  5. the feed version: the chain reads Particuliers feed 3.5 (3.3 removed on 4 May 2026).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { onlineServiceTerritory } from '../../api/_services/verification/sources.js';
import { practical, officialPatch } from '../../api/_services/verification/chain.js';
import { classifyFiche } from '../../api/_services/verification/classify.js';
import { DILA_ARCHIVE_URL } from '../../api/_services/verification/dila.js';
import { coverage, classifiedSubdomains } from '../../scripts/social-coverage.mjs';

const REF = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
const crumbs = (...titles) => [{ id: 'Particuliers', title: 'Accueil particuliers' }, ...titles.map((t, i) => ({ id: `N${i + 1}`, title: t }))];
const meta = (title, themes, extra = {}) => ({ id: 'F1', kind: "Fiche d'information", title, description: '', coverage: 'France entière', path: [...crumbs(...themes), { id: 'F1', title }], ...extra });

describe('FA-D2 1 — the territory of an online service cited by a fiche', () => {
  it('reads the DILA title label, the body that runs it and the single-city hosts', () => {
    expect(onlineServiceTerritory({ url: 'https://mondalo.logement.gouv.fr/', title: 'Bas-Rhin (67) : faire un recours Dalo', source: "Ministère chargé de l'environnement" })).toBe('OURS');
    expect(onlineServiceTerritory({ url: 'https://mondalo.logement.gouv.fr/', title: 'Province et Dom : estimer son éligibilité au Dalo', source: 'Ministère chargé du logement' })).toBe('OURS');
    expect(onlineServiceTerritory({ url: 'https://mondalo.logement.gouv.fr/', title: 'Calvados (14) : faire un recours Dalo', source: "Ministère chargé de l'environnement" })).toBe('OTHER');
    expect(onlineServiceTerritory({ url: 'https://dalo-daho-ile-de-france.developpement-durable.gouv.fr/extranet/', title: 'Île-de-France : faire un recours Dalo', source: "Direction régionale et interdépartementale de l'hébergement et du logement (DRIHL) Ile-de-France" })).toBe('OTHER');
    expect(onlineServiceTerritory({ url: 'https://cdn.paris.fr/paris/2020/02/12/x.pdf', title: 'Demande de second livret de famille', source: 'Ville de Paris' })).toBe('OTHER');
    expect(onlineServiceTerritory({ url: 'https://electeur-nc.fr/', title: 'Vérifier son inscription', source: 'Gouvernement de Nouvelle Calédonie' })).toBe('OTHER');
    expect(onlineServiceTerritory({ url: 'https://tvvist3res-v2.paris.fr/tvvist/', title: 'Carte de stationnement résidentiel', source: 'Ministère chargé des transports' })).toBe('OTHER');
    expect(onlineServiceTerritory({ url: 'https://demande-autonomie.gouv.fr/', title: "Demande d'aide à l'autonomie", source: 'Caisse nationale de solidarité pour l’autonomie (CNSA)' })).toBe('ANY');
    expect(onlineServiceTerritory({ url: 'https://www.alsace.eu/aides', title: 'FSL', source: 'Collectivité européenne d’Alsace' })).toBe('ANY');   // a local body of ours is not « other »
    expect(onlineServiceTerritory({ url: 'https://example.gouv.fr/', title: 'Personne âgée : aide financière', source: 'Ministère chargé de la santé' })).toBe('ANY');   // a topic label is not a territory
    // the ministry « chargé de la ville » runs a national tool: « ville » alone is not a local body (F1019 Contrat adultes-relais)
    expect(onlineServiceTerritory({ url: 'https://sig.ville.gouv.fr/', title: 'Rechercher un quartier prioritaire', source: 'Ministère chargé de la ville' })).toBe('ANY');
  });

  it('the Dalo next step is the Bas-Rhin service, not the Île-de-France extranet listed first by the fiche', () => {
    const src = { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F18005', online: [
      { url: 'https://dalo-daho-ile-de-france.developpement-durable.gouv.fr/extranet/Simulation', type: 'Simulateur', title: 'Île-de-France : savoir si vous êtes éligible au Dalo ou au Daho', source: 'Ministère chargé du logement' },
      { url: 'https://dalo-daho-ile-de-france.developpement-durable.gouv.fr/extranet/', type: 'Téléservice', title: 'Île-de-France : faire un recours Dalo', source: 'Direction régionale et interdépartementale de l’hébergement et du logement (DRIHL) Ile-de-France' },
      { url: 'https://www.demarches-simplifiees.fr/commencer/dalo-recours-amiable-logement-herault', type: 'Téléservice', title: 'Hérault (34) : faire un recours Dalo', source: 'Ministère chargé du logement' },
      { url: 'https://mondalo.logement.gouv.fr/', type: 'Téléservice', title: 'Bas-Rhin (67) : faire un recours Dalo', source: "Ministère chargé de l'environnement" },
    ], whereToGo: [] };
    expect(practical(src).apply).toBe('https://mondalo.logement.gouv.fr/');
    expect(officialPatch('demarche', { ...src, title: 'Dalo', text: 'x' })).toMatchObject({ lien_teleservice: 'https://mondalo.logement.gouv.fr/' });
  });

  it('a fiche whose only online service is another city\'s gives no link at all (the official fiche stays the way in)', () => {
    const src = { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F11996', online: [{ url: 'https://cdn.paris.fr/paris/2020/02/12/a.pdf', type: 'formulaireNG', title: 'Demande de livret de famille', source: 'Ville de Paris' }], whereToGo: [] };
    expect(practical(src).apply).toBeNull();
    const p = officialPatch('dispositif', { ...src, title: 'Livret de famille', text: 'x' });
    expect(p.liens).toEqual([{ nom: 'Fiche officielle', url: src.url }]);
  });

  it('a national service keeps its place (no reordering without a territory)', () => {
    const src = { url: 'u', online: [{ url: 'https://www.maprocuration.gouv.fr/', type: 'Téléservice', title: 'Faire une procuration', source: "Ministère chargé de l'intérieur" }], whereToGo: [] };
    expect(practical(src).apply).toBe('https://www.maprocuration.gouv.fr/');
  });
});

describe('FA-D2 2 — the audience of a fiche', () => {
  const sheet = { text: '## Montant\n', online: [] };
  it('« salarié ou fonctionnaire » is for everyone; a sheet describing court staff is not public agents\' own rule', () => {
    expect(classifyFiche(meta("Prime d'activité : salarié ou fonctionnaire", ['Social - Santé', "Prime d'activité"]), sheet).audience).toBe('particuliers');
    expect(classifyFiche(meta('Magistrats du tribunal judiciaire et autres agents publics de justice', ['Justice', 'Acteurs du monde judiciaire']), { text: '', online: [] }).audience).toBe('particuliers');
  });
  it('the public agents\' own rules keep their audience', () => {
    expect(classifyFiche(meta('Congé de longue maladie (CLM) du fonctionnaire', ['Travail - Formation', 'Maladie ou accident du travail dans la fonction publique']), { text: '', online: [] }).audience).toBe('agents-publics');
    expect(classifyFiche(meta('Chèques-vacances pour un agent public', ['Loisirs - Sports - Culture', 'Aides aux vacances']), { text: '', online: [] }).audience).toBe('agents-publics');
  });
});

describe('FA-D2 3 — the CMI reaches the accessibility-and-mobility need', () => {
  it('classification: F34049 « Carte mobilité inclusion (CMI) » serves handicap/accessibilite-mobilite', () => {
    const c = classifyFiche(meta('Carte mobilité inclusion (CMI)', ['Social - Santé', 'Handicap']), { text: '## Démarche\n', online: [] });
    expect(c.ok).toBe(true);
    expect([c.domain && c.subdomain ? `${c.domain}/${c.subdomain}` : null, ...c.subdomains]).toContain('handicap/accessibilite-mobilite');
  });
  it('measurement: a published CMI sheet is a titled right of the need (no longer TAXONOMY_ONLY)', () => {
    const data = { aide: [], demarche: [{ slug: 'cmi', titre: 'Carte mobilité inclusion (CMI)', description_courte: 'La CMI permet de faciliter les déplacements' }], guide: [], dispositif: [], actualite: [], structures: [] };
    const row = coverage(REF, data, new Set()).rows.find((r) => r.subdomain === 'accessibilite-mobilite');
    expect(row.evidence.verifiedRightsByTitle).toBe(true);
    expect(row.status).not.toBe('TAXONOMY_ONLY');
  });
});

describe('FA-D2 4 — declared services are not « nothing published »', () => {
  it('a need with only a service declared by a published place is PARTIALLY_COVERED, never COVERED_VERIFIED on that alone', () => {
    const place = { id: 'p1', slug: 'chantier', nom: 'Chantier', type_structure: 'Association', services: ["Chantier d'insertion"], source_url: 'https://example.org', code_postal: '67000', ville: 'Strasbourg', telephone: '0300000000', date_verification: new Date().toISOString() };
    const data = { aide: [], demarche: [], guide: [], dispositif: [], actualite: [], structures: [place] };
    const row = coverage(REF, data, new Set()).rows.find((r) => r.subdomain === 'iae');
    expect(row.services).toBe(1);
    expect(row.status).toBe('PARTIALLY_COVERED');
    expect(row.gap).toBe('missing verified rights content (declared services only)');
    const none = coverage(REF, { ...data, structures: [] }, new Set()).rows.find((r) => r.subdomain === 'iae');
    expect(none.status).toBe('TAXONOMY_ONLY');   // an honest empty state stays empty
  });
});

describe('FA-D2 6 — a classified record counts where the chain placed it, not where a context-blind word lands', () => {
  const rec = (slug, titre, cls) => ({ slug, titre, description_falc: titre, cls });
  it('« pension alimentaire » is not food aid; « sapeur-pompier volontaire » is not social emergency; hand-written records keep the word rule', () => {
    const data = { aide: [], demarche: [], guide: [], actualite: [], structures: [], dispositif: [
      rec('pa', 'Revalorisation annuelle de la pension alimentaire', { domain: 'famille', subdomain: 'separation', subdomains: ['famille/separation'] }),
      rec('spv', 'Sapeur-pompier volontaire (SPV) : secours', { domain: 'lien-social', subdomain: null, subdomains: [] }),
      { slug: 'colis', titre: 'Colis alimentaire à Strasbourg', description_falc: 'aide alimentaire' },   // nobody classified it: words decide
    ] };
    const { rows } = coverage(REF, data, new Set());
    const food = rows.find((r) => r.subdomain === 'aide-alimentaire');
    expect(food.rightsSlugs).toEqual(['dispositif:colis']);
    expect(rows.find((r) => r.subdomain === 'separation').titledSlugs).toContain('dispositif:pa');
    expect(rows.find((r) => r.subdomain === 'urgence-sociale').rightsContent).toBe(0);
  });
  it('a public Level 1 record without its classification reads it from mots_cles [domain, subdomain]; a CMI record classified before FA-D2 still reaches its need', () => {
    expect([...classifiedSubdomains({ mode: 'OFFICIAL_SOURCE', mots_cles: ['famille', 'separation'] })]).toEqual(['famille/separation']);
    expect(classifiedSubdomains({ mots_cles: ['famille', 'separation'] })).toBeNull();   // hand-written: no classification claimed
    const old = { slug: 'cmi', titre: 'Carte mobilité inclusion (CMI)', cls: { domain: 'handicap', subdomain: 'mdph-droits', subdomains: ['handicap/mdph-droits'] } };
    const row = coverage(REF, { aide: [], demarche: [old], guide: [], dispositif: [], actualite: [], structures: [] }, new Set()).rows.find((r) => r.subdomain === 'accessibilite-mobilite');
    expect(row.titledSlugs).toEqual(['demarche:cmi']);
  });
});

describe('FA-D2 5 — Service-Public Particuliers feed version', () => {
  it('the chain reads feed 3.5', () => {
    expect(DILA_ARCHIVE_URL).toBe('https://lecomarquage.service-public.gouv.fr/vdd/3.5/part/zip/vosdroits-latest.zip');
  });
  it('no code points at the removed 3.3 feed (or the degraded 3.4 one)', () => {
    const hits = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(p); } else if (/\.(m?js|jsx|json)$/.test(e.name) && /vdd\/3\.[34]\//.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
    } };
    for (const d of ['api', 'scripts', 'src', 'config']) walk(d);
    expect(hits).toEqual([]);
  });
});
