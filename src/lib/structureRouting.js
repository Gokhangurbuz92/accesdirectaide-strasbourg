// @ts-nocheck
/**
 * DTA S3A — honest structure shortlist for a plan step (PURE: no I/O).
 * Contract: PRODUCT_FLOW_CONTRACT (structure selection by the person, never by ADA) + N8/N17 (territory/service applicability is data, and the data is UNVERIFIED).
 *  - the shortlist is built ONLY from the organism the assessment already names (`whoToAsk`) and ONLY by NAME correspondence; it never says a structure is suitable, eligible or open to the person;
 *  - ADA has no verified service area, public or opening data (ws2-source-manifest: Structure UNVERIFIED), so the notice says so and asks the person to check;
 *  - no structure id, contact detail, availability or appointment is created here: the person opens a structure page and any booking happens there, bound to the structure they chose;
 *  - when nothing matches (or the organism is generic) the result is an explicit limitation plus safe internal alternatives.
 */
export const ROUTING_NOTICE = 'Correspondance par le nom uniquement. ADA ne sait pas si cette structure dessert votre commune, traite votre demande ou est ouverte : renseignez-vous auprès d\'elle. Données en cours de vérification.';
/** Shown next to a structure that has published online appointments on ADA (its own configuration, not a judgement of suitability); the booking itself starts on that structure's page. */
export const RDV_ONLINE_LABEL = 'Rendez-vous en ligne proposés sur ADA (à confirmer sur sa page)';
/** PKG-11 / E04: when a structure is listed because of a SERVICE it declares (not its name), the notice says so. */
export const ROUTING_NOTICE_SERVICES = 'Correspondance par le nom ou par un service que la structure indique proposer. ADA ne sait pas si cette structure dessert votre commune, traite votre demande ou est ouverte : renseignez-vous auprès d\'elle. Données en cours de vérification.';
export const NO_MATCH_NOTICE = 'ADA n\'a pas de structure à vous proposer pour cette étape. Ce n\'est pas un refus : vous pouvez chercher vous-même dans l\'annuaire.';
export const ALTERNATIVES = Object.freeze([
  { to: '/structures', label: 'Parcourir l\'annuaire des structures' },
  { to: '/structures?type=france_services', label: 'Chercher un espace France Services' },
  { to: '/ressources?emergency=1', label: 'Ressources d\'urgence' },
]);

const ORGANISMS = Object.freeze([
  { key: 'CAF', ask: /\bCAF\b/, nameMatch: /\bCAF\b|allocations?\s+familiales?/i, query: 'CAF' },
]);

/** @param {unknown} who the `whoToAsk` text of a verify step @returns {{key:string, query:string}|null} */
export function organismQuery(who) {
  const w = typeof who === 'string' ? who : '';
  const o = ORGANISMS.find((x) => x.ask.test(w));
  return o ? { key: o.key, query: o.query } : null;
}

/**
 * @param {unknown} who
 * @param {unknown} structures raw directory items ({ id, slug, nom, ville, ... }); anything else is ignored
 * @returns {{ mode: 'MATCHED'|'NONE', organism: string|null, structures: Array<{ id: string, slug: string|null, nom: string, ville: string|null, rdvOnline: boolean }>, notice: string, alternatives: typeof ALTERNATIVES }}
 */
export function routeStructures(who, structures) {
  const o = ORGANISMS.find((x) => x.ask.test(typeof who === 'string' ? who : ''));
  const list = Array.isArray(structures) ? structures : [];
  const picked = [];
  if (o) {
    const seen = new Set();
    for (const s of list) {
      const nom = s && typeof s.nom === 'string' ? s.nom.trim() : '';
      const id = s && (typeof s.id === 'string' || typeof s.id === 'number') ? String(s.id) : '';
      const slug = s && typeof s.slug === 'string' ? s.slug.trim() : '';
      // PKG-11 / E04: a structure whose declared service names the organism is also listed, with that service shown (« indique proposer »)
      const service = !o.nameMatch.test(nom) && Array.isArray(s?.services) ? s.services.find((/** @type {unknown} */ x) => typeof x === 'string' && o.nameMatch.test(x)) : null;
      if (!nom || !id || !slug || seen.has(id) || (!o.nameMatch.test(nom) && !service)) continue;
      seen.add(id);
      picked.push({ id, slug, nom, ville: typeof s.ville === 'string' && s.ville ? s.ville : null, rdvOnline: s.is_pro_enabled === true, ...(service ? { service } : {}) });
      if (picked.length === 5) break;
    }
  }
  return picked.length
    ? { mode: 'MATCHED', organism: o.key, structures: picked, notice: picked.some((x) => x.service) ? ROUTING_NOTICE_SERVICES : ROUTING_NOTICE, alternatives: ALTERNATIVES }
    : { mode: 'NONE', organism: o ? o.key : null, structures: [], notice: NO_MATCH_NOTICE, alternatives: ALTERNATIVES };
}

/** Internal route of a structure page (the booking, when the structure offers it, starts there). Returns null without a slug: no route is ever invented from an id. */
export function structurePath(s) {
  return s && typeof s.slug === 'string' && s.slug ? `/structures/${encodeURIComponent(s.slug)}` : null;
}
