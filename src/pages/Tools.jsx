// @ts-nocheck

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import LoadError from '@/components/LoadError';
import PageHeader from '@/components/layout/PageHeader';
import { OFFICIAL_TOOLS, OFFICIAL_TOOLS_CHECKED_AT } from '@/config/officialTools';
import { ExternalLink } from 'lucide-react';

const checkedDay = new Date(`${OFFICIAL_TOOLS_CHECKED_AT}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** R26: the official public services and simulators — real, usable tools while AccesDirectAide publishes none of its own */
function OfficialTools() {
    return (
        <section aria-labelledby="official-tools-title" data-testid="official-tools">
            <h2 id="official-tools-title" className="text-xl font-bold text-slate-900">Outils officiels en ligne</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Simulateurs et services en ligne des organismes publics. Ils s’ouvrent sur le site de l’organisme : AccesDirectAide ne les gère pas et
                ne garantit pas leurs résultats. Adresses vérifiées le {checkedDay}.
            </p>
            <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {OFFICIAL_TOOLS.map((t) => (
                    <li key={t.id} className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="official-tool">
                        <span className="w-fit rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-800">{t.categorie}</span>
                        <h3 className="mt-3 text-base font-semibold text-slate-900">{t.titre}</h3>
                        <p className="mt-1 flex-1 text-sm text-slate-600">{t.description}</p>
                        <a href={t.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded">
                            Ouvrir sur {new URL(t.url).hostname.replace(/^www\./, '')}<ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span>
                        </a>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default function Tools() {
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
        methode: "Méthode",
        numerique: "Outil Numérique",
        modele: "Modèle / Template",
        ressource: "Ressource"
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <SEO
                title="Boîte à Outils"
                description="Outils pratiques pour l'accompagnement."
                path="/outils"
            />

            <PageHeader title="Boîte à outils" description="Simulateurs et services en ligne utiles pour vos démarches, choisis sur les sites des organismes publics." />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
            {failed && <LoadError what="les outils" onRetry={() => setAttempt((n) => n + 1)} testId="tools-error" />}
            {(tools.length > 0 || hasFilter) && !failed && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                {/* Filters */}
                <aside className="bg-white p-6 rounded-lg shadow h-fit">
                    <h2 className="font-semibold mb-4">Filtrer par</h2>

                    <div className="mb-4">
                        <label htmlFor="tools-f1" className="block text-sm font-medium mb-1">Type d'outil</label>
                        <select id="tools-f1"
                            className="w-full border rounded p-2"
                            value={filters.type}
                            onChange={e => setFilters({ ...filters, type: e.target.value })}
                        >
                            <option value="">Tous</option>
                            {facets.types?.map(t => (
                                <option key={t} value={t}>{typeLabels[t] || t}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label htmlFor="tools-f2" className="block text-sm font-medium mb-1">Catégorie</label>
                        <select id="tools-f2"
                            className="w-full border rounded p-2"
                            value={filters.categorie}
                            onChange={e => setFilters({ ...filters, categorie: e.target.value })}
                        >
                            <option value="">Toutes</option>
                            {facets.categories?.map(c => (
                                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label htmlFor="tools-f3" className="block text-sm font-medium mb-1">Public</label>
                        <select id="tools-f3"
                            className="w-full border rounded p-2"
                            value={filters.public}
                            onChange={e => setFilters({ ...filters, public: e.target.value })}
                        >
                            <option value="">Tous</option>
                            {facets.publics?.map(p => (
                                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                            ))}
                        </select>
                    </div>
                </aside>

                {/* Results */}
                <div className="md:col-span-3">
                    {loading ? (
                        <div className="text-center py-10" role="status">Chargement…</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {tools.map(tool => (
                                <Link key={tool.id} to={`/outils/${tool.slug}`} className="block group h-full" data-testid="tool-card">
                                    <article className="bg-white p-6 rounded-lg shadow-sm border border-purple-50 hover:border-purple-200 group-hover:shadow-md transition h-full flex flex-col">
                                        <div className="flex gap-2 mb-3">
                                            <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full uppercase font-bold">
                                                {typeLabels[tool.type] || tool.type}
                                            </span>
                                        </div>
                                        <h2 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-purple-600">
                                            {tool.titre}
                                        </h2>
                                        <p className="text-gray-600 text-sm line-clamp-3 mb-4 flex-grow">
                                            {tool.resume_falc}
                                        </p>
                                        <div className="text-purple-600 font-medium text-sm mt-auto">
                                            Voir l'outil &rarr;
                                        </div>
                                    </article>
                                </Link>
                            ))}

                            {tools.length === 0 && (
                                <div className="col-span-3 text-gray-700 text-center py-10 bg-gray-50 rounded" data-testid="tools-empty">
                                    Aucun outil publié pour ces critères.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            )}
            <OfficialTools />
            </div>
        </div>
    );
}
