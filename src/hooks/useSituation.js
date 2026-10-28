import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/storage';

/**
 * useSituation
 * Hook personnalisé pour gérer l'état du diagnostic avec persistance locale.
 * Permet de reprendre le questionnaire là où on s'est arrêté.
 *
 * @param {Object} initialState — valeurs par défaut de la situation
 * @returns {{ situation: Object, updateField: Function, resetSituation: Function }}
 */
export function useSituation(initialState = {}) {
    const [situation, setSituation] = useState(() => {
        const saved = storage.loadSituation();
        return saved || initialState;
    });

    // Sauvegarde automatique à chaque changement — debounce-free car
    // localStorage est synchrone et extrêmement rapide.
    useEffect(() => {
        storage.saveSituation(situation);
    }, [situation]);

    /**
     * Met à jour un champ spécifique de la situation.
     */
    const updateField = useCallback((/** @type {number} */ field, /** @type {any} */ value) => {
        setSituation(prev => ({
            ...prev,
            [field]: value,
        }));
    }, []);

    /**
     * Réinitialise le diagnostic complet.
     */
    const resetSituation = useCallback(() => {
        storage.clear();
        setSituation(initialState);
    }, [initialState]);

    return {
        situation,
        updateField,
        resetSituation,
    };
}
