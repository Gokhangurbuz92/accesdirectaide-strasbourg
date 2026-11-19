// @ts-nocheck
/**
 * X04 (expansion) — Mes événements (/compte/evenements): the person's own registrations, the accessibility need they chose (change it with its
 * agreement, or remove it) and cancellation (the need is erased with it). Closed by default: 503 → « not open yet ».
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, formatTime, useLanguage, useT } from '@/i18n';
import { frAttrs } from '@/lib/recordLang';
import { ACCESSIBILITY_NEEDS, accessibilityLabel } from '@/lib/academyEvents';

/** the need editor of one current registration @param {{ reg: any, onDone: (text: string, error?: boolean) => void }} props */
function NeedEditor({ reg, onDone }) {
  const { t } = useT('events');
  const [need, setNeed] = useState(reg.accessibilityNeed || '');
  const [consent, setConsent] = useState(false);
  const id = `need-${reg.itemId}`;
  const save = async () => {
    try { await citizenApi.eventAction({ action: 'need', itemId: reg.itemId, accessibilityNeed: need || null, ...(need ? { accessibilityNeedConsent: consent } : {}) }); onDone(t('events:mine.need_saved', 'Besoin d’accessibilité enregistré.')); }
    catch (e) { onDone(e.message, true); }
  };
  return (
    <div className="mt-2 space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-900">{t('events:register.need_legend', 'Besoin d’accessibilité (facultatif)')}</label>
      <select id={id} className="w-full max-w-md rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" value={need} onChange={(e) => { setNeed(e.target.value); setConsent(false); }}>
        <option value="">{t('events:register.no_need', 'Aucun besoin à signaler')}</option>
        {ACCESSIBILITY_NEEDS.map((n) => <option key={n} value={n}>{accessibilityLabel(n, t)}</option>)}
      </select>
      {need && need !== reg.accessibilityNeed && (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>{t('events:register.consent', 'J’accepte que ce besoin d’accessibilité soit enregistré avec mon inscription et compté pour l’organisateur. Il est effacé si j’annule.')}</span></label>
      )}
      <Button type="button" size="sm" variant="outline" disabled={need === (reg.accessibilityNeed || '') || (need !== '' && !consent)} onClick={save}>{t('events:mine.save_need', 'Enregistrer le besoin')}</Button>
    </div>
  );
}

export default function CompteEvenements() {
  const { t } = useT('events');
  const { code } = useLanguage();
  const [state, setState] = useState({ loading: true, error: '', closed: false, registrations: [] });
  const [message, setMessage] = useState({ text: '', error: false });
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', closed: false, registrations: (await citizenApi.myEvents()).registrations || [] }); }
    catch (err) { setState({ loading: false, closed: err.status === 503, error: err.status === 401 ? t('events:mine.login_required', 'Connectez-vous pour voir vos inscriptions.') : err.status === 503 ? '' : err.message, registrations: [] }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const done = (text, error = false) => { setMessage({ text, error }); load(); };
  const title = t('events:mine.title', 'Mes événements');
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('events:list.loading', 'Chargement…')}</div>;
  const now = Date.now();
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-evenements">
      <SEO title={title} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {state.closed && <p role="status" data-testid="academy-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{t('events:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>}
      <div aria-live="polite" role="status">{message.text && <p className={`rounded-md border p-3 ${message.error ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{message.text}</p>}</div>
      {!state.closed && !state.error && state.registrations.length === 0 && (
        <p data-testid="mine-empty" className="text-slate-700">{t('events:mine.none', 'Aucune inscription.')} <Link className="font-medium text-blue-800 underline" to="/evenements">{t('events:list.to_events', 'Voir les événements')}</Link></p>
      )}
      {state.registrations.length > 0 && (
        <ul className="space-y-4" data-testid="mine-list">
          {state.registrations.map((r) => {
            const translatedTitle = code !== 'fr' && r.titles?.[code];
            const current = r.status === 'REGISTERED' && r.eventStatus === 'published' && new Date(r.startsAt).getTime() > now;
            return (
              <li key={r.itemId} className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {r.slug ? <Link className="text-blue-800 underline" to={`/evenements/${r.slug}`} {...frAttrs(code, { translated: Boolean(translatedTitle) })}>{translatedTitle || r.title}</Link> : <span {...frAttrs(code)}>{r.title}</span>}
                </h2>
                <p className="text-sm text-slate-800"><time dateTime={r.startsAt}>{formatDate(r.startsAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, {formatTime(r.startsAt)}</time> — <span {...frAttrs(code)}>{r.venueName}, {r.venueCommune}</span></p>
                <p className="mt-1 text-sm font-medium" data-testid="mine-status">
                  {r.eventStatus === 'cancelled' ? t('events:mine.event_cancelled', 'L’organisateur a annulé cet événement.')
                    : r.status === 'CANCELLED' ? t('events:mine.you_cancelled', 'Inscription annulée.') : t('events:mine.registered', 'Inscrit ou inscrite.')}
                </p>
                {r.accessibilityNeed && <p className="text-sm text-slate-800">{t('events:mine.your_need', 'Votre besoin d’accessibilité : {{need}}', { need: accessibilityLabel(r.accessibilityNeed, t) })}</p>}
                {current && (
                  <>
                    <NeedEditor reg={r} onDone={done} />
                    <Button type="button" size="sm" variant="destructive" className="mt-3" onClick={async () => {
                      try { await citizenApi.eventAction({ action: 'cancel', itemId: r.itemId }); done(t('events:mine.cancelled', 'Inscription annulée. Votre besoin d’accessibilité a été effacé.')); }
                      catch (e) { done(e.message, true); }
                    }}>{t('events:mine.cancel', 'Annuler mon inscription')}</Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
