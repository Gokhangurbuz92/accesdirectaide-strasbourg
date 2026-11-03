// R38 — « Prendre rendez-vous sans compte »: an OPTIONAL account-free booking, offered only when the structure opted in and the server switch is on
// (the API answers 404 / 503 otherwise and this page says so). Steps: service -> slot -> minimal identity + consent -> 6-digit code -> confirmed.
// Accessibility: each step's heading takes the focus, errors are announced (role="alert"), every control is labelled, targets are at least 44 px.
// R39: a SEPARATE, optional box for the J-1 reminder e-mail — never pre-ticked, not required, independent of the booking-mails consent; its help text is
// linked with aria-describedby; the box itself is 24×24 px inside a 44 px label.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { useT, formatDate } from '@/i18n';
import { GUEST_NOTE_MAX, guestGet, guestPost, newIdempotencyKey, slotsByParisDay } from '@/lib/guestBooking';
import { useGuestMessages } from '@/lib/useGuestMessages';

const field = 'mt-1 block w-full min-h-[44px] rounded-md border border-slate-400 bg-white px-3 py-2 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700';
const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-md bg-blue-800 px-5 py-2 text-base font-medium text-white hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 disabled:opacity-60';
const secondary = 'inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-400 bg-white px-5 py-2 text-base font-medium text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-700';
/** @typedef {import('@/lib/guestBooking').GuestSlot} GuestSlot */
/** @typedef {import('@/lib/guestBooking').GuestStructure} GuestStructure */
/** @typedef {import('@/lib/guestBooking').GuestService} GuestService */
/** @typedef {import('@/lib/guestBooking').GuestHold} GuestHold */
/** @typedef {import('@/lib/guestBooking').GuestConfirmation} GuestConfirmation */
/** @typedef {{ name: string, email: string, phone: string, note: string, consent: boolean, reminderConsent: boolean }} GuestForm */

