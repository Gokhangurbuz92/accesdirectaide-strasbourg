// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    BarChart3,
    TrendingUp,
    Download,
    Calendar,
    Users,
    MessageCircle,
    FileText,
    ShieldCheck,
    ArrowUpRight,
    CheckCircle2,
    XCircle,
    MessageSquare,
    Compass,
} from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
} from 'recharts';
import i18n, { useT } from '@/i18n';
import { Trans } from 'react-i18next';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

/**
 * ImpactReports — Tableau de bord d'impact social
 *
 * Route: /pro/reports
 * Accessible uniquement aux STRUCTURE_ADMIN.
 *
 * Affiche les métriques agrégées de la structure pour justifier
 * les financements sans compromettre la vie privée.
 */
export default function ImpactReports() {
    const { t } = useT('pro');
    useOutletContext();

    const [period, setPeriod] = useState('month');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;

    // R8: a refused or failed report is said — it showed every indicator at 0, which is false data
    const [loadProblem, setLoadProblem] = useState('');
    const fetchReport = useCallback(async () => {
        setLoading(true); setLoadProblem('');
        try {
            const res = await fetch(`/api/pro/reports?period=${period}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                setData(await res.json());
            } else {
                setData(null);
                setLoadProblem(res.status === 403 ? t('pro:impact.admins_only', 'Les indicateurs de la structure sont réservés à ses administrateurs.') : res.status === 401 ? t('pro:impact.session_expired', 'Votre session a expiré : reconnectez-vous.') : t('pro:impact.not_computed', 'Les indicateurs n’ont pas pu être calculés.'));
            }
        } catch {
            setData(null); setLoadProblem(t('pro:impact.not_computed', 'Les indicateurs n’ont pas pu être calculés.'));
        } finally {
            setLoading(false);
        }
    }, [period, token]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time

    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    // PKG-4 / E07: the server builds the CSV of THIS organization (measured indicators, small cells suppressed, no personal data)
    const [exportError, setExportError] = useState('');
    const handleExportCSV = async () => {
        setExportError('');
        try {
            const res = await fetch(`/api/pro/reports?period=${period}&format=csv`, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error(String(res.status));
            const url = URL.createObjectURL(await res.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = `indicateurs-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
            setExportError(t('pro:impact.export_failed', 'Export impossible. Réessayez.'));
        }
    };

    const kpis = data?.kpis || {};

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <BarChart3 size={22} className="text-indigo-600" />
                        {t('pro:impact.title', "Mesure d'Impact Social")}
                    </h1>
                    <p className="text-sm text-slate-700">
                        {t('pro:impact.subtitle', 'Indicateurs mesurés de votre structure (aucune estimation, petits effectifs masqués)')}
                    </p>
                </div>
                <div className="flex gap-2">
                    <div className="bg-white border border-slate-200 rounded-lg flex">
                        {['month', 'quarter', 'year'].map((p) => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${period === p
                                    ? 'bg-slate-900 text-white rounded-lg'
                                    : 'text-slate-700 hover:text-slate-700'
                                    }`}
                            >
                                {p === 'month' ? t('pro:impact.period_month', 'Mois') : p === 'quarter' ? t('pro:impact.period_quarter', 'Trimestre') : t('pro:impact.period_year', 'Année')}
                            </button>
                        ))}
                    </div>
                    <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="pro-report-csv">
                        <Download className="mr-2 h-4 w-4" />
                        CSV
                    </Button>
                </div>
            </div>

            {loadProblem && !loading ? (
                <div role="alert" data-testid="pro-report-problem" className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                    <p>{loadProblem}</p>
                    <Button variant="outline" size="sm" className="mt-2" data-testid="pro-report-retry" onClick={fetchReport}>{t('pro:impact.retry', 'Réessayer')}</Button>
                </div>
            ) : null}
            {loadProblem && !loading ? null : loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : (
                <>
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <KpiCard
                            label={t('pro:impact.kpi_completed', 'Rendez-vous honorés')}
                            value={kpis.completedAppointments ?? 0}
                            icon={<Users size={16} className="text-indigo-600" />}
                            sub={t('pro:impact.kpi_completed_sub', '{{rate}} % des rendez-vous passés non annulés', { rate: kpis.completionRate ?? 0 })}
                        />
                        <KpiCard
                            label={t('pro:impact.kpi_conversations', 'Conversations')}
                            value={kpis.conversations ?? 0}
                            icon={<MessageCircle size={16} className="text-emerald-700" />}
                            sub={t('pro:impact.kpi_conversations_sub', 'Échanges par la messagerie')}
                        />
                        <KpiCard
                            label={t('pro:impact.kpi_shared', 'Diagnostics partagés')}
                            value={kpis.diagnosticsShared === null ? '—' : kpis.diagnosticsShared ?? 0}
                            icon={<FileText size={16} className="text-amber-800" />}
                            sub={kpis.diagnosticsShared === null ? t('pro:impact.not_open', 'Fonction non ouverte : non mesuré') : t('pro:impact.kpi_shared_sub', 'Dossiers transmis')}
                        />
                        <KpiCard
                            label={t('pro:impact.kpi_team', 'Équipe active')}
                            value={kpis.teamSize ?? 0}
                            icon={<Users size={16} className="text-purple-600" />}
                            sub={t('pro:impact.kpi_team_sub', '{{cancelled}} RDV annulés', { cancelled: kpis.cancelledAppointments ?? 0 })}
                        />
                    </div>

                    {exportError ? <p role="alert" className="text-sm text-red-800" data-testid="pro-report-csv-error">{exportError}</p> : null}
                    {/* Phase 3 — SMS Impact + Boussole Sociale */}
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        <KpiCard
                            label={t('pro:impact.kpi_sms', 'Rappels SMS acceptés par l’opérateur')}
                            value={kpis.smsNotifications ?? 0}
                            icon={<MessageSquare size={16} className="text-teal-600" />}
                            sub={t('pro:impact.kpi_sms_sub', 'Accepté par l’opérateur ne veut pas dire reçu')}
                        />
                        <KpiCard
                            label={t('pro:impact.kpi_no_show', 'Absences constatées')}
                            value={kpis.noShowCount ?? 0}
                            icon={<TrendingUp size={16} className="text-teal-600" />}
                            sub={t('pro:impact.kpi_no_show_sub', 'RDV marqués « absent·e » par l’équipe')}
                        />
                        <KpiCard
                            label={t('pro:impact.kpi_referrals', 'Orientations')}
                            value={kpis.referralsSent === null ? '—' : kpis.referralsSent ?? 0}
                            icon={<Compass size={16} className="text-indigo-600" />}
                            sub={kpis.referralsSent === null || kpis.casesClosed === null ? t('pro:impact.not_open', 'Fonction non ouverte : non mesuré') : `${t('pro:impact.kpi_referrals_sub', 'envoyées · {{received}} reçues · {{closed}} dossiers clôturés', { received: kpis.referralsReceived ?? 0, closed: kpis.casesClosed ?? 0 })}${kpis.casesClosedPartial ? t('pro:impact.kpi_referrals_partial', ' (hors résultats de moins de 5 dossiers)') : ''}`}
                        />
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {/* Daily Activity Chart */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <Calendar size={14} className="text-indigo-500" />
                                    {t('pro:impact.daily_activity', 'Activité quotidienne')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {(data?.dailyActivity || []).length === 0 ? (
                                    <div className="h-[250px] flex items-center justify-center text-sm text-slate-600">
                                        {t('pro:impact.no_data', 'Aucune donnée pour cette période')}
                                    </div>
                                ) : (
                                    <div className="h-[250px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={data.dailyActivity}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis
                                                    dataKey="date"
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                                                    tickFormatter={(v) => {
                                                        const d = new Date(v);
                                                        return `${d.getDate()}/${d.getMonth() + 1}`;
                                                    }}
                                                />
                                                <YAxis
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                                                    allowDecimals={false}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        borderRadius: '12px',
                                                        border: 'none',
                                                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                                        fontSize: '12px',
                                                    }}
                                                    labelFormatter={(v) =>
                                                        new Date(v).toLocaleDateString('fr-FR', {
                                                            weekday: 'short',
                                                            day: 'numeric',
                                                            month: 'short',
                                                        })
                                                    }
                                                />
                                                <Bar dataKey="count" name={t('pro:impact.appointments_series', 'RDV')} fill="#4f46e5" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Themes Pie Chart */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <TrendingUp size={14} className="text-indigo-500" />
                                    {t('pro:impact.by_service', 'Répartition par service')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {(data?.themes || []).length === 0 ? (
                                    <div className="h-[250px] flex items-center justify-center text-sm text-slate-600">
                                        {t('pro:impact.no_data', 'Aucune donnée pour cette période')}
                                    </div>
                                ) : (
                                    <div className="h-[250px] flex items-center">
                                        {/* R46: the legend beside the ring carries the same figures as text; the drawing itself is hidden from assistive technology (axe svg-img-alt) */}
                                        <div className="w-1/2 h-full" aria-hidden="true">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie
                                                        data={data.themes}
                                                        innerRadius={50}
                                                        outerRadius={85}
                                                        paddingAngle={4}
                                                        dataKey="value"
                                                        rootTabIndex={-1}
                                                    >
                                                        {data.themes.map((/** @type {{ name: import("react").Key | null | undefined; }} */ entry, /** @type {number} */ i) => (
                                                            <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip
                                                        contentStyle={{
                                                            borderRadius: '12px',
                                                            border: 'none',
                                                            fontSize: '12px',
                                                        }}
                                                    />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="w-1/2 space-y-3 pl-4">
                                            {data.themes.map((/** @type {{ value: number; name: any; }} */ item, /** @type {number} */ i) => {
                                                const total = data.themes.reduce((/** @type {number} */ s, t) => s + t.value, 0);
                                                const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                                                return (
                                                    <div key={item.name} className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div
                                                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                                                style={{ backgroundColor: COLORS[i % COLORS.length] }}
                                                            />
                                                            <span className="text-xs text-slate-600 truncate">
                                                                {item.name}
                                                            </span>
                                                        </div>
                                                        <span className="text-xs font-bold text-slate-900 ml-2">
                                                            {pct}%
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Status breakdown */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold">{t('pro:impact.by_status', 'Répartition par statut')}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-3">
                                {(data?.byStatus || []).map((/** @type {{ count: string | number, status: string | number }} */ s) => (
                                    <div
                                        key={s.status}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-lg border border-slate-100"
                                    >
                                        {s.status === 'cancelled' ? (
                                            <XCircle size={12} className="text-red-500" />
                                        ) : (
                                            <CheckCircle2 size={12} className="text-emerald-500" />
                                        )}
                                        <span className="text-xs font-medium text-slate-700 capitalize">
                                            {s.status}
                                        </span>
                                        <span className="text-xs font-bold text-slate-900">{s.count}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* owner usefulness pass (2026-10-25): a hard-coded social-impact « certification » card rated « excellent » (crediting SMS reminders, which are off) was removed: nothing measured it */}
                    {/* aggregated-statistics notice */}
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <ShieldCheck className="text-emerald-700 shrink-0" size={16} />
                        <p className="text-xs text-emerald-700">
                            <Trans i18n={i18n} i18nKey="pro:impact.aggregated_notice" defaults="<0>Statistiques agrégées :</0> ces rapports ne contiennent que des compteurs, les petits effectifs sont masqués, et aucun contenu privé (nom, diagnostic, message) n'y figure." components={[<strong key="s" />]} />
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}

// @ts-ignore
function KpiCard({ label, value, icon, sub }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-slate-700">{label}</CardTitle>
                {icon}
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                {sub && (
                    <p className="text-[10px] text-slate-600 mt-0.5 flex items-center gap-1">
                        <ArrowUpRight size={10} /> {sub}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
