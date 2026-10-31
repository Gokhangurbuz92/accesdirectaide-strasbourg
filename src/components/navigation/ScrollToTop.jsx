import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * R29: a new page opens at its top. Without this, opening a card from a scrolled list (aides, démarches, lieux, guides, actualités) showed the detail
 * page at the list's scroll position — on a phone, in the middle of the text. Going back (POP) keeps the browser's own position; a change of the
 * query string only (filters, page of results) or an in-page anchor does not move the page.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if (type === 'POP' || hash) return;
    window.scrollTo(0, 0);
  }, [pathname, hash, type]);
  return null;
}
