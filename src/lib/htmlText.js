// @ts-nocheck
const NAMED_ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * Convertit un contenu HTML potentiel en texte lisible.
 * @param {unknown} value
 * @param {{ maxLength?: number }} [options]
 */
export function htmlToPlainText(value, options = {}) {
  if (value == null) return '';

  const raw = String(value);
  const withLineBreakHints = raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '- ');

  const withoutTags = withLineBreakHints.replace(/<[^>]+>/g, ' ');

  const decodedNamedEntities = withoutTags.replace(
    /&(nbsp|amp|lt|gt|quot);|&#39;/gi,
    (match) => NAMED_ENTITIES[match.toLowerCase()] || match,
  );

  const decodedEntities = decodedNamedEntities
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCharCode(Number.parseInt(codePoint, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => String.fromCharCode(Number.parseInt(codePoint, 16)));

  const normalized = decodedEntities
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const maxLength = Number.isFinite(options.maxLength) ? Number(options.maxLength) : 0;
  if (maxLength > 0 && normalized.length > maxLength) {
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
  }

  return normalized;
}
