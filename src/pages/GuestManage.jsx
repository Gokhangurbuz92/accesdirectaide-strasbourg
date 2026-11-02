// R38 — the personal link of an account-free booking (/rdv/:slug/sans-compte/gerer?appointment=<id>#manage=<token>): date, time, place and service only;
// cancel; move to another free slot of the same service. The token is read from the fragment once, removed from the address bar, and sent in POST bodies only.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { useT, formatDate } from '@/i18n';
import { guestGet, guestPost, readManageCapability, slotsByParisDay } from '@/lib/guestBooking';
import { useGuestMessages } from '@/lib/useGuestMessages';

const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-md bg-blue-800 px-5 py-2 text-base font-medium text-white hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 disabled:opacity-60';
const secondary = 'inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-400 bg-white px-5 py-2 text-base font-medium text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-700';
const danger = 'inline-flex min-h-[44px] items-center justify-center rounded-md bg-red-800 px-5 py-2 text-base font-medium text-white hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2 disabled:opacity-60';
const isoDay = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const when = (v) => formatDate(v, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default function GuestManage() {
  const { t } = useT('booking');
  const message = useGuestMessages();
  const { structureSlug = '' } = useParams();
  const capRef = useRef(null);
  if (capRef.current === null && typeof window !== 'undefined') capRef.current = readManageCapability(window.location.search, window.location.hash) || false;
  const [state, setState] = useState({ loading: true, error: '', appointment: null, emailMasked: null });
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [moving, setMoving] = useState(false);
  const [slots, setSlots] = useState({ loading: false, list: [], error: '' });
  const [slot, setSlot] = useState(null);
  const statusRef = useRef(null);

  useEffect(() => {
    // the capability leaves the address bar (history, screenshots, a shared address) as soon as it is read
    if (capRef.current && typeof window !== 'undefined' && window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!capRef.current) { setState({ loading: false, error: message('APPOINTMENT_NOT_FOUND'), appointment: null }); return; }
    guestPost('manage', capRef.current).then((r) => setState(r.ok ? { loading: false, error: '', appointment: r.body.appointment, emailMasked: r.body.emailMasked } : { loading: false, error: message(r.body.code), appointment: null }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (info) statusRef.current?.focus(); }, [info]);

  const a = state.appointment;
  const days = useMemo(() => slotsByParisDay(slots.list), [slots.list]);

  const loadSlots = async () => {
    setMoving(true); setSlot(null); setSlots({ loading: true, list: [], error: '' });
    const r = await guestGet(`structures/${encodeURIComponent(structureSlug)}/slots?${new URLSearchParams({ serviceId: a.service?.id || '', from: isoDay(0), to: isoDay(13) })}`);
    setSlots({ loading: false, list: r.ok ? (r.body.slots || []).filter((s) => s.startAt !== a.startsAt) : [], error: r.ok ? '' : message(r.body.code) });
  };
  const cancel = async () => {
    setBusy(true); const r = await guestPost('manage/cancel', capRef.current); setBusy(false); setConfirmCancel(false);
    if (r.ok) { setState((s) => ({ ...s, appointment: r.body.appointment })); setInfo(t('booking:manage.cancelled', 'Le rendez-vous est annulé. Un e-mail de confirmation vous est envoyé.')); }
    else setInfo(message(r.body.code));
  };
  const move = async () => {
    setBusy(true); const r = await guestPost('manage/reschedule', { ...capRef.current, startAt: slot.startAt }); setBusy(false);
    if (r.ok) { setState((s) => ({ ...s, appointment: r.body.appointment })); setMoving(false); setInfo(t('booking:manage.moved', 'Le rendez-vous est déplacé. Un e-mail avec le nouvel horaire vous est envoyé.')); }
    else setInfo(message(r.body.code));
  };

  return (
    <main className="min-h-screen bg-slate-50 py-8" id="main-content">
      <SEO title={t('booking:manage.seo', 'Mon rendez-vous')} description={t('booking:manage.seo', 'Mon rendez-vous')} path={`/rdv/${structureSlug}/sans-compte/gerer`} noindex={true} />
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('booking:manage.title', 'Mon rendez-vous (sans compte)')}</h1>
        {info ? <p ref={statusRef} tabIndex={-1} role="status" className="mt-4 rounded-md border border-blue-300 bg-blue-50 p-3 text-slate-900">{info}</p> : null}
        {state.loading ? <p role="status" className="mt-6">{t('booking:loading', 'Chargement…')}</p> : null}
        {state.error ? <p role="alert" className="mt-6 rounded-md border border-amber-400 bg-amber-50 p-4" data-testid="guest-manage-invalid">{state.error}</p> : null}
        {a ? (
          <section className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-6" data-testid="guest-manage">
            <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <dt className="font-medium">{t('booking:manage.structure', 'Structure')}</dt><dd>{a.structure?.name}</dd>
              <dt className="font-medium">{t('booking:manage.service', 'Motif')}</dt><dd>{a.service?.name}</dd>
              <dt className="font-medium">{t('booking:manage.when', 'Date et heure (Paris)')}</dt><dd>{a.startsAt ? when(a.startsAt) : ''}</dd>
              <dt className="font-medium">{t('booking:manage.where', 'Lieu')}</dt><dd>{a.location?.address || ''}</dd>
              <dt className="font-medium">{t('booking:manage.status', 'État')}</dt>
              <dd>{a.status === 'CANCELLED' ? t('booking:manage.statusCancelled', 'Annulé') : t('booking:manage.statusConfirmed', 'Confirmé')}</dd>
              {state.emailMasked ? (<><dt className="font-medium">{t('booking:manage.email', 'E-mail')}</dt><dd>{state.emailMasked}</dd></>) : null}
            </dl>
            <div className="flex flex-wrap gap-3 pt-2">
              {a.canReschedule && !moving ? <button type="button" className={secondary} onClick={loadSlots}>{t('booking:manage.move', 'Déplacer')}</button> : null}
              {a.rescheduleBlocked === 'RESCHEDULE_TOO_LATE' ? <p className="w-full text-slate-700" data-testid="guest-move-too-late">{t('booking:manage.moveTooLate', 'Ce rendez-vous est trop proche pour être déplacé en ligne : contactez la structure.')}</p> : null}
              {a.rescheduleBlocked === 'RESCHEDULE_LIMIT' ? <p className="w-full text-slate-700" data-testid="guest-move-limit">{t('booking:manage.moveLimit', 'Ce rendez-vous a déjà été déplacé le nombre de fois permis : contactez la structure.')}</p> : null}
              {a.canCancel && !confirmCancel ? <button type="button" className={secondary} onClick={() => setConfirmCancel(true)}>{t('booking:manage.cancel', 'Annuler le rendez-vous')}</button> : null}
            </div>
            {confirmCancel ? (
              <div role="group" aria-labelledby="guest-cancel-q" className="rounded-md border border-red-300 bg-red-50 p-3">
                <p id="guest-cancel-q">{t('booking:manage.cancelConfirm', 'Confirmer l’annulation ? Le créneau sera libéré.')}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <button type="button" className={danger} disabled={busy} onClick={cancel}>{t('booking:manage.cancelYes', 'Oui, annuler')}</button>
                  <button type="button" className={secondary} onClick={() => setConfirmCancel(false)}>{t('booking:manage.cancelNo', 'Non, garder')}</button>
                </div>
              </div>
            ) : null}
            {moving ? (
              <fieldset className="space-y-3">
                <legend className="font-medium">{t('booking:slot.legend', 'Créneau (heure de Paris)')}</legend>
                {slots.loading ? <p role="status">{t('booking:loading', 'Chargement…')}</p> : null}
                {slots.error ? <p role="alert" className="text-red-800">{slots.error}</p> : null}
                {!slots.loading && !slots.error && days.length === 0 ? <p>{t('booking:slot.none', 'Aucun créneau libre dans les 14 prochains jours.')}</p> : null}
                {days.map((d) => (
                  <div key={d.date}>
                    <p className="font-medium text-slate-800">{formatDate(d.slots[0].startAt, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {d.slots.map((s) => (
                        <label key={s.startAt} className={`inline-flex min-h-[44px] min-w-[72px] cursor-pointer items-center justify-center rounded-md border px-3 ${slot?.startAt === s.startAt ? 'border-blue-800 bg-blue-50 font-semibold' : 'border-slate-300 bg-white'}`}>
                          <input type="radio" name="guest-move-slot" className="sr-only" value={s.startAt} checked={slot?.startAt === s.startAt} onChange={() => setSlot(s)} />
                          {formatDate(s.startAt, { hour: '2-digit', minute: '2-digit' })}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-3">
                  <button type="button" className={primary} disabled={!slot || busy} onClick={move}>{t('booking:manage.moveConfirm', 'Déplacer à ce créneau')}</button>
                  <button type="button" className={secondary} onClick={() => setMoving(false)}>{t('booking:back', 'Retour')}</button>
                </div>
              </fieldset>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
