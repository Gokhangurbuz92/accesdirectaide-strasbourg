// @ts-nocheck
/**
 * Automatic verification chain — the registry of official sources (« Registre des sources officielles », table SourceRegistryEntry).
 *
 * Levels: NATIONAL (gouvernement, ministères, opérateurs nationaux), ORGANISME (sécurité sociale : Caf, Assurance maladie, MSA, Assurance retraite…), REGIONAL
 * (Région Grand Est, ARS, DREETS), DEPARTEMENTAL (Collectivité européenne d'Alsace : solidarités, autonomie, MDPH), PREFECTURE (services de l'État dans le
 * Bas-Rhin), COMMUNAL (communes, Ville et Eurométropole de Strasbourg, CCAS), REGISTRE (SIRENE, Annuaire de l'administration, FINESS, Légifrance, data.gouv.fr).
 *
 * How a site becomes a trusted source — automatically, never by a person's click:
 *  - the starting list below (the State's own sites and the public bodies of the launch territory), each with what makes it official;
 *  - every week, the website the Annuaire de l'administration (DILA) gives for each public body of the département: the State's own directory says it is that
 *    body's site (attestation kept with the link to the directory entry). A site no longer listed for two weekly refreshes is retired automatically.
 *  - every week too, the online services Service-Public.gouv.fr itself cites in its fiches (téléservices, formulaires, simulateurs: « ServiceEnLigne », with the body
 *    that runs them): the State's information service says it is that body's official service — trusted for démarches only, never for the rules of an aide; the
 *    local services of another territory (« Ville de Paris ») are left out;
 *  - every night, the health of the feeds the chain reads (archive, Annuaire, SIRENE: answered or not, how long, which version), and every month a light visit of
 *    each site of the registry (a few dozen per night): reachable or not, moved or not — a site that redirects to an address nobody attests is paused (not
 *    trusted any more), a site replaced by another trusted one is retired with its successor, a site unreachable for three monthly visits is set aside (ERROR).
 * Shared platforms (social networks, site builders, webmail) are never attested: trusting them would trust everybody's pages. What was left out, and why, is kept
 * in the registry refresh's metrics (the owner's page lists it).
 * Authority (chain.js): a source is used only for what it is an authority on (`capabilities`: aides, demarches, structures…); a site of the right domain cannot
 * be the source of a rule outside its field.
 */
import { eq, sql } from 'drizzle-orm';
import { SourceRegistryEntry } from '../../../src/db/schema.js';
import { officialGet, officialJson, hostIn, SourceError } from './fetcher.js';
import { digits } from './registries.js';
import { DILA_ARCHIVE_URL } from './dila.js';
import { decode } from './pages.js';

