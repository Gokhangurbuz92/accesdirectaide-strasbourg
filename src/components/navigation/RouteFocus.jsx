import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * R32 / Q01 — after an in-app navigation, a screen-reader user must learn that a new page opened. Before, the focus stayed on the link that was
 * pressed (often removed from the page) and nothing was announced. Now, once the new page has drawn its main heading, the focus moves to it (the
 * heading is read, and Tab continues from the top of the content) without scrolling. Nothing happens on the first load (the browser and the screen
 * reader already start at the top), on a change of query string only (filters, result pages) or on an in-page anchor.
 */
export default function RouteFocus() {
  const { pathname, hash } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (hash) return undefined;
    let tries = 0; let timer;
    const move = () => {
      const main = document.getElementById('main-content');
      const h1 = main?.querySelector('h1');
      if (!h1 && tries < 20) { tries += 1; timer = window.setTimeout(move, 100); return; }   // the page may load its content first (up to 2 s)
      const target = h1 || main;
      if (!target) return;
      if (target !== main && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    timer = window.setTimeout(move, 50);
    return () => window.clearTimeout(timer);
  }, [pathname, hash]);
  return null;
}
