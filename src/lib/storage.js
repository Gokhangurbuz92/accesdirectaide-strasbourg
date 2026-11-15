/**
 * storage.js
 * Utilitaire de persistance souveraine utilisant le localStorage.
 * Gère l'expiration des données après 24 heures pour la protection de la vie privée.
 * Zéro dépendance externe — solution 100 % souveraine.
 */

const STORAGE_KEY = 'ada_diagnostic_state';
const WIZARD_KEY = 'ada_wizard_state';
// A-9: what the orientation wizard may keep while the tab is open — the choices of its first four steps (need, postal code, household and work situation,
// urgency). The last step (birth date or age band, income, rent, housing) is never written to the browser's storage.
export const WIZARD_KEPT_FIELDS = Object.freeze(['need', 'territory', 'situation', 'statut', 'urgency']);
const WIZARD_LAST_KEPT_STEP = 4;
const EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 24 heures

/**
 * Internal helper — saves data with a timestamp under the given key.
 * @param {string} key
 * @param {Object} data
 */
function save(key, data) {
    try {
        const payload = {
            data,
            timestamp: Date.now(),
        };
        localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
        if (import.meta.env.DEV) console.error('[Storage] Erreur lors de la sauvegarde :', error);
    }
}

/**
 * Internal helper — loads data from the given key, returning null if expired or invalid.
 * @param {string} key
 * @returns {Object|null}
 */
function load(key) {
    try {
        const item = localStorage.getItem(key);
        if (!item) return null;

        const { data, timestamp } = JSON.parse(item);

        // Vérification de l'expiration (24h)
        if (Date.now() - timestamp > EXPIRATION_TIME) {
            localStorage.removeItem(key);
            return null;
        }

        return data;
    } catch {
        // Données corrompues ou format invalide — nettoyage silencieux
        localStorage.removeItem(key);
        return null;
    }
}

export const storage = {
    /**
     * Sauvegarde les données de situation diagnostic (page standalone).
     * @param {Object} data
     */
    saveSituation(data) {
        save(STORAGE_KEY, data);
    },

    /**
     * Récupère les données de situation si non expirées.
     * @returns {Object|null}
     */
    loadSituation() {
        return load(STORAGE_KEY);
    },

    /**
     * Sauvegarde l'état du wizard (étape + données accumulées).
     * @param {Object} data
     */
    saveWizard(data) {
        // A-9: the wizard's progress stays in this tab only (sessionStorage) and holds only the first steps' choices — never the last step's
        // birth date, income or housing answers (WIZARD_KEPT_FIELDS)
        try {
            const kept = Object.fromEntries(Object.entries((data && data.data) || {}).filter(([k]) => WIZARD_KEPT_FIELDS.includes(k)));
            sessionStorage.setItem(WIZARD_KEY, JSON.stringify({ data: { step: Math.min(Number(data && data.step) || 0, WIZARD_LAST_KEPT_STEP), data: kept }, timestamp: Date.now() }));
        } catch { /* storage unavailable: the wizard simply does not resume */ }
    },

    /**
     * Récupère l'état du wizard si non expiré.
     * @returns {Object|null}
     */
    loadWizard() {
        try { localStorage.removeItem(WIZARD_KEY); } catch { /* A-9: the 24-hour copy of earlier versions is removed, never read */ }
        try {
            const item = sessionStorage.getItem(WIZARD_KEY);
            if (!item) return null;
            const { data, timestamp } = JSON.parse(item);
            if (!data || Date.now() - timestamp > EXPIRATION_TIME) { sessionStorage.removeItem(WIZARD_KEY); return null; }
            return data;
        } catch {
            try { sessionStorage.removeItem(WIZARD_KEY); } catch { /* nothing to clean */ }
            return null;
        }
    },

    /**
     * Supprime les données de diagnostic.
     */
    clear() {
        localStorage.removeItem(STORAGE_KEY);
    },

    /**
     * Supprime l'état du wizard.
     */
    clearWizard() {
        try { sessionStorage.removeItem(WIZARD_KEY); } catch { /* nothing to clean */ }
        try { localStorage.removeItem(WIZARD_KEY); } catch { /* nothing to clean */ }
    },

    /**
     * Launch-readiness item 63: called when the site starts — answers older than 24 hours are removed at the next visit of ANY page (not only when the
     * questionnaire is opened again).
     */
    purgeExpired() {
        load(STORAGE_KEY);
        try { localStorage.removeItem(WIZARD_KEY); } catch { /* A-9: wizard answers are no longer kept across sessions */ }
    },

    /**
     * Supprime toutes les données ADA du stockage local.
     */
    clearAll() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WIZARD_KEY);
        try { sessionStorage.removeItem(WIZARD_KEY); } catch { /* nothing to clean */ }
    },
};
