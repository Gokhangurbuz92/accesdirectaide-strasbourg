// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Shield,
    Clock,
    ChevronLeft,
    ChevronRight,
    FileText,
    UserPlus,
    Eye,
    LogIn,
    UserX,
    Download,
    Loader2,
} from 'lucide-react';

const ACTION_LABELS = {
    DOSSIER_VIEWED: { label: 'Dossier consulté', icon: Eye, color: 'text-amber-800 bg-amber-50' },
    DOSSIER_STATUS_UPDATED: { label: 'Statut mis à jour', icon: FileText, color: 'text-blue-600 bg-blue-50' },
    REGISTER_VIA_INVITE: { label: 'Inscription via invite', icon: UserPlus, color: 'text-emerald-700 bg-emerald-50' },
    INVITATION_SENT: { label: 'Invitation envoyée', icon: UserPlus, color: 'text-indigo-600 bg-indigo-50' },
    LOGIN_SUCCESS: { label: 'Connexion', icon: LogIn, color: 'text-slate-600 bg-slate-100' },
    USER_DISABLED: { label: 'Membre désactivé', icon: UserX, color: 'text-red-600 bg-red-50' },
    REGISTER_SUCCESS: { label: 'Inscription structure', icon: UserPlus, color: 'text-emerald-700 bg-emerald-50' },
};

/**
 * ProAuditLog — Journal d'audit RGPD
 *
 * Accessible uniquement aux STRUCTURE_ADMIN.
 * Affiche l'historique complet des accès avec filtrage et pagination.
 */
export default function ProAuditLog() {
    useOutletContext();

    const [entries, setEntries] = useState([]);

    const [loadProblem, setLoadProblem] = useState('');
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalCount: 0 });
    const [loading, setLoading] = useState(true);
    const [actionFilter, setActionFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);

    const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        setLoadProblem('');
        try {
            const params = new URLSearchParams({
                page: String(currentPage),
                limit: '30',
            });
            if (actionFilter !== 'all') {
                params.set('action', actionFilter);
            }

            const res = await fetch(`/api/pro/audit?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            // R7: a refusal or an outage is said — it showed « Aucune entrée trouvée », as if the journal were empty
            if (!res.ok) {
                setEntries([]);
                setLoadProblem(res.status === 403 ? 'Le journal d’audit est réservé aux administrateurs de la structure.' : res.status === 401
                    ? 'Votre session a expiré : reconnectez-vous.' : 'Le journal n’a pas pu être chargé. Ce n’est pas un journal vide : réessayez.');
                return;
            }
            const data = await res.json();
            setEntries(data.entries || []);
            setPagination(data.pagination || { page: 1, totalPages: 1, totalCount: 0 });
        } catch {
            setLoadProblem('Le service est momentanément injoignable : le journal n’a pas pu être chargé.');
        } finally {
            setLoading(false);
        }
    }, [currentPage, actionFilter, token]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const handleExport = () => {
        const csv = [
            'Date,Action,Acteur,IP Hash,Détails',
            ...entries.map((e) => {
                const date = new Date(e.timestamp).toLocaleString('fr-FR');
                const details = JSON.stringify(e.details || {}).replace(/"/g, "'");
                return `"${date}","${e.action}","${e.actorEmail || e.actorId}","${e.ipHash || ''}","${details}"`;
            }),
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Shield size={22} className="text-indigo-600" />
                        Journal d&apos;Audit
                    </h1>
                    <p className="text-sm text-slate-700">
                        Traçabilité des accès — Conformité RGPD
                    </p>
                </div>
                <div className="flex gap-2">
                    <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger className="w-[180px]" aria-label="Filtrer le journal par action">
                            <SelectValue placeholder="Filtrer par action" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Toutes les actions</SelectItem>
                            <SelectItem value="DOSSIER_VIEWED">Dossier consulté</SelectItem>
                            <SelectItem value="DOSSIER_STATUS_UPDATED">Statut mis à jour</SelectItem>
                            <SelectItem value="REGISTER_VIA_INVITE">Inscription invite</SelectItem>
                            <SelectItem value="INVITATION_SENT">Invitation envoyée</SelectItem>
                            <SelectItem value="LOGIN_SUCCESS">Connexion</SelectItem>
                            <SelectItem value="USER_DISABLED">Membre désactivé</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={handleExport}>
                        <Download className="mr-2 h-4 w-4" />
                        Export CSV
                    </Button>
                </div>
            </div>

            {/* Stats banner */}
            <Card className="bg-slate-50 border-slate-200">
                <CardContent className="py-3 px-4 flex items-center justify-between">
                    <p className="text-xs text-slate-700">
                        <span className="font-bold text-slate-700">{pagination.totalCount}</span> entrées
                        {actionFilter !== 'all' && (
                            <span> · Filtre: <span className="font-medium">{ACTION_LABELS[actionFilter]?.label || actionFilter}</span></span>
                        )}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-emerald-700">
                        <Shield size={12} />
                        <span className="font-bold">Audit trail actif</span>
                    </div>
                </CardContent>
            </Card>

            {/* Entries */}
            {loadProblem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="pro-audit-problem">{loadProblem}</p> : null}
            {loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : loadProblem ? null : entries.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-slate-600">
                        <Shield size={32} className="mx-auto mb-3 opacity-20" />
                        <p className="text-sm">Aucune entrée trouvée</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {entries.map((entry) => {
                        const meta = ACTION_LABELS[entry.action] || {
                            label: entry.action,
                            icon: Shield,
                            color: 'text-slate-600 bg-slate-100',
                        };
                        const IconComp = meta.icon;

                        return (
                            <Card key={entry.id} className="hover:shadow-sm transition-shadow">
                                <CardContent className="flex items-center gap-4 p-4">
                                    <div className={`p-2 rounded-lg shrink-0 ${meta.color.split(' ')[1]}`}>
                                        <IconComp size={14} className={meta.color.split(' ')[0]} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-900">
                                            {meta.label}
                                        </p>
                                        <p className="text-xs text-slate-700 truncate">
                                            {entry.actorEmail || entry.actorId?.slice(0, 8) || 'Système'}
                                            {entry.details?.shareId && (
                                                <> · Dossier #{entry.details.shareId.slice(0, 8)}</>
                                            )}
                                            {entry.details?.email && (
                                                <> · {entry.details.email}</>
                                            )}
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] text-slate-600 flex items-center gap-1">
                                            <Clock size={10} />
                                            {new Date(entry.timestamp).toLocaleString('fr-FR', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </p>
                                        {entry.ipHash && (
                                            <p className="text-[9px] text-slate-600 mt-0.5">
                                                IP: {entry.ipHash.slice(0, 8)}...
                                            </p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => p - 1)}
                    >
                        <ChevronLeft size={14} />
                    </Button>
                    <span className="text-xs text-slate-700">
                        Page {currentPage} / {pagination.totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= pagination.totalPages}
                        onClick={() => setCurrentPage((p) => p + 1)}
                    >
                        <ChevronRight size={14} />
                    </Button>
                </div>
            )}
        </div>
    );
}
