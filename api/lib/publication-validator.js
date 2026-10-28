// @ts-nocheck
/**
 * Publication quality validation utilities
 *
 * Implements quality gates to prevent publishing incomplete or stale content
 */

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 6 * ONE_MONTH_MS;
const TWELVE_MONTHS_MS = 12 * ONE_MONTH_MS;

/**
 * Validation result structure
 */
class ValidationResult {
  constructor() {
    this.canPublish = true;
    /**
     * @type {{ field: string; message: string; }[]}
     */
    this.errors = [];
    /**
     * @type {{ field: string; message: string; }[]}
     */
    this.warnings = [];
  }

  /** @param {string} field @param {string} message */
  addError(field, message) {
    this.errors.push({ field, message });
    this.canPublish = false;
  }

  /** @param {string} field @param {string} message */
  addWarning(field, message) {
    this.warnings.push({ field, message });
  }

  get isValid() {
    return this.canPublish && this.errors.length === 0;
  }
}

/**
 * Validate required fields for publication
 */
/** @param {any} content @param {string} contentType */
function validateRequiredFields(content, contentType) {
  const result = new ValidationResult();

  // Common required fields for all content types
  if (!content.source_url || content.source_url.trim() === '') {
    result.addError('source_url', 'URL source obligatoire pour la publication');
  }

  if (!content.summary_falc || content.summary_falc.trim() === '') {
    result.addError('summary_falc', 'Résumé FALC obligatoire pour la publication');
  }

  // Content-type specific validations
  switch (contentType) {
    case 'aide':
      if (!content.titre || content.titre.trim() === '') {
        result.addError('titre', 'Titre obligatoire');
      }
      if (!content.pour_qui || content.pour_qui.trim() === '') {
        result.addError('pour_qui', 'Champ "Pour qui ?" obligatoire');
      }
      break;

    case 'demarche':
      if (!content.titre || content.titre.trim() === '') {
        result.addError('titre', 'Titre obligatoire');
      }
      if (!content.pour_qui || content.pour_qui.trim() === '') {
        result.addError('pour_qui', 'Champ "Pour qui ?" obligatoire');
      }
      break;

    case 'structure':
      if (!content.nom || content.nom.trim() === '') {
        result.addError('nom', 'Nom de la structure obligatoire');
      }
      if (!content.ville || content.ville.trim() === '') {
        result.addError('ville', 'Ville obligatoire');
      }
      if (!content.adresse || content.adresse.trim() === '') {
        result.addWarning('adresse', 'Adresse recommandée pour une meilleure visibilité');
      }
      break;

    case 'actualite':
      if (!content.titre || content.titre.trim() === '') {
        result.addError('titre', 'Titre obligatoire');
      }
      if (!content.contenu || content.contenu.trim() === '') {
        result.addError('contenu', 'Contenu obligatoire');
      }
      break;
  }

  return result;
}

/**
 * Validate content freshness
 */
/** @param {any} content */
function validateFreshness(content) {
  const result = new ValidationResult();
  const now = Date.now();

  // Check last verification date
  if (content.date_verification || content.last_checked_at) {
    const lastChecked = new Date(content.date_verification || content.last_checked_at).getTime();
    const age = now - lastChecked;

    if (age > TWELVE_MONTHS_MS) {
      result.addError(
        'date_verification',
        'Information non vérifiée depuis plus de 12 mois - vérification obligatoire avant publication'
      );
    } else if (age > SIX_MONTHS_MS) {
      result.addWarning(
        'date_verification',
        'Information non vérifiée depuis plus de 6 mois - vérification recommandée'
      );
    }
  } else {
    result.addWarning(
      'date_verification',
      'Aucune date de vérification - recommandé de vérifier avant publication'
    );
  }

  return result;
}

/**
 * Validate source URL accessibility
 */
/** @param {any} content */
function validateSourceUrl(content) {
  const result = new ValidationResult();

  if (!content.source_url) {
    return result; // Already checked in required fields
  }

  try {
    const url = new URL(content.source_url);

    // Check for valid protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      result.addError('source_url', 'URL source doit utiliser HTTP ou HTTPS');
    }

    // Warning for non-HTTPS
    if (url.protocol === 'http:') {
      result.addWarning('source_url', 'Préférez HTTPS pour la source');
    }

    // Check for localhost/private IPs (shouldn't be public)
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.match(/^172\.(1[6-9]|2\d|3[01])\./)
    ) {
      result.addError('source_url', 'URL source ne peut pas être une adresse locale/privée');
    }
  } catch (error) {
    result.addError('source_url', 'URL source invalide : ' + error.message);
  }

  return result;
}

