/**
 * ClassificationService — Deterministic intent classification
 *
 * Migrates classifier.js taxonomy into a deterministic keyword/rule-based classifier.
 * No LLM calls. The Router uses this first; LLM classification is only a fallback.
 */

// Taxonomy from existing classifier.js — canonical categories
export const CATEGORIES = [
  'EMPLOI', 'LOGEMENT', 'SANTE', 'FAMILLE', 'HANDICAP',
  'ETUDES', 'MOBILITE', 'ENERGIE', 'ALIMENTATION', 'NUMERIQUE',
  'JUSTICE', 'SENIORS'
];

export const AUDIENCES = [
  'JEUNES', 'SENIORS', 'FAMILLES', 'HANDICAP',
  'DEMANDEURS_EMPLOI', 'SALARIES', 'ETUDIANTS', 'TOUS'
];

// Intent types for routing
export const INTENTS = [
  'ORIENTATION', 'ELIGIBILITY', 'PROCEDURE', 'DOCUMENT',
  'FALC', 'STRUCTURE_SEARCH', 'SAFETY_ABSTENTION'
];

// Deterministic keyword patterns for intent classification
const INTENT_PATTERNS = {
  FALC: {
    keywords: ['falc', 'facile à lire', 'simplifier', 'simplification', 'langage simple', 'facile à comprendre', 'simplifié'],
    confidence: 0.95
  },
  DOCUMENT: {
    keywords: ['courrier', 'lettre', 'document', 'notification', 'attestation', 'certificat', 'reçu', "j'ai reçu", 'comprendre ce document', 'que signifie', 'expliquer ce courrier', 'résumer ce document', 'cette lettre', 'facture'],
    confidence: 0.90
  },
  PROCEDURE: {
    keywords: ['comment faire', 'démarche', 'procédure', 'étapes', 'formulaire', 'dossier', 'demande de', 'demander', 'où faire', 'comment demander', 'comment obtenir', 'où s\'inscrire', 'inscription'],
    confidence: 0.85
  },
  ELIGIBILITY: {
    keywords: ['éligible', 'droit à', 'ai-je droit', 'puis-je bénéficier', 'conditions', 'critères', 'montant', 'combien', 'qui peut', 'suis-je éligible', 'bénéficier de', 'puis-je toucher', 'barème'],
    confidence: 0.85
  },
  STRUCTURE_SEARCH: {
    keywords: ['où se trouve', 'adresse', 'structure', 'accueil', 'guichet', 'organisme', 'bureau', 'centre', 'antenne', 'proche de', 'près de', 'trouver un'],
    confidence: 0.85
  },
  ORIENTATION: {
    keywords: ['aide', 'aides', 'quelles aides', 'besoin', 'situation', 'perdu', 'difficulté', 'problème', 'cherche', 'orienter', 'conseiller', 'soutien financier', 'pas d\'argent', 'aide pour'],
    confidence: 0.80
  }
};

// Category keyword patterns for aide classification
const CATEGORY_PATTERNS = {
  EMPLOI: ['emploi', 'travail', 'chômage', 'formation professionnelle', 'insertion', 'pôle emploi', 'france travail', 'contrat', 'cdd', 'cdi', 'intérim', 'apprentissage professionnel'],
  LOGEMENT: ['logement', 'loyer', 'hébergement', 'rénovation', 'apl', 'hlm', 'expulsion', 'locataire', 'propriétaire', 'habitation', 'bail'],
  SANTE: ['santé', 'soins', 'mutuelle', 'médecin', 'hôpital', 'maladie', 'css', 'complémentaire santé', 'pharmacie', 'traitement'],
  FAMILLE: ['famille', 'enfant', 'enfants', 'garde', 'parentalité', 'naissance', 'allocations familiales', 'crèche', 'scolarité'],
  HANDICAP: ['handicap', 'aah', 'rqth', 'accessibilité', 'mdph', 'invalidité', 'incapacité', 'pch', 'aeeh'],
  ETUDES: ['études', 'étudiant', 'bourse', 'université', 'formation', 'diplôme', 'école', 'apprentissage', 'crous', 'erasmus'],
  MOBILITE: ['transport', 'mobilité', 'permis', 'véhicule', 'voiture', 'bus', 'train', 'déplacement', 'covoiturage'],
  ENERGIE: ['énergie', 'électricité', 'gaz', 'chauffage', 'facture', 'rénovation énergétique', 'isolation', 'chèque énergie', 'maprimerénov'],
  ALIMENTATION: ['alimentation', 'alimentaire', 'cantine', 'épicerie sociale', 'banque alimentaire', 'repas', 'nourriture'],
  NUMERIQUE: ['numérique', 'ordinateur', 'internet', 'digital', 'informatique', 'tablette', 'connexion'],
  JUSTICE: ['justice', 'juridique', 'avocat', 'tribunal', 'aide juridictionnelle', 'droits', 'litige', 'plainte'],
  SENIORS: ['senior', 'retraite', 'dépendance', 'apa', 'ehpad', 'personne âgée', 'vieillesse', 'aspa']
};

/**
 * Classify user intent deterministically using keyword matching.
 * @param {string} text - User input text
 * @returns {{ intent: string, confidence: number, method: 'DETERMINISTIC', categories: string[], matchedKeywords: string[] }}
 */
export function classifyIntent(text) {
  if (!text || typeof text !== 'string') {
    return { intent: 'SAFETY_ABSTENTION', confidence: 0, method: 'DETERMINISTIC', categories: [], matchedKeywords: [] };
  }

  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let bestIntent = null;
  let bestConfidence = 0;
  /**
   * @type {string[]}
   */
  let bestKeywords = [];

  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    const matched = pattern.keywords.filter(kw => {
      const normalizedKw = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return normalized.includes(normalizedKw);
    });
    if (matched.length > 0) {
      // Score: base confidence + bonus for multiple keyword matches
      const score = Math.min(pattern.confidence + (matched.length - 1) * 0.05, 1.0);
      if (score > bestConfidence) {
        bestConfidence = score;
        bestIntent = intent;
        bestKeywords = matched;
      }
    }
  }

  // Map STRUCTURE_SEARCH to ORIENTATION (handled by OrientationSpecialist with structure tool)
  if (bestIntent === 'STRUCTURE_SEARCH') {
    bestIntent = 'ORIENTATION';
  }

  const categories = classifyCategories(text);

  return {
    intent: bestIntent || 'ORIENTATION', // Default to orientation for general queries
    confidence: bestConfidence || 0.5,    // Low confidence if no keyword match
    method: 'DETERMINISTIC',
    categories,
    matchedKeywords: bestKeywords
  };
}

/**
 * Classify aide categories deterministically.
 * @param {string} text - Text to classify
 * @returns {string[]} Matched categories (1-3)
 */
export function classifyCategories(text) {
  if (!text || typeof text !== 'string') return [];

  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const scores = [];

  for (const [category, keywords] of Object.entries(CATEGORY_PATTERNS)) {
    const matched = keywords.filter(kw => {
      const normalizedKw = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return normalized.includes(normalizedKw);
    });
    if (matched.length > 0) {
      scores.push({ category, score: matched.length });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, 3).map(s => s.category);
}
