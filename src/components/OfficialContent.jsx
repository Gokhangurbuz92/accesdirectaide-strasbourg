// @ts-nocheck
import { formatDate, useT } from '@/i18n';
import { officialBlocks } from '@/lib/officialBlocks';

/**
 * Catalogue (12/11/2026) — LEVEL 1: the official Service-Public fiche a record reproduces (api/lib/publicVisibility.js publicOfficial), shown as it is, with what
 * the Licence Ouverte 2.0 and the DILA ask of a reuse: the publisher « Service-Public.gouv.fr / DILA », the date of its last update, the licence, the file it
 * comes from (address, name, date), the link to the fiche. The text is the fiche's own (French, lang="fr"), rendered as plain React text — never as HTML.
 * A long fiche cut at a heading says so and sends to the rest on Service-Public. On a record whose summary was written (Level 2) the fiche is folded.
 */
const day = (d) => (d ? formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' }) : null);

function Blocks({ text }) {
  return officialBlocks(text).map((b, i) => {
    if (b.type === 'h3') return <h3 key={i} className="mt-6 text-lg font-semibold text-slate-900">{b.text}</h3>;
    if (b.type === 'h4') return <h4 key={i} className="mt-4 font-semibold text-slate-900">{b.text}</h4>;
    if (b.type === 'ul') return <ul key={i} className="mt-2 list-disc space-y-1 ps-6 text-slate-700">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>;
    if (b.type === 'table') return (
      <div key={i} className="mt-3 overflow-x-auto"><table className="min-w-full border-collapse text-sm"><tbody>
        {b.rows.map((r, j) => <tr key={j} className="border-b border-slate-200">{r.map((c, k) => <td key={k} className="px-2 py-1.5 align-top text-slate-700">{c}</td>)}</tr>)}
      </tbody></table></div>);
    if (b.type === 'strong') return <p key={i} className="mt-3 font-semibold text-slate-900">{b.text}</p>;
    if (b.type === 'pointer') return <p key={i} className="mt-2 text-sm text-slate-600">{b.text}</p>;
    return <p key={i} className="mt-2 leading-relaxed text-slate-700">{b.text}</p>;
  });
}

/** @param {{ official: any, folded?: boolean }} props */
export default function OfficialContent({ official, folded = false }) {
  const { t } = useT('shared');
  if (!official?.text) return null;
  const updated = day(official.importantChangeAt || official.modifiedAt);
  const body = (
    <div lang="fr" className="mt-3 border-t border-slate-200 pt-3 text-base">
      <Blocks text={official.text} />
      {official.truncated ? <p className="mt-4 font-medium text-slate-900" data-testid="official-truncated">{t('shared:official.truncated', 'La fiche officielle est longue : la suite se lit sur Service-Public.gouv.fr.')}</p> : null}
      {official.online?.length ? (
        <div className="mt-6"><h3 className="text-lg font-semibold text-slate-900">{t('shared:official.online', 'Services en ligne et formulaires officiels')}</h3>
          <ul className="mt-2 space-y-1 ps-0">{official.online.map((o, i) => <li key={i}><a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 text-indigo-800 underline underline-offset-2">{o.title || o.url}</a>{o.type ? <span className="ms-2 text-xs text-slate-500">({o.type})</span> : null}</li>)}</ul></div>
      ) : null}
      {official.references?.length ? (
        <div className="mt-6"><h3 className="text-lg font-semibold text-slate-900">{t('shared:official.references', 'Textes de référence')}</h3>
          <ul className="mt-2 space-y-1 ps-0">{official.references.map((r, i) => <li key={i}><a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 text-indigo-800 underline underline-offset-2">{r.title || r.url}</a></li>)}</ul></div>
      ) : null}
    </div>
  );
  return (
    <section data-testid="official-content" aria-labelledby="official-content-title" className="rounded-lg border border-slate-200 bg-white px-4 py-4 sm:px-6">
      <h2 id="official-content-title" className="text-xl font-semibold text-slate-900">{t('shared:official.heading', 'Fiche officielle')}</h2>
      <p className="mt-1 text-sm text-slate-600" data-testid="official-attribution">
        {t('shared:official.meta', 'Source : {{publisher}}', { publisher: official.publisher || 'Service-Public.gouv.fr / DILA' })}
        {updated ? <> — {t('shared:official.updated', 'mise à jour : {{date}}', { date: updated })}</> : null}
        {official.licence ? <> — <a href={official.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{official.licence}</a></> : null}
      </p>
      {official.archive?.file ? <p className="mt-0.5 text-xs text-slate-500">{t('shared:official.file', 'Données : fichier {{file}} du {{date}}', { file: official.archive.file, date: day(official.archive.date) || '—' })} (<a href={official.archive.url} className="underline underline-offset-2" rel="noopener noreferrer">{t('shared:official.download', 'téléchargement')}</a>)</p> : null}
      <p className="mt-1 text-xs text-slate-500">{t('shared:official.lang', 'Contenu officiel, en français.')}</p>
      {official.url ? <a href={official.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center font-medium text-indigo-800 underline underline-offset-2">{t('shared:official.open', 'Lire la fiche sur Service-Public.gouv.fr')}</a> : null}
      {folded ? (
        <details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 font-medium text-slate-900">{t('shared:official.show', 'Afficher la fiche officielle complète')}</summary>{body}</details>
      ) : body}
    </section>
  );
}
