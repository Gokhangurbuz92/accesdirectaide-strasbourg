// @ts-nocheck
import i18n from '@/i18n';
import { ensureCsrfHeaders, getCsrfHeaders } from './csrf';

const SEARCH_API_PATH = '/api/search';
const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 30;
const MIN_QUERY_LENGTH = 2;

export const SEARCH_CATEGORY_OPTIONS = [
  { value: 'papiers-citoyennete', label: 'Papiers - Citoyenneté' },
  { value: 'famille', label: 'Famille' },
  { value: 'social-sante', label: 'Social - Santé' },
  { value: 'personnes-agees', label: 'Personnes âgées' },
  { value: 'handicap', label: 'Handicap' },
  { value: 'travail-formation', label: 'Travail - Formation' },
  { value: 'logement', label: 'Logement' },
  { value: 'transports', label: 'Transports' },
  { value: 'argent', label: 'Argent - Impôts' },
  { value: 'justice', label: 'Justice' },
  { value: 'etranger', label: 'Étranger' },
  { value: 'loisirs', label: 'Loisirs - Sport - Culture' },
  { value: 'lgbtqi-plus', label: 'LGBTQI+' },
];

const SEARCH_CATEGORY_LOOKUP = Object.fromEntries(
  SEARCH_CATEGORY_OPTIONS.map((option) => [option.value, option.label])
);

/** @type {Record<string, string>} */
const LEGACY_CATEGORY_MAP = {
  logement: 'logement',
  sante: 'social-sante',
  handicap: 'handicap',
  emploi: 'travail-formation',
  famille: 'famille',
  etudes: 'travail-formation',
  mobilite: 'transports',
  energie: 'logement',
  alimentation: 'social-sante',
  justice: 'justice',
  numerique: 'travail-formation',
  autre: '',
  // Legacy uppercase
  LOGEMENT: 'logement',
  SANTE: 'social-sante',
  HANDICAP: 'handicap',
  EMPLOI: 'travail-formation',
  FAMILLE: 'famille',
  ETUDES: 'travail-formation',
  MOBILITE: 'transports',
  ENERGIE: 'logement',
  ALIMENTATION: 'social-sante',
  JUSTICE: 'justice',
  NUMERIQUE: 'travail-formation',
  AUTRE: '',
};

const activeControllers = new Map();

/** @param {unknown} scope */
function normalizeScope(scope) {
  if (!scope) return 'default';
  return String(scope);
}

/** @param {unknown} limit */
function clampLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  if (parsed < MIN_LIMIT) return MIN_LIMIT;
  if (parsed > MAX_LIMIT) return MAX_LIMIT;
  return parsed;
}

/** @param {Response} response */
async function parsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  const rawText = await response.text().catch(() => '');
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

/** @param {number} status @param {any} payload */
function buildErrorMessage(status, payload) {
  // PKG-11 audit: a security refusal used to show the server's raw English word (« Forbidden »)
  if (status === 401 || status === 403) return 'La recherche a été refusée par sécurité. Rechargez la page puis réessayez.';
  if (payload && typeof payload === 'object') {
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
  }
  if (status >= 500) {
    return 'Le service de recherche est temporairement indisponible.';
  }
  if (status === 400) {
    return 'La requête de recherche est invalide.';
  }
  return 'La recherche a échoué.';
}

/** @param {any} item */
function normalizeResultItem(item) {
  const normalizedCategory = normalizeSearchCategory(item?.category || item?.categorie);
  /** @param {any} value */
  const toOptionalNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    id: item?.id ? String(item.id) : '',
    slug: item?.slug ? String(item.slug) : '',
    title: item?.title || item?.titre || 'Aide',
    description: item?.description || item?.cest_quoi || item?.summary_falc || '',
    category: normalizedCategory || null,
    status: item?.status || null,
    score: toOptionalNumber(item?.score),
    lexicalScore: toOptionalNumber(item?.lexicalScore),
    semanticScore: toOptionalNumber(item?.semanticScore),
    citations: Array.isArray(item?.citations) ? item.citations : [],
  };
}

/** @param {any} payload */
function normalizeResponse(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const results = rawItems.map(normalizeResultItem);
  const totalFromPayload = Number(payload?.total);

  // Normalize additional result types from expanded search
  const demarches = Array.isArray(payload?.demarches) ? payload.demarches : [];
  const structures = Array.isArray(payload?.structures) ? payload.structures : [];
  const actualites = Array.isArray(payload?.actualites) ? payload.actualites : [];
  const guides = Array.isArray(payload?.guides) ? payload.guides : [];

  return {
    results,
    demarches,
    structures,
    actualites,
    guides,
    // R34: the danger signal of the server (emergency numbers to show first), or null
    safety: payload?.safety && Array.isArray(payload.safety.numbers) ? { kind: String(payload.safety.kind || ''), numbers: payload.safety.numbers.map(String) } : null,
    meta: {
      total: Number.isFinite(totalFromPayload) ? totalFromPayload : results.length,
      totalAll: (Number.isFinite(totalFromPayload) ? totalFromPayload : results.length) + demarches.length + structures.length + actualites.length + guides.length,
      message: typeof payload?.message === 'string' ? payload.message : null,
    },
    error: typeof payload?.error === 'string' ? payload.error : null,
  };
}

