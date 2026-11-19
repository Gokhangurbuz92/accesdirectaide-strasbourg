// @ts-nocheck
/**
 * X02 (expansion) — Mes témoignages (/compte/temoignages): write a testimonial (adult accounts; moderated before publication), see its state, withdraw it at
 * any time (it leaves public view at once and its text is erased). The form: a first name or pseudonym the person TYPES (never prefilled — not the e-mail,
 * not the profile), the text with a warning next to it (no health or disability detail, nothing about other people), the explicit consent box — never
 * pre-ticked, sent with the version of its wording. No photo, no file. Closed by default: 503 → « not open yet ».
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useLanguage, useT } from '@/i18n';
import { BODY_MAX, BODY_MIN, reasonLabel, statusLabel, TESTIMONIAL_CONSENT_VERSION, TESTIMONIAL_LANGS, textAttrs } from '@/lib/testimonials';

/** @param {{ onDone: (text: string, error?: boolean) => void }} props */
function SubmitForm({ onDone }) {
  const { t } = useT('testimonials');
  const { code } = useLanguage();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const lang = TESTIMONIAL_LANGS.includes(code) ? code : 'fr';
  const ready = name.trim().length >= 2 && body.trim().length >= BODY_MIN && consent && !busy;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await citizenApi.testimonialAction({ action: 'submit', displayName: name.trim(), body: body.trim(), lang, consent: true, consentVersion: TESTIMONIAL_CONSENT_VERSION });
      onDone(t('testimonials:form.sent', 'Merci. Votre témoignage sera relu avant d’être publié. Vous pouvez le retirer à tout moment.'));
    } catch (err) { onDone(err.message, true); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="testimonial-form" noValidate>
      <h2 className="text-lg font-semibold text-slate-900">{t('testimonials:form.title', 'Écrire un témoignage')}</h2>
      <div>
        <label htmlFor="testimonial-name" className="block text-sm font-semibold text-slate-900">{t('testimonials:form.name', 'Prénom ou pseudonyme')}</label>
        <p id="testimonial-name-help" className="text-sm text-slate-700">{t('testimonials:form.name_help', 'C’est le seul nom affiché. N’indiquez pas votre nom de famille ni votre adresse e-mail. Un mot, éventuellement suivi d’une initiale (exemple : « Marie D. »).')}</p>
        <input id="testimonial-name" type="text" autoComplete="off" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="testimonial-name-help"
          className="mt-1 w-full max-w-sm rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor="testimonial-body" className="block text-sm font-semibold text-slate-900">{t('testimonials:form.body', 'Votre témoignage')}</label>
        <p id="testimonial-health-warning" data-testid="health-warning" className="mt-1 rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-950">
          {t('testimonials:form.health_warning', 'Ne donnez aucun détail sur votre santé, un handicap ou un traitement, ni d’information sur d’autres personnes (nom, adresse, téléphone). Ce n’est pas nécessaire : un témoignage qui en contient n’est pas publié.')}
        </p>
        <textarea id="testimonial-body" rows={6} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby="testimonial-health-warning testimonial-count" {...textAttrs(lang)}
          className="mt-2 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" />
        <p id="testimonial-count" className="text-xs text-slate-700">{t('testimonials:form.count', '{{n}} caractères sur {{max}} (au moins {{min}})', { n: body.length, max: BODY_MAX, min: BODY_MIN })}</p>
      </div>
      <p className="text-sm text-slate-700">{t('testimonials:form.no_photo', 'Pas de photo ni de fichier : seuls le texte et le prénom ou pseudonyme sont publiés.')}</p>
      <label className="flex items-start gap-2 text-sm text-slate-900" data-testid="testimonial-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>{t('testimonials:form.consent', 'J’accepte que ce témoignage soit publié sur le site sous le prénom ou pseudonyme indiqué, après relecture. Je peux retirer mon accord à tout moment : le témoignage est alors retiré du site et son texte effacé.')}</span>
      </label>
      <Button type="submit" disabled={!ready}>{t('testimonials:form.submit', 'Envoyer pour relecture')}</Button>
    </form>
  );
}

