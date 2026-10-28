import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminClient as client } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    ThumbsDown,
    ThumbsUp,
    MessageCircle,
    AlertCircle,
    RefreshCw,
    Loader2,
    Clock,
    Sparkles,
} from 'lucide-react';

/**
 * AdminAudit
 *
 * "Mur des Améliorations" — shows negatively-rated AI responses
 * so admins can identify gaps in the RAG knowledge base.
 */
export default function AdminAudit() {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['admin-audit'],
        queryFn: () =>
            client
                .get('/api/admin/conversations?rating=-1&limit=50')
                .then((r) => r.data?.data || { logs: [], stats: {} }),
        refetchInterval: 60_000,
    });

    const logs = data?.logs || [];
    const stats = data?.stats || {};
    const positiveCount = stats.positive || 0;
    const negativeCount = stats.negative || 0;
    const total = positiveCount + negativeCount;
    const satisfactionRate = total > 0 ? Math.round((positiveCount / total) * 100) : 0;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="border-b border-slate-200 bg-white py-6">
                <div className="mx-auto max-w-5xl px-4 sm:px-6">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
                                <div className="rounded-xl bg-red-100 p-2 text-red-600">
                                    <AlertCircle className="h-5 w-5" />
                                </div>
                                Mur des Améliorations
                            </h1>
                            <p className="text-sm text-slate-700">
                                Retours négatifs des usagers — priorités de correction RAG
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
                                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                                Actualiser
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 space-y-6">
                {/* Stats Row */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-1">
                                <ThumbsDown className="h-4 w-4 text-red-500" />
                            </div>
                            <p className="text-2xl font-bold text-red-600">{negativeCount}</p>
                            <p className="text-sm text-slate-700">Insatisfactions</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-1">
                                <ThumbsUp className="h-4 w-4 text-emerald-500" />
                            </div>
                            <p className="text-2xl font-bold text-emerald-700">{positiveCount}</p>
                            <p className="text-sm text-slate-700">Satisfactions</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-1">
                                <Sparkles className="h-4 w-4 text-indigo-500" />
                            </div>
                            <p className={`text-2xl font-bold ${satisfactionRate >= 80 ? 'text-emerald-700' : satisfactionRate >= 50 ? 'text-amber-800' : 'text-red-600'}`}>
                                {satisfactionRate}%
                            </p>
                            <p className="text-sm text-slate-700">Satisfaction</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-1">
                                <MessageCircle className="h-4 w-4 text-slate-400" />
                            </div>
                            <p className="text-2xl font-bold text-slate-800">{total}</p>
                            <p className="text-sm text-slate-700">Total feedbacks</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Content */}
                {isLoading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : error ? (
                    <Card>
                        <CardContent className="p-8 text-center">
                            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-400" />
                            <p className="text-slate-600">Erreur de chargement</p>
                            <p className="mt-1 text-sm text-slate-400">{error.message}</p>
                        </CardContent>
                    </Card>
                ) : logs.length === 0 ? (
                    <Card className="border-emerald-100 bg-emerald-50">
                        <CardContent className="p-12 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-500">
                                <ThumbsUp className="h-8 w-8" />
                            </div>
                            <h3 className="mb-1 text-xl font-bold text-emerald-800">Qualité Optimale !</h3>
                            <p className="text-sm text-emerald-700">
                                Aucun retour négatif récent. Le RAG fonctionne bien.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        <h3 className="px-1 text-sm font-semibold text-red-600">
                            ⚠️ {logs.length} réponse{logs.length > 1 ? 's' : ''} à améliorer
                        </h3>
                        {logs.map((/** @type {{ createdAt: string | number, id: string | number, message: string | number, searchMode: string | number, userComment: string | number }} */ log) => (
                            <Card key={log.id} className="group transition-all hover:border-red-200 hover:shadow-md">
                                <CardContent className="p-5">
                                    <div className="mb-4 flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="rounded-xl bg-red-50 p-2.5 text-red-500 transition-colors group-hover:bg-red-500 group-hover:text-white">
                                                <ThumbsDown className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                                    Échec de pertinence
                                                </p>
                                                <p className="flex items-center gap-1 text-xs text-slate-400">
                                                    <Clock className="h-3 w-3" />
                                                    {new Date(log.createdAt).toLocaleString('fr-FR')}
                                                </p>
                                            </div>
                                        </div>
                                        {log.searchMode && (
                                            <Badge className="border-0 bg-slate-100 text-[10px] font-bold uppercase text-slate-700">
                                                {log.searchMode}
                                            </Badge>
                                        )}
                                    </div>

                                    {/* User question */}
                                    <div className="mb-3">
                                        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-indigo-400">
                                            <MessageCircle className="h-3 w-3" /> Question de l&#39;usager
                                        </p>
                                        <p className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold italic leading-relaxed text-slate-800">
                                            &ldquo;{log.message}&rdquo;
                                        </p>
                                    </div>

                                    {/* User comment */}
                                    {log.userComment && (
                                        <div className="rounded-2xl border-l-4 border-red-400 bg-red-50/50 p-4">
                                            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-red-500">
                                                <AlertCircle className="h-3 w-3" /> Raison du mécontentement
                                            </p>
                                            <p className="text-sm font-medium italic leading-relaxed text-slate-700">
                                                &ldquo;{log.userComment}&rdquo;
                                            </p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
