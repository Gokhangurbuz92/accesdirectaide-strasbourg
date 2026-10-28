/**
 * @ada/shared — Constantes métier
 *
 * Miroir des enums pour usage côté client (source: src/db/schema.ts)
 * Source de vérité : src/db/schema.ts
 */

// ─────────────────────────────────────────────────
// Catégories d'aides
// ─────────────────────────────────────────────────
export const AID_CATEGORIES = /** @type {const} */ ({
    LOGEMENT: 'LOGEMENT',
    SANTE: 'SANTE',
    HANDICAP: 'HANDICAP',
    EMPLOI: 'EMPLOI',
    FAMILLE: 'FAMILLE',
    ETUDES: 'ETUDES',
    MOBILITE: 'MOBILITE',
    ENERGIE: 'ENERGIE',
    ALIMENTATION: 'ALIMENTATION',
    JUSTICE: 'JUSTICE',
    NUMERIQUE: 'NUMERIQUE',
    AUTRE: 'AUTRE',
});

export const AID_CATEGORY_LABELS = /** @type {const} */ ({
    LOGEMENT: 'Logement',
    SANTE: 'Santé',
    HANDICAP: 'Handicap',
    EMPLOI: 'Emploi',
    FAMILLE: 'Famille',
    ETUDES: 'Études',
    MOBILITE: 'Mobilité',
    ENERGIE: 'Énergie',
    ALIMENTATION: 'Alimentation',
    JUSTICE: 'Justice',
    NUMERIQUE: 'Numérique',
    AUTRE: 'Autre',
});

// ─────────────────────────────────────────────────
// Statuts
// ─────────────────────────────────────────────────
export const AID_STATUSES = /** @type {const} */ ({
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED',
    ARCHIVED: 'ARCHIVED',
});

export const CONTENT_STATUSES = /** @type {const} */ ({
    BROUILLON: 'brouillon',
    PUBLIE: 'publie',
    ARCHIVE: 'archive',
});

// ─────────────────────────────────────────────────
// Types de contenu
// ─────────────────────────────────────────────────
export const CONTENT_TYPES = /** @type {const} */ ({
    AIDE: 'AIDE',
    DEMARCHE: 'DEMARCHE',
    STRUCTURE: 'STRUCTURE',
    ACTUALITE: 'ACTUALITE',
});

// ─────────────────────────────────────────────────
// Motifs de signalement
// ─────────────────────────────────────────────────
export const REPORT_REASONS = /** @type {const} */ ({
    LIEN_MORT: 'LIEN_MORT',
    HORAIRES_FAUX: 'HORAIRES_FAUX',
    INFO_FAUSSE: 'INFO_FAUSSE',
    INFO_OBSOLETE: 'INFO_OBSOLETE',
    AUTRE: 'AUTRE',
});

export const REPORT_STATUSES = /** @type {const} */ ({
    NEW: 'NEW',
    IN_PROGRESS: 'IN_PROGRESS',
    FIXED: 'FIXED',
    REJECTED: 'REJECTED',
});

// ─────────────────────────────────────────────────
// Rendez-vous
// ─────────────────────────────────────────────────
export const RDV_BOOKING_MODES = /** @type {const} */ ({
    IN_PERSON: 'IN_PERSON',
    VIDEO: 'VIDEO',
    BOTH: 'BOTH',
});

export const APPOINTMENT_STATUSES = /** @type {const} */ ({
    REQUESTED: 'requested',
    BOOKED: 'booked',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    NO_SHOW: 'no_show',
});

// ─────────────────────────────────────────────────
// Ingestion
// ─────────────────────────────────────────────────
export const INGEST_JOB_STATUSES = /** @type {const} */ ({
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    ERROR: 'ERROR',
});

export const DATA_SOURCES = /** @type {const} */ ({
    AIDES_TERRITOIRES: 'Aides-Territoires',
    SCRAPING: 'Scraping',
    OPENFISCA: 'OpenFisca',
    DREES: 'DREES',
    FINESS: 'FINESS',
    RNA: 'RNA',
    SERVICE_PUBLIC: 'Service-Public.fr',
    RSS: 'RSS',
});

// ─────────────────────────────────────────────────
// Territoires
// ─────────────────────────────────────────────────
export const TERRITORY_SCOPES = /** @type {const} */ ({
    NATIONAL: 'NATIONAL',
    REGIONAL: 'REGIONAL',
    DEPARTMENTAL: 'DEPARTMENTAL',
    COMMUNAL: 'COMMUNAL',
});

// ─────────────────────────────────────────────────
// Rôles
// ─────────────────────────────────────────────────
export const USER_ROLES = /** @type {const} */ ({
    ADMIN: 'admin',
    PRO_ADMIN: 'admin',
    PRO_AGENT: 'agent',
    CITIZEN: 'citizen',
});
