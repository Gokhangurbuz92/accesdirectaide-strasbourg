// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { adminClient as client } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    MessageSquare,
    Search,
    Cpu,
    Zap,
    AlertCircle,
    CheckCircle,
    Loader2,
    Clock,
    Sparkles,
    Download,
    TrendingUp,
    BarChart3,
} from 'lucide-react';
import { useState } from 'react';

const MODE_CONFIG = {
    rag: { label: 'RAG 3072d', icon: Cpu, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    lexical: { label: 'Lexical', icon: Search, className: 'bg-amber-50 text-amber-700 border-amber-200' },
    static: { label: 'Static', icon: AlertCircle, className: 'bg-red-50 text-red-700 border-red-200' },
};

/**
 * AdminConversations
 *
 * Monitoring page for conversation logs + analytics dashboard.
 * Shows RAG efficiency, top intents, mode breakdown, CSV export, and log list.
 */
export default function AdminConversations() {
    const [filter, setFilter] = useState('all');

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-conversations', filter],
        queryFn: () => {
            const params = filter !== 'all' ? `?mode=${filter}` : '';
            return client.get(`/api/admin/conversations${params}`).then(r => r.data?.data || { logs: [], stats: {} });
        },
        refetchInterval: 30_000,
    });

    const { data: analytics, isError: analyticsFailed } = useQuery({
        queryKey: ['admin-analytics'],
        queryFn: () => client.get('/api/admin/analytics').then(r => r.data?.data || {}),
        refetchInterval: 60_000,
    });

    const logs = data?.logs || [];
    const stats = data?.stats || { total: 0, rag: 0, lexical: 0, static: 0 };
    const ragEfficiency = analytics?.ragEfficiency ?? 0;   // R7: shown only when the analytics loaded (a failure read « 0 % »)
    const topIntents = analytics?.intents || [];

    // R7: the export carries the administrator's session (window.open sent no Authorization header: the server always answered 401)
    const [exportProblem, setExportProblem] = useState('');
    const handleExportCSV = async () => {
        const modeParam = filter !== 'all' ? `&mode=${filter}` : '';
        setExportProblem('');
        try {
            const token = sessionStorage.getItem('access_token');
            const r = await fetch(`/api/admin/conversations?format=csv${modeParam}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Session expirée : reconnectez-vous.' : 'L’export n’a pas pu être préparé. Réessayez.');
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement('a'); a.href = url; a.download = 'echanges.csv'; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { setExportProblem(e instanceof Error ? e.message : 'L’export n’a pas pu être préparé.'); }
    };

    if (error) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-8 text-center">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-slate-600">Erreur de chargement des logs</p>
                        <p className="text-sm text-slate-600 mt-1" role="alert" data-testid="admin-conversations-problem">{error?.status === 503 || /503/.test(String(error?.message)) ? 'Le journal des échanges est momentanément indisponible.' : error?.status === 401 ? 'Session expirée : reconnectez-vous.' : 'Le journal n’a pas pu être chargé. Réessayez.'}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 py-6">
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2">
                                <MessageSquare className="h-6 w-6 text-indigo-500" />
                                Journal des Échanges
                            </h1>
                            <p className="text-slate-500 text-sm">
                                Performance RAG et analyse des requêtes usagers
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5" data-testid="admin-conversations-export">
                                <Download className="h-3.5 w-3.5" />
                                Export CSV
                            </Button>
                            {exportProblem ? <p role="alert" className="text-sm text-red-800" data-testid="admin-conversations-export-problem">{exportProblem}</p> : null}
                            <Badge className="bg-indigo-100 text-indigo-700 border-0 gap-1">
                                <Sparkles className="h-3 w-3" />
                                {stats.total} échanges
                            </Badge>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                {/* Analytics Row */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatsCard label="Total" value={stats.total} icon={<MessageSquare className="text-indigo-600" />} />
                    <StatsCard label="RAG (3072d)" value={stats.rag} icon={<CheckCircle className="text-emerald-600" />} />
                    <StatsCard label="Lexical" value={stats.lexical} icon={<Search className="text-amber-600" />} />
                    <StatsCard label="Static" value={stats.static} icon={<AlertCircle className="text-red-500" />} />
                    {/* RAG Efficiency Gauge */}
                    <Card className="col-span-2 lg:col-span-1">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="p-1.5 bg-slate-50 rounded-lg">
                                    <TrendingUp className={ragEfficiency >= 80 ? 'text-emerald-600' : ragEfficiency >= 50 ? 'text-amber-600' : 'text-red-500'} />
                                </div>
                            </div>
                            <p className={`text-2xl font-bold ${ragEfficiency >= 80 ? 'text-emerald-700' : ragEfficiency >= 50 ? 'text-amber-700' : 'text-red-600'}`}>
                                {analyticsFailed ? '—' : `${ragEfficiency}%`}
                            </p>
                            {analyticsFailed ? <p className="text-xs text-red-700" role="alert" data-testid="admin-conversations-analytics-problem">Statistiques indisponibles</p> : null}
                            <p className="text-sm text-slate-500">Efficacité RAG</p>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${ragEfficiency >= 80 ? 'bg-emerald-500' : ragEfficiency >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                    style={{ width: `${ragEfficiency}%` }}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Top Intents + Filter */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Top Intents */}
                    <Card className="lg:col-span-2">
                        <CardContent className="p-4">
                            <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
                                <BarChart3 className="h-4 w-4 text-indigo-500" />
                                Top Intentions Détectées
                            </h3>
                            {topIntents.length > 0 ? (
                                <div className="space-y-2">
                                    {topIntents.map((item, /** @type {string} */ idx) => (
                                        <div key={item.intent} className="flex items-center gap-3">
                                            <span className="text-xs font-bold text-slate-400 w-4">{idx + 1}.</span>
                                            <Badge className="bg-indigo-50 text-indigo-700 border-0 text-xs font-bold">
                                                {item.intent}
                                            </Badge>
                                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-indigo-400 rounded-full"
                                                    style={{ width: `${stats.total ? (item.count / stats.total) * 100 : 0}%` }}
                                                />
                                            </div>
                                            <span className="text-xs font-bold text-slate-500">{item.count}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-400 italic">Aucune intention détectée pour l&#39;instant.</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Filter Toolbar */}
                    <Card>
                        <CardContent className="p-4">
                            <h3 className="font-bold text-slate-800 text-sm mb-3">Filtrer par mode</h3>
                            <div className="flex flex-col gap-2">
                                {['all', 'rag', 'lexical', 'static'].map(mode => (
                                    <Button
                                        key={mode}
                                        variant={filter === mode ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setFilter(mode)}
                                        className="text-xs font-bold uppercase justify-start"
                                    >
                                        {mode === 'all' ? 'Tous les modes' : MODE_CONFIG[mode]?.label || mode}
                                    </Button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Log List */}
                {isLoading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : logs.length > 0 ? (
                    <div className="space-y-3">
                        {logs.map(log => {
                            const modeConf = MODE_CONFIG[log.searchMode] || MODE_CONFIG.static;
                            const ModeIcon = modeConf.icon;
                            return (
                                <Card key={log.id} className="hover:shadow-md transition-shadow">
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                    <p className="font-semibold text-slate-900 truncate">
                                                        &ldquo;{log.message}&rdquo;
                                                    </p>
                                                    {log.intent && (
                                                        <Badge className="bg-indigo-100 text-indigo-700 border-0 text-[10px] font-bold uppercase">
                                                            {log.intent}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                                                    <span className="flex items-center gap-1">
                                                        <Zap className="h-3 w-3 text-amber-500" />
                                                        {log.sourceCount} aide{log.sourceCount !== 1 ? 's' : ''} trouvée{log.sourceCount !== 1 ? 's' : ''}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(log.createdAt).toLocaleString('fr-FR')}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex-shrink-0">
                                                <Badge className={`${modeConf.className} border gap-1 text-[10px] font-bold`}>
                                                    <ModeIcon className="h-3 w-3" />
                                                    {modeConf.label}
                                                </Badge>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                ) : (
                    <Card>
                        <CardContent className="p-12 text-center">
                            <MessageSquare className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                            <p className="text-slate-600">Aucun échange enregistré</p>
                            <p className="text-sm text-slate-400 mt-1">
                                Les logs apparaîtront ici après les premières conversations.
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* RAG Maintenance Banner */}
                {stats.static > 0 && (
                    <Card className="bg-slate-900 border-0">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3 text-white">
                                <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0" />
                                <div>
                                    <p className="font-bold text-sm">
                                        {stats.static} réponse{stats.static > 1 ? 's' : ''} en mode statique détectée{stats.static > 1 ? 's' : ''}
                                    </p>
                                    <p className="text-slate-400 text-xs mt-1">
                                        Le mode statique signifie que le modèle local était indisponible : la réponse a été construite à partir des fiches, sans IA.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}

// @ts-ignore
function StatsCard({ label, value, icon }) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-slate-50 rounded-lg">{icon}</div>
                </div>
                <p className="text-2xl font-bold text-slate-900">{value ?? '—'}</p>
                <p className="text-sm text-slate-500">{label}</p>
            </CardContent>
        </Card>
    );
}
