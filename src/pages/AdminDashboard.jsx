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
import { useT, formatDateTime, formatTime } from '@/i18n';

/**
 * AdminDashboard — « À traiter » (owner LAB audit, 2026-10-25).
 *
 * The first screen answers « what waits for me? »: one card per review screen with the number of items waiting for a person (computed server-side by each
 * screen's own rule, GET /api/admin/stats → tasks), what to do, and the link to the screen where the decision is taken. The technical figures (counts, search
 * index, scheduled runs, feature flags) stay available below, folded.
 */
/** the last automatic verification, in one line (the detail is on /admin/veille): what the system did by itself */
function VeilleSummary() {
    const { t } = useT('admin');
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
                <strong>{t('admin:dashboard.veille.title', 'Veille automatique')}</strong> — {data.status?.paused?.paused ? t('admin:dashboard.veille.paused', 'en pause. ') : ''}{last ? t('admin:dashboard.veille.last', 'dernière le {{date}} : {{added}} publiées ou ajoutées, {{updated}} mises à jour, {{withdrawn}} retirées.', { date: formatDateTime(last.startedAt, { dateStyle: 'medium', timeStyle: 'short'}), added: n(/:PUBLISHED$/) + n(/:CREATED$/), updated: n(/:(UPDATED|CORRECTED)$/), withdrawn: n(/:WITHDRAWN$/) }) : t('admin:dashboard.veille.none', 'pas encore de veille : la première a lieu cette nuit à 3 h 17.')}
                {' '}{t('admin:dashboard.veille.self_check', 'Les fiches se vérifient seules ; vous n’avez rien à valider.')}{alerts.length ? ` ${t('admin:dashboard.veille.alerts', '{{n}} alerte(s) à lire.', { n: alerts.length })}` : ''}
            </p>
            <Link to="/admin/veille" className="text-sm font-medium text-blue-700 underline underline-offset-2">{t('admin:dashboard.veille.link', 'Voir ce que le système a fait')}</Link>
        </CardContent></Card>
    );
}

