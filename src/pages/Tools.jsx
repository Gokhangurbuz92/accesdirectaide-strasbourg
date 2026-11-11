// @ts-nocheck

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import LoadError from '@/components/LoadError';
import PageHeader from '@/components/layout/PageHeader';
import { OFFICIAL_TOOLS, OFFICIAL_TOOLS_CHECKED_AT, toolText } from '@/config/officialTools';
import { Compass, ExternalLink, Gavel, GraduationCap, HeartPulse, Home, Hourglass, IdCard, Landmark, Scale } from 'lucide-react';
import { CONTAINER, ChoiceChips, FilterField, SELECT } from '@/components/layout/catalog';
import { formatDate, useLanguage, useT } from '@/i18n';

const CATEGORY_ICON = { droits: Scale, jeunes: GraduationCap, logement: Home, sante: HeartPulse, retraite: Hourglass, justice: Gavel, papiers: IdCard, orientation: Compass };

/** R26: the official public services and simulators — real, usable tools while AccesDirectAide publishes none of its own.
 * 11/11/2026: grouped by topic (chips filter them in the page, nothing is sent), each card says it is an official service and opens on the body's site. */
function OfficialTools() {
    const { t } = useT('tools');
    // R32: the name, purpose and topic of each official tool in the interface language (src/config/officialTools.js, namespace « shared »)
    const { t: tShared } = useT('shared');
    const [topic, setTopic] = useState('');
    const checkedDay = formatDate(`${OFFICIAL_TOOLS_CHECKED_AT}T12:00:00Z`, { day: 'numeric', month: 'long', year: 'numeric' });
    const topics = [...new Set(OFFICIAL_TOOLS.map((tool) => tool.categorie))];
    const topicName = (c) => { const x = OFFICIAL_TOOLS.find((tool) => tool.categorie === c); const s0 = x ? toolText(x, tShared).categorie : c; return s0.charAt(0).toUpperCase() + s0.slice(1); };
    const shown = topic ? OFFICIAL_TOOLS.filter((tool) => tool.categorie === topic) : OFFICIAL_TOOLS;
    return (
        <section aria-labelledby="official-tools-title" data-testid="official-tools">
            <div className="flex flex-col gap-1">
                <h2 id="official-tools-title" className="font-heading text-xl font-bold text-slate-900 sm:text-2xl">{t('tools:official.title', 'Outils officiels en ligne')}</h2>
                <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
                    {t('tools:official.intro', 'Simulateurs et services en ligne des organismes publics. Ils s’ouvrent sur le site de l’organisme : AccesDirectAide ne les gère pas et ne garantit pas leurs résultats. Adresses vérifiées le {{date}}.', { date: checkedDay })}
                </p>
            </div>
            <div className="mt-5">
                <ChoiceChips label={t('tools:filters.category', 'Catégorie')} value={topic} onChange={setTopic} testId="official-tools-topics"
                    options={[{ value: '', label: t('tools:filters.category-all', 'Toutes'), count: OFFICIAL_TOOLS.length },
                        ...topics.map((c) => ({ value: c, label: topicName(c), count: OFFICIAL_TOOLS.filter((tool) => tool.categorie === c).length }))]} />
            </div>
            <ul className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((tool) => {
                    const text = toolText(tool, tShared);
                    const Icon = CATEGORY_ICON[tool.categorie] || Compass;
                    const host = new URL(tool.url).hostname.replace(/^www\./, '');
                    return (
                        <li key={tool.id} className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle transition-shadow hover:border-blue-200 hover:shadow-float" data-testid="official-tool">
                            <div className="flex items-start justify-between gap-3">
                                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-800" aria-hidden="true"><Icon className="h-5 w-5" /></span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                                    <Landmark className="h-3.5 w-3.5" aria-hidden="true" />{t('tools:official.badge', 'Service officiel')}
                                </span>
                            </div>
                            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-blue-800">{text.categorie}</p>
                            <h3 className="mt-1 font-heading text-base font-semibold leading-snug text-slate-900">{text.titre}</h3>
                            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-600">{text.description}</p>
                            <a href={tool.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg text-sm font-semibold text-blue-800 hover:text-blue-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
                                {t('tools:official.open', 'Ouvrir sur {{host}}', { host })}<ExternalLink className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" /><span className="sr-only">{t('tools:official.new-tab', ' (nouvel onglet)')}</span>
                            </a>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export default function Tools() {
    const { t } = useT('tools');
    const { isSource } = useLanguage();
    const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
    const [tools, setTools] = useState([]);
    const [loading, setLoading] = useState(true);
    // PKG-11 audit pass 2 (P11 / Q10): an outage is said as such with a retry — it used to be shown as « Aucun outil trouvé »
    const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
    const [facets, setFacets] = useState({ types: [], categories: [], publics: [] });
    const [filters, setFilters] = useState({
        type: '',
        categorie: '',
        public: ''
    });

    useEffect(() => {
        fetch('/api/tools/facets')
            .then(res => res.json())
            .then(data => setFacets(data))
            .catch(e => { if (import.meta.env.DEV) console.error("Facets error", e); });
    }, []);

    useEffect(() => {
        async function fetchTools() {
            setLoading(true); setFailed(false);
            const query = new URLSearchParams();
            if (filters.type) query.append('type', filters.type);
            if (filters.categorie) query.append('categorie', filters.categorie);
            if (filters.public) query.append('public', filters.public);
            query.append('statut', 'publie');

            try {
                const res = await fetch(`/api/tools?${query.toString()}`);
                if (!res.ok) throw new Error(`tools ${res.status}`);
                const data = await res.json();
                if (!Array.isArray(data)) throw new Error('tools: unexpected answer');
                setTools(data);
            } catch (e) {
                if (import.meta.env.DEV) console.error("Error fetching tools", e);
                setFailed(true);
            } finally {
                setLoading(false);
            }
        }
        fetchTools();
    }, [filters, attempt]);

    const hasFilter = Boolean(filters.type || filters.categorie || filters.public);
    const typeLabels = {
        methode: t('tools:type.methode', "Méthode"),
        numerique: t('tools:type.numerique', "Outil Numérique"),
        modele: t('tools:type.modele', "Modèle / Template"),
        ressource: t('tools:type.ressource', "Ressource")
    };

    return (
        <div className="min-h-screen overflow-x-hidden bg-slate-50">
            <SEO
                title={t('tools:seo.title', 'Boîte à Outils')}
                description={t('tools:seo.description', 'Outils pratiques pour l\'accompagnement.')}
                path="/outils"
            />

            <PageHeader title={t('tools:header.title', 'Boîte à outils')} description={t('tools:header.description', 'Simulateurs et services en ligne utiles pour vos démarches, choisis sur les sites des organismes publics.')} />

            <div className={`${CONTAINER} space-y-12 py-6 sm:py-8`}>
            {failed && <LoadError what={t('tools:error.what', 'les outils')} onRetry={() => setAttempt((n) => n + 1)} testId="tools-error" />}
            {(tools.length > 0 || hasFilter) && !failed && (
            <section aria-labelledby="ada-tools-title" data-testid="ada-tools">
                <h2 id="ada-tools-title" className="font-heading text-xl font-bold text-slate-900 sm:text-2xl">{t('tools:ada.title', 'Outils AccesDirectAide')}</h2>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-subtle">
                    <div className="grid gap-4 sm:grid-cols-3">
                        <FilterField id="tools-f1" label={t('tools:filters.type', 'Type d\'outil')}>
                            <select id="tools-f1" className={SELECT} value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
                                <option value="">{t('tools:filters.type-all', 'Tous')}</option>
                                {facets.types?.map(type => (
                                    <option key={type} value={type} {...(typeLabels[type] ? {} : fr)}>{typeLabels[type] || type}</option>
                                ))}
                            </select>
                        </FilterField>
                        <FilterField id="tools-f2" label={t('tools:filters.category', 'Catégorie')}>
                            <select id="tools-f2" className={SELECT} value={filters.categorie} onChange={e => setFilters({ ...filters, categorie: e.target.value })}>
                                <option value="">{t('tools:filters.category-all', 'Toutes')}</option>
                                {facets.categories?.map(c => (
                                    <option key={c} value={c} {...fr}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                                ))}
                            </select>
                        </FilterField>
                        <FilterField id="tools-f3" label={t('tools:filters.public', 'Public')}>
                            <select id="tools-f3" className={SELECT} value={filters.public} onChange={e => setFilters({ ...filters, public: e.target.value })}>
                                <option value="">{t('tools:filters.public-all', 'Tous')}</option>
                                {facets.publics?.map(p => (
                                    <option key={p} value={p} {...fr}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                                ))}
                            </select>
                        </FilterField>
                    </div>
                </div>

                <div className="mt-5">
                    {loading ? (
                        <div className="py-10 text-center text-slate-600" role="status">{t('tools:loading', 'Chargement…')}</div>
                    ) : (
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                            {tools.map(tool => (
                                <Link key={tool.id} to={`/outils/${tool.slug}`} className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" data-testid="tool-card">
                                    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-subtle transition-shadow group-hover:border-blue-200 group-hover:shadow-float">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-900">{t('tools:ada.badge', 'AccesDirectAide')}</span>
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800" {...(typeLabels[tool.type] ? {} : fr)}>
                                                {typeLabels[tool.type] || tool.type}
                                            </span>
                                        </div>
                                        <h3 className="mt-3 font-heading text-lg font-semibold leading-snug text-slate-900 group-hover:text-blue-800" {...fr}>
                                            {tool.titre}
                                        </h3>
                                        <p className="mt-1.5 line-clamp-3 flex-grow text-sm leading-relaxed text-slate-600" {...fr}>
                                            {tool.resume_falc}
                                        </p>
                                        <div className="mt-4 text-sm font-semibold text-blue-800">
                                            {t('tools:card.open', 'Voir l\'outil →')}
                                        </div>
                                    </article>
                                </Link>
                            ))}

                            {tools.length === 0 && (
                                <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white py-10 text-center text-slate-700" data-testid="tools-empty">
                                    {t('tools:empty', 'Aucun outil publié pour ces critères.')}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>
            )}
            <OfficialTools />
            </div>
        </div>
    );
}
