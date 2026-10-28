/**
 * API response types for AccesDirectAide.
 *
 * These types mirror the shapes actually returned by the backend
 * (see api/_handlers/aides.js + api/lib/search-query.js).
 *
 * ⚠️  Do NOT invent fields — every key here was confirmed in the
 *     handler / enrichment code.
 */

// ---------------------------------------------------------------------------
// Provenance (attached to every item by buildProvenance)
// ---------------------------------------------------------------------------

export interface ApiProvenance {
    verifiedAt: string | null;
    fetchedAt: string | null;
    sourceUrl: string | null;
    sourceHost: string | null;
}

// ---------------------------------------------------------------------------
// Aide — List item (lightweight, returned by search/list endpoint)
// ---------------------------------------------------------------------------

export interface ApiAideListItem {
    id: string;
    slug: string | null;
    titre: string;
    categorie: string | null;
    theme: string | null;
    sub_theme: string | null;
    cest_quoi: string | null;
    summary_falc: string | null;
    est_urgent: boolean;
    territoires: string[];
    date_verification: string | null;
    quality_score: number;
    published_at: string | null;
    updatedAt: string;
    providerName: string | null;
    source_name: string | null;
    source_org: string | null;
    source_url: string | null;
    fetched_at: string | null;
    provenance: ApiProvenance;
    /** Only present when searching with `q` */
    rank?: number;
}

// ---------------------------------------------------------------------------
// Aide — Detail (full object, returned by /api/aides/:slug)
// ---------------------------------------------------------------------------

export interface ApiAideCategory {
    id: string;
    slug: string;
    label: string;
}

export interface ApiAideSituation {
    id: string;
    code: string;
    label: string;
    description?: string | null;
}

export interface ApiAideSituationRelation {
    id: string;
    situation: ApiAideSituation;
}

export interface ApiAideDetail {
    id: string;
    slug: string | null;
    titre: string;
    categorie: string | null;
    theme: string | null;
    sub_theme: string | null;
    est_urgent: boolean;
    territoires: string[];
    date_verification: string | null;
    delai_indicatif: string | null;
    cest_quoi: string | null;
    pour_qui: string | null;
    ce_que_ca_aide: string | null;
    documents_necessaires: string[];
    etapes: unknown | null;
    ou_demander: string | null;
    lien_demande: string | null;
    updatedAt: string;
    statut: string;
    quality_score: number;
    published_at: string | null;
    mots_cles: string[];
    summary_falc: string | null;
    audiences: string[];
    conditions_falc: string | null;
    montant_falc: string | null;
    situations_vie: string[];
    providerName: string | null;
    source_name: string | null;
    source_org: string | null;
    source_url: string | null;
    fetched_at: string | null;
    category: ApiAideCategory | null;
    situations: Array<{ id: string; slug: string; label: string }>;
    aidSituations: ApiAideSituationRelation[];
    provenance: ApiProvenance;
}

// ---------------------------------------------------------------------------
// Pagination & Facets
// ---------------------------------------------------------------------------

export interface ApiPagination {
    total: number;
    page: number;
    limit: number;
    pageSize: number;
    totalPages: number;
    hasNext: boolean;
}

export interface ApiFacets {
    themes: Record<string, number>;
    organismes: Record<string, number>;
    publics: Record<string, number>;
    territoires: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Composed response (list endpoint)
// ---------------------------------------------------------------------------

export interface ApiAidesListResponse {
    items: ApiAideListItem[];
    pagination: ApiPagination;
    facets: ApiFacets;
}

// ---------------------------------------------------------------------------
// Error shape (thrown by client.ts)
// ---------------------------------------------------------------------------

export interface ApiError {
    status: number;
    message: string;
    body?: unknown;
}
