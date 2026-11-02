import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/storage';

/**
 * useSituation
 * Hook personnalisé pour gérer l'état du diagnostic avec persistance locale.
 * Permet de reprendre le questionnaire là où on s'est arrêté.
 *
 * @template {Record<string, unknown>} T
 * @param {T} initialState — valeurs par défaut de la situation
 * @returns {{ situation: T, updateField: <K extends keyof T>(field: K, value: T[K]) => void, resetSituation: () => void }}
 */
export function useSituation(initialState = /** @type {T} */ ({})) {
    const [situation, setSituation] = useState(/** @returns {T} */ () => {
        const saved = storage.loadSituation();
        // the saved answers over the defaults: a situation saved before a field existed (e.g. the age band) still has every field
        return saved ? { ...initialState, ...saved } : initialState;
    });

    // Sauvegarde automatique à chaque changement — debounce-free car
    // localStorage est synchrone et extrêmement rapide.
    useEffect(() => {
        storage.saveSituation(situation);
    }, [situation]);

    /**
     * Met à jour un champ spécifique de la situation.
     */
    const updateField = useCallback(/** @type {<K extends keyof T>(field: K, value: T[K]) => void} */ ((field, value) => {
        setSituation(prev => ({
            ...prev,
            [field]: value,
        }));
    }), []);

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
