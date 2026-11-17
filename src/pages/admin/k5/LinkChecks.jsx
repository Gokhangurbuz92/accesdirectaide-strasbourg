// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { useT, formatDateTime } from '@/i18n';
import { linkRows } from './linkChecksModel.js';

/**
 * RA-06 — contrôle des liens officiels (/admin/liens) : ce que le contrôle des liens (api/_services/link-check.js) a enregistré pour les fiches visibles —
 * adresse contrôlée, résultat, date du dernier contrôle, fiche qui la cite. Lecture seule (GET /api/admin/link-checks?kind=link). Rien n'est dépublié
 * automatiquement : deux résultats « introuvable » de suite ouvrent un élément dans la file qualité des données. Le contrôle ne tourne que si le
 * propriétaire l'active (il contacte des sites officiels) : la page dit quand le dernier contrôle a eu lieu, ou qu'il n'y en a pas encore eu.
 */
const ADMIN_PATH = { Aide: 'aides', Demarche: 'demarches', Dispositif: 'dispositifs', Structure: 'structures' };
export default function AdminLinkChecks() {
  const { t } = useT('admin');
  const [only, setOnly] = useState('broken');
  const [state, setState] = useState({ loading: true, error: '', rows: [], last: null });
  const TYPE = { Aide: t('admin:k5.links.type_aide', 'Aide'), Demarche: t('admin:k5.links.type_demarche', 'Démarche'), Dispositif: t('admin:k5.links.type_dispositif', 'Dispositif'), Structure: t('admin:k5.links.type_structure', 'Structure') };
  const CLASS = { OK: t('admin:k5.links.c_ok', 'Accessible'), REDIRECTED: t('admin:k5.links.c_redirected', 'Accessible après redirection'), BROKEN: t('admin:k5.links.c_broken', 'Introuvable (lien cassé)'),
    BLOCKED: t('admin:k5.links.c_blocked', 'Le site refuse le contrôle automatique'), SERVER: t('admin:k5.links.c_server', 'Erreur du site'), NETWORK: t('admin:k5.links.c_network', 'Site injoignable'),
    OUTSIDE: t('admin:k5.links.c_outside', 'Hors des sources officielles acceptées (non contacté)'), OTHER: t('admin:k5.links.c_other', 'Réponse inattendue') };

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [list, newest] = await Promise.all([
        apiClient.admin.k5(`link-checks?kind=link&limit=100${only === 'broken' ? '&is_broken=true' : ''}`),
        apiClient.admin.k5('link-checks?kind=link&limit=1'),
      ]);
      setState({ loading: false, error: '', rows: linkRows(list?.items), last: newest?.items?.[0]?.checks?.[0]?.fetched_at || null });
    } catch (e) { setState({ loading: false, error: explain(e), rows: [], last: null }); }
  }, [only]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4 p-4" data-testid="admin-links">
      <h1 className="text-2xl font-bold">{t('admin:k5.links.title', 'Liens officiels (contrôle)')}</h1>
      <p className="text-sm">{t('admin:k5.links.intro', 'Résultats du contrôle des liens des fiches visibles (source officielle, lien de demande, liens des dispositifs). Seules les adresses https des sources officielles acceptées sont contactées. Rien n’est dépublié automatiquement : deux résultats « introuvable » de suite ouvrent un élément dans la file qualité des données, pour une personne.')}</p>
      <p className="text-sm" data-testid="admin-links-last">{state.loading ? t('admin:k5.duplicates.loading', 'Chargement…') : state.error ? '' : state.last
        ? t('admin:k5.links.last', 'Dernier contrôle enregistré : {{date}}.', { date: formatDateTime(state.last) })
        : t('admin:k5.links.never', 'Aucun contrôle enregistré. Le contrôle des liens ne tourne que lorsque le propriétaire l’active ; tant qu’il n’a pas tourné, cette page reste vide et ne dit rien de l’état des liens.')}</p>
      {state.error ? <p role="alert" className="text-sm text-destructive" data-testid="admin-links-problem">{state.error} <button type="button" className="underline" onClick={load}>{t('admin:k5.dupdec.retry', 'Réessayer')}</button></p> : null}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">{t('admin:k5.links.show', 'Afficher')}
          <select className="rounded border p-1" value={only} onChange={(e) => setOnly(e.target.value)} data-testid="admin-links-filter">
            <option value="broken">{t('admin:k5.links.show_broken', 'les liens en erreur')}</option><option value="all">{t('admin:k5.links.show_all', 'tous les résultats')}</option>
          </select></label>
        <Button size="sm" variant="outline" onClick={load}>{t('admin:k5.links.refresh', 'Actualiser')}</Button>
        <Link className="text-primary underline" to="/admin/review-queue">{t('admin:layout.nav.review_queue', 'File qualité des données')}</Link>
      </div>
      <p className="text-sm" role="status" data-testid="admin-links-count">{state.loading || state.error ? '' : t('admin:k5.links.count', '{{n}} adresse(s) parmi les 100 résultats les plus récents.', { n: state.rows.length })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="admin-links-table">
          <caption className="sr-only">{t('admin:k5.links.caption', 'Liens contrôlés : fiche, adresse contrôlée, résultat, dernier contrôle')}</caption>
          <thead><tr className="border-b">
            <th scope="col" className="p-1 text-start">{t('admin:k5.links.col_record', 'Fiche')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.links.col_url', 'Adresse contrôlée')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.links.col_result', 'Résultat')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.links.col_checked', 'Dernier contrôle')}</th>
          </tr></thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={r.key} className="border-b align-top" data-testid="admin-links-row" data-class={r.cls}>
                <th scope="row" className="p-1 text-start font-normal">
                  {ADMIN_PATH[r.entityType] ? <Link className="text-primary underline" to={`/admin/${ADMIN_PATH[r.entityType]}/${encodeURIComponent(r.entityId)}`}>{TYPE[r.entityType]} {r.entityId}</Link> : `${r.entityType} ${r.entityId}`}
                </th>
                <td className="p-1"><a className="break-all text-primary underline" href={r.url} target="_blank" rel="noreferrer noopener">{r.url}</a>
                  {r.cls === 'REDIRECTED' ? <p className="break-all text-xs">{t('admin:k5.links.final', 'Adresse finale : {{url}}', { url: r.final_url })}</p> : null}</td>
                <td className="p-1">{CLASS[r.cls]}{r.http_status ? t('admin:k5.links.http', ' (HTTP {{status}})', { status: r.http_status }) : ''}
                  {r.results > 1 ? <p className="text-xs">{t('admin:k5.links.results', '{{n}} résultats dans cette liste', { n: r.results })}</p> : null}</td>
                <td className="p-1">{formatDateTime(r.fetched_at)}</td>
              </tr>
            ))}
            {!state.loading && !state.error && !state.rows.length ? <tr><td colSpan={4} className="p-2">{only === 'broken' && state.last ? t('admin:k5.links.none_broken', 'Aucun lien en erreur parmi les résultats récents.') : t('admin:k5.links.none', 'Aucun résultat.')}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
