import { useState, useEffect } from 'react';
import SEO from '@/components/SEO';
import DispositifCard from '@/components/cards/DispositifCard';
import { Link } from 'react-router-dom';
import LoadError from '@/components/LoadError';

export default function Dispositifs() {
    const [dispositifs, setDispositifs] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [filterDept, setFilterDept] = useState('');
    const [filterPublic, setFilterPublic] = useState('');
    const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const fetchDispositifs = async () => {
            setLoading(true); setFailed(false);
            try {
                let url = '/api/dispositifs';
                const params = new URLSearchParams();
                if (filterDept) params.append('departement', filterDept);
                if (filterPublic) params.append('public', filterPublic);

                if (params.toString()) url += `?${params.toString()}`;

                const res = await fetch(url);
                if (!res.ok) throw new Error(`dispositifs ${res.status}`);
                const data = await res.json();
                setDispositifs(Array.isArray(data) ? data : []);
            } catch (err) {
                setFailed(true);   // an outage is said as such, never shown as « aucun dispositif »
            } finally {
                setLoading(false);
            }
        };

        fetchDispositifs();
    }, [filterDept, filterPublic, attempt]);

    return (
        <div className="min-h-screen bg-slate-50">
            <SEO
                title="Dispositifs territoriaux"
                description="Découvrez les dispositifs locaux et territoriaux pour vous aider."
                path="/dispositifs"
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
                    <h1 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-md">Dispositifs Territoriaux</h1>
                    <p className="mt-2 text-blue-100/80 text-sm sm:text-base">Découvrez les dispositifs locaux et territoriaux pour vous aider.</p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* R18: no published programme at all (none verified on an official source yet) = said as such, with the next steps; the filters only when there is something to filter */}
            {!loading && !failed && dispositifs.length === 0 && !filterDept && !filterPublic ? (
                <div className="rounded-lg border border-slate-200 bg-white p-6" data-testid="dispositifs-none-published">
                    <h2 className="text-lg font-semibold text-slate-900">Aucun programme local n’est encore publié ici</h2>
                    <p className="mt-2 text-slate-700">ADA n’affiche un dispositif qu’après l’avoir vérifié sur une source officielle. Les aides et les lieux d’accueil, eux, sont déjà disponibles :</p>
                    <ul className="mt-4 flex flex-wrap gap-3">
                        <li><Link to="/aides" className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-white underline-offset-2 hover:underline">Voir les aides</Link></li>
                        <li><Link to="/structures" className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-slate-900 underline-offset-2 hover:underline">Trouver un lieu d’aide</Link></li>
                        <li><Link to="/diagnostic" className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-slate-900 underline-offset-2 hover:underline">Faire le point sur mes droits</Link></li>
                    </ul>
                </div>
            ) : (
            <>
            <div className="bg-white p-4 rounded-lg shadow mb-8 flex flex-wrap gap-4 items-center">
                <label htmlFor="dispositifs-departement" className="sr-only">Département</label>
                <select id="dispositifs-departement"
                    className="border p-2 rounded min-h-11"
                    value={filterDept}
                    onChange={(e) => setFilterDept(e.target.value)}
                >
                    <option value="">Tous les départements</option>
                    <option value="67">Bas-Rhin (67)</option>
                    <option value="68">Haut-Rhin (68)</option>
                </select>

                <label htmlFor="dispositifs-public" className="sr-only">Public</label>
                <select id="dispositifs-public"
                    className="border p-2 rounded min-h-11"
                    value={filterPublic}
                    onChange={(e) => setFilterPublic(e.target.value)}
                >
                    <option value="">Tous publics</option>
                    <option value="jeunes">Jeunes</option>
                    <option value="seniors">Seniors</option>
                    <option value="familles">Familles</option>
                    <option value="handicap">Personnes handicapées</option>
                </select>
            </div>

            {loading ? (
                <p role="status">Chargement...</p>
            ) : failed ? (
                <LoadError what="les dispositifs" onRetry={() => setAttempt((n) => n + 1)} testId="dispositifs-error" />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="dispositifs-list">
                    {dispositifs.map((/** @type {{ id: string | number }} */ d) => (
                        <DispositifCard key={d.id} dispositif={d} />
                    ))}
                    {dispositifs.length === 0 && (
                        <p className="col-span-3 text-center text-gray-700" data-testid="dispositifs-empty">Aucun dispositif trouvé pour ces critères.</p>
                    )}
                </div>
            )}
            </>
            )}
            </div>
        </div>
    );
}
