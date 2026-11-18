// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { label } from '@/lib/caseLabels';
// FA-D1 (D-FA1-1): the referral codes in the interface language (pro:case_labels.*, as the professional pages and the dossier transparency show them)
import { useCaseLabels } from '@/lib/caseLabelsI18n';
import { useT, formatDate } from '@/i18n';
import ReferentCard from '@/components/sharing/ReferentCard';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * PKG-4 / R09 R11 — Mes orientations (/compte/orientations): what organizations propose to do with my dossier. NOTHING is transmitted before I accept; accepting gives
 * the receiving organization access to my dossier (I can withdraw it from the dossier page at any time); I see the outcome when the organization records it.
 * M2: each referral names its NEXT STEP and whose move it is; a step without progress is flagged with whom to ask; a decline shows its controlled motive
 * (never the organization's free text) and, when the organization suggested another one, that nothing was transmitted to it; a referral that follows
 * another says so. The contact person of the path (« référent de parcours ») is shown, proposed and ended here, per dossier.
 */
export default function CompteOrientations() {
  const { t } = useT('compte');
  const fr = useFrAttrs();
  const L = useCaseLabels();
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
  const byId = new Map(state.referrals.map((r) => [r.id, r]));
  const dossiers = [...new Set(state.referrals.map((r) => r.dossierId).filter(Boolean))];
  /** the next step in the person's words (the code comes from the server; an unknown code shows nothing) */
  const nextText = (r) => {
    const a = r.nextAction; if (!a) return '';
    const v = { from: r.from, to: r.to, suggested: r.suggested || '', date: a.at || a.dueAt ? formatDate(a.at || a.dueAt) : '' };
    switch (a.code) {
      case 'CITIZEN_DECIDE': return t('compte:orientations.next.citizen_decide', 'à vous de décider');
      case 'RECEIVER_ANSWER': return a.dueAt ? t('compte:orientations.next.receiver_answer_due', '{{to}} doit répondre avant le {{date}}', v) : t('compte:orientations.next.receiver_answer', '{{to}} doit répondre', v);
      case 'SENDER_REPLY': return t('compte:orientations.next.sender_reply', '{{from}} doit apporter des précisions à {{to}}', v);
      case 'RECEIVER_FIRST_STEP': return t('compte:orientations.next.receiver_first_step', '{{to}} doit vous contacter ou vous proposer un premier rendez-vous', v);
      case 'APPOINTMENT': return t('compte:orientations.next.appointment', 'rendez-vous prévu le {{date}}', v);
      case 'RECEIVER_RESULT': return t('compte:orientations.next.receiver_result', '{{to}} vous accompagne et indiquera le résultat', v);
      case 'SENDER_PROPOSE_SUGGESTED': return t('compte:orientations.next.sender_propose_suggested', '{{from}} peut vous proposer {{suggested}} ; rien ne lui est transmis sans votre accord', v);
      case 'SENDER_NEXT': return t('compte:orientations.next.sender_next', '{{from}} peut vous proposer une autre orientation', v);
      default: return '';
    }
  };
  const responseText = (code) => ({
    OUT_OF_SCOPE: t('compte:orientations.response.out_of_scope', 'cette demande ne relève pas de son champ'),
    NO_CAPACITY: t('compte:orientations.response.no_capacity', 'pas de place actuellement'),
    ALREADY_SUPPORTED: t('compte:orientations.response.already_supported', 'vous êtes déjà accompagné·e sur ce sujet'),
    NEEDS_MORE_INFORMATION: t('compte:orientations.response.needs_more_information', 'elle a demandé des précisions à la structure qui vous accompagne'),
    REDIRECT_SUGGESTED: t('compte:orientations.response.redirect_suggested', 'elle suggère une autre structure'),
    OTHER: t('compte:orientations.response.other', 'autre motif'),
  }[code] || '');
  const follows = (r) => (r.previousId && byId.get(r.previousId) ? <p className="text-slate-700" data-testid="orientation-follows">{t('compte:orientations.follows', 'Suite de l’orientation vers {{to}}, qui n’a pas abouti.', { to: byId.get(r.previousId).to })}</p> : null);
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-orientations">
      <SEO title={t('compte:orientations.mes_orientations', 'Mes orientations')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:orientations.mes_orientations', 'Mes orientations')}</h1>
      <p className="text-sm text-slate-700">{t('compte:orientations.une_structure_qui_vous', 'Une structure qui vous accompagne peut proposer de transmettre votre dossier à une autre structure. Rien n’est transmis sans votre accord. Les notes internes des structures ne sont jamais transmises.')}</p>
      {state.error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><p>{state.error}</p>{state.auth ? <Button asChild variant="outline" className="mt-2"><Link to="/auth/login?next=/compte/orientations">{t('compte:orientations.connecter', 'Se connecter')}</Link></Button> : <Button type="button" variant="outline" className="mt-2" onClick={load}>{t('compte:orientations.reessayer', 'Réessayer')}</Button>}</div> : null}
      {problem ? <p role="alert" data-testid="orientation-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="orientation-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {pending.length ? (
        <Card><CardHeader><CardTitle as="h2" className="text-lg">{t('compte:orientations.decider', 'À décider')}</CardTitle></CardHeader><CardContent className="space-y-3">
          {pending.map((r) => (
            <div key={r.id} data-testid="orientation-pending" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p><strong>{r.from}</strong> {t('compte:orientations.proposes_to', 'propose de transmettre votre dossier à')} <strong>{r.to}</strong> {t('compte:orientations.reason', '— motif :')} {label(L.reason, r.reasonCode)}.</p>
              {follows(r)}
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
      <Card><CardHeader><CardTitle as="h2" className="text-lg">{t('compte:orientations.suivi', 'Suivi')}</CardTitle></CardHeader><CardContent>
        {others.length ? <ul className="space-y-2">{others.map((r) => (
          <li key={r.id} data-testid="orientation-item" className="rounded-md border border-slate-200 p-2 text-sm">
            <p>{r.from} → <strong>{r.to}</strong> — <span data-testid="orientation-item-status">{label(L.referralStatus, r.status)}</span></p>
            {follows(r)}
            {r.responseCode && responseText(r.responseCode) ? <p data-testid="orientation-response">{t('compte:orientations.response_label', 'Réponse de {{to}} :', { to: r.to })} {responseText(r.responseCode)}{r.respondedAt ? ` (${formatDate(r.respondedAt)})` : ''}</p> : null}
            {r.suggested ? <p data-testid="orientation-suggested">{t('compte:orientations.suggested', 'Structure suggérée :')} <strong {...fr}>{r.suggested}</strong>. {t('compte:orientations.suggested_nothing_sent', 'Rien ne lui a été transmis.')}</p> : null}
            {r.outcome ? <p data-testid="orientation-outcome">{t('compte:orientations.resultat', 'Résultat :')} {label(L.outcome, r.outcome)}{r.outcomeSummary ? ` — « ${r.outcomeSummary} »` : ''}</p> : null}
            {nextText(r) ? <p data-testid="orientation-next"><strong>{t('compte:orientations.next_label', 'Prochaine étape :')}</strong> {nextText(r)}</p> : null}
            {r.needsFollowUp ? <p data-testid="orientation-follow-up" className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">{t('compte:orientations.needs_follow_up', 'Cette étape n’a pas avancé depuis un moment. Vous pouvez contacter {{org}} pour savoir où elle en est.', { org: r.nextAction?.by === 'RECEIVER' ? r.to : r.from })}</p> : null}
            {!r.nextAction && r.closedAt ? <p className="text-slate-700">{t('compte:orientations.closed_on', 'Close le {{date}}.', { date: formatDate(r.closedAt) })}</p> : null}
          </li>
        ))}</ul> : state.error ? null : <p className="text-sm text-slate-700" data-testid="orientation-empty">{t('compte:orientations.aucune_orientation_pour_moment', 'Aucune orientation pour le moment.')}</p>}
      </CardContent></Card>
      {dossiers.map((d) => <ReferentCard key={d} shareId={d} />)}
    </div>
  );
}
