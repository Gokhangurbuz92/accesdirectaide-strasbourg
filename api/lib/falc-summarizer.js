
/**
 * FALC Summarizer (Rules-based)
 * Designed for public aid information.
 * 
 * Rules:
 * 1. 4-7 short sentences max.
 * 2. Simple vocabulary.
 * 3. Expand acronyms.
 * 4. No added info (zero intox).
 */

const ACRONYMS = {
    "APL": "Aide Personnalisée au Logement",
    "RSA": "Revenu de Solidarité Active",
    "CAF": "Caisse d'Allocations Familiales",
    "CPAM": "Caisse Primaire d'Assurance Maladie",
    "AAH": "Allocation aux Adultes Handicapés",
    "PCH": "Prestation de Compensation du Handicap",
    "MDPH": "Maison Départementale des Personnes Handicapées",
    "ARE": "Allocation de Retour à l'Emploi",
    "ASS": "Allocation de Solidarité Spécifique",
    "C2S": "Complémentaire Santé Solidaire",
    "HLM": "Habitation à Loyer Modéré",
    "ANTS": "Agence Nationale des Titres Sécurisés",
    "OFPRA": "Office Français de Protection des Réfugiés et Apatrides",
    "OFII": "Office Français de l'Immigration et de l'Intégration",
    "CCAS": "Centre Communal d'Action Sociale",
    "RIB": "Relevé d'Identité Bancaire",
    "CMG": "Complément de Libre Choix du Mode de Garde",
    "ARS": "Allocation de Rentrée Scolaire"
};

const SIMPLE_WORDS = {
    "indemnisation": "argent reçu",
    "périodicité": "fréquence",
    "éligibilité": "droit à l'aide",
    "dématérialisé": "sur internet",
    "allocataire": "personne qui reçoit l'aide",
    "prestataire": "personne qui donne le service",
    "concomitant": "en même temps",
    "subvenir": "payer pour",
    "rémunération": "salaire",
    "solliciter": "demander",
    "justificatif": "papier",
    "précarité": "difficulté d'argent",
    "suspendu": "arrêté",
    "effectuer": "faire",
    "acquitter": "payer"
};

/**
 * Unescapes HTML entities.
 * @param {string} str
 */
function unescapeHTML(str) {
    if (!str) return "";
    return str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ');
}

/**
 * Strips HTML tags from text.
 * @param {string} html
 */
function stripHTML(html) {
    if (!html) return "";
    const unescaped = unescapeHTML(html);
    return unescaped.replace(/<[^>]*>?/gm, ' ');
}

/**
 * Expands acronyms and simplifies words.
 * @param {string} text
 */
function simplifyText(text) {
    let simplified = text;

    // Expand acronyms (case sensitive usually, but we check both)
    for (const [acro, full] of Object.entries(ACRONYMS)) {
        const regex = new RegExp(`\\b${acro}\\b`, 'g');
        simplified = simplified.replace(regex, `${full} (${acro})`);
    }

    // Simplify hard words
    for (const [hard, easy] of Object.entries(SIMPLE_WORDS)) {
        const regex = new RegExp(`\\b${hard}\\b`, 'gi');
        simplified = simplified.replace(regex, easy);
    }

    return simplified;
}

/**
 * Splits text into sentences.
 * @param {string} text
 */
function splitSentences(text) {
    if (!text) return [];
    // Simple sentence splitter on . ! ? followed by space or end
    return text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 10);
}

/**
 * Core summarization logic.
 * @param {string} text
 */
export function summarizeFALC(text, maxSentences = 6) {
    const clean = stripHTML(text).replace(/\s+/g, ' ').trim();
    const sentences = splitSentences(clean);

    if (sentences.length === 0) return clean.substring(0, 300);

    // Take first N sentences
    const selected = sentences.slice(0, maxSentences);

    // Simplify each selected sentence
    const finalSentences = selected.map(s => simplifyText(s.trim()));

    return finalSentences.join(' ');
}

/**
 * Extracts 3-5 key points from text.
 * @param {string} text
 */
export function extractKeyPoints(text) {
    const clean = stripHTML(text).replace(/\s+/g, ' ').trim();
    const sentences = splitSentences(clean);

    // Try to find sentences with keywords like "important", "faut", "attention", "date", "montant"
    const keywords = ["important", "faut", "doit", "attention", "date", "montant", "limite", "aide"];
    const relevant = sentences.filter(s => keywords.some(k => s.toLowerCase().includes(k)));

    const points = relevant.length >= 3 ? relevant.slice(0, 5) : sentences.slice(0, 3);
    return points.map(p => simplifyText(p.trim()).substring(0, 150));
}

// Alias for compatibility
export const summarizeToFalc = summarizeFALC;