export default function AdminDashboard() {
    const { t } = useT('admin');
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
                        <p className="text-slate-600">{t('admin:dashboard.load_error', 'Erreur de chargement des statistiques')}</p>
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
    const loadedAt = dataUpdatedAt ? formatTime(dataUpdatedAt) : '—';
    const n = (v) => (v == null ? null : Number(v));
    const sum = (...vals) => (vals.some((v) => v == null) ? null : vals.reduce((a, v) => a + Number(v), 0));

    const ws2 = tasks.ws2;
    const orgs = tasks.organizations;
    const cards = [
        {
            key: 'ws2', title: t('admin:dashboard.card.ws2.title', 'Fiches du lancement (WS2)'), to: '/admin/ws2', count: ws2 ? n(ws2.pending) : null, unit: t('admin:dashboard.card.ws2.unit', 'jamais examinée(s)'),
            detail: ws2 ? t('admin:dashboard.card.ws2.detail', '{{onHold}} en attente · {{rejected}} refusée(s) · {{verified}} vérifiée(s) sur {{total}}', { onHold: ws2.onHold, rejected: ws2.rejected, verified: ws2.humanVerified, total: ws2.records }) : null,
            todo: t('admin:dashboard.card.ws2.todo', 'Vérifier une fiche demande la source officielle ouverte, la relecture complète et la confirmation du territoire. Les fiches en attente reviennent ici après correction.'),
        },
        {
            key: 'orgs', title: t('admin:dashboard.card.orgs.title', 'Organisations'), to: '/admin/organizations?decision=never', count: orgs ? n(orgs.never) : null, unit: t('admin:dashboard.card.orgs.unit', 'sans décision'),
            detail: orgs ? t('admin:dashboard.card.orgs.detail', '{{onHold}} en attente · {{rejected}} refusée(s) · {{verified}} vérifiée(s) sur {{total}}', { onHold: orgs.onHold, rejected: orgs.rejected, verified: orgs.verified, total: orgs.total }) : null,
            todo: t('admin:dashboard.card.orgs.todo', 'Vérifier l’identité d’une organisation sur un registre officiel, séparément de son activité.'),
        },
        { key: 'dup', title: t('admin:dashboard.card.dup.title', 'Doublons proposés'), to: '/admin/doublons', count: n(tasks.duplicates), unit: t('admin:dashboard.card.dup.unit', 'paire(s)'), todo: t('admin:dashboard.card.dup.todo', 'Comparer les deux fiches et décider sur une source officielle ; rien n’est fusionné automatiquement.') },
        { key: 'prop', title: t('admin:dashboard.card.prop.title', 'Propositions de fiches'), to: '/admin/structure-proposals', count: n(tasks.proposals), unit: t('admin:dashboard.card.prop.unit', 'en attente'), todo: t('admin:dashboard.card.prop.todo', 'Accepter avec une source officielle ou refuser avec un motif.') },
        { key: 'falc', title: t('admin:dashboard.card.falc.title', 'Textes faciles à lire (FALC)'), to: '/admin/falc', count: n(tasks.falc), unit: t('admin:dashboard.card.falc.unit', 'brouillon(s)'), todo: t('admin:dashboard.card.falc.todo', 'Relire chaque brouillon avant de l’approuver ; un brouillon n’est jamais publié seul.') },
        { key: 'rep', title: t('admin:dashboard.card.rep.title', 'Signalements et suggestions'), to: '/admin/signalements', count: n(tasks.reports), unit: t('admin:dashboard.card.rep.unit', 'nouveau(x) ou en cours'), todo: t('admin:dashboard.card.rep.todo', 'Traiter chaque signalement du public et noter la décision.') },
        { key: 'quality', title: t('admin:dashboard.card.quality.title', 'File qualité des données'), to: '/admin/review-queue', count: n(tasks.quality), unit: t('admin:dashboard.card.quality.unit', 'élément(s) ouvert(s)'), todo: t('admin:dashboard.card.quality.todo', 'Résoudre ou écarter chaque élément avec votre motif.') },
        { key: 'ai', title: t('admin:dashboard.card.ai.title', 'Suggestions de l’IA'), to: '/admin/ai-oversight', count: n(tasks.aiSuggestions), unit: t('admin:dashboard.card.ai.unit', 'à examiner'), todo: t('admin:dashboard.card.ai.todo', 'Une suggestion ne s’applique jamais seule : acceptez-la ou rejetez-la avec une note.') },
        {
            key: 'privacy', title: t('admin:dashboard.card.privacy.title', 'Protection des données'), to: '/admin/privacy', count: sum(tasks.accessRequests, tasks.erasures, tasks.closures), unit: t('admin:dashboard.card.privacy.unit', 'demande(s) en cours'),
            detail: tasks.accessRequests == null ? null : t('admin:dashboard.card.privacy.detail', '{{access}} accès · {{erasures}} effacement(s) · {{closures}} fermeture(s)', { access: tasks.accessRequests, erasures: tasks.erasures, closures: tasks.closures }),
            todo: t('admin:dashboard.card.privacy.todo', 'Deux personnes : l’une propose, une autre confirme après sa propre lecture journalisée.'),
        },
        { key: 'support', title: t('admin:dashboard.card.support.title', 'Demandes d’aide'), to: '/admin/support', count: n(tasks.support), unit: t('admin:dashboard.card.support.unit', 'ouverte(s)'), todo: t('admin:dashboard.card.support.todo', 'Répondre ou orienter ; les demandes liées aux données vont à la protection des données.') },
        { key: 'bg', title: t('admin:dashboard.card.bg.title', 'Accès d’urgence à examiner'), to: '/admin/operations', count: n(tasks.breakGlass), unit: t('admin:dashboard.card.bg.unit', 'à examiner'), todo: t('admin:dashboard.card.bg.todo', 'Un accès d’urgence est examiné ensuite par une autre personne, avec les actions faites pendant la fenêtre.') },
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
                                {t('admin:dashboard.title', 'À traiter')}
                            </h1>
                            <p className="text-slate-700 text-sm">
                                {t('admin:dashboard.intro', 'Ce qui attend la décision d’une personne. Chaque carte mène à l’écran où décider.')}
                                {waiting.length ? ` ${t('admin:dashboard.waiting', '{{n}} écran(s) ont des éléments en attente.', { n: waiting.length })}` : ` ${t('admin:dashboard.nothing_waiting', 'Rien n’est en attente.')}`}
                            </p>
                        </div>
                        {/* owner LAB audit: the badge states only what is known — when the figures were read */}
                        <Badge className="bg-slate-100 text-slate-800 border-0 gap-1" data-testid="admin-dashboard-loaded-at">
                            <Zap className="h-3 w-3" />
                            {t('admin:dashboard.loaded_at', 'Chiffres lus à {{time}}', { time: loadedAt })}
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
                                    {c.count == null ? t('admin:dashboard.count_unavailable', 'indisponible') : c.count > 0 ? `${c.count} ${c.unit}` : t('admin:dashboard.count_none', 'Rien en attente')}
                                </span>
                            </div>
                            {c.detail ? <p className="mt-1 text-xs text-slate-700">{c.detail}</p> : null}
                            <p className="mt-2 text-sm text-slate-700">{c.todo}</p>
                            <Link to={c.to} className="mt-3 inline-flex min-h-11 items-center rounded border border-slate-300 px-3 text-sm font-medium text-blue-800 hover:bg-slate-50">
                                {t('admin:dashboard.open', 'Ouvrir « {{title}} »', { title: c.title })}
                            </Link>
                        </li>
                    ))}
                </ul>

                <details className="rounded-lg border border-slate-200 bg-white" data-testid="admin-dashboard-technical">
                    <summary className="cursor-pointer p-4 font-semibold text-slate-800">{t('admin:dashboard.technical', 'Vue technique : compteurs, index de recherche, tâches planifiées, fonctionnalités')}</summary>
                    <div className="space-y-6 p-4 pt-0">
                        {/* Stats Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                            <StatCard icon={<FileText className="text-indigo-600" />} label={t('admin:dashboard.stat.aides', 'Aides')} value={stats.aides} />
                            <StatCard icon={<FileText className="text-purple-600" />} label={t('admin:dashboard.stat.demarches', 'Démarches')} value={stats.demarches} />
                            <StatCard icon={<Shield className="text-blue-600" />} label={t('admin:dashboard.stat.admins', 'Administrateurs')} value={stats.admins} />
                            <StatCard icon={<Users className="text-emerald-700" />} label={t('admin:dashboard.stat.citizens', 'Comptes citoyens')} value={stats.citizens} />
                            <StatCard icon={<Activity className="text-orange-600" />} label={t('admin:dashboard.stat.cron_runs', 'Exécutions planifiées')} value={stats.cronRuns} />
                        </div>

                        {/* RAG Health Card */}
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                        <Cpu className="h-4 w-4 text-indigo-500" />
                                        {t('admin:dashboard.rag.title', 'Index de recherche')}{rag.dimensions ? ` ${t('admin:dashboard.rag.dimensions', '(vecteurs {{n}} dimensions)', { n: rag.dimensions })}` : ''}
                                    </h3>
                                    <Badge className={rag.missing === 0 && !rag.stale ? 'bg-emerald-100 text-emerald-700 border-0' : 'bg-amber-100 text-amber-700 border-0'}>
                                        {rag.missing === 0 && !rag.stale ? t('admin:dashboard.rag.up_to_date', 'À jour') : [rag.missing ? t('admin:dashboard.rag.missing', '{{n}} sans vecteur', { n: rag.missing }) : '', rag.stale ? t('admin:dashboard.rag.stale', '{{n}} à recalculer', { n: rag.stale }) : ''].filter(Boolean).join(', ')}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-700">{t('admin:dashboard.rag.with_vector', '{{indexed}} / {{total}} aides avec un vecteur', { indexed: rag.indexed, total: rag.total })}{rag.stale ? ` ${t('admin:dashboard.rag.stale_detail', { count: rag.stale, defaultValue_one: '(dont {{count}} calculé avant la dernière modification de la fiche)', defaultValue_other: '(dont {{count}} calculés avant la dernière modification de la fiche)' })}` : ''}</span>
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
                                                {t('admin:dashboard.recent_crons', 'Dernières exécutions planifiées')}
                                            </h3>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {(activity.recentCrons || []).length === 0 ? (
                                                <p className="p-4 text-sm text-slate-600">{t('admin:dashboard.no_crons', 'Aucune exécution planifiée (normal dans le LAB local : aucune tâche n’y est programmée).')}</p>
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
                                                                    {cron.itemsProcessed != null && t('admin:dashboard.cron_items', '{{n}} éléments • ', { n: cron.itemsProcessed })}
                                                                    {cron.durationMs != null && `${(cron.durationMs / 1000).toFixed(1)} s`}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <span className="text-xs text-slate-600">
                                                            {cron.startedAt ? formatDateTime(cron.startedAt) : '—'}
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
                                                {t('admin:dashboard.recent_imports', 'Derniers imports')}
                                            </h3>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {(activity.recentImports || []).length === 0 ? (
                                                <p className="p-4 text-sm text-slate-600">{t('admin:dashboard.no_imports', 'Aucun import récent.')}</p>
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
                                                                    {log.itemsCreated != null && t('admin:dashboard.import_created', '+{{n}} créées', { n: log.itemsCreated })}
                                                                    {log.itemsUpdated != null && ` / ${t('admin:dashboard.import_updated', '{{n}} mises à jour', { n: log.itemsUpdated })}`}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <span className="text-xs text-slate-600">
                                                            {log.createdAt ? formatDateTime(log.createdAt) : '—'}
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
                                            {t('admin:dashboard.features', 'Fonctionnalités activées')}
                                        </h3>
                                        <div className="space-y-3">
                                            <FlagRow label={t('admin:dashboard.flag.ai_agent', 'Agent IA')} code="AI_AGENT" enabled={features.AI_AGENT} />
                                            <FlagRow label="RAG" code="RAG" enabled={features.RAG} />
                                            <FlagRow label="OpenFisca" code="OPENFISCA" enabled={features.OPENFISCA} />
                                            <FlagRow label={t('admin:dashboard.flag.cache', 'Cache')} code="CACHE" enabled={features.CACHE} />
                                            <FlagRow label={t('admin:dashboard.flag.maintenance', 'Maintenance')} code="MAINTENANCE" enabled={features.MAINTENANCE} warning />
                                            <FlagRow label={t('admin:dashboard.flag.audit', 'Audit RGPD')} code="AUDIT_LOG" enabled={features.AUDIT_LOG} />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="p-4">
                                        <h3 className="font-bold text-slate-800 mb-4">{t('admin:dashboard.infra.title', 'Infrastructure')}</h3>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-slate-700">{t('admin:dashboard.infra.env', 'Environnement')}</span>
                                                <Badge variant="outline">{infra.nodeEnv}</Badge>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-700">{t('admin:dashboard.infra.cache', 'Cache')}</span>
                                                <Badge variant="outline">{infra.cache?.backend || '—'}</Badge>
                                            </div>
                                            {infra.cache?.memorySize != null && (
                                                <div className="flex justify-between">
                                                    <span className="text-slate-700">{t('admin:dashboard.infra.cache_entries', 'Entrées en cache')}</span>
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