export const LEVELS = ['NATIONAL', 'EUROPEEN', 'ORGANISME', 'OPERATEUR', 'REGIONAL', 'DEPARTEMENTAL', 'PREFECTURE', 'COMMUNAL', 'REGISTRE'];
const LO = { name: 'Licence Ouverte 2.0', url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/' };
const ANNUAIRE_API = 'https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records';

/** The starting list: serious official sources, by level. `domains`: the hosts the chain may read for this source (with their subdomains). */
export const SEED_SOURCES = [
  { sourceId: 'dila-service-public', level: 'NATIONAL', type: 'XML', name: 'Service-Public.gouv.fr — fiches pratiques (DILA, Premier ministre)', endpoint: DILA_ARCHIVE_URL, domains: ['service-public.gouv.fr', 'service-public.fr'], capabilities: ['aides', 'demarches'], frequency: 'quotidienne', licence: LO, attestation: "Site officiel de l'administration française, publié par la Direction de l'information légale et administrative (Premier ministre)." },
  { sourceId: 'annuaire-administration', level: 'REGISTRE', type: 'REST_API', name: "Annuaire de l'administration (DILA)", endpoint: ANNUAIRE_API, domains: ['lannuaire.service-public.gouv.fr', 'api-lannuaire.service-public.fr'], capabilities: ['structures'], frequency: 'hebdomadaire', licence: LO, attestation: "Annuaire officiel des services publics, tenu par la DILA (Premier ministre)." },
  { sourceId: 'sirene', level: 'REGISTRE', type: 'REST_API', name: "Recherche d'entreprises — répertoire SIRENE (INSEE, DINUM)", endpoint: 'https://recherche-entreprises.api.gouv.fr/search', domains: ['recherche-entreprises.api.gouv.fr', 'annuaire-entreprises.data.gouv.fr'], capabilities: ['structures:identite'], frequency: 'hebdomadaire', licence: LO, attestation: "Répertoire officiel des entreprises, associations et établissements (INSEE)." },
  { sourceId: 'legifrance', level: 'REGISTRE', type: 'CURATED', name: 'Légifrance (DILA)', endpoint: 'https://www.legifrance.gouv.fr', domains: ['legifrance.gouv.fr'], capabilities: ['textes'], frequency: 'continue', licence: LO, attestation: 'Service public de la diffusion du droit (textes officiels).' },
  { sourceId: 'data-gouv', level: 'REGISTRE', type: 'REST_API', name: 'data.gouv.fr (Etalab)', endpoint: 'https://www.data.gouv.fr/api/1/', domains: ['data.gouv.fr'], capabilities: ['jeux-de-donnees'], frequency: 'continue', licence: LO, attestation: 'Plateforme ouverte des données publiques (Etalab, DINUM).' },
  { sourceId: 'finess', level: 'REGISTRE', type: 'JSON_FILE', name: 'FINESS+ — établissements sanitaires, sociaux et médico-sociaux (Agence du numérique en santé)', endpoint: 'https://www.data.gouv.fr/datasets/finess-structures-1', domains: ['finess.esante.gouv.fr'], capabilities: ['structures:medico-social'], frequency: 'quotidienne', licence: LO, attestation: 'Répertoire national officiel des établissements sanitaires, sociaux et médico-sociaux (flux FINESS+ quotidiens, data.gouv.fr).' },
  // R11 / D05: a referential of PRODUCERS' statements, not an authority — no domain becomes trusted through it and it attests nothing; each service it lists stays
  // attributed to its producer (datainclusion.js)
  { sourceId: 'data-inclusion', level: 'OPERATEUR', type: 'JSON_FILE', name: "data·inclusion — offre d'insertion sociale et professionnelle (GIP de l'inclusion)", endpoint: 'https://www.data.gouv.fr/datasets/referentiel-de-loffre-dinsertion-sociale-et-professionnelle-data-inclusion', domains: [], capabilities: ['services:attribues'], frequency: 'hebdomadaire', licence: LO, attestation: "Référentiel ouvert publié chaque semaine par la Plateforme de l'inclusion : chaque service reste attribué à son producteur (opérateur public ou structure qui se déclare sur une plateforme) ; il n'est pas vérifié par l'État." },
  { sourceId: 'caf', level: 'ORGANISME', type: 'HTML_SCRAPER', name: 'Caf — Caisse nationale des allocations familiales (dont la Caf du Bas-Rhin)', endpoint: 'https://www.caf.fr', domains: ['caf.fr'], capabilities: ['aides', 'structures'], frequency: 'hebdomadaire', attestation: 'Organisme national de sécurité sociale (branche famille).' },
  { sourceId: 'assurance-maladie', level: 'ORGANISME', type: 'HTML_SCRAPER', name: 'Assurance maladie — ameli.fr (dont la CPAM du Bas-Rhin)', endpoint: 'https://www.ameli.fr', domains: ['ameli.fr'], capabilities: ['aides', 'structures'], frequency: 'hebdomadaire', attestation: 'Organisme national de sécurité sociale (branche maladie).' },
  { sourceId: 'msa', level: 'ORGANISME', type: 'HTML_SCRAPER', name: 'MSA — Mutualité sociale agricole (dont la MSA d’Alsace)', endpoint: 'https://www.msa.fr', domains: ['msa.fr'], capabilities: ['aides', 'structures'], frequency: 'hebdomadaire', attestation: 'Organisme de sécurité sociale du monde agricole.' },
  { sourceId: 'assurance-retraite', level: 'ORGANISME', type: 'HTML_SCRAPER', name: 'Assurance retraite (Cnav, Carsat Alsace-Moselle)', endpoint: 'https://www.lassuranceretraite.fr', domains: ['lassuranceretraite.fr', 'carsat-alsacemoselle.fr', 'info-retraite.fr'], capabilities: ['aides', 'structures'], frequency: 'hebdomadaire', attestation: 'Organismes de sécurité sociale (branche retraite) et GIP Union Retraite.' },
  { sourceId: 'france-travail', level: 'NATIONAL', type: 'HTML_SCRAPER', name: 'France Travail', endpoint: 'https://www.francetravail.fr', domains: ['francetravail.fr'], capabilities: ['aides', 'demarches', 'structures'], frequency: 'hebdomadaire', attestation: "Opérateur public de l'emploi." },
  { sourceId: 'mes-droits-sociaux', level: 'NATIONAL', type: 'HTML_SCRAPER', name: 'Mes droits sociaux (sécurité sociale)', endpoint: 'https://www.mesdroitssociaux.gouv.fr', domains: ['mesdroitssociaux.gouv.fr'], capabilities: ['aides'], frequency: 'hebdomadaire', attestation: 'Portail public des droits sociaux.' },
  { sourceId: 'cnsa', level: 'NATIONAL', type: 'HTML_SCRAPER', name: 'CNSA — Mon parcours handicap, Pour les personnes âgées', endpoint: 'https://www.monparcourshandicap.gouv.fr', domains: ['monparcourshandicap.gouv.fr', 'pour-les-personnes-agees.gouv.fr', 'cnsa.fr'], capabilities: ['aides', 'demarches'], frequency: 'hebdomadaire', attestation: "Caisse nationale de solidarité pour l'autonomie (établissement public)." },
  { sourceId: 'justice', level: 'NATIONAL', type: 'HTML_SCRAPER', name: 'Ministère de la Justice — justice.fr', endpoint: 'https://www.justice.fr', domains: ['justice.fr', 'justice.gouv.fr'], capabilities: ['aides', 'demarches', 'structures'], frequency: 'hebdomadaire', attestation: 'Site du ministère de la Justice pour le public.' },
  { sourceId: 'defenseur-des-droits', level: 'NATIONAL', type: 'HTML_SCRAPER', name: 'Défenseur des droits', endpoint: 'https://www.defenseurdesdroits.fr', domains: ['defenseurdesdroits.fr'], capabilities: ['structures'], frequency: 'mensuelle', attestation: 'Autorité administrative indépendante (Constitution, art. 71-1).' },
  { sourceId: 'pass-culture', level: 'NATIONAL', type: 'HTML_SCRAPER', name: 'pass Culture (ministère de la Culture)', endpoint: 'https://pass.culture.fr', domains: ['pass.culture.fr'], capabilities: ['aides'], frequency: 'mensuelle', attestation: 'Dispositif public du ministère de la Culture.' },
  { sourceId: 'region-grand-est', level: 'REGIONAL', type: 'HTML_SCRAPER', name: 'Région Grand Est (dont Fluo, transports régionaux)', endpoint: 'https://www.grandest.fr', domains: ['grandest.fr'], capabilities: ['aides'], frequency: 'hebdomadaire', attestation: 'Collectivité territoriale (Région Grand Est).' },
  // R24 (owner decision R20.2, 28/10/2026): the operator of the Région's TER Fluo network is the authority on ITS OWN tariff offers (Carte Solidaire) — local
  // capabilities only, never on a national aide; host-level like every source (ter.sncf.com serves each region under its own path)
  { sourceId: 'ter-grand-est', level: 'OPERATEUR', type: 'HTML_SCRAPER', name: 'TER Grand Est — SNCF Voyageurs, opérateur du réseau TER Fluo de la Région Grand Est (offres tarifaires)', endpoint: 'https://www.ter.sncf.com/grand-est', domains: ['ter.sncf.com'], capabilities: ['aides:local', 'demarches:local'], frequency: 'hebdomadaire', attestation: "Opérateur ferroviaire désigné par la Région Grand Est (autorité organisatrice) pour le réseau TER Fluo ; source primaire de ses propres offres (décision du propriétaire R20.2, 28/10/2026)." },
  { sourceId: 'ars-grand-est', level: 'REGIONAL', type: 'HTML_SCRAPER', name: 'ARS Grand Est', endpoint: 'https://www.grand-est.ars.sante.fr', domains: ['grand-est.ars.sante.fr'], capabilities: ['structures'], frequency: 'mensuelle', attestation: 'Agence régionale de santé (établissement public de l’État).' },
  { sourceId: 'cea', level: 'DEPARTEMENTAL', type: 'HTML_SCRAPER', name: "Collectivité européenne d'Alsace (solidarités, autonomie, MDPH du Bas-Rhin)", endpoint: 'https://www.alsace.eu', domains: ['alsace.eu'], capabilities: ['aides', 'demarches', 'structures'], frequency: 'hebdomadaire', attestation: "Collectivité qui exerce les compétences du Département du Bas-Rhin (RSA, APA, PCH, protection de l'enfance, MDPH)." },
  { sourceId: 'prefecture-67', level: 'PREFECTURE', type: 'HTML_SCRAPER', name: 'Préfecture du Bas-Rhin (services de l’État)', endpoint: 'https://www.bas-rhin.gouv.fr', domains: ['bas-rhin.gouv.fr'], capabilities: ['demarches', 'structures', 'aides'], frequency: 'hebdomadaire', attestation: "Représentation de l'État dans le département." },
  { sourceId: 'strasbourg', level: 'COMMUNAL', type: 'HTML_SCRAPER', name: 'Ville et Eurométropole de Strasbourg (dont le CCAS)', endpoint: 'https://www.strasbourg.eu', domains: ['strasbourg.eu'], capabilities: ['aides', 'demarches', 'structures'], frequency: 'hebdomadaire', attestation: 'Collectivités territoriales (commune et métropole).' },
];

/** shared platforms: a page there is not the body's own site */
const SHARED = ['facebook.com', 'fb.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'google.com', 'sites.google.com', 'wixsite.com', 'jimdo.com',
  'jimdofree.com', 'blogspot.com', 'wordpress.com', 'over-blog.com', 'free.fr', 'wanadoo.fr', 'orange.fr', 'sfr.fr', 'laposte.net', 'gmail.com', 'canalblog.com', 'e-monsite.com',
  'webnode.fr', 'site-solocal.com', 'pagesjaunes.fr', 'mairie.com', 'annuaire-mairie.fr', 'calameo.com', 'linktr.ee', 'bit.ly'];
export const isShared = (host) => SHARED.some((d) => host === d || host.endsWith('.' + d));

/** Level of a public body from its Annuaire type (pivot type_service_local). */
export function levelOf(type) {
  const t = String(type || '');
  if (/^(mairie|ccas|epci|police_municipale|mairie_com|csl)$/.test(t)) return 'COMMUNAL';
  if (/^(caf|cpam|carsat|urssaf|msa|cicas|cnav|mutualite_sociale_agricole)$/.test(t)) return 'ORGANISME';
  if (/^(cg|mds|maison_handicapees|pmi|clic|accompagnement_personnes_agees|maia|cdas|laboratoire_departemental|sdis|caue)$/.test(t)) return 'DEPARTEMENTAL';
  if (/^(cr|paierie_regionale|ars_antenne|dreets|dreal|drac|draf|dr_.*|prefecture_region|direccte|carif_oref)$/.test(t)) return 'REGIONAL';
  if (/^(prefecture|sous_pref|prefecture_greffe_associations|ddets|ddt|ddpp|ddpjj|dd_femmes|ddfip|dd_fip|sdjes|ofii|plateforme_naturalisation)$/.test(t)) return 'PREFECTURE';
  if (/^(parc_naturel_regional)$/.test(t)) return 'REGIONAL';
  if (/^(ad)$/.test(t)) return 'DEPARTEMENTAL';                    // archives départementales
  if (/^(credit_municipal)$/.test(t)) return 'COMMUNAL';
  // associations, chambers, orders and other bodies that run a service (Mission locale, information jeunesse, point conseil budget, France Rénov', CIDFF,
  // ADIL…): official for their own service, not authorities of the State (the Annuaire lists them; owner LAB, 2026-10-25: 109 sites were labelled « State »)
  if (/^(fr_renov|cij|pcb|mission_locale|pif|cidf|adil|maison_emploi|ssti|crib|apec|fdc|fdapp|safer|ctrc|chambre_agriculture|cci|chambre_metier|ordre_avocats|chambre_notaires|huissiers_justice|architectes_reg|medecins_dpt|cdg|arlci)$/.test(t)) return 'OPERATEUR';
  return 'NATIONAL';   // State services and national public bodies (gendarmerie, courts, customs, Banque de France, Crous, France services label…)
}

const parseList = (v) => { if (Array.isArray(v)) return v; try { const p = JSON.parse(String(v || '[]')); return Array.isArray(p) ? p : []; } catch { return []; } };

/**
 * Every public body of a département in the Annuaire de l'administration (about 1 200 for the Bas-Rhin), in pages of 100.
 * @param {string} departement e.g. '67' @param {{ fetchImpl?: typeof fetch, env?: any }} [opts]
 */
export async function listDepartmentOffices(departement, opts = {}) {
  const dep = digits(departement).slice(0, 3) || String(departement || '').slice(0, 3);
  const where = encodeURIComponent(`startswith(code_insee_commune,"${dep}")`);
  const out = []; let total = null;
  for (let offset = 0; offset < 10000; offset += 100) {
    const { json } = await officialJson(`${ANNUAIRE_API}?where=${where}&limit=100&offset=${offset}`, opts);
    total = json.total_count ?? total;
    const rows = json.results || [];
    out.push(...rows);
    if (rows.length < 100 || (total !== null && out.length >= total)) break;
  }
  return { rows: out, total };
}

/** The attested websites of a list of Annuaire rows: { host → { name, type, level, evidenceUrl } } (first body listed for a host wins). */
export function attestedSites(rows) {
  const sites = new Map();
  for (const r of rows || []) {
    const type = (parseList(r.pivot)[0] || {}).type_service_local || null;
    for (const s of parseList(r.site_internet)) {
      let host = '';
      try { const u = new URL(String(s.valeur || '')); if (!/^https?:$/.test(u.protocol)) continue; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
      if (!host || isShared(host) || sites.has(host)) continue;
      sites.set(host, { name: r.nom, type, level: levelOf(type), evidenceUrl: r.url_service_public || null, annuaireId: r.id });
    }
  }
  return sites;
}

/** The Annuaire sites left out of the registry, with the reason (shared platform, not a web address). @param {any[]} rows @returns {{ host: string, name: string, reason: string }[]} */
export function rejectedSites(rows) {
  const out = []; const seen = new Set();
  for (const r of rows || []) {
    for (const s of parseList(r.site_internet)) {
      const raw = String(s.valeur || '').trim(); if (!raw) continue;
      let host = '';
      try { const u = new URL(raw); if (!/^https?:$/.test(u.protocol)) throw new Error('scheme'); host = u.hostname.toLowerCase().replace(/^www\./, ''); }
      catch { if (!seen.has(raw)) { seen.add(raw); out.push({ host: raw.slice(0, 80), name: r.nom, reason: 'adresse de site invalide' }); } continue; }
      if (isShared(host) && !seen.has(host)) { seen.add(host); out.push({ host, name: r.nom, reason: 'plateforme partagée (réseau social, hébergeur de pages, messagerie) : pas le site propre de l’organisme' }); }
    }
  }
  return out;
}

/** The seed list into the registry (inserted once, kept up to date by its sourceId; never disabled here). @param {any} db @param {Date} [now] */
export async function ensureSeed(db, now = new Date()) {
  for (const s of SEED_SOURCES) {
    const values = { sourceId: s.sourceId, name: s.name, type: s.type, endpoint: s.endpoint, capabilities: s.capabilities, trustedDomains: s.domains, connectorClass: 'seed', level: s.level,
      attestation: s.attestation, territory: s.level === 'NATIONAL' || s.level === 'ORGANISME' || s.level === 'REGISTRE' ? 'FR' : 'FR-67', organisation: s.name, updateFrequency: s.frequency,
      licenceName: s.licence?.name || null, licenceUrl: s.licence?.url || null, status: 'ACTIVE', updatedAt: now };
    await db.insert(SourceRegistryEntry).values(values).onConflictDoUpdate({ target: SourceRegistryEntry.sourceId, set: { name: values.name, type: values.type, endpoint: values.endpoint, capabilities: values.capabilities,
      trustedDomains: values.trustedDomains, level: values.level, attestation: values.attestation, updateFrequency: values.updateFrequency, updatedAt: now } });
  }
}

/**
 * Weekly refresh: the Annuaire's attested sites of the département become (or stay) trusted sources; a site not seen for two refreshes is retired.
 * @param {{ db: any, departement?: string, rows?: any[], now?: Date, fetchImpl?: typeof fetch, env?: any }} p rows: an Annuaire reading already made this run
 */
/**
 * R14: a site the Annuaire attests (a mairie, an intercommunal or departmental site) is an authority on its organisation and on ITS OWN local schemes and procedures —
 * not on the rules of a national aide (a commune page can carry outdated national amounts): « :local » capabilities (chain.js authorityFor refuses them for a NATIONAL record).
 */
export const ATTESTED_CAPABILITIES = ['structures', 'aides:local', 'demarches:local'];
export async function refreshRegistry({ db, departement = '67', rows, now = new Date(), fetchImpl, env }) {
  await ensureSeed(db, now);
  const list = rows || (await listDepartmentOffices(departement, { fetchImpl, env })).rows;
  const sites = attestedSites(list);
  const existing = await db.select().from(SourceRegistryEntry).where(eq(SourceRegistryEntry.connectorClass, 'annuaire-attested'));
  const byId = new Map(existing.map((e) => [e.sourceId, e]));
  let added = 0; let kept = 0; let retired = 0; let restored = 0;
  for (const [host, s] of sites) {
    const sourceId = `annuaire-site:${host}`; const e = byId.get(sourceId);
    if (!e) {
      await db.insert(SourceRegistryEntry).values({ sourceId, name: `${s.name} — site officiel`, type: 'HTML_SCRAPER', endpoint: `https://${host}`, trustedDomains: [host], capabilities: ATTESTED_CAPABILITIES,
        connectorClass: 'annuaire-attested', level: s.level, attestation: `Annuaire de l'administration (DILA) : site officiel de « ${s.name} ».`, attestationUrl: s.evidenceUrl,
        territory: `FR-${departement}`, organisation: s.name, updateFrequency: 'hebdomadaire', status: 'ACTIVE', lastSuccessAt: now, lastSyncAt: now, updatedAt: now }).onConflictDoNothing();
      added += 1;
    } else {
      // listed again: a site retired for missing refreshes comes back; a site paused or set aside by its health (moved elsewhere, unreachable) stays so until its next
      // visit, and a site the visit found REPLACED by another trusted one (successor recorded: bas-rhin.fr → alsace.eu) stays retired
      const back = e.status === 'DISABLED' && !e.successorSourceId;
      if (back) restored += 1; else kept += 1;
      await db.update(SourceRegistryEntry).set({ status: back ? 'ACTIVE' : e.status, failureCount: 0, disabledAt: back ? null : e.disabledAt, lastSuccessAt: now, lastSyncAt: now,
        level: s.level, attestationUrl: s.evidenceUrl, capabilities: ATTESTED_CAPABILITIES, updatedAt: now }).where(eq(SourceRegistryEntry.id, e.id));
    }
  }
  for (const e of existing) {
    if (sites.has(e.sourceId.replace(/^annuaire-site:/, '')) || e.status !== 'ACTIVE') continue;
    const misses = (e.failureCount || 0) + 1;
    await db.update(SourceRegistryEntry).set({ failureCount: misses, lastSyncAt: now, updatedAt: now, ...(misses >= 2 ? { status: 'DISABLED', disabledAt: now } : {}) }).where(eq(SourceRegistryEntry.id, e.id));
    if (misses >= 2) retired += 1;
  }
  const rejected = rejectedSites(list);
  return { offices: list.length, attestedSites: sites.size, added, kept, restored, retired, rejectedCount: rejected.length, rejected: rejected.slice(0, 60) };
}

// ------------------------------------------------------------------------------------------------------------------------------- online services cited by Service-Public
const LOCAL_BODY = /(^|\s)(ville|mairie|commune|d[ée]partement|conseil d[ée]partemental|r[ée]gion|collectivit[ée]|m[ée]tropole|pr[ée]fecture)(\s|$)/i;
const OUR_TERRITORY = /strasbourg|bas-rhin|alsace|grand est|eurom[ée]tropole/i;
const SOCIAL_SECURITY = /caisse|assurance maladie|assurance retraite|mutualit[ée] sociale|urssaf|carsat|cnav|cnaf|\bmsa\b|agirc|arrco/i;

/**
 * What a cited online service is, truthfully: a State site (*.gouv.fr), a European institution (*.europa.eu), a social security body, or else a service OPERATOR
 * (an association, a company or an eco-organisme running a public scheme, a mediator…) — cited by Service-Public for its service, not an authority of the State.
 */
export function onlineLevel(host, org = '') {
  if (/(^|\.)gouv\.fr$/.test(host)) return 'NATIONAL';
  if (/(^|\.)europa\.eu$/.test(host)) return 'EUROPEEN';
  if (SOCIAL_SECURITY.test(org)) return 'ORGANISME';
  return 'OPERATEUR';
}

/** The hosts of the online services cited by the fiches of an archive: { host → { orgs (body → count), fiches, titles, types } }. @param {{ fiches: Map<string, string> }} archive */
export function onlineServiceHosts(archive) {
  const hosts = new Map();
  for (const [id, xml] of archive?.fiches || []) {
    for (const m of String(xml).matchAll(/<ServiceEnLigne\b([^>]*)>([\s\S]*?)<\/ServiceEnLigne>/g)) {
      const url = decode((m[1].match(/\bURL="([^"]+)"/) || [])[1] || '');
      let host = '';
      try { const u = new URL(url); if (u.protocol !== 'https:') continue; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
      const org = decode(((m[2].match(/<Source[^>]*>([^<]*)<\/Source>/) || [])[1] || '').trim());
      const title = decode(((m[2].match(/<Titre>([^<]*)<\/Titre>/) || [])[1] || '').trim());
      let h = hosts.get(host);
      if (!h) { h = { host, orgs: new Map(), fiches: new Set(), titles: [], types: new Set() }; hosts.set(host, h); }
      h.fiches.add(id); if (org) h.orgs.set(org, (h.orgs.get(org) || 0) + 1);
      if (title && h.titles.length < 3 && !h.titles.includes(title)) h.titles.push(title);
      const type = (m[1].match(/\btype="([^"]+)"/) || [])[1]; if (type) h.types.add(decode(type));
    }
  }
  return hosts;
}

/**
 * Weekly: the online services Service-Public cites become trusted sources for démarches (attested by the DILA, with an example fiche); not cited for two
 * refreshes: retired. Hosts already covered by the registry are left as they are. @param {{ db: any, archive: any, now?: Date }} p
 */
export async function refreshOnlineServices({ db, archive, now = new Date() }) {
  const hosts = onlineServiceHosts(archive);
  const covered = (await db.select({ d: SourceRegistryEntry.trustedDomains, c: SourceRegistryEntry.connectorClass }).from(SourceRegistryEntry))
    .filter((r) => r.c !== 'dila-attested').flatMap((r) => r.d || []);
  const existing = await db.select().from(SourceRegistryEntry).where(eq(SourceRegistryEntry.connectorClass, 'dila-attested'));
  const byId = new Map(existing.map((e) => [e.sourceId, e]));
  const seen = new Set(); const rejected = []; let added = 0; let kept = 0; let restored = 0; let retired = 0;
  for (const [host, h] of hosts) {
    if (isShared(host)) { rejected.push({ host, reason: 'plateforme partagée' }); continue; }
    const org = [...h.orgs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    if (org && LOCAL_BODY.test(org) && !OUR_TERRITORY.test(org)) { rejected.push({ host, name: org, reason: 'service local d’un autre territoire' }); continue; }
    if (hostIn(host, covered)) continue;                                       // already a source of the registry (starting list, Annuaire)
    const sourceId = `dila-online:${host}`; seen.add(sourceId);
    const fiche = [...h.fiches][0];
    const values = { name: `${org || host} — service en ligne`, type: 'HTML_SCRAPER', endpoint: `https://${host}`, trustedDomains: [host], capabilities: ['demarches'], connectorClass: 'dila-attested',
      level: onlineLevel(host, org), territory: OUR_TERRITORY.test(org) ? 'FR-67' : 'FR', organisation: org || null, updateFrequency: 'hebdomadaire',
      attestation: `Service-Public.gouv.fr (DILA) le cite comme service en ligne officiel${org ? ` de « ${org} »` : ''} dans ${h.fiches.size} fiche${h.fiches.size > 1 ? 's' : ''}${h.titles[0] ? `, par exemple « ${h.titles[0]} »` : ''}.`.slice(0, 600),
      attestationUrl: `https://www.service-public.gouv.fr/particuliers/vosdroits/${fiche}`, lastSuccessAt: now, lastSyncAt: now, updatedAt: now };
    const e = byId.get(sourceId);
    if (!e) { await db.insert(SourceRegistryEntry).values({ sourceId, status: 'ACTIVE', ...values }).onConflictDoNothing(); added += 1; }
    else {
      const back = e.status === 'DISABLED' && !e.successorSourceId;   // replaced by a successor: stays retired
      if (back) restored += 1; else kept += 1;
      await db.update(SourceRegistryEntry).set({ ...values, status: back ? 'ACTIVE' : e.status, failureCount: 0, disabledAt: back ? null : e.disabledAt }).where(eq(SourceRegistryEntry.id, e.id));
    }
  }
  for (const e of existing) {
    if (seen.has(e.sourceId) || e.status !== 'ACTIVE') continue;
    const misses = (e.failureCount || 0) + 1;
    await db.update(SourceRegistryEntry).set({ failureCount: misses, lastSyncAt: now, updatedAt: now, ...(misses >= 2 ? { status: 'DISABLED', disabledAt: now } : {}) }).where(eq(SourceRegistryEntry.id, e.id));
    if (misses >= 2) retired += 1;
  }
  return { citedHosts: hosts.size, added, kept, restored, retired, rejectedCount: rejected.length, rejected: rejected.slice(0, 60) };
}

// ------------------------------------------------------------------------------------------------------------------------------- health
/**
 * The nightly health of a feed the chain reads (archive, Annuaire, SIRENE): answered or not, in how long, which version; a new version is the date of its last
 * change. @param {any} db @param {string} sourceId @param {{ ok: boolean, status?: number | null, ms?: number, version?: string | null, error?: string | null, detail?: any }} r
 */
export async function recordFeedHealth(db, sourceId, r, now = new Date()) {
  const [e] = await db.select().from(SourceRegistryEntry).where(eq(SourceRegistryEntry.sourceId, sourceId)).limit(1);
  if (!e) return null;
  const prev = e.health || {};
  const failures = r.ok ? 0 : (prev.consecutiveFailures || 0) + 1;
  const health = { ...prev, checkedAt: now.toISOString(), ok: r.ok, status: r.status ?? null, ms: r.ms ?? null, error: r.ok ? null : String(r.error || 'sans réponse').slice(0, 200),
    consecutiveFailures: failures, lastOkAt: r.ok ? now.toISOString() : prev.lastOkAt || null, outageSince: r.ok ? null : prev.outageSince || now.toISOString(), detail: r.detail ?? prev.detail ?? null };
  const changed = r.ok && r.version && r.version !== e.contentVersion;
  await db.update(SourceRegistryEntry).set({ health, lastSyncAt: now, ...(r.ok ? { lastSuccessAt: now } : {}), ...(changed ? { contentVersion: String(r.version).slice(0, 200), lastChangeAt: now } : {}), updatedAt: now })
    .where(eq(SourceRegistryEntry.id, e.id));
  return health;
}

/**
 * Monthly visit of the registry's sites, a few per night (the oldest visit first): reachable? moved?
 * @param {{ db: any, net: any, now?: Date, limit?: number, halted?: () => boolean, select?: (sourceId: string) => boolean }} p select: the sources to visit (tests)
 * Returns what was found: { visited, ok, moved, paused, failed, retired }.
 */
export async function reviewSources({ db, net, now = new Date(), limit = 30, halted = () => false, select = () => true }) {
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
  const rows = (await db.execute(sql`SELECT id, source_id AS "sourceId", endpoint, trusted_domains AS domains, status, health, redirects, connector_class AS cls FROM "SourceRegistryEntry"
    WHERE status IN ('ACTIVE', 'PAUSED', 'ERROR') AND (connector_class IN ('annuaire-attested', 'dila-attested') OR (connector_class = 'seed' AND type IN ('HTML_SCRAPER', 'CURATED')))
      AND (health IS NULL OR health->>'reviewedAt' IS NULL OR health->>'reviewedAt' < ${cutoff}) ORDER BY coalesce(health->>'reviewedAt', '') ASC, source_id LIMIT ${limit * 20}`)).rows
    .filter((r) => select(r.sourceId)).slice(0, limit);
  const all = await db.select({ id: SourceRegistryEntry.id, sourceId: SourceRegistryEntry.sourceId, d: SourceRegistryEntry.trustedDomains, status: SourceRegistryEntry.status }).from(SourceRegistryEntry);
  const out = { visited: 0, ok: 0, moved: 0, paused: 0, failed: 0, retired: 0 };
  for (const e of rows) {
    if (halted()) break;
    out.visited += 1;
    const domains = (e.domains || []).map((d) => String(d).toLowerCase());
    const url = e.endpoint || (domains[0] ? `https://${domains[0]}` : null); if (!url) continue;
    const prev = e.health || {}; const redirects = Array.isArray(e.redirects) ? e.redirects : [];
    const t0 = Date.now(); let patch = {}; let health = { ...prev, reviewedAt: now.toISOString() };
    try {
      const r = await officialGet(url, { ...net, maxBytes: 2 * 1024 * 1024, timeoutMs: 15000 });
      const finalHost = new URL(r.url).hostname.toLowerCase();
      health = { ...health, reviewOk: r.status < 400, reviewStatus: r.status, reviewMs: Date.now() - t0, reviewFailures: r.status < 400 ? 0 : (prev.reviewFailures || 0) + 1 };
      if (r.status < 400 && !hostIn(finalHost, domains)) {
        // moved to another TRUSTED site (the fetcher refuses any other redirect): the old address is replaced by its successor
        const successor = all.find((x) => x.id !== e.id && x.status === 'ACTIVE' && hostIn(finalHost, x.d || []));
        redirects.push({ from: url, to: r.url, at: now.toISOString() });
        patch = { redirects: redirects.slice(-10), ...(successor ? { successorSourceId: successor.sourceId, status: 'DISABLED', disabledAt: now } : {}) };
        out.moved += 1; if (successor) out.retired += 1;
      } else if (r.status < 400) { out.ok += 1; if (e.status !== 'ACTIVE') patch.status = 'ACTIVE'; }
      else { out.failed += 1; if (health.reviewFailures >= 3) patch.status = 'ERROR'; }
    } catch (err) {
      if (err instanceof SourceError && err.code === 'URL_REFUSED' && err.details?.url && err.details.url !== url) {
        // redirected to an address nobody attests: not trusted any more until a refresh attests it again
        redirects.push({ from: url, to: String(err.details.url).slice(0, 300), at: now.toISOString(), untrusted: true });
        health = { ...health, reviewOk: false, reviewError: 'redirection vers un site non attesté', reviewMs: Date.now() - t0 };
        patch = { redirects: redirects.slice(-10), status: 'PAUSED' }; out.paused += 1;
      } else {
        const failures = (prev.reviewFailures || 0) + 1;
        health = { ...health, reviewOk: false, reviewError: String(err?.code || err?.message || err).slice(0, 120), reviewMs: Date.now() - t0, reviewFailures: failures };
        out.failed += 1; if (failures >= 3) patch.status = 'ERROR';
      }
    }
    await db.update(SourceRegistryEntry).set({ ...patch, health, lastSyncAt: now, updatedAt: now }).where(eq(SourceRegistryEntry.id, e.id));
  }
  return out;
}

/** The hosts the chain may read and cite as evidence: the seed's domains and every ACTIVE attested site. @param {any} db */
export async function trustedDomains(db) {
  const rows = await db.select({ d: SourceRegistryEntry.trustedDomains }).from(SourceRegistryEntry).where(eq(SourceRegistryEntry.status, 'ACTIVE'));
  return [...new Set(rows.flatMap((r) => r.d || []).map((d) => String(d).toLowerCase()))];
}

/** Registry summary for the owner's digest. @param {any} db */
export async function registrySummary(db) {
  const rows = (await db.execute(sql`SELECT level, status, "connector_class" AS cls, count(*)::int AS n FROM "SourceRegistryEntry" GROUP BY 1, 2, 3`)).rows;
  return rows;
}
