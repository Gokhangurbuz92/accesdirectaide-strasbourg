import { useEffect, useState } from 'react';

/**
 * FA-D4 (RGAA 8.6 — a relevant page title): the text of the page's main heading (the first h1 inside #main-content), followed as the page renders and
 * changes. The professional and administration layouts use it as the title of the pages that do not set their own: before, a dozen screens shared
 * one title (« AccesDirect Pro », or the public site's default sentence), so a screen-reader user or a browser tab could not tell them apart.
 * A page that renders its own <SEO> still wins (react-helmet keeps the innermost title).
 * @param {string} pathname re-read on every navigation
 * @returns {string} '' while there is no heading
 */
export default function useMainHeadingText(pathname) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const read = () => {
      const clean = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const h1 = clean(document.querySelector('#main-content h1'));
      // a section with its own tabs under one h1 (e.g. Rendez-vous › Services / Disponibilités): the current tab names the screen
      const tab = clean(document.querySelector('#main-content nav [aria-current="page"]'));
      const next = (tab && h1 && tab !== h1 ? `${tab} — ${h1}` : h1).slice(0, 120);
      setText((prev) => (prev === next ? prev : next));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [pathname]);
  return text;
}
