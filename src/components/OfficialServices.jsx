// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatDate, useT } from '@/i18n';
import { ChoiceChips, FilterField, Pager, SELECT, TEXT_INPUT } from '@/components/layout/catalog';
import { categoryLabel } from '@/components/ui/CategoryChip';

/**
 * Catalogue (12/11/2026) — the official online services listed by Service-Public.gouv.fr (DILA flux, Licence Ouverte 2.0): simulators, online procedures,
 * cerfa forms, letter templates, search tools — about two thousand, each address opened on `checkedAt` (scripts/build-official-services.mjs). Loaded only
 * when the toolbox is opened (its own chunk), searched and filtered in the browser, 24 a page. Every entry links to the service itself: AccesDirectAide does
 * not run it and does not vouch for a result. Titles stay the services' own (French, lang="fr").
 */
const PAGE = 24;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export default function OfficialServices() {
  const { t } = useT('tools');
  const [doc, setDoc] = useState(null); const [failed, setFailed] = useState(false);
  const [q, setQ] = useState(''); const [kind, setKind] = useState(''); const [cat, setCat] = useState(''); const [page, setPage] = useState(1); const [pro, setPro] = useState(false);
  useEffect(() => { let alive = true; import('@/config/officialServices.generated.json').then((m) => { if (alive) setDoc(m.default || m); }).catch(() => alive && setFailed(true)); return () => { alive = false; }; }, []);
  useEffect(() => { setPage(1); }, [q, kind, cat, pro]);
  const items = useMemo(() => doc?.items || [], [doc]);
  const shown = useMemo(() => {
    const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
    return items.filter((x) => (pro || x.audience !== 'pro') && (!kind || x.kind === kind) && (!cat || x.categorie === cat)
      && words.every((w) => fold(`${x.title} ${x.operator || ''} ${x.cerfa || ''}`).includes(w)))
      .sort((a, b) => (b.cited || 0) - (a.cited || 0) || a.title.localeCompare(b.title, 'fr'));
  }, [items, q, kind, cat, pro]);
  const KIND = {
    simulateur: t('tools:services.kind.simulateur', 'Simulateurs'), teleservice: t('tools:services.kind.teleservice', 'Démarches en ligne'),
    formulaire: t('tools:services.kind.formulaire', 'Formulaires (cerfa)'), modele: t('tools:services.kind.modele', 'Modèles de lettres'), recherche: t('tools:services.kind.recherche', 'Outils de recherche'),
  };
  const cats = [...new Set(items.map((x) => x.categorie).filter(Boolean))].sort();
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice((page - 1) * PAGE, page * PAGE);
  if (failed) return null;
  return (
    <section aria-labelledby="official-services-title" data-testid="official-services" className="mt-12">
      <h2 id="official-services-title" className="text-2xl font-semibold text-slate-900">{t('tools:services.title', 'Services en ligne officiels')}</h2>
      <p className="mt-1 max-w-3xl text-slate-700">{t('tools:services.intro', 'Les simulateurs, démarches en ligne, formulaires et modèles de lettres recensés par Service-Public.gouv.fr. Chaque lien mène au service officiel lui-même ; AccesDirectAide ne le gère pas et ne garantit pas son résultat.')}</p>
      {doc ? (
        <p className="mt-1 text-xs text-slate-500" data-testid="official-services-source">
          {t('tools:services.source', 'Source : {{publisher}}, {{licence}} — liste du {{date}}, adresses vérifiées le {{checked}}.', { publisher: doc.source?.publisher, licence: doc.source?.licence, date: formatDate(doc.source?.date, { day: 'numeric', month: 'long', year: 'numeric' }) || '—', checked: doc.checkedAt ? formatDate(`${doc.checkedAt}T12:00:00Z`, { day: 'numeric', month: 'long', year: 'numeric' }) : '—' })}
        </p>
      ) : <p role="status" className="mt-3 text-slate-600">{t('tools:services.loading', 'Chargement des services officiels…')}</p>}
      {doc ? (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
            <FilterField id="official-services-q" label={t('tools:services.search', 'Rechercher un service, un formulaire, un numéro cerfa')}>
              <input id="official-services-q" type="text" inputMode="search" className={TEXT_INPUT} value={q} maxLength={120} onChange={(e) => setQ(e.target.value)} data-testid="official-services-search" />
            </FilterField>
            <FilterField id="official-services-cat" label={t('tools:services.category', 'Thème')}>
              <select id="official-services-cat" className={SELECT} value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">{t('tools:filters.category-all', 'Toutes')}</option>
                {cats.map((c) => <option key={c} value={c}>{categoryLabel(c, t) || c}</option>)}
              </select>
            </FilterField>
          </div>
          <div className="mt-3"><ChoiceChips label={t('tools:services.kinds', 'Type de service')} value={kind} onChange={setKind} testId="official-services-kinds"
            options={[{ value: '', label: t('tools:filters.category-all', 'Toutes'), count: items.filter((x) => pro || x.audience !== 'pro').length }, ...Object.entries(KIND).map(([k, label]) => ({ value: k, label, count: items.filter((x) => x.kind === k && (pro || x.audience !== 'pro')).length }))]} /></div>
          <label className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" className="h-5 w-5" checked={pro} onChange={(e) => setPro(e.target.checked)} data-testid="official-services-pro" />
            {t('tools:services.pro', 'Afficher aussi les services destinés aux entreprises, associations et professionnels')}
          </label>
          <p className="mt-3 text-sm text-slate-700" role="status" aria-live="polite" data-testid="official-services-count">{t('tools:services.count', { count: shown.length, defaultValue_one: '{{count}} service', defaultValue_other: '{{count}} services' })}</p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="official-services-list">
            {slice.map((x) => (
              <li key={x.id} className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4" data-testid="official-service">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{x.generic ? t('tools:services.site', 'Site officiel') : KIND[x.kind]}{x.cerfa ? ` · cerfa ${x.cerfa}` : ''}</span>
                {(x.login || x.pdf || x.audience === 'pro') ? (
                  <span className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    {x.login ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-900 ring-1 ring-amber-200">{t('tools:services.login', 'Connexion requise')}</span> : null}
                    {x.pdf ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-800 ring-1 ring-slate-200">{t('tools:services.pdf', 'PDF à télécharger')}</span> : null}
                    {x.audience === 'pro' ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-900 ring-1 ring-indigo-200">{t('tools:services.forPro', 'Entreprises et associations')}</span> : null}
                  </span>
                ) : null}
                <a href={x.url} target="_blank" rel="noopener noreferrer" lang="fr" className="mt-1 inline-flex min-h-11 items-start gap-1.5 font-semibold text-indigo-800 underline-offset-2 hover:underline">
                  <span>{x.title}</span><ExternalLink className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" /><span className="sr-only">{t('tools:services.newTab', '(nouvel onglet)')}</span>
                </a>
                {x.operator ? <span className="mt-auto pt-2 text-sm text-slate-600" lang="fr">{x.operator}</span> : null}
              </li>
            ))}
          </ul>
          <Pager page={page} totalPages={totalPages} hasNext={page < totalPages} onPage={setPage} label={t('tools:services.pages', 'Pages des services officiels')}
            previous={t('tools:services.previous', 'Précédent')} next={t('tools:services.next', 'Suivant')} status={t('tools:services.page', 'Page {{page}} sur {{total}}', { page, total: totalPages })} />
        </>
      ) : null}
    </section>
  );
}
