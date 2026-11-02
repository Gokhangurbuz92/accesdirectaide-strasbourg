// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { OUTCOME_LABELS, REASON_LABELS, REFERRAL_STATUS_LABELS, label } from '@/lib/caseLabels';
import { useT } from '@/i18n';

/**
 * PKG-4 / R09 R11 — Mes orientations (/compte/orientations): what organizations propose to do with my dossier. NOTHING is transmitted before I accept; accepting gives
 * the receiving organization access to my dossier (I can withdraw it from the dossier page at any time); I see the outcome when the organization records it.
 */
export default function CompteOrientations() {
  const { t } = useT('compte');
  const [state, setState] = useState({ loading: true, error: '', referrals: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', referrals: (await citizenApi.referrals()).referrals || [] }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? t('compte:orientations.login_required', 'Connectez-vous pour voir vos orientations.') : err.message, auth: err.status === 401, referrals: [] }); }   // R18: « Se connecter » only when the session is really missing (401); any other failure offers to try again (it read as « please sign in »)
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const decide = async (r, decision) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await citizenApi.decideReferral(r.id, decision); setMessage(decision === 'accept' ? t('compte:orientations.sent_to', 'Votre dossier est transmis à {{to}}.', { to: r.to }) : t('compte:orientations.refused', 'Vous avez refusé : rien n’a été transmis.')); await load(); }
    catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:orientations.chargement', 'Chargement…')}</div>;
  const pending = state.referrals.filter((r) => r.status === 'PENDING_CITIZEN'); const others = state.referrals.filter((r) => r.status !== 'PENDING_CITIZEN');
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-orientations">
      <SEO title={t('compte:orientations.mes_orientations', 'Mes orientations')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:orientations.mes_orientations', 'Mes orientations')}</h1>
      <p className="text-sm text-slate-700">{t('compte:orientations.une_structure_qui_vous', 'Une structure qui vous accompagne peut proposer de transmettre votre dossier à une autre structure. Rien n’est transmis sans votre accord. Les notes internes des structures ne sont jamais transmises.')}</p>
      {state.error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><p>{state.error}</p>{state.auth ? <Button asChild variant="outline" className="mt-2"><Link to="/auth/login?next=/compte/orientations">{t('compte:orientations.connecter', 'Se connecter')}</Link></Button> : <Button type="button" variant="outline" className="mt-2" onClick={load}>{t('compte:orientations.reessayer', 'Réessayer')}</Button>}</div> : null}
      {problem ? <p role="alert" data-testid="orientation-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="orientation-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {pending.length ? (
        <Card><CardHeader><CardTitle className="text-lg">{t('compte:orientations.decider', 'À décider')}</CardTitle></CardHeader><CardContent className="space-y-3">
          {pending.map((r) => (
            <div key={r.id} data-testid="orientation-pending" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p><strong>{r.from}</strong> {t('compte:orientations.proposes_to', 'propose de transmettre votre dossier à')} <strong>{r.to}</strong> {t('compte:orientations.reason', '— motif :')} {label(REASON_LABELS, r.reasonCode)}.</p>
              {r.message ? <p className="whitespace-pre-wrap">{t('compte:orientations.message_sent', 'Message qui sera transmis : « {{message}} »', { message: r.message })}</p> : null}
              <p>{t('compte:orientations.if_accept', 'Si vous acceptez, {{to}} pourra consulter votre dossier. Vous pourrez retirer cet accès à tout moment depuis la page du dossier.', { to: r.to })}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={busy} data-testid="orientation-accept" onClick={() => decide(r, 'accept')}>{t('compte:orientations.accepte_transmission', 'J’accepte la transmission')}</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="orientation-refuse" onClick={() => decide(r, 'refuse')}>{t('compte:orientations.refuse', 'Je refuse')}</Button>
              </div>
            </div>
          ))}
        </CardContent></Card>
      ) : null}
      <Card><CardHeader><CardTitle className="text-lg">{t('compte:orientations.suivi', 'Suivi')}</CardTitle></CardHeader><CardContent>
        {others.length ? <ul className="space-y-2">{others.map((r) => (
          <li key={r.id} data-testid="orientation-item" className="rounded-md border border-slate-200 p-2 text-sm">
            <p>{r.from} → <strong>{r.to}</strong> — <span data-testid="orientation-item-status">{label(REFERRAL_STATUS_LABELS, r.status)}</span></p>
            {r.outcome ? <p data-testid="orientation-outcome">{t('compte:orientations.resultat', 'Résultat :')} {label(OUTCOME_LABELS, r.outcome)}{r.outcomeSummary ? ` — « ${r.outcomeSummary} »` : ''}</p> : null}
          </li>
        ))}</ul> : state.error ? null : <p className="text-sm text-slate-700" data-testid="orientation-empty">{t('compte:orientations.aucune_orientation_pour_moment', 'Aucune orientation pour le moment.')}</p>}
      </CardContent></Card>
    </div>
  );
}