export default function CompteTemoignages() {
  const { t } = useT('testimonials');
  const [state, setState] = useState({ loading: true, error: '', closed: false, testimonials: [], canSubmit: false });
  const [message, setMessage] = useState({ text: '', error: false });
  const load = useCallback(async () => {
    try { const r = await citizenApi.myTestimonials(); setState({ loading: false, error: '', closed: false, testimonials: r.testimonials || [], canSubmit: r.available !== false && r.canSubmit !== false }); }
    catch (err) { setState({ loading: false, closed: err.status === 503, error: err.status === 401 ? t('testimonials:mine.login_required', 'Connectez-vous pour écrire ou retirer un témoignage.') : err.status === 503 ? '' : err.message, testimonials: [], canSubmit: false }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const done = (text, error = false) => { setMessage({ text, error }); load(); };
  const title = t('testimonials:mine.title', 'Mes témoignages');
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('testimonials:loading', 'Chargement…')}</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-temoignages">
      <SEO title={title} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {state.closed && <p role="status" data-testid="testimonials-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{t('testimonials:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>}
      <div aria-live="polite" role="status">{message.text && <p className={`rounded-md border p-3 ${message.error ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{message.text}</p>}</div>
      {!state.closed && !state.error && (
        <>
          <p className="text-sm text-slate-700">{t('testimonials:mine.intro', 'Votre témoignage est relu avant publication. Il est réservé aux comptes de personnes de 18 ans ou plus. Vous pouvez le retirer à tout moment.')} <Link className="font-medium text-blue-800 underline" to="/temoignages">{t('testimonials:mine.to_public', 'Voir les témoignages publiés')}</Link></p>
          {state.testimonials.length > 0 && (
            <ul className="space-y-4" data-testid="mine-testimonials">
              {state.testimonials.map((x) => (
                <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900" data-testid="mine-status">{statusLabel(x.status, t)} — <time dateTime={x.submittedAt}>{formatDate(x.submittedAt, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
                  {x.moderationReason && <p className="text-sm text-slate-800">{t('testimonials:mine.reason', 'Motif : {{reason}}', { reason: reasonLabel(x.moderationReason, t) })}</p>}
                  {x.body && <blockquote className="mt-2 whitespace-pre-line text-slate-900" {...textAttrs(x.lang)}>{x.body}</blockquote>}
                  {x.displayName && <p className="text-sm text-slate-700"><span {...textAttrs(x.lang)}>{x.displayName}</span></p>}
                  {!x.body && <p className="text-sm text-slate-700">{t('testimonials:mine.erased', 'Le texte de ce témoignage a été effacé.')}</p>}
                  {['pending', 'published'].includes(x.status) && (
                    <div className="mt-3 space-y-1">
                      <p className="text-sm text-slate-700">{t('testimonials:mine.withdraw_help', 'Le retrait est immédiat : le témoignage n’est plus visible et son texte est effacé.')}</p>
                      <Button type="button" size="sm" variant="destructive" onClick={async () => {
                        try { await citizenApi.testimonialAction({ action: 'withdraw', id: x.id }); done(t('testimonials:mine.withdrawn', 'Votre témoignage est retiré et son texte effacé.')); }
                        catch (e) { done(e.message, true); }
                      }}>{t('testimonials:mine.withdraw', 'Retirer mon témoignage')}</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {state.canSubmit ? <SubmitForm onDone={done} /> : <p className="text-sm text-slate-700" data-testid="one-active">{t('testimonials:mine.one_active', 'Vous avez déjà un témoignage en attente ou publié. Pour en écrire un autre, retirez-le d’abord.')}</p>}
        </>
      )}
    </div>
  );
}
