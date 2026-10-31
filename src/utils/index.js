import slugify from '@sindresorhus/slugify';

/** @param {string} text */
export function toSlug(text) {
  if (!text) return '';
  return slugify(text, { lowercase: true, decamelize: false });
}

/** @param {string} slug */
export function fromSlug(slug) {
  if (!slug) return '';
  return slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** @type {Record<string, string>} */
const PAGE_URL_MAP = {
  Home: '/',
  Aides: '/aides',
  AideDetail: '/aide/view',
  Demarches: '/demarches',
  Annuaire: '/structures',   // R26: the canonical list of places (/annuaire answers 308 to it)
  Tools: '/outils',
  DemarcheDetail: '/demarches/view',
  StructureDetail: '/structures/view',
  Actualites: '/actualites',
  Contact: '/contact',
  MentionsLegales: '/mentions-legales',
  Confidentialite: '/politique-confidentialite',
  Cookies: '/cookies',
  AppointmentRequest: '/appointments/request',
  AdminAides: '/admin/aides',
  AdminAideEdit: '/admin/aides/:id',
  AdminDemarches: '/admin/demarches',
  AdminDemarcheEdit: '/admin/demarches/:id',
  AdminRecentSyncs: '/admin/sync/recent',
  AdminObservability: '/admin/observability',
  AdminReviewQueue: '/admin/review-queue',
};

/**
 * @param {string} routeTemplate
 * @param {Record<string, string>} [params]
 */
function fillRouteParams(routeTemplate, params = {}) {
  return routeTemplate.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
    const value = params[key];
    const normalizedValue = value === undefined || value === null || value === '' ? 'new' : String(value);
    return encodeURIComponent(normalizedValue);
  });
}

/**
 * @param {string | undefined} pageName
 * @param {Record<string, string>} [params]
 */
export function createPageUrl(pageName, params = {}) {
  const routeTemplate = PAGE_URL_MAP[/** @type {string} */ (pageName)];
  if (routeTemplate) {
    return fillRouteParams(routeTemplate, params);
  }
  return '/' + toSlug(/** @type {string} */ (pageName));
}
