/**
 * Actualités v2 — saved articles, kept ONLY in this browser (no account, no server, no tracking). Each entry keeps what the « Saved » list needs to
 * show a link (id, slug, title, date, publisher), at most 100 entries. Storage may be unavailable (private window, blocked site data): the list is
 * then empty and saving silently does nothing — the page works the same.
 */
import { useCallback, useEffect, useState } from 'react';

export const BOOKMARKS_KEY = 'ada_news_saved_v1';
const MAX = 100;

/** @typedef {{ id: string, slug?: string | null, titre: string, date?: string | null, publisher?: string | null }} SavedNews */

/** @returns {SavedNews[]} */
export function readBookmarks() {
  try {
    const v = JSON.parse(window.localStorage.getItem(BOOKMARKS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && typeof x.titre === 'string').slice(0, MAX) : [];
  } catch { return []; }
}
/** @param {SavedNews[]} list */
function writeBookmarks(list) {
  try { window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list.slice(0, MAX))); window.dispatchEvent(new Event('ada:news-saved')); } catch { /* storage unavailable */ }
}

export default function useNewsBookmarks() {
  const [items, setItems] = useState(() => (typeof window === 'undefined' ? [] : readBookmarks()));
  useEffect(() => {
    const sync = () => setItems(readBookmarks());
    window.addEventListener('ada:news-saved', sync); window.addEventListener('storage', sync);
    return () => { window.removeEventListener('ada:news-saved', sync); window.removeEventListener('storage', sync); };
  }, []);
  const isSaved = useCallback((/** @type {string} */ id) => items.some((x) => x.id === id), [items]);
  const toggle = useCallback((/** @type {SavedNews} */ entry) => {
    const cur = readBookmarks();
    const next = cur.some((x) => x.id === entry.id) ? cur.filter((x) => x.id !== entry.id)
      : [{ id: entry.id, slug: entry.slug || null, titre: String(entry.titre || '').slice(0, 300), date: entry.date || null, publisher: entry.publisher || null }, ...cur];
    writeBookmarks(next); setItems(next);
  }, []);
  const clear = useCallback(() => { writeBookmarks([]); setItems([]); }, []);
  return { items, isSaved, toggle, clear };
}
