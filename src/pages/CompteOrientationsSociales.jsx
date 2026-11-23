// @ts-nocheck
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';
import { lbl, socialReferralLabels } from '@/lib/socialReferralLabels';

/**
 * G14-PS — « Mes orientations sociales » (/compte/orientations-sociales). A structure that helps me can propose to orient me to another structure for
 * practical needs (housing, work, budget…). It gives me a code; I enter it here, I see who proposes, to whom and why, and I decide. Nothing is sent before
 * I accept: then only the reasons, and the contact details I tick, are visible to the receiving structure. No document and no health information is ever
 * transmitted. I can withdraw my agreement at any time.
 */
export default function CompteOrientationsSociales() {
  const { t } = useT('socialref');
  const L = socialReferralLabels(t);
  const codeId = useId();
  const [state, setState] = useState({ loading: true, error: '', auth: false, available: true, referrals: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [share, setShare] = useState({});
  const load = useCallback(async () => {
    try { const out = await citizenApi.socialReferrals(); setState({ loading: false, error: '', auth: false, available: out.available !== false, referrals: out.referrals || [] }); }
    catch (err) {
      setState({ loading: false, auth: err.status === 401, available: true, referrals: [],
        error: err.status === 401 ? t('socialref:citizen.login', 'Connectez-vous pour voir vos orientations sociales.') : err.status === 503 ? t('socialref:closed', 'L’orientation sociale n’est pas encore ouverte.') : err.message });
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);
  const act = async (body, ok) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await citizenApi.socialReferralAction(body); setMessage(ok); await load(); }
    catch (err) { setProblem(err.code === 'INVALID_CODE' ? t('socialref:citizen.bad_code', 'Code inconnu ou expiré. Vérifiez-le ou demandez un nouveau code.') : err.message); }
    finally { setBusy(false); }
  };
  const claim = (e) => { e.preventDefault(); const code = String(new FormData(e.currentTarget).get('code') || ''); e.currentTarget.reset(); act({ action: 'claim', code }, t('socialref:citizen.claimed', 'La proposition est ajoutée. Lisez-la et décidez.')); };
  const reasons = (r) => (r.reasonCodes || []).map((c) => lbl(L.reason, c)).join(', ');
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('socialref:loading', 'Chargement…')}</div>;
  const pending = state.referrals.filter((r) => r.status === 'PENDING_CITIZEN'); const others = state.referrals.filter((r) => r.status !== 'PENDING_CITIZEN');
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-orientations-sociales">
      <SEO title={t('socialref:citizen.title', 'Mes orientations sociales')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('socialref:citizen.title', 'Mes orientations sociales')}</h1>
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-slate-800">
        <p>{t('socialref:citizen.intro', 'Une structure peut vous orienter vers une autre structure pour le logement, l’emploi, le budget ou les démarches.')}</p>
        <ul className="ms-5 mt-1 list-disc space-y-1">
          <li>{t('socialref:citizen.rule1', 'Rien n’est envoyé sans votre accord.')}</li>
          <li>{t('socialref:citizen.rule2', 'Aucun document et aucune information de santé ne sont envoyés.')}</li>
          <li>{t('socialref:citizen.rule3', 'Vous pouvez retirer votre accord à tout moment.')}</li>
        </ul>
      </div>
      {state.error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><p>{state.error}</p>{state.auth ? <Button asChild variant="outline" className="mt-2"><Link to="/auth/login?next=/compte/orientations-sociales">{t('socialref:citizen.signin', 'Se connecter')}</Link></Button> : null}</div> : null}
      {problem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div role="status" aria-live="polite">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {!state.error ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="sr-code">
          <h2 id="sr-code" className="text-lg font-semibold text-slate-900">{t('socialref:citizen.code_title', 'J’ai un code d’orientation')}</h2>
          <form onSubmit={claim} className="flex flex-wrap items-end gap-2">
            <div><label htmlFor={codeId} className="block font-medium text-slate-900">{t('socialref:citizen.code_label', 'Code donné par la structure (10 caractères)')}</label>
              <input id={codeId} name="code" required autoComplete="off" spellCheck={false} dir="ltr" className="mt-1 rounded-md border border-slate-400 px-3 py-2 font-mono text-base uppercase" /></div>
            <Button type="submit" disabled={busy}>{t('socialref:citizen.code_submit', 'Voir la proposition')}</Button>
          </form>
        </section>
      ) : null}
      {pending.length ? (
        <section className="space-y-3" aria-labelledby="sr-pending">
          <h2 id="sr-pending" className="text-lg font-semibold text-slate-900">{t('socialref:citizen.to_decide', 'À décider')}</h2>
          {pending.map((r) => {
            const s = share[r.id] || { shareEmail: false, sharePhone: false };
            return (
              <article key={r.id} className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="social-pending">
                <p>{t('socialref:citizen.proposal', '{{from}} propose de vous orienter vers {{to}}.', { from: r.from, to: r.to })}</p>
                <p><strong>{t('socialref:reasons', 'Motifs :')}</strong> {reasons(r)}</p>
                <fieldset className="space-y-1">
                  <legend className="font-medium">{t('socialref:citizen.share_legend', 'Ce que {{to}} pourra voir pour vous contacter (facultatif) :', { to: r.to })}</legend>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.shareEmail} onChange={(e) => setShare((x) => ({ ...x, [r.id]: { ...s, shareEmail: e.target.checked } }))} />{t('socialref:citizen.share_email', 'Mon adresse e-mail')}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.sharePhone} onChange={(e) => setShare((x) => ({ ...x, [r.id]: { ...s, sharePhone: e.target.checked } }))} />{t('socialref:citizen.share_phone', 'Mon numéro de téléphone')}</label>
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busy} onClick={() => act({ action: 'decide', id: r.id, decision: 'accept', ...s }, t('socialref:citizen.accepted', 'Vous avez accepté. {{to}} va recevoir l’orientation.', { to: r.to }))}>{t('socialref:citizen.accept', 'J’accepte')}</Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => act({ action: 'decide', id: r.id, decision: 'refuse' }, t('socialref:citizen.refused', 'Vous avez refusé. Rien n’a été envoyé.'))}>{t('socialref:citizen.refuse', 'Je refuse')}</Button>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
      {others.length ? (
        <section className="space-y-3" aria-labelledby="sr-list">
          <h2 id="sr-list" className="text-lg font-semibold text-slate-900">{t('socialref:citizen.mine', 'Mes orientations')}</h2>
          <ul className="space-y-2">
            {others.map((r) => (
              <li key={r.id} className="space-y-1 rounded-md border border-slate-200 bg-white p-3" data-testid="social-item">
                <p><strong>{r.to}</strong> — {lbl(L.status, r.status)}{r.responseCode ? ` (${lbl(L.decline, r.responseCode)})` : ''}</p>
                <p className="text-sm text-slate-700">{t('socialref:citizen.from_line', 'Proposée par {{from}} le {{date}}', { from: r.from, date: formatDate(r.createdAt) })} · {reasons(r)}</p>
                {r.canWithdraw ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act({ action: 'withdraw', id: r.id }, t('socialref:citizen.withdrawn', 'Votre accord est retiré. Les deux structures sont prévenues.'))}>{t('socialref:citizen.withdraw', 'Retirer mon accord')}</Button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!state.error && !state.referrals.length ? <p className="text-slate-700">{t('socialref:citizen.empty', 'Vous n’avez pas encore d’orientation sociale.')}</p> : null}
    </div>
  );
}
