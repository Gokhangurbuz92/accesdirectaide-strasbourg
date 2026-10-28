/**
 * storage.js
 * Utilitaire de persistance souveraine utilisant le localStorage.
 * Gère l'expiration des données après 24 heures pour la protection de la vie privée.
 * Zéro dépendance externe — solution 100 % souveraine.
 */

const STORAGE_KEY = 'ada_diagnostic_state';
const WIZARD_KEY = 'ada_wizard_state';
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
        save(WIZARD_KEY, data);
    },

    /**
     * Récupère l'état du wizard si non expiré.
     * @returns {Object|null}
     */
    loadWizard() {
        return load(WIZARD_KEY);
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
        localStorage.removeItem(WIZARD_KEY);
    },

    /**
     * Launch-readiness item 63: called when the site starts — answers older than 24 hours are removed at the next visit of ANY page (not only when the
     * questionnaire is opened again).
     */
    purgeExpired() {
        load(STORAGE_KEY);
        load(WIZARD_KEY);
    },

    /**
     * Supprime toutes les données ADA du stockage local.
     */
    clearAll() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WIZARD_KEY);
    },
};
