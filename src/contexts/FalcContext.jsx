// @ts-nocheck
import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { ACCESSIBILITY_EVENT } from '@/lib/accountAccessibility';

const FalcContext = createContext(null);

/**
 * FalcProvider — Global FALC (Facile À Lire et à Comprendre) state.
 * Persists user preference in localStorage.
 * Adds `falc-mode` class to body for CSS targeting.
 */
export function FalcProvider({ children }) {
  const [isFalcEnabled, setIsFalcEnabled] = useState(() => {
    try {
      return localStorage.getItem('falc-mode') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('falc-mode', String(isFalcEnabled));
    } catch {
      // localStorage unavailable (private browsing)
    }

    if (isFalcEnabled) {
      document.body.classList.add('falc-mode');
    } else {
      document.body.classList.remove('falc-mode');
    }
  }, [isFalcEnabled]);

  // K0 / C04: the signed-in account's FALC preference (src/lib/accountAccessibility.js)
  useEffect(() => {
    const onAccount = (e) => { if (typeof e?.detail?.falc === 'boolean') setIsFalcEnabled(e.detail.falc); };
    window.addEventListener(ACCESSIBILITY_EVENT, onAccount);
    return () => window.removeEventListener(ACCESSIBILITY_EVENT, onAccount);
  }, []);

  const toggleFalc = () => setIsFalcEnabled(prev => !prev);

  const value = useMemo(() => ({
    isFalcEnabled,
    toggleFalc,
  }), [isFalcEnabled]);

  return (
    <FalcContext.Provider value={value}>
      {children}
    </FalcContext.Provider>
  );
}

/**
 * useFalc — Hook to access FALC mode state.
 * Returns safe defaults if used outside FalcProvider.
 */
export function useFalc() {
  const context = useContext(FalcContext);
  if (!context) {
    // Safe fallback — no crash, no console.error
    return { isFalcEnabled: false, toggleFalc: () => { } };
  }
  return context;
}

export default FalcProvider;
