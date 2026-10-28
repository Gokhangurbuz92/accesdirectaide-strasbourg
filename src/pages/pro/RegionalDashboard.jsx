// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';
import { proRdvRequest } from '@/api/pro-rdv-client';
import {
    Globe,
    TrendingUp,
    Users,
    Building2,
    ChevronRight,
    Search,
    ArrowUpRight,
    ArrowDownRight,
    ShieldCheck,
    Activity,
    Loader2,
    Calendar,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

/**
 * RegionalDashboard — Multi-structure observatory
 *
 * Route: /pro/regional
 *
 * Shows anonymized aggregate stats across all structures
 * for territorial decision-makers.
 */
export default function RegionalDashboard() {
    const [search, setSearch] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [refused, setRefused] = useState(false);

    // PKG-11 audit pass 2: the API gives 7 days of appointments as { date, value } (value null when masked); the chart read « rdv » / « diag » keys that never
    // existed (always empty) and drew a « Diagnostics » series nobody measures
    const trendData = useMemo(
        () => (data?.stats?.trend || []).map((d) => ({ date: d.date, rdv: d.value })),
        [data]
    );

    const fetchStats = useCallback(async () => {
        setLoading(true);
        try {
            setData(await proRdvRequest('/api/pro/regional-stats'));   // PKG-4: bearer session like every pro page (was cookie-only = always 401)
            setFailed(false); setRefused(false);
        } catch (err) {
            // R20: a refusal (organization not yet activated by ADA, or access withdrawn) is not an outage: « Réessayer » would never help
            if (err?.status === 403) setRefused(true);
            else setFailed(true);   // pass 2: said on screen (a silent failure showed « < 5 » and « 0 » as if measured)
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    const stats = data?.stats || {};
    const filtered = useMemo(
        () => {
            const cities = stats.cities || [];
            return cities.filter(
                (c) =>
                    c.name.toLowerCase().includes(search.toLowerCase()) ||
                    (c.city || '').toLowerCase().includes(search.toLowerCase())
            );
        },
        [stats.cities, search]
    );

    if (loading) {
        return (
            <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
        );
    }

    if (refused && !data) {
        return (
            <div className="min-h-screen bg-slate-50 py-8 px-4">
                <SEO title="Observatoire Régional — ADA" noindex />
                <div className="max-w-6xl mx-auto space-y-4">
                    <h1 className="text-xl font-bold text-slate-900">Observatoire Régional ADA</h1>
                    <p role="note" className="p-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700" data-testid="regional-refused">
                        L’observatoire est réservé aux structures actives vérifiées par ADA. Il s’ouvrira quand ADA aura activé votre structure.
                    </p>
                </div>
            </div>
        );
    }

    // R8: figures that were never loaded are not drawn (« < 5 » and « 0 » under the banner read as measured); a way to try again
    if (failed && !data) {
        return (
            <div className="min-h-screen bg-slate-50 py-8 px-4">
                <SEO title="Observatoire Régional — ADA" noindex />
                <div className="max-w-6xl mx-auto space-y-4">
                    <h1 className="text-xl font-bold text-slate-900">Observatoire Régional ADA</h1>
                    <div role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800" data-testid="regional-error">
                        <p>Les statistiques n’ont pas pu être chargées : aucun chiffre n’est affiché.</p>
                        <button type="button" className="mt-2 rounded border border-red-300 px-3 py-1 text-sm underline" data-testid="regional-retry" onClick={fetchStats}>Réessayer</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <SEO title="Observatoire Régional — ADA" noindex />
            <div className="max-w-6xl mx-auto space-y-6">
                {failed && (
                    <div role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800" data-testid="regional-error">
                        <p>Les statistiques n’ont pas pu être mises à jour : les chiffres ci-dessous sont ceux du dernier chargement.</p>
                        <button type="button" className="mt-2 rounded border border-red-300 px-3 py-1 text-sm underline" data-testid="regional-retry" onClick={fetchStats}>Réessayer</button>
                    </div>
                )}
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-slate-900 text-white rounded-2xl">
                            <Globe size={22} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">
                                Observatoire Régional ADA
                            </h1>
                            <p className="text-xs text-slate-700">
                                Agrégats mesurés des structures vérifiées · commune affichée à partir de 3 structures · valeurs inférieures à 5 masquées
                            </p>
                        </div>
                    </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <KpiCard
                        label="Citoyens aidés"
                        value={stats.totalCitizensHelped ?? '< 5'}
                        icon={<Users size={14} className="text-indigo-500" />}
                    />
                    <KpiCard
                        label="Structures"
                        value={stats.activeStructures ?? 0}
                        icon={<Building2 size={14} className="text-emerald-500" />}
                    />
                    <KpiCard
                        label="Agents"
                        value={stats.totalAgents ?? '< 5'}
                        icon={<ShieldCheck size={14} className="text-amber-500" />}
                    />
                    <KpiCard
                        label="RDV ce mois"
                        value={stats.appointmentsThisMonth ?? '< 5'}
                        icon={<Calendar size={14} className="text-blue-500" />}
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* Structures list */}
                    <div className="lg:col-span-2 space-y-3">
                        <div className="relative">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                            />
                            <input
                                type="text"
                                placeholder="Rechercher une structure..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                aria-label="Rechercher une structure"
                                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                            />
                        </div>

                        {filtered.length === 0 ? (
                            <Card>
                                <CardContent className="p-6 text-center text-sm text-slate-600">
                                    Aucune structure trouvée
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {filtered.map((/** @type {{ id: string | number }} */ city) => (
                                    <StructureCard key={city.id} city={city} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Trend chart */}
                    <Card>
                        <CardHeader className="pb-1">
                            <CardTitle className="text-xs font-bold flex items-center gap-2">
                                <Activity size={12} className="text-indigo-500" />
                                Rendez-vous des 7 derniers jours (valeurs inférieures à 5 masquées)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[180px] w-full mt-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={trendData}>
                                        <defs>
                                            <linearGradient id="rdvGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1} />
                                                <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: '12px',
                                                border: 'none',
                                                boxShadow: '0 4px 12px rgba(0,0,0,.08)',
                                                fontSize: '11px',
                                            }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="rdv"
                                            stroke="#4f46e5"
                                            fill="url(#rdvGrad)"
                                            strokeWidth={2}
                                            name="RDV"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex justify-between text-[9px] text-slate-600 font-bold uppercase mt-2">
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-indigo-500" /> RDV
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Sovereignty banner */}
                <Card className="bg-slate-900 text-white border-slate-800">
                    <CardContent className="p-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <h2 className="text-sm font-bold uppercase tracking-wider mb-1">
                                    Interopérabilité Territoriale
                                </h2>
                                <p className="text-xs text-slate-300">
                                    Données agrégées : aucun accès aux dossiers nominatifs, et les
                                    valeurs inférieures à 5 sont masquées.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-md text-[9px] font-bold uppercase">
                                    Agrégats uniquement
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

// @ts-ignore
function KpiCard({ label, value, icon }) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-1">{icon}
                    <span className="text-[10px] font-bold text-slate-600 uppercase">
                        {label}
                    </span>
                </div>
                <p className="text-xl font-bold text-slate-900">
                    {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
                </p>
            </CardContent>
        </Card>
    );
}

function StructureCard({ city }) {
    const isActive = city.status === 'optimal';
    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center text-[10px] font-bold">
                            {(city.name || '??').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-900">{city.name}</p>
                            {city.city && (
                                <p className="text-[10px] text-slate-600">{city.city}</p>
                            )}
                        </div>
                    </div>
                    <span
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                            }`}
                    >
                        {isActive ? 'actif' : 'inactif'}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded-lg p-2 text-center">
                        <p className="text-[9px] text-slate-600 font-bold uppercase">Agents</p>
                        <p className="text-sm font-bold text-slate-900">{city.agents ?? '< 5'}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2 text-center">
                        <p className="text-[9px] text-slate-600 font-bold uppercase">RDV</p>
                        <p className="text-sm font-bold text-slate-900">{city.rdv ?? '< 5'}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
