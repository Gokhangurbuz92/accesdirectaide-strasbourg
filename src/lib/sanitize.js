import DOMPurify from 'dompurify';

// Configuration stricte : on n'autorise que le formatage basique (FALC friendly)
const sanitizeConfig = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h2', 'h3'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'], // Bloque onclick, javascript:, etc.
};

export const sanitizeHtml = (/** @type {string | Node} */ dirtyHtml) => {
  if (typeof window === 'undefined') return dirtyHtml; // SSR check
  return DOMPurify.sanitize(dirtyHtml, sanitizeConfig);
};
