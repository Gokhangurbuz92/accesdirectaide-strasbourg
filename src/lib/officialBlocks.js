// @ts-nocheck
/** Catalogue (12/11/2026): the text of an official fiche as display blocks (src/components/OfficialContent.jsx). */
/** the fiche's text (headings « ## », lists « - », table rows « a | b », notes « **…** », links « → … ») as blocks */
export function officialBlocks(text) {
  const blocks = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (h) { blocks.push({ type: h[1].length === 2 ? 'h3' : 'h4', text: h[2] }); continue; }
    const li = line.match(/^-\s+(.*)$/);
    if (li) { const last = blocks[blocks.length - 1]; if (last?.type === 'ul') last.items.push(li[1]); else blocks.push({ type: 'ul', items: [li[1]] }); continue; }
    if (line.includes(' | ')) { const cells = line.split(' | ').map((c) => c.trim()); const last = blocks[blocks.length - 1]; if (last?.type === 'table') last.rows.push(cells); else blocks.push({ type: 'table', rows: [cells] }); continue; }
    const strong = line.match(/^\*\*(.*)\*\*$/);
    if (strong) { blocks.push({ type: 'strong', text: strong[1] }); continue; }
    if (line.startsWith('→ ')) { blocks.push({ type: 'pointer', text: line.slice(2) }); continue; }
    blocks.push({ type: 'p', text: line });
  }
  return blocks;
}

