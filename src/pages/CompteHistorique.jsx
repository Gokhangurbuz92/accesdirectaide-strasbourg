// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { formatDate, useT } from '@/i18n';

/**
 * PKG-2 / C11 — Mon historique (/compte/historique): OFF by default. When the person switches it on, their searches and viewed records are kept in their account only
 * (never used for statistics); they can delete one entry or everything, and switching it off erases everything at once.
 */
export default function CompteHistorique() {
  const { t } = useT('compte');
  const { historyKind: HISTORY_KIND_LABELS } = useMonEspaceLabels();
  const [state, setState] = useState({ loading: true, error: '', enabled: false, entries: [] });
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(null);   // the requested value while the server has not answered (the box follows the click at once)
  const load = useCallback(async () => {
    try { const h = await citizenApi.getHistory(); setState({ loading: false, error: '', failed: false, enabled: h.enabled, entries: h.entries || [] }); }
    // R12 (C11): when the setting could not be read, the switch is not shown as « off » (it is disabled until the page reloads it)
    catch (err) { setState({ loading: false, error: err.status === 401 ? t('compte:history.login_required', 'Connectez-vous pour gérer votre historique.') : err.message, failed: true, enabled: false, entries: [] }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const toggle = async () => {
    if (pending !== null) return;
    const next = !state.enabled; setPending(next); setMessage('');
    try {
      const out = await citizenApi.setHistoryEnabled(next);
      setState((s) => ({ ...s, enabled: out.enabled, entries: out.enabled ? s.entries : [] }));
      setMessage(out.enabled ? t('compte:history.enabled', 'Historique activé : vos prochaines recherches seront gardées dans votre compte.') : t('compte:history.disabled', 'Historique désactivé et effacé ({{n}} entrée(s) supprimée(s)).', { n: out.erased }));
    } catch (err) { setMessage(''); setState((s) => ({ ...s, error: err.message })); }
    finally { setPending(null); load(); }
  };
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:history.chargement', 'Chargement…')}</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-historique">
      <SEO title={t('compte:history.mon_historique', 'Mon historique')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:history.mon_historique', 'Mon historique')}</h1>
      {state.error ? <div role="alert" data-testid="historique-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><p>{state.error}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={load}>{t('compte:history.reessayer', 'Réessayer')}</Button></div> : null}
      <div aria-live="polite" role="status" data-testid="historique-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      <Card>
        <CardHeader><CardTitle className="text-lg">{t('compte:history.garder_mon_historique', 'Garder mon historique')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-800">
          <p>{t('compte:history.facultatif_est_utilise_que', 'Facultatif. Il n’est utilisé que pour vous permettre de retrouver vos recherches ; il n’est jamais utilisé pour des statistiques.')}</p>
          <label className="flex items-center gap-2"><input type="checkbox" data-testid="historique-toggle" checked={pending ?? state.enabled} aria-busy={pending !== null || undefined} disabled={Boolean(state.failed || state.loading)} onChange={toggle} /> {t('compte:history.garder_historique_mes_recherches', 'Garder l’historique de mes recherches et des fiches consultées')}</label>
        </CardContent>
      </Card>
      {state.enabled ? (
        <Card>
          <CardHeader><CardTitle className="text-lg">{t('compte:history.entrees', 'Entrées')}</CardTitle></CardHeader>
          <CardContent>
            {state.entries.length ? (
              <>
                <ul className="space-y-2" data-testid="historique-list">
                  {state.entries.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-sm" data-testid="historique-item">
                      <span>{HISTORY_KIND_LABELS[e.kind]} — {e.label} <span className="text-slate-600">({formatDate(e.createdAt, { dateStyle: 'short', timeStyle: 'medium' })})</span></span>
                      <Button type="button" size="sm" variant="outline" aria-label={t('compte:history.delete_named', 'Supprimer {{label}}', { label: e.label })} onClick={async () => { try { await citizenApi.clearHistory(e.id); setMessage(t('compte:history.entry_deleted', 'Entrée supprimée.')); await load(); } catch (err) { setMessage(''); setState((s) => ({ ...s, error: err.message || t('compte:history.delete_failed', 'La suppression a échoué : réessayez.') })); } }}>{t('compte:history.supprimer', 'Supprimer')}</Button>
                    </li>
                  ))}
                </ul>
                <Button type="button" className="mt-3" variant="outline" data-testid="historique-clear" onClick={async () => { try { const out = await citizenApi.clearHistory(); setMessage(t('compte:history.cleared', '{{n}} entrée(s) supprimée(s).', { n: out.erased })); await load(); } catch (err) { setMessage(''); setState((s) => ({ ...s, error: err.message || t('compte:history.clear_failed', 'L’effacement a échoué : réessayez.') })); } }}>{t('compte:history.tout_effacer', 'Tout effacer')}</Button>
              </>
            ) : <p className="text-sm text-slate-700" data-testid="historique-empty">{t('compte:history.aucune_entree_pour_moment', 'Aucune entrée pour le moment.')}</p>}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
