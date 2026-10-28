// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminClient as client, apiClient } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Database,
    Users,
    FileText,
    Activity,
    Zap,
    Cpu,
    CheckCircle,
    AlertCircle,
    Clock,
    Shield,
} from 'lucide-react';

/**
 * AdminDashboard — « À traiter » (owner LAB audit, 2026-10-25).
 *
 * The first screen answers « what waits for me? »: one card per review screen with the number of items waiting for a person (computed server-side by each
 * screen's own rule, GET /api/admin/stats → tasks), what to do, and the link to the screen where the decision is taken. The technical figures (counts, search
 * index, scheduled runs, feature flags) stay available below, folded.
 */
/** the last automatic verification, in one line (the detail is on /admin/veille): what the system did by itself */
function VeilleSummary() {
    const { data } = useQuery({ queryKey: ['admin-veille'], queryFn: () => apiClient.admin.getVeille(7), refetchInterval: 60_000 });
    if (!data) return null;
    // the last run that did something (a run put off by a QA campaign or by the pause is not one), and only the alerts that matter
    const last = data.status?.lastRun || (data.runs || []).find((r) => r.job === 'veille' && !['skipped', 'running'].includes(r.status));
    const c = last?.metrics?.counts || {};
    const n = (re) => Object.entries(c).filter(([k]) => re.test(k)).reduce((t, [, v]) => t + Number(v || 0), 0);
    const alerts = (data.alerts || []).filter((a) => a.level !== 'info');
    return (
        <Card data-testid="admin-veille-summary"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-slate-800">
                <strong>Veille automatique</strong> — {data.status?.paused?.paused ? 'en pause. ' : ''}{last ? `dernière le ${new Date(last.startedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' })} : ${n(/:PUBLISHED$/) + n(/:CREATED$/)} publiées ou ajoutées, ${n(/:(UPDATED|CORRECTED)$/)} mises à jour, ${n(/:WITHDRAWN$/)} retirées.` : 'pas encore de veille : la première a lieu cette nuit à 3 h 17.'}
                {' '}Les fiches se vérifient seules ; vous n’avez rien à valider.{alerts.length ? ` ${alerts.length} alerte(s) à lire.` : ''}
            </p>
            <Link to="/admin/veille" className="text-sm font-medium text-blue-700 underline underline-offset-2">Voir ce que le système a fait</Link>
        </CardContent></Card>
    );
}

