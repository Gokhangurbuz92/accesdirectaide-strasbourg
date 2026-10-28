/**
 * R14: the Content-Disposition of a downloaded document — an ASCII fallback plus the RFC 5987 UTF-8 name, as api/_handlers/download.js does since PKG-11. A name
 * with a character above U+00FF (œ, Cyrillic, Arabic, an emoji) made setHeader throw ERR_INVALID_CHAR: the file uploaded and could never be downloaded (500).
 * @param {unknown} name @returns {string}
 */
export function attachmentDisposition(name) {
  const filename = String(name || 'document').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 120) || 'document';   // eslint-disable-line no-control-regex
  const ascii = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document';
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
