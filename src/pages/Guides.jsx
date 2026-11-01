// @ts-nocheck

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import AnimatedCard from '@/components/ui/AnimatedCard';
import LoadError from '@/components/LoadError';
import PageHeader from '@/components/layout/PageHeader';
import EmptyCatalogue from '@/components/layout/EmptyCatalogue';
import i18n, { useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

/** one guide of the list — R32: its category, title and summary are the record's own text (French, marked lang="fr", until a verified translation exists) */
function GuideCard({ guide, index }) {
    const { t } = useT('guides');
    const tr = useContentTranslation('guide', guide);
    const resume = tr.value('resume_falc');
    const intro = tr.value('contenu_json')?.intro;
    const categorie = tr.value('categorie');
    return (
        <AnimatedCard index={index}>
            <Link to={`/bonnes-pratiques/${guide.slug}`} className="block group" data-testid="guide-card">
                <article className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 group-hover:shadow-md transition">
                    <div className="flex gap-2 mb-2">
                        {categorie && (
                            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full uppercase font-bold" {...tr.attrs('categorie')}>
                                {categorie}
                            </span>
                        )}
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600" {...tr.attrs('titre')}>
                        {tr.value('titre')}
                    </h2>
                    <p className="text-gray-600 line-clamp-2" {...(resume ? tr.attrs('resume_falc') : intro ? tr.attrs('contenu_json') : {})}>
                        {resume || intro || t('guides:list.see_guide', 'Voir le guide')}
                    </p>
                </article>
            </Link>
        </AnimatedCard>
    );
}

export default function Guides() {
    const { t } = useT('guides');
    const [guides, setGuides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
    const [facets, setFacets] = useState({ categories: [], publics: [], contextes: [] });
    const [filters, setFilters] = useState({
        categorie: '',
        public: '',
        contexte: ''
    });
    const hasFilter = Boolean(filters.categorie || filters.public || filters.contexte);

    useEffect(() => {
        // Load facets
        fetch('/api/guides/facets')
            .then(res => res.json())
            .then(data => setFacets(data))
            .catch(e => { if (import.meta.env.DEV) console.error("Facets error", e); });
    }, []);

    useEffect(() => {
        async function fetchGuides() {
            setLoading(true); setFailed(false);
            const query = new URLSearchParams();
            if (filters.categorie) query.append('categorie', filters.categorie);
            if (filters.public) query.append('public', filters.public);
            if (filters.contexte) query.append('contexte', filters.contexte);
            query.append('statut', 'publie');

            try {
                const res = await fetch(`/api/guides?${query.toString()}`);
                if (!res.ok) throw new Error(`guides ${res.status}`);
                const data = await res.json();
                setGuides(Array.isArray(data) ? data : []);
            } catch (e) {
                setFailed(true);   // an outage is said as such, never shown as « aucun guide »
                // @ts-ignore
                if (import.meta.env.DEV) console.error("Error fetching guides", e);
            } finally {
                setLoading(false);
            }
        }
        fetchGuides();
    }, [filters, attempt]);

    return (
        <div className="min-h-screen bg-slate-50">
            <SEO
                title={t('guides:list.seo_title', 'Bonnes Pratiques')}
                description={t('guides:list.seo_description', "Guides et bonnes pratiques FALC pour l'accessibilité.")}
                path="/bonnes-pratiques"
            />

            <PageHeader title={t('guides:list.title', 'Bonnes pratiques')} description={t('guides:list.description', 'Des guides pratiques pour préparer vos démarches et vos rendez-vous, en langage simple.')} />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* R26: no published guide at all = said plainly, with the verified content to use instead (the filters only when there is something to filter) */}
            {!loading && !failed && guides.length === 0 && !hasFilter ? (
                <EmptyCatalogue title={t('guides:none.title', 'Aucun guide n’est encore publié')} testId="guides-none-published">
                    <p>{t('guides:none.preparing', 'Les guides de bonnes pratiques sont en préparation : chacun sera publié après relecture.')}</p>
                    <p><Trans i18n={i18n} i18nKey="guides:none.meanwhile" defaults="En attendant, chaque <0>démarche</0> explique déjà les étapes et les documents à préparer, et le <1>glossaire</1> explique les sigles (RSA, APL, CCAS…)."
                        components={[<strong key="demarche" />, <Link key="glossaire" to="/glossaire" className="font-medium text-blue-700 underline" />]} /></p>
                </EmptyCatalogue>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                {/* Filters */}
                <aside className="bg-white p-6 rounded-lg shadow h-fit">
                    <h2 className="font-semibold mb-4">{t('guides:filters.title', 'Filtrer par')}</h2>

                    {/* the facet values are the records' own words (French) */}
                    <div className="mb-4">
                        <label htmlFor="guides-f1" className="block text-sm font-medium mb-1">{t('guides:filters.category', 'Catégorie')}</label>
                        <select id="guides-f1"
                            className="w-full border rounded p-2"
                            value={filters.categorie}
                            onChange={e => setFilters({ ...filters, categorie: e.target.value })}
                        >
                            <option value="">{t('guides:filters.all_f', 'Toutes')}</option>
                            {facets.categories?.map(c => (
                                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label htmlFor="guides-f2" className="block text-sm font-medium mb-1">{t('guides:filters.audience', 'Public')}</label>
                        <select id="guides-f2"
                            className="w-full border rounded p-2"
                            value={filters.public}
                            onChange={e => setFilters({ ...filters, public: e.target.value })}
                        >
                            <option value="">{t('guides:filters.all_m', 'Tous')}</option>
                            {facets.publics?.map(p => (
                                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label htmlFor="guides-f3" className="block text-sm font-medium mb-1">{t('guides:filters.context', 'Contexte')}</label>
                        <select id="guides-f3"
                            className="w-full border rounded p-2"
                            value={filters.contexte}
                            onChange={e => setFilters({ ...filters, contexte: e.target.value })}
                        >
                            <option value="">{t('guides:filters.all_m', 'Tous')}</option>
                            {facets.contextes?.map(c => (
                                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                            ))}
                        </select>
                    </div>
                </aside>

                {/* Results */}
                <div className="md:col-span-3">
                    {loading ? (
                        <div className="text-center py-10" role="status">{t('guides:list.loading', 'Chargement...')}</div>
                    ) : failed ? (
                        <LoadError what={t('guides:list.load_what', 'les guides')} onRetry={() => setAttempt((n) => n + 1)} testId="guides-error" />
                    ) : (
                        <div className="grid gap-6" data-testid="guides-list">
                            {guides.map((guide, index) => (
                                <GuideCard key={guide.id} guide={guide} index={index} />
                            ))}

                            {guides.length === 0 && (
                                <div className="text-gray-700 text-center py-10 bg-gray-50 rounded" data-testid="guides-empty">
                                    {t('guides:list.empty_filters', 'Aucun guide trouvé pour ces filtres.')}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            )}
            </div>
        </div>
    );
}
