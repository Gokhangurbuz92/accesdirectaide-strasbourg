// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { formatDate, useT } from '@/i18n';

const durations = (t) => [[30, t('compte:delegations.d30', '30 jours')], [90, t('compte:delegations.d90', '3 mois')], [180, t('compte:delegations.d180', '6 mois')], [365, t('compte:delegations.d365', '1 an')]];
const LIVE = ['INVITED', 'ACTIVE', 'PROOF_REQUIRED', 'EXPIRED'];

/**
 * PKG-2 / C23 — Personnes de confiance (/compte/delegations). Give a READ-ONLY, scoped, time-limited access that either side can end; see what the person viewed;
 * answer an invitation (?invitation=…); open what was given to me. Legal mandates stay "proof not verified" and open nothing: the page says so.
 */
export default function CompteDelegations() {
  const { t } = useT('compte');
  const L = useMonEspaceLabels();
  const [params, setParams] = useSearchParams();
  const invitation = params.get('invitation') || '';
  const [state, setState] = useState({ loading: true, error: '', granted: [], received: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [form, setForm] = useState({ email: '', role: 'AIDANT', scopes: ['PARCOURS_READ'], days: 90 });
  const [link, setLink] = useState(null);
  const [logs, setLogs] = useState({});
  const load = useCallback(async () => {
    try { const d = await citizenApi.listDelegations(); setState({ loading: false, error: '', granted: d.granted || [], received: d.received || [] }); }
    catch (err) { setState({ loading: false, unauth: err.status === 401, error: err.status === 401 ? t('compte:delegations.login_required', 'Connectez-vous pour gérer vos personnes de confiance.') : err.message, granted: [], received: [] }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setMessage(''); setProblem(''); try { const out = await fn(); if (ok) setMessage(ok); await load(); return out; } catch (err) { setProblem(err.message); return null; } };
  const toggleScope = (s) => setForm((f) => ({ ...f, scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s] }));
  const invite = async (e) => {
    e.preventDefault(); setLink(null);
    const out = await run(() => citizenApi.inviteDelegate(form), '');
    if (out) {
      setLink({ url: out.inviteLink, delivered: out.delivery === 'PROVIDER_ACCEPTED' });
      setMessage(out.delivery === 'PROVIDER_ACCEPTED' ? t('compte:delegations.invite_sent', 'Invitation transmise au service d’envoi d’e-mails (la réception n’est pas garantie : vous pouvez aussi transmettre le lien ci-dessous).') : t('compte:delegations.invite_not_sent', 'Invitation créée. Aucun e-mail n’a pu être envoyé : transmettez vous-même le lien ci-dessous.'));
      setForm((f) => ({ ...f, email: '' }));
    }
  };
  const respond = async (accept) => {
    const out = await run(() => citizenApi.respondDelegation(invitation, accept), '');
    if (out) {
      setMessage(!accept ? t('compte:delegations.declined', 'Invitation refusée.') : out.delegation.status === 'ACTIVE' ? t('compte:delegations.accepted', 'Invitation acceptée. Vous pouvez consulter ce que la personne a choisi de partager.')
        : t('compte:delegations.accepted_no_proof', 'Invitation acceptée, mais la preuve du mandat n’est pas encore vérifiable : aucun accès n’est ouvert.'));
      setParams({}, { replace: true });
    }
  };
  const showLog = async (id) => { try { const d = await citizenApi.delegationLog(id); setLogs((l) => ({ ...l, [id]: d.events || [] })); } catch (err) { setProblem(err.message); } };
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:delegations.chargement', 'Chargement…')}</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-delegations">
      <SEO title={t('compte:delegations.personnes_confiance', 'Personnes de confiance')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:delegations.personnes_confiance', 'Personnes de confiance')}</h1>
      <p className="text-sm text-slate-700">{t('compte:delegations.intro_before', 'Une personne de confiance peut')} <strong>{t('compte:delegations.intro_strong', 'seulement consulter')}</strong> {t('compte:delegations.intro_after', 'ce que vous choisissez, pendant une durée limitée. Elle ne peut rien modifier, rien envoyer et ne se connecte jamais à votre place. Vous voyez ce qu’elle a consulté et vous pouvez arrêter à tout moment.')}</p>
      {state.error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{state.error}</p>
          {state.unauth ? <Button asChild variant="outline" className="mt-2"><Link to={`/auth/login?next=${encodeURIComponent(invitation ? `/compte/delegations?invitation=${invitation}` : '/compte/delegations')}`}>{t('compte:delegations.connecter', 'Se connecter')}</Link></Button> : null}
        </div>
      ) : null}
      {problem ? <p role="alert" data-testid="delegation-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="delegation-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>

      {invitation && !state.error ? (
        <Card data-testid="delegation-invitation">
          <CardHeader><CardTitle className="text-lg">{t('compte:delegations.une_personne_vous_propose', 'Une personne vous propose de l’aider')}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-800">
            <p>{t('compte:delegations.acceptant_vous_pourrez_consulter', 'En acceptant, vous pourrez consulter, en lecture seule, ce que cette personne a choisi de partager. Elle verra ce que vous consultez et pourra arrêter à tout moment.')}</p>
            <div className="flex gap-2">
              <Button type="button" data-testid="delegation-accept" onClick={() => respond(true)}>{t('compte:delegations.accepter', 'Accepter')}</Button>
              <Button type="button" variant="outline" data-testid="delegation-decline" onClick={() => respond(false)}>{t('compte:delegations.refuser', 'Refuser')}</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* R7: the forms and lists only for a signed-in person (the invite form was shown, unusable, to a signed-out visitor) */}
      {state.unauth ? null : (<>
      <Card>
        <CardHeader><CardTitle className="text-lg">{t('compte:delegations.donner_acces', 'Donner un accès')}</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={invite} data-testid="delegation-form">
            <div><label htmlFor="dlg-email" className="block text-sm text-slate-800">{t('compte:delegations.adresse_mail_personne', 'Adresse e-mail de la personne')}</label>
              <input id="dlg-email" type="email" required autoComplete="off" data-testid="delegation-email" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label htmlFor="dlg-role" className="block text-sm text-slate-800">{t('compte:delegations.son_role', 'Son rôle')}</label>
              <select id="dlg-role" data-testid="delegation-role" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(L.delegationRole).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {form.role !== 'AIDANT' ? <p className="mt-1 text-sm text-amber-900" data-testid="delegation-proof-notice">{t('compte:delegations.mandat_legal_demande_une', 'Un mandat légal demande une preuve (jugement, mandat). Sa vérification n’est pas encore disponible : la délégation restera en attente et n’ouvrira aucun accès.')}</p> : null}
            </div>
            <fieldset><legend className="text-sm text-slate-800">{t('compte:delegations.elle_pourra_consulter', 'Ce qu’elle pourra consulter')}</legend>
              {Object.entries(L.delegationScope).map(([k, v]) => (
                <label key={k} className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`delegation-scope-${k}`} checked={form.scopes.includes(k)} onChange={() => toggleScope(k)} />{v}</label>
              ))}
            </fieldset>
            <div><label htmlFor="dlg-days" className="block text-sm text-slate-800">{t('compte:delegations.pendant', 'Pendant')}</label>
              <select id="dlg-days" data-testid="delegation-days" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
                {durations(t).map(([d, l]) => <option key={d} value={d}>{l}</option>)}
              </select></div>
            <Button type="submit" data-testid="delegation-invite" disabled={!form.scopes.length}>{t('compte:delegations.inviter', 'Inviter')}</Button>
          </form>
          {link ? <p className="mt-3 break-all rounded-md border border-slate-200 bg-slate-50 p-2 text-sm" data-testid="delegation-link">{t('compte:delegations.lien_invitation_valable_7', 'Lien d’invitation (valable 7 jours, pour cette adresse e-mail seulement) :')} <span>{link.url}</span></p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">{t('compte:delegations.acces_que_donnes', 'Accès que j’ai donnés')}</CardTitle></CardHeader>
        <CardContent>
          {state.granted.length ? (
            <ul className="space-y-2" data-testid="delegation-granted">
              {state.granted.map((d) => (
                <li key={d.id} data-testid="delegation-granted-item" className="space-y-1 rounded-md border border-slate-200 p-2 text-sm">
                  <p><strong>{d.inviteEmail}</strong> — {L.delegationRole[d.role]} — <span data-testid="delegation-granted-status">{L.delegationStatus[d.status]}</span></p>
                  <p className="text-slate-700">{d.scopes.map((s) => L.delegationScope[s]).join(' · ')} {t('compte:delegations.until', '— jusqu’au {{date}}', { date: formatDate(d.expiresAt) })}</p>
                  <div className="flex flex-wrap gap-2">
                    {LIVE.includes(d.status) || d.status === 'INVITATION_EXPIRED' ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" data-testid="delegation-revoke" onClick={() => run(() => citizenApi.endDelegation(d.id), t('compte:delegations.ended', 'Accès arrêté.'))}>{t('compte:delegations.arreter_acces', 'Arrêter l’accès')}</Button> : null}
                    <Button type="button" size="sm" variant="outline" data-testid="delegation-show-log" onClick={() => showLog(d.id)}>{t('compte:delegations.elle_consulte', 'Ce qu’elle a consulté')}</Button>
                  </div>
                  {logs[d.id] ? (logs[d.id].length ? <ol className="list-inside list-disc text-slate-800" data-testid="delegation-log">{logs[d.id].map((e, i) => <li key={i} data-testid="delegation-log-event">{formatDate(e.at, { dateStyle: 'short', timeStyle: 'medium' })} — {e.label}</li>)}</ol>
                    : <p className="text-slate-700" data-testid="delegation-log-empty">{t('compte:delegations.rien_encore_ete_consulte', 'Rien n’a encore été consulté.')}</p>) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-700" data-testid="delegation-granted-empty">{t('compte:delegations.vous_avez_donne_aucun', 'Vous n’avez donné aucun accès.')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">{t('compte:delegations.acces_donnes', 'Accès qu’on m’a donnés')}</CardTitle></CardHeader>
        <CardContent>
          {state.received.length ? (
            <ul className="space-y-2" data-testid="delegation-received">
              {state.received.map((d) => (
                <li key={d.id} data-testid="delegation-received-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span><strong>{d.principalEmail}</strong> — {L.delegationStatus[d.status]}</span>
                  <span className="flex gap-2">
                    {d.status === 'ACTIVE' ? <Button asChild size="sm"><Link to={`/compte/delegations/${encodeURIComponent(d.id)}`} data-testid="delegation-open">{t('compte:delegations.consulter', 'Consulter')}</Link></Button> : null}
                    {['ACTIVE', 'PROOF_REQUIRED', 'EXPIRED'].includes(d.status) ? <Button type="button" size="sm" variant="outline" data-testid="delegation-renounce" onClick={() => run(() => citizenApi.endDelegation(d.id), t('compte:delegations.renounced', 'Vous avez renoncé à cet accès.'))}>{t('compte:delegations.renoncer', 'Renoncer')}</Button> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-700" data-testid="delegation-received-empty">{t('compte:delegations.personne_vous_donne_acces', 'Personne ne vous a donné d’accès.')}</p>}
        </CardContent>
      </Card>
      </>)}
    </div>
  );
}
