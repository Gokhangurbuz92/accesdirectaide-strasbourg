// @ts-nocheck
/**
 * X04 (expansion) — one academy page (/academie/:slug) or one event (/evenements/:slug). An event shows its date, place, organizer, accessibility
 * information and places left, and — while registration is open — the registration form of a signed-in adult account: an OPTIONAL accessibility need
 * chosen in a closed list (no free text), sent only with its separate, never pre-ticked agreement. Anonymous visitors are offered sign-in; nothing
 * personal is asked on this page otherwise. 404 / 410 / 503 (not open yet) each say what happened.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { formatDate, formatTime, useLanguage, useT } from '@/i18n';
import { frAttrs } from '@/lib/recordLang';
import { citizenApi } from '@/lib/citizenApi';
import { ACCESSIBILITY_NEEDS, accessibilityLabel, itemText } from '@/lib/academyEvents';

/** the registration block of an open event @param {{ item: any, onChange: () => void }} props */
function Registration({ item, onChange }) {
  const { t } = useT('events');
  const [me, setMe] = useState({ loading: true, signedIn: false, registered: false });
  const [need, setNeed] = useState('');
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    citizenApi.myEvents().then((r) => setMe({ loading: false, signedIn: true, registered: (r.registrations || []).some((x) => x.slug === item.slug && x.status === 'REGISTERED') }))
      .catch((e) => setMe({ loading: false, signedIn: e.status !== 401, registered: false, error: e.status === 401 ? '' : e.message }));
  }, [item.slug]);
  useEffect(() => { load(); }, [load]);

  if (me.loading) return <p role="status">{t('events:list.loading', 'Chargement…')}</p>;
  if (!me.signedIn) {
    return (
      <p data-testid="event-signin">
        {t('events:register.signin_needed', 'L’inscription se fait avec un compte personnel (personnes de 18 ans ou plus).')}{' '}
        <Link className="font-medium text-blue-800 underline" to={`/auth/login?next=${encodeURIComponent(`/evenements/${item.slug}`)}`}>{t('events:register.signin', 'Se connecter pour s’inscrire')}</Link>
      </p>
    );
  }
  if (me.registered) {
    return (
      <p data-testid="event-registered" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
        {t('events:register.already', 'Vous êtes inscrit ou inscrite à cet événement.')}{' '}
        <Link className="font-medium underline" to="/compte/evenements">{t('events:register.manage', 'Gérer mes inscriptions')}</Link>
      </p>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: '', error: false });
    try {
      await citizenApi.eventAction({ action: 'register', slug: item.slug, ...(need ? { accessibilityNeed: need, accessibilityNeedConsent: consent } : {}) });
      setMsg({ text: t('events:register.done', 'Inscription enregistrée. Un rappel apparaîtra dans vos notifications 48 heures avant l’événement.'), error: false });
      setMe((m) => ({ ...m, registered: true })); onChange();
    } catch (err) { setMsg({ text: err.message, error: true }); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="event-register-form" noValidate>
      <fieldset className="space-y-2">
        <legend className="font-semibold text-slate-900">{t('events:register.need_legend', 'Besoin d’accessibilité (facultatif)')}</legend>
        <p className="text-sm text-slate-700" id="need-help">{t('events:register.need_help', 'Indiquez un besoin seulement si vous le souhaitez : l’organisateur voit le nombre de personnes par besoin, jamais votre nom. Vous pouvez le retirer à tout moment.')}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="need" value="" checked={need === ''} onChange={() => { setNeed(''); setConsent(false); }} aria-describedby="need-help" className="mt-1" />{t('events:register.no_need', 'Aucun besoin à signaler')}</label>
          {ACCESSIBILITY_NEEDS.map((n) => (
            <label key={n} className="flex items-start gap-2 text-sm"><input type="radio" name="need" value={n} checked={need === n} onChange={() => setNeed(n)} aria-describedby="need-help" className="mt-1" />{accessibilityLabel(n, t)}</label>
          ))}
        </div>
      </fieldset>
      {need && (
        <label className="flex items-start gap-2 text-sm text-slate-900" data-testid="event-need-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>{t('events:register.consent', 'J’accepte que ce besoin d’accessibilité soit enregistré avec mon inscription et compté pour l’organisateur. Il est effacé si j’annule.')}</span>
        </label>
      )}
      <p className="text-sm text-slate-700">{t('events:register.data', 'Seuls votre compte, cet événement, les dates d’inscription et, si vous le choisissez, votre besoin d’accessibilité sont enregistrés.')}</p>
      <div aria-live="polite" role="status">{msg.text && <p className={msg.error ? 'text-red-900' : 'text-emerald-900'}>{msg.text}</p>}</div>
      <Button type="submit" disabled={busy || (need !== '' && !consent)}>{t('events:register.submit', 'M’inscrire')}</Button>
    </form>
  );
}

