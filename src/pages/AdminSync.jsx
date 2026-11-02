// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import { apiClient } from '@/api/client';
import i18n, { useT } from '@/i18n';

const STATUS = () => ({ success: i18n.t('admin:sync.status.success', 'Réussie'), completed: i18n.t('admin:sync.status.success', 'Réussie'), failed: i18n.t('admin:sync.status.failed', 'Échec'), error: i18n.t('admin:sync.status.failed', 'Échec'), skipped: i18n.t('admin:sync.status.skipped', 'Non lancée'), running: i18n.t('admin:sync.status.running', 'En cours') });

/**
 * /admin/sync — owner LAB audit (2026-10-25). The page used to launch synchronisations through the function API of the former Base44 platform and to read
 * Base44 entities (`UpdateLog`, `Source`) whose API does not exist here: the buttons failed, the history and the sources never loaded, and it promised a daily
 * 5 a.m. run that nothing schedules. It now says how records arrive and shows the real history of the scheduled tasks (admin/cron-runs).
 */
export default function AdminSync() {
  const { t } = useT('admin');
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-cron-runs-all'], queryFn: () => apiClient.admin.getCronRuns(undefined, 20) });
  const runs = data?.items || [];
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6" data-testid="admin-sync">
      <h1 className="text-2xl font-bold text-slate-900">{t('admin:sync.title', 'Synchronisations')}</h1>
      <section className="space-y-2 rounded border border-slate-300 bg-white p-4 text-sm text-slate-800" data-testid="admin-sync-explainer" aria-label={t('admin:sync.how_records_arrive', 'Comment les fiches arrivent')}>
        <h2 className="text-base font-semibold">{t('admin:sync.how_records_arrive', 'Comment les fiches arrivent')}</h2>
        <p>{t('admin:sync.no_launch_here', 'Aucune synchronisation ne se lance depuis cette page. Les synchronisations autorisées sont des tâches planifiées du serveur ; dans le LAB local, aucune n’est programmée.')}</p>
        <p>{t('admin:sync.enters_as_draft', 'Une fiche synchronisée entre comme brouillon non vérifié : elle n’est publiée qu’après sa vérification (automatique par la veille, décision D-5 v2, ou par une personne), avec sa source officielle.')}</p>
        <p><Trans i18n={i18n} i18nKey="admin:sync.use_catalogue" defaults="Pour ajouter ou corriger une fiche à la main, utilisez le catalogue (<0>Aides</0>, <1>Démarches</1>, <2>Structures</2>)." components={[<Link key="a" className="text-blue-800 underline" to="/admin/aides" />, <Link key="d" className="text-blue-800 underline" to="/admin/demarches" />, <Link key="s" className="text-blue-800 underline" to="/admin/structures" />]} /></p>
      </section>
      <section className="rounded border border-slate-300 bg-white p-4" aria-labelledby="sync-history">
        <h2 id="sync-history" className="font-semibold">{t('admin:sync.last_runs', 'Dernières exécutions des tâches planifiées')}</h2>
        {isLoading ? <p role="status">{t('admin:sync.loading', 'Chargement…')}</p> : error ? <p role="alert" className="text-rose-800">{t('admin:sync.history_error', 'L’historique n’a pas pu être lu.')}</p> : runs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-700" data-testid="admin-sync-empty">{t('admin:sync.empty', 'Aucune exécution enregistrée (normal dans le LAB local : aucune tâche n’y est planifiée).')}</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead><tr><th scope="col">{t('admin:sync.col.job', 'Tâche')}</th><th scope="col">{t('admin:sync.col.start', 'Début')}</th><th scope="col">{t('admin:sync.col.result', 'Résultat')}</th><th scope="col">{t('admin:sync.col.duration', 'Durée')}</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id} className="border-t border-slate-200">
                <td>{r.job}</td><td>{r.startedAt ? new Date(r.startedAt).toLocaleString('fr-FR') : '—'}</td>
                <td>{STATUS()[String(r.status || '').toLowerCase()] || r.status}{r.skipReason ? ` (${r.skipReason})` : ''}</td>
                <td>{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="mt-3 text-sm text-slate-700"><Trans i18n={i18n} i18nKey="admin:sync.details" defaults="Détails : <0>exécutions</0> · <1>observabilité</1>." components={[<Link key="r" className="text-blue-800 underline" to="/admin/runs" />, <Link key="o" className="text-blue-800 underline" to="/admin/observability" />]} /></p>
      </section>
    </div>
  );
}
