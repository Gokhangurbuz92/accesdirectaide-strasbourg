// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { useT, formatDateTime } from '@/i18n';
import { alertKind, lastRunPerJob } from './alertsModel.js';

/**
 * RA-03 (interface) — /admin/alertes : l'historique des alertes de santé que la vérification planifiée a déclenchées (GET /api/admin/alerts, les 50 plus
 * récentes gardées par le serveur) et la dernière exécution enregistrée de chaque tâche planifiée (GET /api/admin/cron-runs, 100 exécutions les plus
 * récentes). Lecture seule : la page ne déclenche, ne relance ni n'acquitte rien.
 */
export default function AdminAlerts() {
  const { t } = useT('admin');
  const STATUS = { success: t('admin:k5.alerts.s_success', 'réussie'), partial: t('admin:k5.alerts.s_partial', 'partielle'), failed: t('admin:k5.alerts.s_failed', 'en échec'),
    running: t('admin:k5.alerts.s_running', 'en cours ou interrompue'), skipped: t('admin:k5.alerts.s_skipped', 'non exécutée') };
  const KIND = (a) => {
    const k = alertKind(a.name);
    if (k.kind === 'JOB_FAILED') return t('admin:k5.alerts.k_failed', 'Tâche planifiée en échec : {{job}}', { job: k.job });
    if (k.kind === 'JOB_STALE') return t('admin:k5.alerts.k_stale', 'Tâche planifiée en retard : {{job}}', { job: k.job });
    return t('admin:k5.alerts.k_check', 'Contrôle de santé : {{name}}', { name: a.name });
  };
  const [alerts, setAlerts] = useState({ loading: true, error: '', list: [] });
  const [runs, setRuns] = useState({ loading: true, error: '', list: [], read: 0 });
  const load = useCallback(async () => {
    setAlerts((s) => ({ ...s, loading: true, error: '' })); setRuns((s) => ({ ...s, loading: true, error: '' }));
    const [a, r] = await Promise.allSettled([apiClient.admin.k5('alerts'), apiClient.admin.k5('cron-runs?limit=100')]);
    setAlerts(a.status === 'fulfilled' ? { loading: false, error: '', list: a.value?.alerts || [] } : { loading: false, error: explain(a.reason), list: [] });
    setRuns(r.status === 'fulfilled' ? { loading: false, error: '', list: lastRunPerJob(r.value?.items), read: (r.value?.items || []).length } : { loading: false, error: explain(r.reason), list: [], read: 0 });
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6 p-4" data-testid="admin-alerts">
      <h1 className="text-2xl font-bold">{t('admin:k5.alerts.title', 'Alertes et tâches planifiées')}</h1>
      <p className="text-sm">{t('admin:k5.alerts.intro', 'Lecture seule : cette page ne déclenche, ne relance et n’acquitte rien. Une alerte est aussi envoyée par e-mail ou webhook quand ces canaux sont configurés ; une alerte identique n’est pas répétée pendant le délai de silence.')}</p>
      <Button size="sm" variant="outline" onClick={load}>{t('admin:k5.alerts.refresh', 'Actualiser')}</Button>

      <section className="space-y-2" aria-labelledby="alerts-jobs">
        <h2 id="alerts-jobs" className="font-semibold">{t('admin:k5.alerts.jobs_heading', 'Dernière exécution de chaque tâche planifiée')}</h2>
        {runs.error ? <p role="alert" className="text-sm text-destructive" data-testid="admin-alerts-runs-problem">{runs.error}</p> : null}
        {runs.loading ? <p role="status" className="text-sm">{t('admin:k5.duplicates.loading', 'Chargement…')}</p> : null}
        {!runs.loading && !runs.error ? <p className="text-sm">{t('admin:k5.alerts.jobs_scope', 'Parmi les {{n}} exécutions enregistrées les plus récentes. Une tâche qui n’apparaît pas n’a aucune exécution récente enregistrée : cela ne prouve pas qu’elle a tourné.', { n: runs.read })} <Link className="text-primary underline" to="/admin/sync">{t('admin:k5.alerts.history_link', 'Historique complet des exécutions')}</Link></p> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-alerts-jobs">
            <caption className="sr-only">{t('admin:k5.alerts.jobs_caption', 'Dernière exécution par tâche : statut, début, durée, motif')}</caption>
            <thead><tr className="border-b">
              <th scope="col" className="p-1 text-start">{t('admin:k5.alerts.col_job', 'Tâche')}</th>
              <th scope="col" className="p-1 text-start">{t('admin:k5.alerts.col_status', 'Statut')}</th>
              <th scope="col" className="p-1 text-start">{t('admin:k5.alerts.col_started', 'Début')}</th>
              <th scope="col" className="p-1 text-start">{t('admin:k5.alerts.col_duration', 'Durée')}</th>
            </tr></thead>
            <tbody>
              {runs.list.map((r) => (
                <tr key={r.job} className="border-b" data-testid="admin-alerts-job" data-status={r.status}>
                  <th scope="row" className="p-1 text-start font-normal">{r.job}</th>
                  <td className={`p-1 ${r.status === 'failed' ? 'font-semibold text-destructive' : ''}`}>{STATUS[r.status] || r.status}{r.skipReason ? ` (${r.skipReason})` : ''}</td>
                  <td className="p-1">{r.startedAt ? formatDateTime(r.startedAt) : '—'}</td>
                  <td className="p-1">{Number.isFinite(r.durationMs) ? t('admin:k5.alerts.seconds', '{{s}} s', { s: Math.round(r.durationMs / 100) / 10 }) : '—'}</td>
                </tr>
              ))}
              {!runs.loading && !runs.error && !runs.list.length ? <tr><td colSpan={4} className="p-2">{t('admin:k5.alerts.no_run', 'Aucune exécution enregistrée.')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="alerts-history">
        <h2 id="alerts-history" className="font-semibold">{t('admin:k5.alerts.history_heading', 'Alertes déclenchées (les plus récentes d’abord)')}</h2>
        {alerts.error ? <p role="alert" className="text-sm text-destructive" data-testid="admin-alerts-problem">{alerts.error}</p> : null}
        {alerts.loading ? <p role="status" className="text-sm">{t('admin:k5.duplicates.loading', 'Chargement…')}</p> : null}
        <ol className="space-y-2" data-testid="admin-alerts-list">
          {alerts.list.map((a, i) => (
            <li key={`${a.timestamp}-${a.name}-${i}`} className="rounded border p-2 text-sm" data-testid="admin-alert" data-kind={alertKind(a.name).kind}>
              <p className="font-semibold">{KIND(a)}</p>
              <p>{formatDateTime(a.timestamp)}{a.severity ? ` — ${a.severity}` : ''}</p>
              <p className="break-words">{a.message}</p>
              {a.details && Object.keys(a.details).length ? (
                <details><summary className="cursor-pointer text-primary">{t('admin:k5.alerts.details', 'Détails techniques')}</summary>
                  <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(a.details, null, 2)}</pre></details>
              ) : null}
            </li>
          ))}
        </ol>
        {!alerts.loading && !alerts.error && !alerts.list.length ? <p className="text-sm" data-testid="admin-alerts-none">{t('admin:k5.alerts.none', 'Aucune alerte enregistrée. Cela veut dire qu’aucune alerte n’a été déclenchée et conservée, pas que la vérification de santé a tourné : voyez la tâche « health-alert » ci-dessus.')}</p> : null}
      </section>
    </div>
  );
}