/** formatDate with the full Intl options it forwards (its JSDoc infers only its default's shape) */
const formatWith = /** @type {(value: string | undefined, options: Intl.DateTimeFormatOptions) => string} */ (formatDate);
/** @param {number} offset */
const isoDay = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** @param {string | undefined} v */
const when = (v) => formatWith(v, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * heading that receives the focus when its step appears — not the first step on page load: the skip link stays the first tab stop (WCAG 2.4.1, R38 a11y run)
 * @param {{ children: import('react').ReactNode, id: string, focusOnMount?: boolean }} props
 */
function StepHeading({ children, id, focusOnMount = true }) {
  const ref = useRef(/** @type {HTMLHeadingElement | null} */ (null));
  useEffect(() => { if (focusOnMount) ref.current?.focus(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return <h2 ref={ref} id={id} tabIndex={-1} className="text-xl font-semibold text-slate-900 focus:outline-none">{children}</h2>;
}

export default function GuestBooking() {
  const { t } = useT('booking');
  const message = useGuestMessages();
  const { structureSlug = '' } = useParams();
  const [state, setState] = useState(/** @type {{ loading: boolean, error: string, structure: GuestStructure | null, services: GuestService[] }} */ ({ loading: true, error: '', structure: null, services: [] }));
  const [serviceId, setServiceId] = useState('');
  const [slots, setSlots] = useState(/** @type {{ loading: boolean, list: GuestSlot[], error: string }} */ ({ loading: false, list: [], error: '' }));
  const [slot, setSlot] = useState(/** @type {GuestSlot | null} */ (null));
  const [step, setStep] = useState('choose');   // choose -> identity -> code -> done
  const leftFirstStep = useRef(false);   // the first step's heading takes the focus only when the visitor comes back to it
  useEffect(() => { if (step !== 'choose') leftFirstStep.current = true; }, [step]);
  const [form, setForm] = useState(/** @type {GuestForm} */ ({ name: '', email: '', phone: '', note: '', consent: false, reminderConsent: false }));
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hold, setHold] = useState(/** @type {GuestHold | null} */ (null));
  const [code, setCode] = useState('');
  const [done, setDone] = useState(/** @type {GuestConfirmation | null} */ (null));
  const keyRef = useRef(newIdempotencyKey());

  useEffect(() => {
    let live = true;
    guestGet(`structures/${encodeURIComponent(structureSlug)}/services`).then((r) => {
      if (!live) return;
      if (!r.ok) setState({ loading: false, error: message(r.body.code), structure: null, services: [] });
      else { setState({ loading: false, error: '', structure: r.body.structure, services: r.body.items || [] }); if ((r.body.items || []).length === 1) setServiceId(r.body.items[0].id); }
    });
    return () => { live = false; };
  }, [structureSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!serviceId) return undefined;
    let live = true;
    setSlots({ loading: true, list: [], error: '' }); setSlot(null);
    guestGet(`structures/${encodeURIComponent(structureSlug)}/slots?${new URLSearchParams({ serviceId, from: isoDay(0), to: isoDay(13) })}`).then((r) => {
      if (live) setSlots({ loading: false, list: r.ok ? r.body.slots || [] : [], error: r.ok ? '' : message(r.body.code) });
    });
    return () => { live = false; };
  }, [serviceId, structureSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => slotsByParisDay(slots.list), [slots.list]);
  const service = state.services.find((s) => s.id === serviceId) || null;
  /** @param {keyof GuestForm} k @returns {(e: import('react').ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void} */
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'consent' || k === 'reminderConsent' ? /** @type {HTMLInputElement} */ (e.target).checked : e.target.value }));

  /** @param {import('react').FormEvent<HTMLFormElement>} e */
  const submitHold = async (e) => {
    e.preventDefault(); setFormError(''); setErrors({});
    /** @type {Record<string, string>} */
    const local = {};
    if (!form.name.trim()) local.name = message('INVALID_NAME');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) local.email = message('INVALID_EMAIL');
    if (!form.consent) local.consent = message('CONSENT_REQUIRED');
    if (Object.keys(local).length) { setErrors(local); setFormError(t('booking:form.fix', 'Corrigez les champs signalés.')); return; }
    setBusy(true);
    const r = await guestPost('hold', { structureSlug, serviceId, startAt: /** @type {GuestSlot} */ (slot).startAt, idempotencyKey: keyRef.current, ...form, consent: form.consent === true, reminderConsent: form.reminderConsent === true });
    setBusy(false);
    if (r.ok) { setHold(r.body); setStep('code'); return; }
    if (r.body.field) setErrors({ [r.body.field]: message(r.body.code) });
    setFormError(message(r.body.code));
    if (r.body.code === 'SLOT_TAKEN') { keyRef.current = newIdempotencyKey(); setStep('choose'); setSlot(null); }
  };

  /** @param {import('react').FormEvent<HTMLFormElement>} e */
  const submitCode = async (e) => {
    e.preventDefault(); setFormError('');
    if (!/^\d{6}$/.test(code)) { setFormError(t('booking:code.format', 'Le code contient 6 chiffres.')); return; }
    setBusy(true);
    const r = await guestPost('confirm', { holdId: /** @type {GuestHold} */ (hold).hold.id, code });
    setBusy(false);
    if (r.ok) { setDone(r.body); setStep('done'); return; }
    const left = typeof r.body.attemptsLeft === 'number' && r.body.attemptsLeft > 0 ? ` ${t('booking:code.left', 'Essais restants : {{n}}.', { n: r.body.attemptsLeft })}` : '';
    // R39: an unknown hold at this step (e.g. the address already had a booking with this structure: no hold was taken) reads as a request no longer active
    const refusal = r.body.code === 'APPOINTMENT_NOT_FOUND' ? 'HOLD_NOT_ACTIVE' : r.body.code;
    setFormError(message(refusal) + left);
    if (['HOLD_EXPIRED', 'HOLD_LOCKED', 'HOLD_NOT_ACTIVE'].includes(refusal)) { keyRef.current = newIdempotencyKey(); setHold(null); setCode(''); setStep('choose'); setSlot(null); setServiceId((s) => s); }
  };

  return (
    <main className="min-h-screen bg-slate-50 py-8" id="main-content">
      <SEO title={t('booking:seo.title', 'Rendez-vous sans compte')} description={t('booking:seo.description', 'Prendre rendez-vous sans créer de compte')} path={`/rdv/${structureSlug}/sans-compte`} noindex={true} />
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('booking:title', 'Prendre rendez-vous sans compte')}</h1>
        {state.structure ? <p className="mt-1 text-slate-700">{state.structure.name}</p> : null}
        <p className="mt-2 text-sm text-slate-700">
          <Link className="underline" to={`/auth/login?next=${encodeURIComponent(`/rdv/${structureSlug}/booking`)}`}>{t('booking:haveAccount', 'Vous avez un compte ? Connectez-vous')}</Link>
        </p>
        <p className="mt-2 text-sm text-slate-700">{t('booking:intro', 'En présentiel uniquement. Vous recevrez un code par e-mail pour confirmer, puis un lien personnel pour voir, déplacer ou annuler le rendez-vous.')}</p>

        {state.loading ? <p role="status" className="mt-6">{t('booking:loading', 'Chargement…')}</p> : null}
        {state.error ? (
          <div role="alert" className="mt-6 rounded-md border border-amber-400 bg-amber-50 p-4 text-slate-900" data-testid="guest-unavailable">
            <p>{state.error}</p>
            <p className="mt-3"><Link className="underline" to={`/rdv/${encodeURIComponent(structureSlug)}`}>{t('booking:withAccount', 'Prendre rendez-vous avec un compte')}</Link></p>
          </div>
        ) : null}

        {!state.loading && !state.error && step === 'choose' ? (
          <section aria-labelledby="guest-step-choose" className="mt-6 space-y-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
            <StepHeading id="guest-step-choose" focusOnMount={leftFirstStep.current}>{t('booking:step.choose', '1. Motif et créneau')}</StepHeading>
            {formError ? <p role="alert" className="text-red-800">{formError}</p> : null}
            <fieldset>
              <legend className="font-medium text-slate-900">{t('booking:service.legend', 'Motif du rendez-vous')}</legend>
              {state.services.length === 0 ? <p className="mt-2 text-slate-700">{t('booking:service.none', 'Aucun motif n’est proposé sans compte pour le moment.')}</p> : null}
              <div className="mt-2 space-y-2">
                {state.services.map((s) => (
                  <label key={s.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border border-slate-300 px-3 py-2">
                    <input type="radio" name="guest-service" value={s.id} checked={serviceId === s.id} onChange={() => setServiceId(s.id)} className="h-5 w-5" />
                    <span>{s.name} <span className="text-slate-600">({t('booking:service.minutes', '{{n}} min', { n: s.durationMinutes })})</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {serviceId ? (
              <fieldset>
                <legend className="font-medium text-slate-900">{t('booking:slot.legend', 'Créneau (heure de Paris)')}</legend>
                {slots.loading ? <p role="status" className="mt-2">{t('booking:loading', 'Chargement…')}</p> : null}
                {slots.error ? <p role="alert" className="mt-2 text-red-800">{slots.error}</p> : null}
                {!slots.loading && !slots.error && days.length === 0 ? <p className="mt-2 text-slate-700">{t('booking:slot.none', 'Aucun créneau libre dans les 14 prochains jours.')}</p> : null}
                <div className="mt-2 space-y-4">
                  {days.map((d) => (
                    <div key={d.date}>
                      <p className="font-medium text-slate-800">{formatWith(d.slots[0].startAt, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {d.slots.map((s) => (
                          <label key={s.startAt} className={`inline-flex min-h-[44px] min-w-[72px] cursor-pointer items-center justify-center rounded-md border px-3 ${slot?.startAt === s.startAt ? 'border-blue-800 bg-blue-50 font-semibold' : 'border-slate-300 bg-white'}`}>
                            <input type="radio" name="guest-slot" className="sr-only" value={s.startAt} checked={slot?.startAt === s.startAt} onChange={() => setSlot(s)} />
                            {formatWith(s.startAt, { hour: '2-digit', minute: '2-digit' })}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <button type="button" className={primary} disabled={!slot} onClick={() => { setFormError(''); setStep('identity'); }}>{t('booking:continue', 'Continuer')}</button>
          </section>
        ) : null}

        {step === 'identity' && slot ? (
          <form onSubmit={submitHold} noValidate aria-labelledby="guest-step-identity" className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
            <StepHeading id="guest-step-identity">{t('booking:step.identity', '2. Vos coordonnées')}</StepHeading>
            <p className="text-slate-800">{service?.name} — {when(slot.startAt)}</p>
            {formError ? <p role="alert" className="text-red-800">{formError}</p> : null}
            <div>
              <label htmlFor="guest-name" className="font-medium">{t('booking:form.name', 'Nom ou initiales')}</label>
              <input id="guest-name" className={field} autoComplete="name" maxLength={80} value={form.name} onChange={set('name')} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'guest-name-error' : undefined} required />
              {errors.name ? <p id="guest-name-error" className="mt-1 text-red-800">{errors.name}</p> : null}
            </div>
            <div>
              <label htmlFor="guest-email" className="font-medium">{t('booking:form.email', 'Adresse e-mail')}</label>
              <input id="guest-email" type="email" className={field} autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} aria-invalid={Boolean(errors.email)} aria-describedby={`guest-email-help${errors.email ? ' guest-email-error' : ''}`} required />
              <p id="guest-email-help" className="mt-1 text-sm text-slate-700">{t('booking:form.emailHelp', 'Le code de confirmation et le lien de gestion y seront envoyés.')}</p>
              {errors.email ? <p id="guest-email-error" className="mt-1 text-red-800">{errors.email}</p> : null}
            </div>
            <div>
              <label htmlFor="guest-phone" className="font-medium">{t('booking:form.phone', 'Téléphone (facultatif)')}</label>
              <input id="guest-phone" type="tel" className={field} autoComplete="tel" inputMode="tel" value={form.phone} onChange={set('phone')} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'guest-phone-error' : undefined} />
              {errors.phone ? <p id="guest-phone-error" className="mt-1 text-red-800">{errors.phone}</p> : null}
            </div>
            <div>
              <label htmlFor="guest-note" className="font-medium">{t('booking:form.note', 'Message court pour la structure (facultatif)')}</label>
              <p id="guest-note-warning" className="mt-1 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-slate-900">{t('booking:form.noteWarning', 'N’écrivez aucune information de santé ni aucun détail personnel sensible.')}</p>
              <textarea id="guest-note" className={`${field} min-h-[88px]`} maxLength={GUEST_NOTE_MAX} value={form.note} onChange={set('note')} aria-describedby="guest-note-warning guest-note-count" aria-invalid={Boolean(errors.note)} />
              <p id="guest-note-count" className="mt-1 text-sm text-slate-700">{t('booking:form.noteCount', '{{used}} / {{max}} caractères', { used: form.note.length, max: GUEST_NOTE_MAX })}</p>
              {errors.note ? <p className="mt-1 text-red-800">{errors.note}</p> : null}
            </div>
            <div>
              <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={form.consent} onChange={set('consent')} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? 'guest-consent-error' : undefined} />
                <span>{t('booking:form.consent', 'J’accepte de recevoir par e-mail les messages de ce rendez-vous (code, confirmation, changements). Mes coordonnées sont transmises à la structure pour ce rendez-vous uniquement.')}</span>
              </label>
              {errors.consent ? <p id="guest-consent-error" className="mt-1 text-red-800">{errors.consent}</p> : null}
            </div>
            <div>
              <label htmlFor="guest-reminder" className="flex min-h-[44px] cursor-pointer items-start gap-3">
                <input id="guest-reminder" type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={form.reminderConsent} onChange={set('reminderConsent')} aria-describedby="guest-reminder-help" />
                <span>{t('booking:form.reminder', 'Recevoir aussi un rappel par e-mail la veille du rendez-vous (facultatif)')}</span>
              </label>
              <p id="guest-reminder-help" className="mt-1 text-sm text-slate-700">{t('booking:form.reminderHelp', 'Un seul e-mail, la veille. Vous pourrez l’arrêter à tout moment avec votre lien personnel.')}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="submit" className={primary} disabled={busy}>{busy ? t('booking:sending', 'Envoi…') : t('booking:form.submit', 'Recevoir le code')}</button>
              <button type="button" className={secondary} onClick={() => setStep('choose')}>{t('booking:back', 'Retour')}</button>
            </div>
          </form>
        ) : null}

        {step === 'code' && hold ? (
          <form onSubmit={submitCode} noValidate aria-labelledby="guest-step-code" className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
            <StepHeading id="guest-step-code">{t('booking:step.code', '3. Code de confirmation')}</StepHeading>
            <p role="status" className="text-slate-800">{t('booking:code.sent', 'Un code à 6 chiffres a été envoyé à {{email}}. Le créneau est réservé 20 minutes.', { email: hold.emailMasked || '' })}</p>
            <p className="text-sm text-slate-700">{t('booking:code.alreadyHint', 'Si vous avez déjà un rendez-vous avec cette structure, vous recevez à la place un e-mail qui vous l’indique : aucun nouveau rendez-vous n’est pris.')}</p>
            {formError ? <p role="alert" className="text-red-800">{formError}</p> : null}
            <div>
              <label htmlFor="guest-code" className="font-medium">{t('booking:code.label', 'Code reçu par e-mail')}</label>
              <input id="guest-code" className={`${field} max-w-[12rem] tracking-widest`} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </div>
            <button type="submit" className={primary} disabled={busy}>{busy ? t('booking:sending', 'Envoi…') : t('booking:code.submit', 'Confirmer le rendez-vous')}</button>
          </form>
        ) : null}

        {step === 'done' && done ? (
          <section aria-labelledby="guest-step-done" className="mt-6 space-y-3 rounded-lg border border-green-300 bg-white p-4 sm:p-6" data-testid="guest-confirmed">
            <StepHeading id="guest-step-done">{t('booking:done.title', 'Rendez-vous confirmé')}</StepHeading>
            <p>{done.appointment.service?.name} — {when(done.appointment.startsAt)}</p>
            {done.appointment.location?.address ? <p>{done.appointment.location.address}</p> : null}
            <p className="text-sm text-slate-700">{done.mail?.status === 'PROVIDER_ACCEPTED' || done.mail?.status === 'TEST_RECORDED'
              ? t('booking:done.mailSent', 'La confirmation et votre lien personnel ont été envoyés par e-mail.')
              : t('booking:done.mailNotSent', 'L’e-mail de confirmation n’a pas pu partir : gardez le lien ci-dessous.')}</p>
            {done.appointment.reminderConsent ? <p className="text-sm text-slate-700" data-testid="guest-reminder-on">{t('booking:done.reminderOn', 'Un rappel vous sera envoyé par e-mail la veille du rendez-vous.')}</p> : null}
            <a className={secondary} href={`/rdv/${encodeURIComponent(structureSlug)}/sans-compte/gerer?${new URLSearchParams({ appointment: done.appointment.id })}#${new URLSearchParams({ manage: done.manage.token })}`}>{t('booking:done.manage', 'Voir, déplacer ou annuler ce rendez-vous')}</a>
          </section>
        ) : null}
      </div>
    </main>
  );
}