/**
 * Validate content completeness (quality score)
 */
/** @param {any} content @param {string} contentType */
function validateCompleteness(content, contentType) {
  const result = new ValidationResult();
  let missingFields = 0;

  // Count critical missing fields based on content type
  switch (contentType) {
    case 'aide':
      if (!content.cest_quoi) missingFields++;
      if (!content.ce_que_ca_aide) missingFields++;
      if (!content.ou_demander) missingFields++;
      if (!content.lien_demande && !content.apply_url) missingFields++;
      if (!content.documents_necessaires || content.documents_necessaires.length === 0)
        missingFields++;

      if (missingFields >= 3) {
        result.addWarning(
          'completeness',
          `${missingFields} champs importants manquants - complétez la fiche pour améliorer l'expérience utilisateur`
        );
      }
      break;

    case 'structure':
      if (!content.telephone && !content.email && !content.site_web) {
        result.addError(
          'contact',
          'Au moins un moyen de contact obligatoire (téléphone, email ou site web)'
        );
      }
      if (!content.horaires) {
        result.addWarning('horaires', 'Horaires d\'ouverture recommandés');
      }
      if (!content.description_courte) {
        result.addWarning('description_courte', 'Description courte recommandée');
      }
      break;
  }

  return result;
}

/**
 * Validate territory scope consistency
 */
/** @param {any} content */
function validateTerritoryScope(content) {
  const result = new ValidationResult();

  if (!content.territory_scope) {
    result.addWarning(
      'territory_scope',
      'Périmètre territorial non défini - sera traité comme national par défaut'
    );
    return result;
  }

  const validScopes = ['NATIONAL', 'REGIONAL', 'DEPARTMENTAL', 'COMMUNAL'];
  if (!validScopes.includes(content.territory_scope)) {
    result.addError('territory_scope', `Périmètre territorial invalide : ${content.territory_scope}`);
    return result;
  }

  // Validate that corresponding codes are present
  switch (content.territory_scope) {
    case 'REGIONAL':
      if (!content.region_codes || content.region_codes.length === 0) {
        result.addError('region_codes', 'Codes région obligatoires pour périmètre REGIONAL');
      }
      break;

    case 'DEPARTMENTAL':
      if (!content.department_codes || content.department_codes.length === 0) {
        result.addError('department_codes', 'Codes département obligatoires pour périmètre DEPARTMENTAL');
      }
      break;

    case 'COMMUNAL':
      if (!content.insee_codes || content.insee_codes.length === 0) {
        result.addError('insee_codes', 'Codes INSEE obligatoires pour périmètre COMMUNAL');
      }
      break;
  }

  return result;
}

/**
 * Main validation function - combines all validators
 *
 * @param {Object} content - The content to validate
 * @param {string} contentType - Type: 'aide', 'demarche', 'structure', 'actualite'
 * @returns {ValidationResult} Combined validation result
 */
export function validateForPublication(content, contentType) {
  const finalResult = new ValidationResult();

  // Run all validators
  const validators = [
    validateRequiredFields(content, contentType),
    validateFreshness(content),
    validateSourceUrl(content),
    validateCompleteness(content, contentType),
    validateTerritoryScope(content),
  ];

  // Combine results
  validators.forEach((validationResult) => {
    finalResult.errors.push(...validationResult.errors);
    finalResult.warnings.push(...validationResult.warnings);
    if (!validationResult.canPublish) {
      finalResult.canPublish = false;
    }
  });

  return finalResult;
}

/**
 * Generate a human-readable validation report
 */
/** @param {ValidationResult} validationResult */
export function generateValidationReport(validationResult) {
  const lines = [];

  if (validationResult.isValid) {
    lines.push('✅ Tous les critères de publication sont respectés');
  } else {
    lines.push('❌ Publication bloquée - corrections nécessaires');
  }

  if (validationResult.errors.length > 0) {
    lines.push('\n🚫 ERREURS (bloquantes) :');
    validationResult.errors.forEach((/** @type {{ field: string, message: string }} */ error) => {
      lines.push(`   - [${error.field}] ${error.message}`);
    });
  }

  if (validationResult.warnings.length > 0) {
    lines.push('\n⚠️  AVERTISSEMENTS (non bloquants) :');
    validationResult.warnings.forEach((/** @type {{ field: string, message: string }} */ warning) => {
      lines.push(`   - [${warning.field}] ${warning.message}`);
    });
  }

  return lines.join('\n');
}

export default {
  validateForPublication,
  generateValidationReport,
  ValidationResult,
};
