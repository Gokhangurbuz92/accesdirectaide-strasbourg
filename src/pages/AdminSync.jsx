// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';

const STATUS = { success: 'Réussie', completed: 'Réussie', failed: 'Échec', error: 'Échec', skipped: 'Non lancée', running: 'En cours' };

/**
 * /admin/sync — owner LAB audit (2026-10-25). The page used to launch synchronisations through the function API of the former Base44 platform and to read
 * Base44 entities (`UpdateLog`, `Source`) whose API does not exist here: the buttons failed, the history and the sources never loaded, and it promised a daily
 * 5 a.m. run that nothing schedules. It now says how records arrive and shows the real history of the scheduled tasks (admin/cron-runs).
 */
export default function AdminSync() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-cron-runs-all'], queryFn: () => apiClient.admin.getCronRuns(undefined, 20) });
  const runs = data?.items || [];
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6" data-testid="admin-sync">
      <h1 className="text-2xl font-bold text-slate-900">Synchronisations</h1>
      <section className="space-y-2 rounded border border-slate-300 bg-white p-4 text-sm text-slate-800" data-testid="admin-sync-explainer" aria-label="Comment les fiches arrivent">
        <h2 className="text-base font-semibold">Comment les fiches arrivent</h2>
        <p>Aucune synchronisation ne se lance depuis cette page. Les synchronisations autorisées sont des tâches planifiées du serveur ; dans le LAB local, aucune n’est programmée.</p>
        <p>Une fiche synchronisée entre comme brouillon non vérifié : elle n’est publiée qu’après sa vérification (automatique par la veille, décision D-5 v2, ou par une personne), avec sa source officielle.</p>
        <p>Pour ajouter ou corriger une fiche à la main, utilisez le catalogue (<Link className="text-blue-800 underline" to="/admin/aides">Aides</Link>, <Link className="text-blue-800 underline" to="/admin/demarches">Démarches</Link>, <Link className="text-blue-800 underline" to="/admin/structures">Structures</Link>).</p>
      </section>
      <section className="rounded border border-slate-300 bg-white p-4" aria-labelledby="sync-history">
        <h2 id="sync-history" className="font-semibold">Dernières exécutions des tâches planifiées</h2>
        {isLoading ? <p role="status">Chargement…</p> : error ? <p role="alert" className="text-rose-800">L’historique n’a pas pu être lu.</p> : runs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-700" data-testid="admin-sync-empty">Aucune exécution enregistrée (normal dans le LAB local : aucune tâche n’y est planifiée).</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead><tr><th scope="col">Tâche</th><th scope="col">Début</th><th scope="col">Résultat</th><th scope="col">Durée</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id} className="border-t border-slate-200">
                <td>{r.job}</td><td>{r.startedAt ? new Date(r.startedAt).toLocaleString('fr-FR') : '—'}</td>
                <td>{STATUS[String(r.status || '').toLowerCase()] || r.status}{r.skipReason ? ` (${r.skipReason})` : ''}</td>
                <td>{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="mt-3 text-sm text-slate-700">Détails : <Link className="text-blue-800 underline" to="/admin/runs">exécutions</Link> · <Link className="text-blue-800 underline" to="/admin/observability">observabilité</Link>.</p>
      </section>
    </div>
  );
}
