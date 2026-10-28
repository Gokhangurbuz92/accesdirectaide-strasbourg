// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { DELEGATION_ROLE_LABELS, DELEGATION_SCOPE_LABELS, DELEGATION_STATUS_LABELS, formatDate } from '@/lib/monEspace';

const DURATIONS = [[30, '30 jours'], [90, '3 mois'], [180, '6 mois'], [365, '1 an']];
const LIVE = ['INVITED', 'ACTIVE', 'PROOF_REQUIRED', 'EXPIRED'];

/**
 * PKG-2 / C23 — Personnes de confiance (/compte/delegations). Give a READ-ONLY, scoped, time-limited access that either side can end; see what the person viewed;
 * answer an invitation (?invitation=…); open what was given to me. Legal mandates stay "proof not verified" and open nothing: the page says so.
 */
export default function CompteDelegations() {
  const [params, setParams] = useSearchParams();
  const invitation = params.get('invitation') || '';
  const [state, setState] = useState({ loading: true, error: '', granted: [], received: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [form, setForm] = useState({ email: '', role: 'AIDANT', scopes: ['PARCOURS_READ'], days: 90 });
  const [link, setLink] = useState(null);
  const [logs, setLogs] = useState({});
  const load = useCallback(async () => {
    try { const d = await citizenApi.listDelegations(); setState({ loading: false, error: '', granted: d.granted || [], received: d.received || [] }); }
    catch (err) { setState({ loading: false, unauth: err.status === 401, error: err.status === 401 ? 'Connectez-vous pour gérer vos personnes de confiance.' : err.message, granted: [], received: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setMessage(''); setProblem(''); try { const out = await fn(); if (ok) setMessage(ok); await load(); return out; } catch (err) { setProblem(err.message); return null; } };
  const toggleScope = (s) => setForm((f) => ({ ...f, scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s] }));
  const invite = async (e) => {
    e.preventDefault(); setLink(null);
    const out = await run(() => citizenApi.inviteDelegate(form), '');
    if (out) {
      setLink({ url: out.inviteLink, delivered: out.delivery === 'PROVIDER_ACCEPTED' });
      setMessage(out.delivery === 'PROVIDER_ACCEPTED' ? 'Invitation transmise au service d’envoi d’e-mails (la réception n’est pas garantie : vous pouvez aussi transmettre le lien ci-dessous).' : 'Invitation créée. Aucun e-mail n’a pu être envoyé : transmettez vous-même le lien ci-dessous.');
      setForm((f) => ({ ...f, email: '' }));
    }
  };
  const respond = async (accept) => {
    const out = await run(() => citizenApi.respondDelegation(invitation, accept), '');
    if (out) {
      setMessage(!accept ? 'Invitation refusée.' : out.delegation.status === 'ACTIVE' ? 'Invitation acceptée. Vous pouvez consulter ce que la personne a choisi de partager.'
        : 'Invitation acceptée, mais la preuve du mandat n’est pas encore vérifiable : aucun accès n’est ouvert.');
      setParams({}, { replace: true });
    }
  };
  const showLog = async (id) => { try { const d = await citizenApi.delegationLog(id); setLogs((l) => ({ ...l, [id]: d.events || [] })); } catch (err) { setProblem(err.message); } };
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">Chargement…</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-delegations">
      <SEO title="Personnes de confiance" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Personnes de confiance</h1>
      <p className="text-sm text-slate-700">Une personne de confiance peut <strong>seulement consulter</strong> ce que vous choisissez, pendant une durée limitée. Elle ne peut rien modifier, rien envoyer et ne se connecte jamais à votre place. Vous voyez ce qu’elle a consulté et vous pouvez arrêter à tout moment.</p>
      {state.error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{state.error}</p>
          {state.unauth ? <Button asChild variant="outline" className="mt-2"><Link to={`/auth/login?next=${encodeURIComponent(invitation ? `/compte/delegations?invitation=${invitation}` : '/compte/delegations')}`}>Se connecter</Link></Button> : null}
        </div>
      ) : null}
      {problem ? <p role="alert" data-testid="delegation-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="delegation-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>

      {invitation && !state.error ? (
        <Card data-testid="delegation-invitation">
          <CardHeader><CardTitle className="text-lg">Une personne vous propose de l’aider</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-800">
            <p>En acceptant, vous pourrez consulter, en lecture seule, ce que cette personne a choisi de partager. Elle verra ce que vous consultez et pourra arrêter à tout moment.</p>
            <div className="flex gap-2">
              <Button type="button" data-testid="delegation-accept" onClick={() => respond(true)}>Accepter</Button>
              <Button type="button" variant="outline" data-testid="delegation-decline" onClick={() => respond(false)}>Refuser</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* R7: the forms and lists only for a signed-in person (the invite form was shown, unusable, to a signed-out visitor) */}
      {state.unauth ? null : (<>
      <Card>
        <CardHeader><CardTitle className="text-lg">Donner un accès</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={invite} data-testid="delegation-form">
            <div><label htmlFor="dlg-email" className="block text-sm text-slate-800">Adresse e-mail de la personne</label>
              <input id="dlg-email" type="email" required autoComplete="off" data-testid="delegation-email" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label htmlFor="dlg-role" className="block text-sm text-slate-800">Son rôle</label>
              <select id="dlg-role" data-testid="delegation-role" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(DELEGATION_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {form.role !== 'AIDANT' ? <p className="mt-1 text-sm text-amber-900" data-testid="delegation-proof-notice">Un mandat légal demande une preuve (jugement, mandat). Sa vérification n’est pas encore disponible : la délégation restera en attente et n’ouvrira aucun accès.</p> : null}
            </div>
            <fieldset><legend className="text-sm text-slate-800">Ce qu’elle pourra consulter</legend>
              {Object.entries(DELEGATION_SCOPE_LABELS).map(([k, v]) => (
                <label key={k} className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`delegation-scope-${k}`} checked={form.scopes.includes(k)} onChange={() => toggleScope(k)} />{v}</label>
              ))}
            </fieldset>
            <div><label htmlFor="dlg-days" className="block text-sm text-slate-800">Pendant</label>
              <select id="dlg-days" data-testid="delegation-days" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
                {DURATIONS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
              </select></div>
            <Button type="submit" data-testid="delegation-invite" disabled={!form.scopes.length}>Inviter</Button>
          </form>
          {link ? <p className="mt-3 break-all rounded-md border border-slate-200 bg-slate-50 p-2 text-sm" data-testid="delegation-link">Lien d’invitation (valable 7 jours, pour cette adresse e-mail seulement) : <span>{link.url}</span></p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Accès que j’ai donnés</CardTitle></CardHeader>
        <CardContent>
          {state.granted.length ? (
            <ul className="space-y-2" data-testid="delegation-granted">
              {state.granted.map((d) => (
                <li key={d.id} data-testid="delegation-granted-item" className="space-y-1 rounded-md border border-slate-200 p-2 text-sm">
                  <p><strong>{d.inviteEmail}</strong> — {DELEGATION_ROLE_LABELS[d.role]} — <span data-testid="delegation-granted-status">{DELEGATION_STATUS_LABELS[d.status]}</span></p>
                  <p className="text-slate-700">{d.scopes.map((s) => DELEGATION_SCOPE_LABELS[s]).join(' · ')} — jusqu’au {formatDate(d.expiresAt)}</p>
                  <div className="flex flex-wrap gap-2">
                    {LIVE.includes(d.status) || d.status === 'INVITATION_EXPIRED' ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" data-testid="delegation-revoke" onClick={() => run(() => citizenApi.endDelegation(d.id), 'Accès arrêté.')}>Arrêter l’accès</Button> : null}
                    <Button type="button" size="sm" variant="outline" data-testid="delegation-show-log" onClick={() => showLog(d.id)}>Ce qu’elle a consulté</Button>
                  </div>
                  {logs[d.id] ? (logs[d.id].length ? <ol className="list-inside list-disc text-slate-800" data-testid="delegation-log">{logs[d.id].map((e, i) => <li key={i} data-testid="delegation-log-event">{new Date(e.at).toLocaleString('fr-FR')} — {e.label}</li>)}</ol>
                    : <p className="text-slate-700" data-testid="delegation-log-empty">Rien n’a encore été consulté.</p>) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-700" data-testid="delegation-granted-empty">Vous n’avez donné aucun accès.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Accès qu’on m’a donnés</CardTitle></CardHeader>
        <CardContent>
          {state.received.length ? (
            <ul className="space-y-2" data-testid="delegation-received">
              {state.received.map((d) => (
                <li key={d.id} data-testid="delegation-received-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span><strong>{d.principalEmail}</strong> — {DELEGATION_STATUS_LABELS[d.status]}</span>
                  <span className="flex gap-2">
                    {d.status === 'ACTIVE' ? <Button asChild size="sm"><Link to={`/compte/delegations/${encodeURIComponent(d.id)}`} data-testid="delegation-open">Consulter</Link></Button> : null}
                    {['ACTIVE', 'PROOF_REQUIRED', 'EXPIRED'].includes(d.status) ? <Button type="button" size="sm" variant="outline" data-testid="delegation-renounce" onClick={() => run(() => citizenApi.endDelegation(d.id), 'Vous avez renoncé à cet accès.')}>Renoncer</Button> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-700" data-testid="delegation-received-empty">Personne ne vous a donné d’accès.</p>}
        </CardContent>
      </Card>
      </>)}
    </div>
  );
}
