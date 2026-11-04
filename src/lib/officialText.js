// R42: moved out of src/components/guides/OfficialText.jsx so the component file only exports components.
/**
 * @typedef {{ kind: 'table', caption: string, rows: string[][] }} TableBlock
 * @typedef {{ kind: 'note', label: string, text: string } | { kind: 'p', text: string } | TableBlock} Block
 */

/**
 * R28: the text of an official Service-Public sheet as the verification reader stores it — paragraphs, « Tableau : » captions followed by « a | b | c »
 * rows, « Attention : » / « À savoir : » notes, « → Service en ligne : » lines — shown as real paragraphs, accessible tables and notes. The words are
 * never changed: this only gives them their structure back.
 * @param {string} text @returns {Block[]}
 */
export function blocksOf(text) {
  /** @type {Block[]} */
  const blocks = [];
  /** @type {TableBlock | null} */
  let table = null;
  const flush = () => { if (table) { blocks.push(table); table = null; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const cap = line.match(/^Tableau\s*:\s*(.*)$/);
    if (cap) { flush(); table = { kind: 'table', caption: cap[1], rows: [] }; continue; }
    if (table && line.includes(' | ')) { table.rows.push(line.split(' | ').map((c) => c.trim())); continue; }
    flush();
    const note = line.match(/^(Attention|À savoir|A savoir|Rappel|Exemple|À noter)\s*:?\s*(.*)$/);
    if (note) { blocks.push({ kind: 'note', label: note[1], text: note[2] }); continue; }
    blocks.push({ kind: 'p', text: line.replace(/^→\s*/, '') });
  }
  flush();
  return blocks.filter((b) => b.kind !== 'table' || b.rows.length > 0);
}
