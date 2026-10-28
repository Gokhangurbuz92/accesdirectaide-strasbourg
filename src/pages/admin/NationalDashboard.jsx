// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { adminClient as client } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Globe,
    Database,
    Map,
    Users,
    TrendingUp,
    Loader2,
    AlertCircle,
    ChevronRight,
} from 'lucide-react';

/**
 * NationalDashboard
 *
 * Territorial supervision panel for AccesDirectAide.
 * Live data from GET /api/admin/national-stats.
 *
 * Shows:
 * - Summary cards (total aids, active structures, shared diagnostics, active agents)
 * - Territorial breakdown (aids by scope)
 * - Hive review queue status (pending, approved, rejected)
 */
export default function NationalDashboard() {
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-national-stats'],
        queryFn: () => client.get('/api/admin/national-stats').then(r => r.data?.data || r.data),   // PKG-11 audit pass 2: the API nests its payload under data (the page always showed « — »)
        refetchInterval: 60_000,
    });

    if (isLoading) {
        return (
            <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-8 text-center">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-slate-600">Erreur de chargement des statistiques nationales</p>
                        <p className="text-sm text-slate-600 mt-1">{error.message}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const summary = data?.summary || {};
    const territorial = data?.territorial || [];
    const hive = data?.hive || [];
    const totalHive = hive.reduce((/** @type {number} */ sum, h) => sum + (h.count || 0), 0);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 py-6">
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2">
                                <Globe className="h-6 w-6 text-teal-600" />
                                Pilotage National
                            </h1>
                            <p className="text-slate-700 text-sm">
                                Supervision territoriale — données actualisées chaque minute
                            </p>
                        </div>
                        <Badge className="bg-slate-100 text-slate-700 border-0 gap-1" data-testid="national-timestamp">
                            {data?.timestamp ? `Données du ${new Date(data.timestamp).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}` : 'Données en attente'}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard icon={<Database className="text-blue-600" />} label="Aides indexées" value={summary.totalAids} />
                    <StatCard icon={<Map className="text-indigo-600" />} label="Structures actives" value={summary.activeStructures} />
                    <StatCard icon={<TrendingUp className="text-amber-800" />} label="Diagnostics partagés" value={summary.sharedDiagnostics} />
                    <StatCard icon={<Users className="text-teal-600" />} label="Agents Pro actifs" value={summary.activeAgents} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Hive Review Queue */}
                    <div className="lg:col-span-2">
                        <Card>
                            <CardContent className="p-6">
                                <h3 className="font-bold text-slate-800 mb-4">
                                    File de modération (Ruche IA)
                                </h3>
                                {hive.length === 0 ? (
                                    <p className="text-sm text-slate-600">Aucun élément dans la file de modération</p>
                                ) : (
                                    <div className="space-y-4">
                                        {hive.map(item => {
                                            const pct = totalHive > 0 ? (item.count / totalHive) * 100 : 0;
                                            const barColor =
                                                item.status === 'approved' ? 'bg-emerald-500'
                                                    : item.status === 'pending' ? 'bg-amber-500'
                                                        : item.status === 'rejected' ? 'bg-red-400'
                                                            : 'bg-slate-400';
                                            return (
                                                <div key={item.status}>
                                                    <div className="flex justify-between text-sm mb-1">
                                                        <span className="font-medium text-slate-600 capitalize">{item.status}</span>
                                                        <span className="font-bold text-slate-800">{item.count}</span>
                                                    </div>
                                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Territorial Breakdown */}
                    <Card className="bg-slate-900 text-white border-0">
                        <CardContent className="p-6">
                            <h3 className="font-bold text-teal-400 text-xs uppercase tracking-wider mb-6">
                                Maillage Territorial
                            </h3>
                            {territorial.length === 0 ? (
                                <p className="text-sm text-slate-300">Aucune donnée territoriale</p>
                            ) : (
                                <div className="space-y-4">
                                    {territorial.map(scope => (
                                        <div key={scope.scope} className="flex justify-between items-center border-b border-white/10 pb-3">
                                            <div>
                                                <p className="text-xs uppercase text-slate-300">{scope.scope}</p>
                                                <p className="text-xl font-bold font-mono">{scope.count.toLocaleString('fr-FR')}</p>
                                            </div>
                                            <ChevronRight className="text-teal-400" size={16} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

// @ts-ignore
function StatCard({ icon, label, value }) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-slate-50 rounded-lg">{icon}</div>
                </div>
                <p className="text-2xl font-bold text-slate-900">{value != null ? value.toLocaleString('fr-FR') : '—'}</p>
                <p className="text-sm text-slate-700">{label}</p>
            </CardContent>
        </Card>
    );
}