/** @param {{ kind: 'LESSON' | 'EVENT' }} props */
export default function AcademyEventDetail({ kind = 'EVENT' }) {
  const { slug } = useParams();
  const { t } = useT('events');
  const { code } = useLanguage();
  const [state, setState] = useState({ loading: true, item: null, status: 0 });
  const [attempt, setAttempt] = useState(0);
  const base = kind === 'EVENT' ? '/evenements' : '/academie';

  useEffect(() => {
    let alive = true;
    fetch(`/api/events/${encodeURIComponent(slug || '')}`).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (alive) setState({ loading: false, item: res.ok ? body.item : null, status: res.status });
    }).catch(() => { if (alive) setState({ loading: false, item: null, status: 0 }); });
    return () => { alive = false; };
  }, [slug, attempt]);

  const back = <Link className="font-medium text-blue-800 underline" to={base}>{kind === 'EVENT' ? t('events:detail.back_events', 'Tous les événements') : t('events:detail.back_academy', 'Toutes les pages de l’académie')}</Link>;
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('events:list.loading', 'Chargement…')}</div>;
  if (!state.item) {
    const text = state.status === 503 ? t('events:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')
      : state.status === 410 ? t('events:detail.withdrawn', 'Cette page a été retirée.')
        : state.status === 404 ? t('events:detail.not_found', 'Cette page n’existe pas ou n’est pas publiée.') : t('events:detail.failed', 'La page n’a pas pu être chargée.');
    return (
      <div className="container mx-auto max-w-3xl space-y-4 px-4 py-8">
        <SEO title={kind === 'EVENT' ? t('events:list.title_events', 'Événements') : t('events:list.title_academy', 'Académie')} noindex />
        <h1 className="text-2xl font-bold text-slate-900">{kind === 'EVENT' ? t('events:list.title_events', 'Événements') : t('events:list.title_academy', 'Académie')}</h1>
        <p role="status" data-testid="academy-detail-unavailable">{text}</p>
        {state.status === 0 && <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('events:list.retry', 'Réessayer')}</Button>}
        <p>{back}</p>
      </div>
    );
  }
  const item = state.item;
  const tx = itemText(item, code);
  const isEvent = item.kind === 'EVENT';
  return (
    <article className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="academy-detail">
      <SEO title={tx.title.text} description={tx.summary.text} path={`${base}/${item.slug}`} />
      <p className="text-sm">{back}</p>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900" {...frAttrs(code, { translated: tx.title.translated })}>{tx.title.text}</h1>
        <p className="text-lg text-slate-700" {...frAttrs(code, { translated: tx.summary.translated })}>{tx.summary.text}</p>
      </header>
      {isEvent && (
        <section aria-labelledby="event-practical" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 id="event-practical" className="text-lg font-semibold text-slate-900">{t('events:detail.practical', 'Informations pratiques')}</h2>
          {item.status === 'cancelled' && <p data-testid="event-cancelled" className="rounded bg-red-100 p-2 font-semibold text-red-950">{t('events:detail.cancelled', 'Cet événement est annulé.')}</p>}
          <dl className="grid gap-2 text-sm text-slate-800 sm:grid-cols-[max-content_1fr] sm:gap-x-4">
            <dt className="font-semibold">{t('events:detail.when', 'Quand')}</dt>
            <dd><time dateTime={item.startsAt}>{formatDate(item.startsAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, {formatTime(item.startsAt)}–{formatTime(item.endsAt)}</time></dd>
            <dt className="font-semibold">{t('events:detail.where', 'Où')}</dt>
            <dd {...frAttrs(code)}>{item.venueName} — {item.venueAddress}, {item.venueCommune}</dd>
            <dt className="font-semibold">{t('events:detail.organizer', 'Organisateur')}</dt>
            <dd {...frAttrs(code)}>{item.organizerName}</dd>
            <dt className="font-semibold">{t('events:detail.places', 'Places')}</dt>
            <dd data-testid="event-remaining">{item.status === 'published' && item.remaining === 0 ? t('events:status.full', 'Complet') : t('events:places_left', 'Places restantes : {{n}} sur {{capacity}}', { n: item.remaining, capacity: item.capacity })}</dd>
          </dl>
        </section>
      )}
      {isEvent && (
        <section aria-labelledby="event-a11y" className="space-y-2" data-testid="event-accessibility">
          <h2 id="event-a11y" className="text-lg font-semibold text-slate-900">{t('events:a11y.title', 'Accessibilité')}</h2>
          {item.accessibilityFeatures?.length > 0
            ? <ul className="list-disc ps-5 text-slate-800">{item.accessibilityFeatures.map((f) => <li key={f}>{accessibilityLabel(f, t)}</li>)}</ul>
            : <p className="text-slate-800">{t('events:a11y.none_listed', 'Aucun aménagement de la liste n’est proposé : lisez la précision de l’organisateur.')}</p>}
          {item.accessibilityNote && <p className="text-slate-800" {...frAttrs(code)}>{item.accessibilityNote}</p>}
        </section>
      )}
      <section className="whitespace-pre-line leading-relaxed text-slate-900" {...frAttrs(code, { translated: tx.body.translated })}>{tx.body.text}</section>
      {isEvent && (
        <section aria-labelledby="event-register" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 id="event-register" className="text-lg font-semibold text-slate-900">{t('events:register.title', 'Inscription')}</h2>
          {item.registrationOpen
            ? <Registration item={item} onChange={() => setAttempt((n) => n + 1)} />
            : <p data-testid="event-registration-closed">{t('events:register.closed', 'Les inscriptions sont closes.')}</p>}
        </section>
      )}
    </article>
  );
}
