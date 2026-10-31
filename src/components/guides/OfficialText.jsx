import PropTypes from 'prop-types';

/**
 * R28: the text of an official Service-Public sheet as the verification reader stores it — paragraphs, « Tableau : » captions followed by « a | b | c »
 * rows, « Attention : » / « À savoir : » notes, « → Service en ligne : » lines — shown as real paragraphs, accessible tables and notes. The words are
 * never changed: this only gives them their structure back.
 * @param {string} text
 */
export function blocksOf(text) {
  const blocks = []; let table = null;
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

export default function OfficialText({ text }) {
  return (
    <div className="space-y-3 text-slate-800 leading-relaxed">
      {blocksOf(text).map((b, i) => {
        if (b.kind === 'table') {
          const [head, ...rows] = b.rows;
          return (
            <div key={i} className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[32rem] text-left text-sm">
                {b.caption && <caption className="bg-slate-50 px-3 py-2 text-left font-semibold text-slate-900">{b.caption}</caption>}
                <thead className="bg-slate-50"><tr>{head.map((c, j) => <th key={j} scope="col" className="border-t border-slate-200 px-3 py-2 font-semibold">{c}</th>)}</tr></thead>
                <tbody>{rows.map((r, k) => <tr key={k} className="border-t border-slate-200 align-top">{r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="px-3 py-2 font-medium">{c}</th> : <td key={j} className="px-3 py-2">{c}</td>))}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (b.kind === 'note') {
          return (
            <p key={i} className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-2 text-slate-900">
              <strong>{b.label}{b.text ? ' : ' : ''}</strong>{b.text}
            </p>
          );
        }
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}
OfficialText.propTypes = { text: PropTypes.string };
