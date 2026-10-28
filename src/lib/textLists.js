/**
 * A list field as a list: an array as it is, or a text with one item per line (« - item »), as the automatic verification chain writes pour_qui and
 * documents_necessaires. @param {unknown} v @returns {string[]}
 */
export function asList(v) {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x?.titre || x?.title || x?.nom || '')).map((x) => String(x).trim()).filter(Boolean);
  if (typeof v !== 'string' || !v.trim()) return [];
  return v.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
}
