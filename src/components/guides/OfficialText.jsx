import PropTypes from 'prop-types';
import { blocksOf } from '@/lib/officialText';

/** @param {{ text: string, lang?: string, dir?: string }} props — `lang`/`dir`: the language of the text (R32: French, marked as such, until a verified translation is shown) */
export default function OfficialText({ text, lang = undefined, dir = undefined }) {
  return (
    <div className="space-y-3 text-slate-800 leading-relaxed" lang={lang} dir={dir}>
      {blocksOf(text).map((b, i) => {
        if (b.kind === 'table') {
          const [head, ...rows] = b.rows;
          return (
            <div key={i} className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[32rem] text-start text-sm">
                {b.caption && <caption className="bg-slate-50 px-3 py-2 text-start font-semibold text-slate-900">{b.caption}</caption>}
                <thead className="bg-slate-50"><tr>{head.map((c, j) => <th key={j} scope="col" className="border-t border-slate-200 px-3 py-2 font-semibold">{c}</th>)}</tr></thead>
                <tbody>{rows.map((r, k) => <tr key={k} className="border-t border-slate-200 align-top">{r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="px-3 py-2 font-medium">{c}</th> : <td key={j} className="px-3 py-2">{c}</td>))}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (b.kind === 'note') {
          return (
            <p key={i} className="rounded-lg border-s-4 border-amber-400 bg-amber-50 px-4 py-2 text-slate-900">
              <strong>{b.label}{b.text ? ' : ' : ''}</strong>{b.text}
            </p>
          );
        }
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}
OfficialText.propTypes = { text: PropTypes.string, lang: PropTypes.string, dir: PropTypes.string };
