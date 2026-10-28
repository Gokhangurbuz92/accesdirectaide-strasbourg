// @ts-nocheck
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminClient as client } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import {
    ScrollText, AlertCircle, RefreshCw,
    Info, AlertTriangle, XCircle, Bug,
} from 'lucide-react';

const LEVEL_OPTIONS = [
    { value: '', label: 'Tous les niveaux' },
    { value: 'error', label: 'Erreurs', color: 'text-red-600' },
    { value: 'warn', label: 'Warnings', color: 'text-amber-600' },
    { value: 'info', label: 'Info', color: 'text-blue-600' },
    { value: 'debug', label: 'Debug', color: 'text-slate-500' },
];

const LEVEL_ICONS = {
    error: <XCircle className="h-4 w-4 text-red-500" />,
    warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    info: <Info className="h-4 w-4 text-blue-500" />,
    debug: <Bug className="h-4 w-4 text-slate-400" />,
};

const LEVEL_BADGE_CLASS = {
    error: 'bg-red-100 text-red-700 border-0',
    warn: 'bg-amber-100 text-amber-700 border-0',
    info: 'bg-blue-100 text-blue-700 border-0',
    debug: 'bg-slate-100 text-slate-600 border-0',
};

/**
 * AdminLogs
 *
 * Shows recent system logs from Redis (GET /api/admin/logs).
 * Filter by level (error, warn, info, debug).
 */
export default function AdminLogs() {
    const [level, setLevel] = useState('');
    const [count] = useState(100);

    const params = new URLSearchParams({ count: String(count) });
    if (level) params.set('level', level);

    const { data: rawData, isLoading, error, refetch } = useQuery({
        queryKey: ['admin-logs', level, count],
        queryFn: () => client.get(`/api/admin/logs?${params.toString()}`).then(r => r.data),
        refetchInterval: 15_000,
    });

    // the page keeps its title while it loads or fails (a heading for screen readers and the route checks; a rate-limited or failed request is not a blank page)
    if (isLoading) {
        return (
            <div className="w-full p-4"><h1 className="text-2xl font-bold text-slate-900 mb-4">Logs Système</h1><SkeletonList count={5} variant="card" /></div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <h1 className="text-2xl font-bold text-slate-900 mb-4">Logs Système</h1>
                <Card>
                    <CardContent className="p-8 text-center">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-slate-600">{(error?.status ?? error?.response?.status) === 429 ? 'Trop de demandes en peu de temps : la page se rechargera d’elle-même dans une minute.' : 'Erreur de chargement des logs'}</p>
                        <p className="text-sm text-slate-400 mt-1">{error.message}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // API may return data directly or wrapped
    const inner = rawData?.data || rawData || {};
    const logs = Array.isArray(inner.logs) ? inner.logs : [];

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 py-6">
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 mb-1">
                                Logs Système
                            </h1>
                            <p className="text-slate-500 text-sm">
                                {logs.length} entrée{logs.length > 1 ? 's' : ''} — rafraîchissement auto 15s
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetch()}
                            className="gap-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Actualiser
                        </Button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
                {/* Level Filter */}
                <div className="flex flex-wrap gap-2">
                    {LEVEL_OPTIONS.map((opt) => (
                        <Button
                            key={opt.value}
                            variant={level === opt.value ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setLevel(opt.value)}
                        >
                            {opt.label}
                        </Button>
                    ))}
                </div>

                {/* Logs Table */}
                <Card>
                    <CardContent className="p-0">
                        {logs.length === 0 ? (
                            <div className="p-8 text-center">
                                <ScrollText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                                {inner.stored === false ? (
                                    <p className="text-slate-700" data-testid="admin-logs-not-collected">Les journaux centralisés ne sont pas collectés sur cet environnement (aucun stockage configuré) : la liste vide ne veut pas dire qu’il ne s’est rien passé.</p>
                                ) : <p className="text-slate-500" data-testid="admin-logs-empty">Aucun log trouvé</p>}
                                {level && (
                                    <p className="text-sm text-slate-400 mt-1">
                                        Essayez un filtre différent
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="relative overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 text-left">
                                            <th className="px-4 py-3 font-semibold text-slate-600 w-10">Niv.</th>
                                            <th className="px-4 py-3 font-semibold text-slate-600 w-44">Date</th>
                                            <th className="px-4 py-3 font-semibold text-slate-600">Message</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {logs.map((log, /** @type {string | number | boolean | null | undefined} */ idx) => (
                                            <tr key={log.id || idx} className="hover:bg-slate-50 align-top">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1.5">
                                                        {LEVEL_ICONS[log.level] || LEVEL_ICONS.info}
                                                        <Badge className={LEVEL_BADGE_CLASS[log.level] || LEVEL_BADGE_CLASS.info}>
                                                            {log.level || 'info'}
                                                        </Badge>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs font-mono">
                                                    {log.timestamp
                                                        ? new Date(log.timestamp).toLocaleString('fr-FR')
                                                        : '—'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="text-slate-800 font-medium">
                                                        {log.message || log.msg || '—'}
                                                    </p>
                                                    {log.details && (
                                                        <pre className="mt-1 text-xs text-slate-400 whitespace-pre-wrap break-all max-w-xl">
                                                            {typeof log.details === 'string'
                                                                ? log.details
                                                                : JSON.stringify(log.details, null, 2)}
                                                        </pre>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
