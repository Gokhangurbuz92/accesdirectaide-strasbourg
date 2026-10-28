import { frontendEnv } from '@/config/env';

const DEFAULT_BASE_URL = 'https://www.accesdirectaide.fr';
const SITE_NAME = 'Accès Direct Aide';

/**
 * @typedef {{ name: string, url?: string }} BreadcrumbItem
 * @typedef {{ titre?: string, title?: string, slug?: string }} AideListItem
 * @typedef {{
 *  titre?: string,
 *  summary_falc?: string,
 *  cest_quoi?: string,
 *  description?: string,
 *  theme?: string,
 *  categorie?: string,
 *  territoires?: string[]
 * }} AideLike
 */

/** @param {string} path */
function sanitizePath(path) {
  const raw = String(path || '/').trim() || '/';
  const withoutHash = raw.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  if (!withoutQuery) return '/';
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

export function getRuntimeOrigin() {
  if (frontendEnv.runtime.vercelEnv === 'production') {
    return DEFAULT_BASE_URL;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const hostname = String(window.location.hostname || '').toLowerCase();
    if (hostname === 'accesdirectaide.fr' || hostname === 'www.accesdirectaide.fr') {
      return DEFAULT_BASE_URL;
    }
    return window.location.origin;
  }

  return DEFAULT_BASE_URL;
}

export function getCurrentPathname() {
  if (typeof window !== 'undefined' && window.location?.pathname) {
    return window.location.pathname || '/';
  }
  return '/';
}

/** @param {string} path */
export function buildCanonicalUrl(path = '/') {
  return `${getRuntimeOrigin()}${sanitizePath(path)}`;
}

/** @param {string} imagePath */
export function buildAbsoluteImageUrl(imagePath = '/og-default.webp') {
  const image = String(imagePath || '/og-default.webp');
  if (image.startsWith('http://') || image.startsWith('https://')) {
    return image;
  }
  const normalized = image.startsWith('/') ? image : `/${image}`;
  return `${getRuntimeOrigin()}${normalized}`;
}

/**
 * @param {string} value
 * @param {number} max
 */
export function truncateDescription(value, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

export function buildSiteSchema() {
  const origin = getRuntimeOrigin();
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: origin,
      inLanguage: 'fr-FR',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: origin,
    },
  ];
}

/** @param {BreadcrumbItem[]} items */
export function buildBreadcrumbSchema(items) {
  const origin = getRuntimeOrigin();
  if (!Array.isArray(items) || !items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => {
      const itemPath = item?.url || '/';
      return {
        '@type': 'ListItem',
        position: index + 1,
        name: item?.name || '',
        item: itemPath.startsWith('http') ? itemPath : `${origin}${sanitizePath(itemPath)}`,
      };
    }),
  };
}

/** @param {AideListItem[]} items */
export function buildAidesItemListSchema(items) {
  const origin = getRuntimeOrigin();
  if (!Array.isArray(items) || items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Aides',
    itemListElement: items.slice(0, 20).map((item, index) => {
      const slug = item?.slug ? sanitizePath(`/aides/${item.slug}`) : null;
      return {
        '@type': 'ListItem',
        position: index + 1,
        name: item?.titre || item?.title || `Aide ${index + 1}`,
        ...(slug ? { url: `${origin}${slug}` } : {}),
      };
    }),
  };
}

/**
 * @param {AideLike | null | undefined} aide
 * @param {string} canonicalPath
 */
export function buildAideDetailSchemas(aide, canonicalPath) {
  const title = aide?.titre || 'Aide';
  const description = truncateDescription(aide?.summary_falc || aide?.cest_quoi || aide?.description || 'Aide sociale');
  const pagePath = canonicalPath || '/aides';
  const canonicalUrl = buildCanonicalUrl(pagePath);
  const territories = Array.isArray(aide?.territoires) ? aide.territoires.filter(Boolean) : [];

  const breadcrumb = buildBreadcrumbSchema([
    { name: 'Accueil', url: '/' },
    { name: 'Aides', url: '/aides' },
    { name: title, url: pagePath },
  ]);

  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonicalUrl,
    mainEntity: {
      '@type': 'GovernmentService',
      name: title,
      description,
      serviceType: aide?.theme || aide?.categorie || 'Aide sociale',
      provider: {
        '@type': 'Organization',
        name: SITE_NAME,
      },
      ...(territories.length > 0
        ? {
          areaServed: territories.map((/** @type {string} */ territory) => ({
            '@type': 'AdministrativeArea',
            name: String(territory),
          })),
        }
        : {}),
    },
  };

  return [breadcrumb, webPage].filter(Boolean);
}
