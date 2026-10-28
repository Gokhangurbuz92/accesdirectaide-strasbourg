// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect } from 'react';
import SEO from '@/components/SEO';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { FileText, ExternalLink } from 'lucide-react';
import { EMERGENCY_FALLBACK } from '@/lib/emergencyNumbers';

export default function Ressources() {
    const emergencyMode = new URLSearchParams(window.location.search).get('emergency') === '1';
    const [ressources, setRessources] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('');
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const fetchRessources = async () => {
            setLoading(true); setFailed(false);
            try {
                let url = '/api/ressources';
                const params = new URLSearchParams();
                if (emergencyMode) params.append('emergency', '1');
                if (filterType) params.append('type', filterType);

                if (params.toString()) url += `?${params.toString()}`;

                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    setRessources(data.items || []);
                } else {
                    setRessources([]); setFailed(true);
                }
            } catch (err) {
                setRessources([]); setFailed(true);
                // @ts-ignore
                if (import.meta.env.DEV) console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchRessources();
    }, [filterType, emergencyMode, attempt]);

    const apiEmergency = ressources.filter((r) => r.phone);
    // never leave the emergency box empty: the built-in national numbers take over when the list could not be loaded
    const emergencyList = emergencyMode ? (apiEmergency.length > 0 ? apiEmergency : EMERGENCY_FALLBACK) : [];

    return (
        <div className="container mx-auto px-4 py-8">
            <SEO
                title="Ressources d'accessibilité"
                description="Découvrez les ressources pour améliorer l'accessibilité et l'inclusion."
                path="/ressources"
            />

            <h1 className="text-3xl font-bold mb-6 text-slate-800">Ressources d'Accessibilité</h1>

            {emergencyMode && (
                <section data-testid="emergency-resources" aria-labelledby="emergency-resources-title" className="mb-8 rounded-lg border border-red-200 bg-red-50 p-4">
                    <h2 id="emergency-resources-title" className="text-xl font-bold text-red-900">Ressources d’urgence</h2>
                    <p className="mt-1 text-sm text-red-900">En cas de danger immédiat, utilisez le numéro adapté à votre situation.</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {emergencyList.map((r) => (
                            <a key={r.id} href={`tel:${r.phone}`} data-testid={`emergency-resource-${r.phone}`} className="rounded-md bg-white p-3 font-semibold text-red-800 underline focus:outline-none focus:ring-2 focus:ring-red-600">
                                {r.title} — {r.phone}
                            </a>
                        ))}
                    </div>
                    {!loading && apiEmergency.length === 0 && <p data-testid="emergency-fallback-note" className="mt-3 text-sm text-red-900">Ces numéros nationaux s’affichent même sans connexion au service.</p>}
                </section>
            )}

            <div className="bg-white p-4 rounded-lg shadow mb-8 flex flex-wrap gap-4 items-center">
                <select
                    className="border p-2 rounded"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    aria-label="Filtrer par type de ressource"
                >
                    <option value="">Tous les types</option>
                    <option value="guide">Guides</option>
                    <option value="tool">Outils</option>
                    <option value="document">Documents</option>
                    <option value="link">Liens utiles</option>
                </select>
            </div>

            {loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : failed ? (
                <div role="alert" data-testid="ressources-error" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
                    <p>Les ressources n’ont pas pu être chargées. Ce n’est pas une absence de ressource.</p>
                    <button type="button" data-testid="ressources-retry" onClick={() => setAttempt((n) => n + 1)} className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-white">Réessayer</button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* owner usefulness pass: the built-in emergency numbers are shown (with their call link) in the box above; as cards they led to a detail
                        page that does not exist (they are not database records) */}
                    {ressources.filter((r) => r.type !== 'URGENCE').map((r) => (
                        <Link key={r.id} to={`/ressources/${r.slug}`} data-testid="ressource-card">
                            <Card className="h-full hover:shadow-lg transition-shadow">
                                <CardContent className="p-6">
                                    <div className="flex items-start gap-3 mb-3">
                                        <FileText className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />
                                        <h3 className="font-semibold text-lg text-slate-900" data-testid="ressource-title">
                                            {r.title}
                                        </h3>
                                    </div>
                                    {r.type && (
                                        <Badge className="mb-3 bg-blue-100 text-blue-800">
                                            {r.type}
                                        </Badge>
                                    )}
                                    {r.content && (
                                        <p className="text-sm text-slate-600 line-clamp-3">
                                            {r.content.substring(0, 150)}...
                                        </p>
                                    )}
                                    {r.source_url && (
                                        <div className="mt-3 flex items-center gap-1 text-xs text-blue-600">
                                            <ExternalLink className="h-3 w-3" />
                                            <span>Source externe</span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                    {/* R7: the emergency numbers (type URGENCE) are shown above, not in this grid: « none found » only when the grid itself is empty */}
                    {!emergencyMode && ressources.filter((r) => r.type !== 'URGENCE').length === 0 && (
                        <p className="col-span-3 text-center text-gray-500" data-testid="ressources-empty">Aucune ressource trouvée pour ces critères.</p>
                    )}
                </div>
            )}
        </div>
    );
}
