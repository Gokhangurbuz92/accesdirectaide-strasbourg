import { useSyncExternalStore } from 'react';

/**
 * G14-LITE — « text first » on a weak or metered connection. True when the person asked their browser to save data (Save-Data / `saveData`), when the
 * operating system asks for reduced data (`prefers-reduced-data: reduce`, where supported), or when the connection is reported as 2G. Then pages do not
 * load decorative or remote images by themselves: the text comes first and an image is shown only when the person asks for it. Maps already load only on
 * request (Annuaire « Carte »). Nothing is stored and nothing is sent anywhere.
 */
export function prefersReducedData() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    const c = /** @type {any} */ (navigator).connection;
    if (c && (c.saveData === true || ['slow-2g', '2g'].includes(String(c.effectiveType || '')))) return true;
  } catch { /* no Network Information API */ }
  try { return window.matchMedia('(prefers-reduced-data: reduce)').matches; } catch { return false; }
}

/** @param {() => void} onChange */
function subscribe(onChange) {
  if (typeof window === 'undefined') return () => {};
  const c = /** @type {any} */ (navigator).connection;
  let mq = null;
  try { mq = window.matchMedia('(prefers-reduced-data: reduce)'); } catch { mq = null; }
  c?.addEventListener?.('change', onChange); mq?.addEventListener?.('change', onChange);
  return () => { c?.removeEventListener?.('change', onChange); mq?.removeEventListener?.('change', onChange); };
}

/** React hook: follows prefersReducedData() (a connection that changes is followed) */
export function useReducedData() {
  return useSyncExternalStore(subscribe, prefersReducedData, () => false);
}
