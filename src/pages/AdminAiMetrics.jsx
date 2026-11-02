// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { adminClient as client } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SkeletonList } from '@/components/ui/skeleton';
import {
    Cpu, Zap, Clock, AlertTriangle, DollarSign,
    Activity, RefreshCw, AlertCircle,
} from 'lucide-react';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

/**
 * AdminAiMetrics
 *
 * Displays the AI usage metrics recorded by the platform (AiMetric: tokens, costs, latency, error rate) — no online AI provider is approved; the LAB uses a
 * local model. Data from GET /api/admin/ai-metrics.
 * PKG-6 / A14: the « Modèle local » section shows real runs of the local model (local-ai-metrics.js): outcomes, latency p50/p95, reason codes, RAG coverage.
 */
export default function AdminAiMetrics() {
    const { t } = useT('admin');
    const { data: rawData, isLoading, error, refetch } = useQuery({
        queryKey: ['admin-ai-metrics'],
        queryFn: () => client.get('/api/admin/ai-metrics').then(r => r.data),
        refetchInterval: 30_000,
    });

    // the page keeps its title while it loads or fails (a heading for screen readers and the route checks; a rate-limited or failed request is not a blank page)
    if (isLoading) {
        return (
            <div className="w-full p-4"><h1 className="text-2xl font-bold text-slate-900 mb-4">{t('admin:ai_metrics.title', 'Métriques IA')}</h1><SkeletonList count={3} variant="card" /></div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <h1 className="text-2xl font-bold text-slate-900 mb-4">{t('admin:ai_metrics.title', 'Métriques IA')}</h1>
                {/* R8: the status is error.status (apiRequest), the 429 text was never shown; no raw « API Error: 500 »; a way to try again */}
                <Card>
                    <CardContent className="p-8 text-center" role="alert" data-testid="admin-ai-metrics-error">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" aria-hidden="true" />
                        <p className="text-slate-700">{(error?.status ?? error?.response?.status) === 429 ? t('admin:ai_metrics.error_429', 'Trop de demandes en peu de temps : réessayez dans une minute.')
                            : (error?.status ?? error?.response?.status) === 401 || (error?.status ?? error?.response?.status) === 403 ? t('admin:ai_metrics.error_auth', 'Session expirée ou accès refusé : reconnectez-vous.')
                                : t('admin:ai_metrics.error_load', 'Les métriques IA n’ont pas pu être chargées.')}</p>
                        <button type="button" className="mt-3 rounded border px-3 py-1 text-sm underline" data-testid="admin-ai-metrics-retry" onClick={() => refetch()}>{t('admin:ai_metrics.retry', 'Réessayer')}</button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // API may return data directly or wrapped in { data: ... }
    const m = rawData?.data || rawData || {};
    const byType = m.by_type || {};
    const last24h = m.last_24h || {};
    const local = m.local || null;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 py-6">
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 mb-1">
                                {t('admin:ai_metrics.title', 'Métriques IA')}
                            </h1>
                            <p className="text-slate-500 text-sm">
                                {t('admin:ai_metrics.subtitle', 'Utilisation, coûts et performance du moteur IA')}
                            </p>
                            {m.source === 'memory' ? (
                                <p role="status" data-testid="admin-ai-metrics-memory" className="mt-2 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
                                    {m.degraded ? t('admin:ai_metrics.memory_degraded', 'Base des métriques injoignable : chiffres de ce seul serveur depuis son démarrage, pas l’historique du service.') : t('admin:ai_metrics.memory', 'chiffres de ce seul serveur depuis son démarrage, pas l’historique du service.')}
                                </p>
                            ) : null}
                        </div>
                        <button
                            onClick={() => refetch()}
                            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50"
                        >
                            <RefreshCw className="h-4 w-4" />
                            {t('admin:ai_metrics.refresh', 'Actualiser')}
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                <LocalModelSection local={local} />

                <h2 className="text-lg font-bold text-slate-800">{t('admin:ai_metrics.online_provider', 'Fournisseur d’IA en ligne (Gemini) : non approuvé, désactivé — toute requête ci-dessous serait anormale')}</h2>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard
                        icon={<Zap className="text-amber-600" />}
                        label={t('admin:ai_metrics.total_requests', 'Requêtes totales')}
                        value={m.total_requests ?? 0}
                    />
                    <MetricCard
                        icon={<Cpu className="text-indigo-600" />}
                        label={t('admin:ai_metrics.tokens_used', 'Tokens consommés')}
                        value={formatNumber(m.total_tokens ?? 0)}
                    />
                    <MetricCard
                        icon={<DollarSign className="text-emerald-600" />}
                        label={t('admin:ai_metrics.estimated_cost', 'Coût estimé (USD)')}
                        value={`$${(m.estimated_cost_usd ?? 0).toFixed(4)}`}
                    />
                    <MetricCard
                        icon={<Clock className="text-blue-600" />}
                        label={t('admin:ai_metrics.avg_latency', 'Latence moyenne')}
                        value={`${m.avg_latency_ms ?? 0} ms`}
                    />
                </div>

                {/* Error & Circuit Breaker Row */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                                <span className="text-sm font-semibold text-slate-700">{t('admin:ai_metrics.error_rate', 'Taux d\'erreur')}</span>
                            </div>
                            <p className="text-2xl font-bold text-slate-900">
                                {m.error_rate_pct ?? 0}%
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Activity className="h-4 w-4 text-orange-500" />
                                <span className="text-sm font-semibold text-slate-700">{t('admin:ai_metrics.circuit_breaker', 'Circuit Breaker Trips')}</span>
                            </div>
                            <p className="text-2xl font-bold text-slate-900">
                                {m.circuit_breaker_trips ?? 0}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Zap className="h-4 w-4 text-blue-500" />
                                <span className="text-sm font-semibold text-slate-700">{t('admin:ai_metrics.last_24h', 'Dernières 24h')}</span>
                            </div>
                            <p className="text-lg font-bold text-slate-900">
                                {t('admin:ai_metrics.last_24h_value', '{{requests}} req · {{tokens}} tokens', { requests: last24h.requests ?? 0, tokens: formatNumber(last24h.tokens ?? 0) })}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* By Type Table */}
                <Card>
                    <CardContent className="p-0">
                        <div className="p-4 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Cpu className="h-4 w-4 text-slate-600" />
                                {t('admin:ai_metrics.by_type', 'Détail par type d\'agent')}
                            </h3>
                        </div>
                        {Object.keys(byType).length === 0 ? (
                            <p className="p-4 text-sm text-slate-600">
                                {t('admin:ai_metrics.no_metric', 'Aucune métrique enregistrée')}
                            </p>
                        ) : (
                            <div className="relative overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 text-left">
                                            <th className="px-4 py-3 font-semibold text-slate-600">{t('admin:ai_metrics.col_type', 'Type')}</th>
                                            <th className="px-4 py-3 font-semibold text-slate-600 text-right">{t('admin:ai_metrics.col_requests', 'Requêtes')}</th>
                                            <th className="px-4 py-3 font-semibold text-slate-600 text-right">{t('admin:ai_metrics.col_tokens', 'Tokens')}</th>
                                            <th className="px-4 py-3 font-semibold text-slate-600 text-right">{t('admin:ai_metrics.col_errors', 'Erreurs')}</th>
                                            <th className="px-4 py-3 font-semibold text-slate-600 text-right">{t('admin:ai_metrics.col_error_rate', 'Taux erreur')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {Object.entries(byType).map(([type, data]) => {
                                            const errorRate = data.requests > 0
                                                ? ((data.errors / data.requests) * 100).toFixed(1)
                                                : '0.0';
                                            return (
                                                <tr key={type} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3">
                                                        <Badge variant="outline" className="font-mono text-xs">
                                                            {type}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-medium">{data.requests}</td>
                                                    <td className="px-4 py-3 text-right">{formatNumber(data.tokens)}</td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className={data.errors > 0 ? 'text-red-600 font-medium' : 'text-slate-600'}>
                                                            {data.errors}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">{errorRate}%</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Storage Info */}
                <p className="text-xs text-slate-600 text-right">
                    {t('admin:ai_metrics.storage', 'Source : {{storage}}', { storage: m.storage || 'unknown' })}
                    {m.buffer_size != null && t('admin:ai_metrics.buffer', ' · Buffer: {{size}}/{{max}}', { size: m.buffer_size, max: m.buffer_max })}
                </p>
            </div>
        </div>
    );
}

const outcomeLabels = (t) => ({ answered: t('admin:ai_metrics.outcome_answered', 'Réponses sourcées'), abstained: t('admin:ai_metrics.outcome_abstained', 'Abstentions'), blocked: t('admin:ai_metrics.outcome_blocked', 'Bloquées par une règle'), error: t('admin:ai_metrics.outcome_error', 'Erreurs') });

/**
 * PKG-6 / A14 — real runs of the local model. No message text is stored: only an outcome, a reason code, the latency of the model call and the token counts.
 * @param {{ local: any }} props
 */
function LocalModelSection({ local }) {
    const { t } = useT('admin');
    if (!local) {
        return (
            <Card data-testid="admin-ai-local">
                <CardContent className="p-4 text-sm text-slate-500">{t('admin:ai_metrics.local_unavailable', 'Métriques du modèle local indisponibles.')}</CardContent>
            </Card>
        );
    }
    const a = local.assistant || {};
    const rag = local.rag || {};
    return (
        <section className="space-y-4" data-testid="admin-ai-local" aria-labelledby="admin-ai-local-title">
            <div>
                <h2 id="admin-ai-local-title" className="text-lg font-bold text-slate-800">{t('admin:ai_metrics.local_title', 'Modèle local (assistant public, FALC)')}</h2>
                <p className="text-sm text-slate-500">
                    {t('admin:ai_metrics.local_intro', '{{days}} derniers jours. Aucun texte de question ni de réponse n\'est enregistré : seulement le résultat, un code de motif, la durée et le nombre de tokens. Coût : 0 (exécution locale).', { days: local.windowDays })}
                </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <MetricCard icon={<Zap className="text-amber-600" />} label={t('admin:ai_metrics.assistant_questions', 'Questions à l\'assistant')} value={a.total ?? 0} />
                {Object.entries(outcomeLabels(t)).map(([k, label]) => (
                    <MetricCard key={k} icon={<Activity className="text-slate-500" />} label={label} value={a[`${k}Pct`] == null ? '—' : `${a[`${k}Pct`]} %`} />
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Clock className="h-4 w-4 text-blue-600" />{t('admin:ai_metrics.latency_title', 'Durée des appels au modèle')}</h3>
                        {(local.latencyMs || []).length === 0 ? <p className="text-sm text-slate-600">{t('admin:ai_metrics.no_call', 'Aucun appel au modèle.')}</p> : (
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-slate-500"><th className="py-1">{t('admin:ai_metrics.col_usage', 'Usage')}</th><th className="py-1 text-right">{t('admin:ai_metrics.col_calls', 'Appels')}</th><th className="py-1 text-right">p50</th><th className="py-1 text-right">p95</th></tr></thead>
                                <tbody>{local.latencyMs.map((l) => (
                                    <tr key={l.feature}><td className="py-1">{l.feature}</td><td className="py-1 text-right">{l.calls}</td><td className="py-1 text-right">{l.p50} ms</td><td className={`py-1 text-right ${l.p95 >= 30000 ? 'text-red-600 font-medium' : ''}`}>{l.p95} ms</td></tr>
                                ))}</tbody>
                            </table>
                        )}
                        <p className="text-xs text-slate-600 mt-2">{t('admin:ai_metrics.limit', 'Limite : 30 000 ms par appel.')}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-orange-500" />{t('admin:ai_metrics.reasons', 'Motifs')}</h3>
                        {(local.reasons || []).length === 0 ? <p className="text-sm text-slate-600">{t('admin:ai_metrics.none', 'Aucun.')}</p> : (
                            <ul className="text-sm space-y-1">{local.reasons.slice(0, 10).map((r) => (
                                <li key={`${r.type}-${r.reason}`} className="flex justify-between gap-2"><span className="font-mono text-xs">{r.type} · {r.reason}</span><span>{r.n}</span></li>
                            ))}</ul>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Cpu className="h-4 w-4 text-indigo-600" />{t('admin:ai_metrics.rag_title', 'Index de recherche (RAG)')}</h3>
                        <p className="text-sm text-slate-700"><Trans i18n={i18n} i18nKey="admin:ai_metrics.rag_published" defaults="Aides visibles par le public : <0>{{published}}</0>, dont indexées : <1>{{embedded}}</1>{{coverage}}" values={{ published: rag.published ?? 0, embedded: rag.publishedEmbedded ?? 0, coverage: rag.publishedCoveragePct == null ? '' : ` (${rag.publishedCoveragePct} %)` }} components={[<strong key="p" />, <strong key="e" />]} /></p>
                        <p className="text-sm text-slate-700 mt-1"><Trans i18n={i18n} i18nKey="admin:ai_metrics.rag_unknown_model" defaults="Vecteurs sans modèle déclaré : <0>{{n}}</0>" values={{ n: rag.embeddedUnknownModel ?? 0 }} components={[<strong key="n" />]} /></p>
                        <p className="text-sm text-slate-700 mt-1">{t('admin:ai_metrics.falc_drafts', 'Brouillons FALC : {{drafted}} par le modèle, {{fallback}} par le résumé automatique', { drafted: local.falc?.drafted ?? 0, fallback: local.falc?.fallback ?? 0 })}</p>
                    </CardContent>
                </Card>
            </div>
        </section>
    );
}

// @ts-ignore
function MetricCard({ icon, label, value }) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-slate-50 rounded-lg">{icon}</div>
                </div>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
                <p className="text-sm text-slate-500">{label}</p>
            </CardContent>
        </Card>
    );
}

/**
 * @param {number} n
 */
function formatNumber(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}
