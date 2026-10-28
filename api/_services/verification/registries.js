// @ts-nocheck
/**
 * Automatic verification chain — the two public registries that tell whether an organization still exists and where it is.
 *
 *  - SIRENE (INSEE), through the public API https://recherche-entreprises.api.gouv.fr: an establishment (SIRET) is open or closed, its exact address and commune
 *    code, whether the legal unit is an association (with its RNA number) and its FINESS numbers. The page a person can open as evidence is
 *    https://annuaire-entreprises.data.gouv.fr/etablissement/<siret>.
 *  - L'Annuaire de l'administration (DILA, Service-Public): public offices (CAF, CPAM, France Travail, mairies, France Services…) with address, telephones,
 *    opening hours and their official page on lannuaire.service-public.gouv.fr.
 * Both are open data, read without any account; only public organization data is sent (a SIRET, a name, a commune code).
 */
import { officialJson } from './fetcher.js';

const SIRENE = 'https://recherche-entreprises.api.gouv.fr/search';
const ANNUAIRE = 'https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records';

export const digits = (s) => String(s || '').replace(/\D/g, '');

/** @param {any} etab @param {any} unit */
function establishment(etab, unit) {
  const closed = etab.etat_administratif !== 'A' || Boolean(etab.date_fermeture);
  return {
    siret: etab.siret, open: !closed, closedAt: etab.date_fermeture || null,
    name: unit?.nom_complet || null, sign: Array.isArray(etab.liste_enseignes) && etab.liste_enseignes.length ? etab.liste_enseignes[0] : (etab.nom_commercial || null),
    address: etab.adresse || null, postalCode: etab.code_postal || null, communeInsee: etab.commune || null, city: etab.libelle_commune || null,
    latitude: etab.latitude ? Number(etab.latitude) : null, longitude: etab.longitude ? Number(etab.longitude) : null,
    legalUnitOpen: unit?.etat_administratif === 'A', isAssociation: Boolean(unit?.complements?.est_association), rna: unit?.complements?.identifiant_association || null,
    finess: etab.liste_finess || unit?.complements?.liste_finess || null, legalForm: unit?.nature_juridique || null, registryUpdatedAt: unit?.date_mise_a_jour || null,
    evidenceUrl: `https://annuaire-entreprises.data.gouv.fr/etablissement/${etab.siret}`,
  };
}

/**
 * One establishment by its SIRET. { found: false } when the registry does not know it (a wrong or obsolete number).
 * @param {string} siret @param {{ fetchImpl?: typeof fetch, env?: any }} [opts]
 */
export async function lookupSiret(siret, opts = {}) {
  const s = digits(siret);
  if (s.length !== 14) return { found: false, reason: 'SIRET_INVALIDE', siret: s };
  const { json, fetchedAt } = await officialJson(`${SIRENE}?q=${s}&per_page=1`, opts);
  const unit = (json.results || [])[0];
  const etab = unit && (unit.matching_etablissements || []).find((e) => digits(e.siret) === s);
  if (!etab) return { found: false, reason: 'SIRET_INCONNU', siret: s, fetchedAt };
  return { found: true, fetchedAt, ...establishment(etab, unit) };
}

/**
 * Candidate establishments for an organization without a SIRET: a name, in a postal code. The caller decides (a single strong match only).
 * @param {string} name @param {{ postalCode?: string }} where @param {{ fetchImpl?: typeof fetch, env?: any }} [opts]
 */
export async function searchEstablishments(name, where = {}, opts = {}) {
  const q = String(name || '').trim().slice(0, 120);
  if (q.length < 3) return { candidates: [] };
  const cp = digits(where.postalCode).slice(0, 5);
  const { json, fetchedAt } = await officialJson(`${SIRENE}?q=${encodeURIComponent(q)}${cp ? `&code_postal=${cp}` : ''}&per_page=5`, opts);
  const candidates = [];
  for (const unit of json.results || []) {
    for (const etab of unit.matching_etablissements || []) if (!cp || etab.code_postal === cp) candidates.push(establishment(etab, unit));
  }
  return { candidates: candidates.slice(0, 10), fetchedAt };
}

const parseJsonField = (v) => { if (Array.isArray(v)) return v; try { const p = JSON.parse(String(v || '[]')); return Array.isArray(p) ? p : []; } catch { return []; } };
const frDate = (s) => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/** @param {any} r */
function office(r) {
  const addr = parseJsonField(r.adresse).find((a) => a.type_adresse === 'Adresse') || parseJsonField(r.adresse)[0] || {};
  return {
    id: r.id, name: r.nom, address: [addr.numero_voie, addr.complement2 && addr.complement2 !== addr.numero_voie ? addr.complement2 : null].filter(Boolean).join(', ') || null,
    postalCode: addr.code_postal || null, city: addr.nom_commune || null, communeInsee: r.code_insee_commune || null,
    phones: parseJsonField(r.telephone).map((t) => ({ number: t.valeur, note: t.description || null })), email: r.adresse_courriel || null,
    website: (parseJsonField(r.site_internet)[0] || {}).valeur || null, hours: parseJsonField(r.plage_ouverture), siret: r.siret || null,
    types: parseJsonField(r.pivot).map((p) => p.type_service_local).filter(Boolean), updatedAt: frDate(r.date_modification), evidenceUrl: r.url_service_public || null,
  };
}

/**
 * Public offices of a commune whose name matches. @param {{ text: string, communeInsee?: string, limit?: number }} q
 * @param {{ fetchImpl?: typeof fetch, env?: any }} [opts]
 */
export async function searchPublicOffices(q, opts = {}) {
  const text = String(q.text || '').replace(/["\\]/g, ' ').trim().slice(0, 100);
  if (text.length < 2) return { offices: [] };
  const where = [`search(nom,"${text}")`, q.communeInsee ? `code_insee_commune="${digits(q.communeInsee).slice(0, 5)}"` : null].filter(Boolean).join(' and ');
  const { json, fetchedAt } = await officialJson(`${ANNUAIRE}?where=${encodeURIComponent(where)}&limit=${Math.min(Number(q.limit) || 5, 20)}`, opts);
  return { offices: (json.results || []).map(office), fetchedAt };
}
