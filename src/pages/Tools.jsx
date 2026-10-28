// @ts-nocheck

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import LoadError from '@/components/LoadError';

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

            {/* Gradient Banner */}
            <div
                className="relative overflow-hidden py-10 sm:py-14"
                style={{ background: 'linear-gradient(135deg, #020617 0%, #002D5A 30%, #1e3a8a 60%, #3730a3 85%, #4F46E5 100%)' }}
            >
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                    <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #818cf8 0%, transparent 70%)' }} />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-50 to-transparent" aria-hidden="true" />
                <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <h1 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-md">Boîte à Outils</h1>
                    <p className="mt-2 text-blue-100/80 text-sm sm:text-base">Outils pratiques pour l'accompagnement social et numérique.</p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                    ) : failed ? (
                        <LoadError what="les outils" onRetry={() => setAttempt((n) => n + 1)} testId="tools-error" />
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
            </div>
        </div>
    );
}