export default function AdminDashboard() {
    const { data: rawData, isLoading, error, dataUpdatedAt } = useQuery({
        queryKey: ['admin-stats'],
        queryFn: () => client.get('/api/admin/stats').then(r => r.data),
        refetchInterval: 30_000, // Refresh every 30s
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
                        <p className="text-slate-600">Erreur de chargement des statistiques</p>
                        <p className="text-sm text-slate-600 mt-1">{error.message}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // API returns { success, data: { counts, features, ... } }
    // client.get() wraps in { data: payload }, so rawData = { success, data: {...} }
    const inner = rawData?.data || rawData || {};
    const stats = inner.counts || {};
    const features = inner.features || {};
    const infra = inner.infrastructure || {};
    const activity = inner.activity || {};
    const rag = inner.rag || { total: 0, indexed: 0, missing: 0 };
    const tasks = inner.tasks || {};
    const loadedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('fr-FR') : '—';
    const n = (v) => (v == null ? null : Number(v));
    const sum = (...vals) => (vals.some((v) => v == null) ? null : vals.reduce((a, v) => a + Number(v), 0));

    const ws2 = tasks.ws2;
    const orgs = tasks.organizations;
    const cards = [
        {
            key: 'ws2', title: 'Fiches du lancement (WS2)', to: '/admin/ws2', count: ws2 ? n(ws2.pending) : null, unit: 'jamais examinée(s)',
            detail: ws2 ? `${ws2.onHold} en attente · ${ws2.rejected} refusée(s) · ${ws2.humanVerified} vérifiée(s) sur ${ws2.records}` : null,
            todo: 'Vérifier une fiche demande la source officielle ouverte, la relecture complète et la confirmation du territoire. Les fiches en attente reviennent ici après correction.',
        },
        {
            key: 'orgs', title: 'Organisations', to: '/admin/organizations', count: orgs ? n(orgs.never) : null, unit: 'sans décision',
            detail: orgs ? `${orgs.onHold} en attente · ${orgs.rejected} refusée(s) · ${orgs.verified} vérifiée(s) sur ${orgs.total}` : null,
            todo: 'Vérifier l’identité d’une organisation sur un registre officiel, séparément de son activité.',
        },
        { key: 'dup', title: 'Doublons proposés', to: '/admin/doublons', count: n(tasks.duplicates), unit: 'paire(s)', todo: 'Comparer les deux fiches et décider sur une source officielle ; rien n’est fusionné automatiquement.' },
        { key: 'prop', title: 'Propositions de fiches', to: '/admin/structure-proposals', count: n(tasks.proposals), unit: 'en attente', todo: 'Accepter avec une source officielle ou refuser avec un motif.' },
        { key: 'falc', title: 'Textes faciles à lire (FALC)', to: '/admin/falc', count: n(tasks.falc), unit: 'brouillon(s)', todo: 'Relire chaque brouillon avant de l’approuver ; un brouillon n’est jamais publié seul.' },
        { key: 'rep', title: 'Signalements et suggestions', to: '/admin/signalements', count: n(tasks.reports), unit: 'nouveau(x) ou en cours', todo: 'Traiter chaque signalement du public et noter la décision.' },
        { key: 'quality', title: 'File qualité des données', to: '/admin/review-queue', count: n(tasks.quality), unit: 'élément(s) ouvert(s)', todo: 'Résoudre ou écarter chaque élément avec votre motif.' },
        { key: 'ai', title: 'Suggestions de l’IA', to: '/admin/ai-oversight', count: n(tasks.aiSuggestions), unit: 'à examiner', todo: 'Une suggestion ne s’applique jamais seule : acceptez-la ou rejetez-la avec une note.' },
        {
            key: 'privacy', title: 'Protection des données', to: '/admin/privacy', count: sum(tasks.accessRequests, tasks.erasures, tasks.closures), unit: 'demande(s) en cours',
            detail: tasks.accessRequests == null ? null : `${tasks.accessRequests} accès · ${tasks.erasures} effacement(s) · ${tasks.closures} fermeture(s)`,
            todo: 'Deux personnes : l’une propose, une autre confirme après sa propre lecture journalisée.',
        },
        { key: 'support', title: 'Demandes d’aide', to: '/admin/support', count: n(tasks.support), unit: 'ouverte(s)', todo: 'Répondre ou orienter ; les demandes liées aux données vont à la protection des données.' },
        { key: 'bg', title: 'Accès d’urgence à examiner', to: '/admin/operations', count: n(tasks.breakGlass), unit: 'à examiner', todo: 'Un accès d’urgence est examiné ensuite par une autre personne, avec les actions faites pendant la fenêtre.' },
    ];
    const waiting = cards.filter((c) => c.count > 0);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 py-6">
                <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="flex flex-wrap justify-between items-center gap-3">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 mb-1">
                                À traiter
                            </h1>
                            <p className="text-slate-700 text-sm">
                                Ce qui attend la décision d’une personne. Chaque carte mène à l’écran où décider.
                                {waiting.length ? ` ${waiting.length} écran(s) ont des éléments en attente.` : ' Rien n’est en attente.'}
                            </p>
                        </div>
                        {/* owner LAB audit: the badge states only what is known — when the figures were read */}
                        <Badge className="bg-slate-100 text-slate-800 border-0 gap-1" data-testid="admin-dashboard-loaded-at">
                            <Zap className="h-3 w-3" />
                            Chiffres lus à {loadedAt}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                <VeilleSummary />
                <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="admin-tasks">
                    {cards.map((c) => (
                        <li key={c.key} data-testid="admin-task" data-task={c.key}
                            className={`rounded-lg border bg-white p-4 ${c.count > 0 ? 'border-amber-400' : 'border-slate-200'}`}>
                            <div className="flex items-start justify-between gap-3">
                                <h2 className="font-semibold text-slate-900">{c.title}</h2>
                                <span className={`shrink-0 rounded px-2 py-0.5 text-sm font-semibold ${c.count == null ? 'bg-slate-100 text-slate-800' : c.count > 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`} data-testid="admin-task-count">
                                    {c.count == null ? 'indisponible' : c.count > 0 ? `${c.count} ${c.unit}` : 'Rien en attente'}
                                </span>
                            </div>
                            {c.detail ? <p className="mt-1 text-xs text-slate-700">{c.detail}</p> : null}
                            <p className="mt-2 text-sm text-slate-700">{c.todo}</p>
                            <Link to={c.to} className="mt-3 inline-flex min-h-11 items-center rounded border border-slate-300 px-3 text-sm font-medium text-blue-800 hover:bg-slate-50">
                                Ouvrir « {c.title} »
                            </Link>
                        </li>
                    ))}
                </ul>

                <details className="rounded-lg border border-slate-200 bg-white" data-testid="admin-dashboard-technical">
                    <summary className="cursor-pointer p-4 font-semibold text-slate-800">Vue technique : compteurs, index de recherche, tâches planifiées, fonctionnalités</summary>
                    <div className="space-y-6 p-4 pt-0">
                        {/* Stats Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                            <StatCard icon={<FileText className="text-indigo-600" />} label="Aides" value={stats.aides} />
                            <StatCard icon={<FileText className="text-purple-600" />} label="Démarches" value={stats.demarches} />
                            <StatCard icon={<Shield className="text-blue-600" />} label="Administrateurs" value={stats.admins} />
                            <StatCard icon={<Users className="text-emerald-700" />} label="Comptes citoyens" value={stats.citizens} />
                            <StatCard icon={<Activity className="text-orange-600" />} label="Exécutions planifiées" value={stats.cronRuns} />
                        </div>

                        {/* RAG Health Card */}
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                        <Cpu className="h-4 w-4 text-indigo-500" />
                                        Index de recherche{rag.dimensions ? ` (vecteurs ${rag.dimensions} dimensions)` : ''}
                                    </h3>
                                    <Badge className={rag.missing === 0 && !rag.stale ? 'bg-emerald-100 text-emerald-700 border-0' : 'bg-amber-100 text-amber-700 border-0'}>
                                        {rag.missing === 0 && !rag.stale ? 'À jour' : [rag.missing ? `${rag.missing} sans vecteur` : '', rag.stale ? `${rag.stale} à recalculer` : ''].filter(Boolean).join(', ')}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-700">{rag.indexed} / {rag.total} aides avec un vecteur{rag.stale ? ` (dont ${rag.stale} calculé${rag.stale > 1 ? 's' : ''} avant la dernière modification de la fiche)` : ''}</span>
                                            <span className="font-bold text-slate-800">
                                                {rag.total > 0 ? Math.round((rag.indexed / rag.total) * 100) : 0}%
                                            </span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all ${rag.missing === 0 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                                style={{ width: `${rag.total > 0 ? (rag.indexed / rag.total) * 100 : 0}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 space-y-4">
                                <Card>
                                    <CardContent className="p-0">
                                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-slate-600" />
                                                Dernières exécutions planifiées
                                            </h3>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {(activity.recentCrons || []).length === 0 ? (
                                                <p className="p-4 text-sm text-slate-600">Aucune exécution planifiée (normal dans le LAB local : aucune tâche n’y est programmée).</p>
                                            ) : (
                                                (activity.recentCrons || []).map((cron) => (
                                                    <div key={cron.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                                                        <div className="flex items-center gap-3">
                                                            {cron.status === 'completed' ? (
                                                                <CheckCircle className="h-4 w-4 text-emerald-500" />
                                                            ) : (
                                                                <AlertCircle className="h-4 w-4 text-amber-500" />
                                                            )}
                                                            <div>
                                                                <p className="text-sm font-semibold text-slate-800">{cron.jobName}</p>
                                                                <p className="text-xs text-slate-600">
                                                                    {cron.itemsProcessed != null && `${cron.itemsProcessed} éléments • `}
                                                                    {cron.durationMs != null && `${(cron.durationMs / 1000).toFixed(1)} s`}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <span className="text-xs text-slate-600">
                                                            {cron.startedAt ? new Date(cron.startedAt).toLocaleString('fr-FR') : '—'}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="p-0">
                                        <div className="p-4 border-b border-slate-100">
                                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                                <Database className="h-4 w-4 text-slate-600" />
                                                Derniers imports
                                            </h3>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {(activity.recentImports || []).length === 0 ? (
                                                <p className="p-4 text-sm text-slate-600">Aucun import récent.</p>
                                            ) : (
                                                (activity.recentImports || []).map((log) => (
                                                    <div key={log.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                                                        <div className="flex items-center gap-3">
                                                            {log.status === 'success' ? (
                                                                <CheckCircle className="h-4 w-4 text-emerald-500" />
                                                            ) : (
                                                                <AlertCircle className="h-4 w-4 text-amber-500" />
                                                            )}
                                                            <div>
                                                                <p className="text-sm font-semibold text-slate-800">{log.sourceName}</p>
                                                                <p className="text-xs text-slate-600">
                                                                    {log.itemsCreated != null && `+${log.itemsCreated} créées`}
                                                                    {log.itemsUpdated != null && ` / ${log.itemsUpdated} mises à jour`}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <span className="text-xs text-slate-600">
                                                            {log.createdAt ? new Date(log.createdAt).toLocaleString('fr-FR') : '—'}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <div className="space-y-4">
                                <Card>
                                    <CardContent className="p-4">
                                        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                            <Shield className="h-4 w-4 text-slate-600" />
                                            Fonctionnalités activées
                                        </h3>
                                        <div className="space-y-3">
                                            <FlagRow label="Agent IA" code="AI_AGENT" enabled={features.AI_AGENT} />
                                            <FlagRow label="RAG" code="RAG" enabled={features.RAG} />
                                            <FlagRow label="OpenFisca" code="OPENFISCA" enabled={features.OPENFISCA} />
                                            <FlagRow label="Cache" code="CACHE" enabled={features.CACHE} />
                                            <FlagRow label="Maintenance" code="MAINTENANCE" enabled={features.MAINTENANCE} warning />
                                            <FlagRow label="Audit RGPD" code="AUDIT_LOG" enabled={features.AUDIT_LOG} />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="p-4">
                                        <h3 className="font-bold text-slate-800 mb-4">Infrastructure</h3>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-slate-700">Environnement</span>
                                                <Badge variant="outline">{infra.nodeEnv}</Badge>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-700">Cache</span>
                                                <Badge variant="outline">{infra.cache?.backend || '—'}</Badge>
                                            </div>
                                            {infra.cache?.memorySize != null && (
                                                <div className="flex justify-between">
                                                    <span className="text-slate-700">Entrées en cache</span>
                                                    <span className="text-slate-800 font-medium">{infra.cache.memorySize}</span>
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </div>
                </details>
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
                <p className="text-2xl font-bold text-slate-900">{value ?? '—'}</p>
                <p className="text-sm text-slate-700">{label}</p>
            </CardContent>
        </Card>
    );
}

// @ts-ignore
function FlagRow({ label, code, enabled, warning = false }) {
    return (
        <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">{label}</span>
                <code className="text-[10px] bg-slate-200 px-1 py-0.5 rounded text-slate-700">{code}</code>
            </div>
            <div className={`w-2 h-2 rounded-full ${enabled
                ? (warning ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]' : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]')
                : 'bg-slate-300'
                }`} />
        </div>
    );
}