/** @param {AbortSignal | undefined} externalSignal @param {AbortController} controller */
function linkAbortSignal(externalSignal, controller) {
  if (!externalSignal) {
    return () => { };
  }

  const abortActiveController = () => controller.abort(externalSignal.reason);
  if (externalSignal.aborted) {
    abortActiveController();
    return () => { };
  }

  externalSignal.addEventListener('abort', abortActiveController, { once: true });
  return () => externalSignal.removeEventListener('abort', abortActiveController);
}

/** @param {unknown} value */
export function normalizeSearchCategory(value) {
  if (!value) return '';
  const rawValue = String(value).trim();
  if (!rawValue) return '';

  // Direct match in canonical lookup (slug-based)
  if (SEARCH_CATEGORY_LOOKUP[rawValue]) return rawValue;

  // Legacy mapping (e.g. 'LOGEMENT' → 'logement', 'sante' → 'social-sante')
  const legacyMappedValue = LEGACY_CATEGORY_MAP[rawValue];
  if (legacyMappedValue !== undefined) return legacyMappedValue;

  // Try lowercase
  const lower = rawValue.toLowerCase();
  if (SEARCH_CATEGORY_LOOKUP[lower]) return lower;
  const legacyLower = LEGACY_CATEGORY_MAP[lower];
  if (legacyLower !== undefined) return legacyLower;

  return '';
}

/** @param {unknown} categoryCode */
export function getSearchCategoryLabel(categoryCode) {
  const normalizedCategory = normalizeSearchCategory(categoryCode);
  return normalizedCategory ? (SEARCH_CATEGORY_LOOKUP[normalizedCategory] || 'Non classée') : 'Non classée';
}

/** @param {unknown} error */
export function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * @typedef {Object} SearchAidesParams
 * @property {string=} query
 * @property {string=} category
 * @property {string | string[]=} situations
 * @property {string=} geoScope
 * @property {string=} territory INSEE commune code (territory pre-filter)
 * @property {number=} limit
 * @property {AbortSignal=} signal
 * @property {string=} scope
 */

/** @param {SearchAidesParams=} params */
export async function searchAides(params = {}) {
  const {
    query,
    category,
    situations,
    geoScope,
    territory,
    limit = DEFAULT_LIMIT,
    signal,
    scope = 'aides-search',
  } = params;
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    throw new Error(`Veuillez saisir au moins ${MIN_QUERY_LENGTH} caractères.`);
  }

  const normalizedScope = normalizeScope(scope);
  const activeController = activeControllers.get(normalizedScope);
  if (activeController) activeController.abort();

  const controller = new AbortController();
  activeControllers.set(normalizedScope, controller);
  const detachAbortListener = linkAbortSignal(signal, controller);

  /** @type {Record<string, any>} */
  const payload = {
    query: normalizedQuery,
    limit: clampLimit(limit),
    lang: i18n.language || 'fr',   // R32: lets the server read a query typed in the interface language (cross-language search)
  };

  const normalizedCategory = normalizeSearchCategory(category);
  if (normalizedCategory) {
    payload.category = normalizedCategory;
  }

  const normalizedSituations = Array.isArray(situations)
    ? situations
    : situations
      ? [situations]
      : [];

  const cleanedSituations = normalizedSituations
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)
    .slice(0, 20);

  if (cleanedSituations.length > 0) {
    payload.situations = cleanedSituations;
  }

  const normalizedGeoScope = typeof geoScope === 'string' ? geoScope.trim() : '';
  if (normalizedGeoScope) {
    payload.geoScope = normalizedGeoScope;
  }
  const normalizedTerritory = typeof territory === 'string' ? territory.trim().toUpperCase() : '';
  if (/^(?:\d{5}|2[AB]\d{3})$/.test(normalizedTerritory)) payload.territory = normalizedTerritory;

  try {
    // PKG-11 audit: the search is a protected POST; before, no CSRF header was sent and every search from a real browser was refused (403).
    // On a first visit (no __csrf cookie yet) the server's refusal itself issues the cookie, so ONE retry with the new token is safe (no side effect).
    const send = () => fetch(SEARCH_API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // in a browser, make sure a CSRF token exists BEFORE the first search (a direct /recherche?q= link searches immediately on load)
    if (typeof document !== 'undefined') await ensureCsrfHeaders().catch(() => null);
    const before = getCsrfHeaders()['x-csrf-token'] || '';
    let response = await send();
    if (response.status === 403 && (getCsrfHeaders()['x-csrf-token'] || '') && (getCsrfHeaders()['x-csrf-token'] || '') !== before) response = await send();

    const parsedPayload = await parsePayload(response);
    if (!response.ok) {
      const error = new Error(buildErrorMessage(response.status, parsedPayload));
      error.status = response.status;
      // @ts-ignore
      error.payload = parsedPayload;
      throw error;
    }

    return normalizeResponse(parsedPayload);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('La recherche est temporairement indisponible.');
  } finally {
    detachAbortListener();
    if (activeControllers.get(normalizedScope) === controller) {
      activeControllers.delete(normalizedScope);
    }
  }
}

export function __resetSearchClientForTests() {
  for (const controller of activeControllers.values()) {
    controller.abort();
  }
  activeControllers.clear();
}
