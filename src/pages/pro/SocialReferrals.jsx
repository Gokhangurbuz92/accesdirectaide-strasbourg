// @ts-nocheck
import { useCallback, useEffect, useId, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { ToneChip } from '@/components/ui/Tone';
import { topicTone } from '@/design/categoryTone';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { formatDate, useT } from '@/i18n';
import { lbl, socialReferralLabels } from '@/lib/socialReferralLabels';

const REASONS = ['HOUSING', 'EMPLOYMENT', 'TRAINING', 'INCOME_BUDGET', 'ENERGY', 'ADMIN_PROCEDURES', 'ACCESS_TO_RIGHTS', 'MOBILITY', 'DIGITAL', 'FOOD'];
const DECLINES = ['OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'OUT_OF_TERRITORY'];
const API = '/api/pro/social-referrals';
const box = 'space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
const input = 'mt-1 block w-full rounded-md border border-slate-400 px-3 py-2 text-base text-slate-900';

/**
 * G14-PS — Orientations sociales (/pro/orientations-sociales): the non-HDS referral between verified, non-medical organisations. The professional chooses a
 * receiving organisation and 1 to 3 reasons from a closed list — there is NO text field and NO document. The person decides with a one-time code in Mon
 * Espace, or here on this screen by typing their own e-mail and password (assisted mode). The receiving organisation accepts, declines (closed motive) or
 * marks the orientation done; it sees the contact the person chose to share only while the orientation is live.
 */
export default function SocialReferrals() {
  const { t } = useT('socialref');
  const L = socialReferralLabels(t);
  const ids = { q: useId(), dec: useId(), em: useId(), pw: useId() };
  const [tab, setTab] = useState('outbox');
  const [list, setList] = useState({ loading: true, items: [], error: '' });
  const [problem, setProblem] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''); const [receivers, setReceivers] = useState([]); const [to, setTo] = useState(''); const [reasons, setReasons] = useState([]);
  const [code, setCode] = useState(null); const [open, setOpen] = useState(null); const [declineCode, setDeclineCode] = useState(DECLINES[0]);
  const [assist, setAssist] = useState(null);
  const errText = (err) => {
    const c = err?.payload?.error;
    if (err?.status === 503) return t('socialref:closed', 'L’orientation sociale n’est pas encore ouverte.');
    if (c === 'MFA_REQUIRED') return t('socialref:pro.mfa', 'Connectez-vous avec la double authentification pour utiliser l’orientation sociale.');
    if (c === 'STRUCTURE_NOT_ELIGIBLE' || c === 'RECEIVER_NOT_ELIGIBLE') return t('socialref:pro.not_eligible', 'Cette structure ne peut pas utiliser l’orientation sociale (non vérifiée, sanitaire ou médico-sociale, ou type non revu).');
    if (c === 'INVALID_CREDENTIALS') return t('socialref:pro.bad_credentials', 'E-mail ou mot de passe incorrect.');
    return err?.payload?.message || t('socialref:error', 'Une erreur est survenue.');
  };
  const load = useCallback(async () => {
    try { const out = await proRdvRequest(API, { query: { box: tab } }); setList({ loading: false, items: out.referrals || [], error: '' }); }
    catch (err) { setList({ loading: false, items: [], error: errText(err) }); }
  }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setBusy(true); setProblem(''); setMessage(''); try { await fn(); if (ok) setMessage(ok); await load(); } catch (err) { setProblem(errText(err)); } finally { setBusy(false); } };
  const search = (e) => { e.preventDefault(); run(async () => { const out = await proRdvRequest(API, { query: { receivers: q.trim() || '*' } }); setReceivers(out.receivers || []); }); };
  const propose = (e) => {
    e.preventDefault();
    run(async () => {
      const out = await proRdvRequest(API, { method: 'POST', body: { action: 'propose', toStructureId: to, reasonCodes: reasons, idempotencyKey: `sr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` } });
      setCode({ id: out.referral.id, code: out.code, to: out.referral.to }); setReasons([]); setTo('');
    }, t('socialref:pro.proposed', 'Orientation proposée. Donnez le code à la personne.'));
  };
  const act = (id, action, extra = {}, ok = '') => run(async () => { const out = await proRdvRequest(API, { method: 'POST', body: { action, id, ...extra } }); if (out.code) setCode({ id, code: out.code }); }, ok);
  const assisted = (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget;
    run(async () => {
      await proRdvRequest(API, { method: 'POST', body: { action: 'assisted_consent', id: assist, email: String(f.get('email') || ''), password: String(f.get('password') || ''), decision: String(f.get('decision') || 'accept'), shareEmail: f.get('shareEmail') === 'on', sharePhone: f.get('sharePhone') === 'on' } });
      form.reset(); setAssist(null);
    }, t('socialref:pro.assisted_done', 'La réponse de la personne est enregistrée.'));
  };
  const toggle = (c) => setReasons((r) => (r.includes(c) ? r.filter((x) => x !== c) : r.length >= 3 ? r : [...r, c]));
  const detail = (id) => run(async () => { setOpen(await proRdvRequest(API, { query: { id } })); });

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8" data-testid="pro-social-referrals">
      <SEO title={t('socialref:pro.title', 'Orientations sociales')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('socialref:pro.title', 'Orientations sociales')}</h1>
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-slate-800">
        <p>{t('socialref:pro.intro', 'Orientez une personne vers une autre structure pour un besoin pratique. Pas de texte libre, pas de document, pas d’information de santé.')}</p>
        <p className="mt-1">{t('socialref:pro.excluded', 'Exclus : santé, handicap, vie sexuelle, justice pénale, droit au séjour, violences, protection de l’enfance, tutelle ou curatelle, hébergement d’urgence. Pour ces sujets, utilisez les circuits prévus.')}</p>
      </div>
      {problem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div role="status" aria-live="polite">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {code ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="social-code">
          <p>{t('socialref:pro.code_intro', 'Code à donner à la personne (valable 14 jours). Elle le saisit dans Mon Espace, rubrique « Mes orientations sociales » :')}</p>
          <p className="font-mono text-2xl tracking-widest" dir="ltr">{code.code}</p>
          <p className="text-sm">{t('socialref:pro.code_once', 'Ce code ne sera plus affiché. Il ne contient aucune information sur la personne.')}</p>
        </div>
      ) : null}

      <section className={box} aria-labelledby="sr-new">
        <h2 id="sr-new" className="text-lg font-semibold text-slate-900">{t('socialref:pro.new', 'Nouvelle orientation')}</h2>
        <form onSubmit={search} className="flex flex-wrap items-end gap-2">
          <div className="grow"><label htmlFor={ids.q} className="font-medium text-slate-900">{t('socialref:pro.search', 'Structure qui reçoit (nom)')}</label>
            <input id={ids.q} value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} className={input} /></div>
          <Button type="submit" variant="outline" disabled={busy}>{t('socialref:pro.search_button', 'Chercher')}</Button>
        </form>
        <form onSubmit={propose} className="space-y-3">
          {receivers.length ? (
            <fieldset><legend className="font-medium text-slate-900">{t('socialref:pro.choose', 'Choisissez la structure')}</legend>
              {receivers.map((s) => <label key={s.id} className="flex items-center gap-2"><input type="radio" name="to" value={s.id} checked={to === s.id} onChange={() => setTo(s.id)} />{s.name}{s.city ? ` — ${s.city}` : ''}</label>)}
            </fieldset>
          ) : <p className="text-sm text-slate-700">{t('socialref:pro.only_eligible', 'Seules les structures vérifiées, actives et non médico-sociales sont proposées.')}</p>}
          <fieldset><legend className="font-medium text-slate-900">{t('socialref:pro.reasons', 'Motifs (1 à 3)')}</legend>
            <div className="grid gap-1 sm:grid-cols-2">{REASONS.map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={reasons.includes(c)} onChange={() => toggle(c)} disabled={!reasons.includes(c) && reasons.length >= 3} />{lbl(L.reason, c)}</label>)}</div>
          </fieldset>
          <Button type="submit" disabled={busy || !to || !reasons.length}>{t('socialref:pro.propose', 'Proposer et obtenir le code')}</Button>
        </form>
      </section>

      <section className={box} aria-labelledby="sr-lists">
        <h2 id="sr-lists" className="text-lg font-semibold text-slate-900">{t('socialref:pro.lists', 'Suivi')}</h2>
        <div className="flex gap-2" role="group" aria-label={t('socialref:pro.lists', 'Suivi')}>
          <Button type="button" variant={tab === 'outbox' ? 'default' : 'outline'} aria-pressed={tab === 'outbox'} onClick={() => setTab('outbox')}>{t('socialref:pro.outbox', 'Envoyées')}</Button>
          <Button type="button" variant={tab === 'inbox' ? 'default' : 'outline'} aria-pressed={tab === 'inbox'} onClick={() => setTab('inbox')}>{t('socialref:pro.inbox', 'Reçues')}</Button>
        </div>
        {list.error ? <p role="alert" className="text-red-900">{list.error}</p> : null}
        {!list.loading && !list.items.length && !list.error ? <p className="text-slate-700">{t('socialref:pro.empty', 'Aucune orientation.')}</p> : null}
        <ul className="divide-y divide-slate-200">
          {list.items.map((r) => (
            <li key={r.id} className="space-y-2 py-3" data-testid="social-row">
              <p><strong>{tab === 'inbox' ? r.from : r.to}</strong> — {lbl(L.status, r.status)}{r.responseCode ? ` (${lbl(L.decline, r.responseCode)})` : ''}</p>
              <p className="text-sm text-slate-700">{formatDate(r.createdAt)} · {(r.reasonCodes || []).map((c, i) => <span key={c}>{i ? ', ' : ''}<ToneChip tone={topicTone(c)}>{lbl(L.reason, c)}</ToneChip></span>)}{r.consentChannel === 'ASSISTED_ON_SCREEN' ? ` · ${t('socialref:pro.assisted_flag', 'accord donné sur écran')}` : ''}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => detail(r.id)}>{t('socialref:pro.details', 'Détails')}</Button>
                {tab === 'outbox' && r.status === 'PENDING_CITIZEN' ? <>
                  <Button type="button" size="sm" variant="outline" onClick={() => setAssist(r.id)}>{t('socialref:pro.assist', 'Accord sur cet écran')}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => act(r.id, 'new_code')}>{t('socialref:pro.new_code', 'Nouveau code')}</Button>
                </> : null}
                {tab === 'outbox' && ['PENDING_CITIZEN', 'SENT'].includes(r.status) ? <Button type="button" size="sm" variant="outline" onClick={() => act(r.id, 'cancel', {}, t('socialref:pro.cancelled', 'Orientation annulée.'))}>{t('socialref:pro.cancel', 'Annuler')}</Button> : null}
                {tab === 'inbox' && r.status === 'SENT' ? <>
                  <Button type="button" size="sm" onClick={() => act(r.id, 'accept', {}, t('socialref:pro.accepted', 'Orientation acceptée.'))}>{t('socialref:pro.accept', 'Accepter')}</Button>
                  <label htmlFor={`${ids.dec}-${r.id}`} className="sr-only">{t('socialref:pro.decline_reason', 'Motif du refus')}</label>
                  <select id={`${ids.dec}-${r.id}`} value={declineCode} onChange={(e) => setDeclineCode(e.target.value)} className="rounded-md border border-slate-400 px-2 text-sm">
                    {DECLINES.map((c) => <option key={c} value={c}>{lbl(L.decline, c)}</option>)}</select>
                  <Button type="button" size="sm" variant="outline" onClick={() => act(r.id, 'decline', { responseCode: declineCode }, t('socialref:pro.declined', 'Orientation refusée.'))}>{t('socialref:pro.decline', 'Refuser')}</Button>
                </> : null}
                {tab === 'inbox' && r.status === 'ACCEPTED' ? <Button type="button" size="sm" onClick={() => act(r.id, 'complete', {}, t('socialref:pro.completed', 'Orientation terminée.'))}>{t('socialref:pro.complete', 'Marquer comme terminée')}</Button> : null}
              </div>
              {assist === r.id ? (
                <form onSubmit={assisted} className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3" data-testid="social-assisted">
                  <p className="text-sm">{t('socialref:pro.assist_help', 'La personne tape elle-même son e-mail et son mot de passe. Rien n’est enregistré ni montré à la structure.')}</p>
                  <div><label htmlFor={ids.em} className="font-medium">{t('socialref:pro.assist_email', 'E-mail de la personne')}</label><input id={ids.em} name="email" type="email" autoComplete="off" required className={input} /></div>
                  <div><label htmlFor={ids.pw} className="font-medium">{t('socialref:pro.assist_password', 'Mot de passe de la personne')}</label><input id={ids.pw} name="password" type="password" autoComplete="off" required className={input} /></div>
                  <fieldset><legend className="font-medium">{t('socialref:pro.assist_share', 'Coordonnées visibles par la structure qui reçoit')}</legend>
                    <label className="flex items-center gap-2"><input type="checkbox" name="shareEmail" />{t('socialref:citizen.share_email', 'Mon adresse e-mail')}</label>
                    <label className="flex items-center gap-2"><input type="checkbox" name="sharePhone" />{t('socialref:citizen.share_phone', 'Mon numéro de téléphone')}</label></fieldset>
                  <fieldset><legend className="font-medium">{t('socialref:pro.assist_decision', 'Décision de la personne')}</legend>
                    <label className="flex items-center gap-2"><input type="radio" name="decision" value="accept" defaultChecked />{t('socialref:citizen.accept', 'J’accepte')}</label>
                    <label className="flex items-center gap-2"><input type="radio" name="decision" value="refuse" />{t('socialref:citizen.refuse', 'Je refuse')}</label></fieldset>
                  <div className="flex gap-2"><Button type="submit" disabled={busy}>{t('socialref:pro.assist_submit', 'Valider')}</Button><Button type="button" variant="outline" onClick={() => setAssist(null)}>{t('socialref:pro.close', 'Fermer')}</Button></div>
                </form>
              ) : null}
              {open && open.referral?.id === r.id ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="social-detail">
                  {open.referral.contact ? <p>{t('socialref:pro.contact', 'Contact partagé par la personne :')} {[open.referral.contact.email, open.referral.contact.phone].filter(Boolean).join(' · ') || t('socialref:pro.no_contact', 'aucun (la personne vous contactera)')}</p> : null}
                  <ol className="ms-5 list-decimal">{(open.events || []).map((e, i) => <li key={i}>{formatDate(e.createdAt)} — {lbl(L.status, e.toStatus)}</li>)}</ol>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
