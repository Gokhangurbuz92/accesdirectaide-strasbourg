// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import SEO from '@/components/SEO';
import MailOutcomeNote from '@/components/rdv/MailOutcomeNote.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import VisioWindow from '@/components/Visio/VisioWindow';
import { formatDate, useT } from '@/i18n';
import { refusalReasonText } from '@/lib/refusalReasons';

const statusLabels = (t) => ({ BOOKED: t('compte:rdv.status.booked', 'Réservé'), CONFIRMED: t('compte:rdv.status.confirmed', 'Confirmé'), REQUESTED: t('compte:rdv.status.requested', 'Demandé'), CANCELLED: t('compte:rdv.status.cancelled', 'Annulé'), LOCKED: t('compte:rdv.status.booked', 'Réservé'), DONE: t('compte:rdv.status.done', 'Passé'), NO_SHOW: t('compte:rdv.status.no_show', 'Absent') });
// R42: the TRUE state computed by the server (a pending request is never shown as confirmed)
const stateLabels = (t) => ({ REQUESTED: t('booking:state.requested', 'Demande en attente de validation par la structure'), CONFIRMED: t('compte:rdv.status.confirmed', 'Confirmé'),
  REFUSED: t('booking:state.refused', 'Demande refusée par la structure'), EXPIRED: t('booking:state.expired', 'Demande expirée sans réponse'), CANCELLED: t('compte:rdv.status.cancelled', 'Annulé'),
  COMPLETED: t('compte:rdv.status.done', 'Passé'), NO_SHOW: t('compte:rdv.status.no_show', 'Absent') });
const when = (d) => formatDate(d, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const isoDay = (d) => d.toISOString().slice(0, 10);
const modeLabels = (t) => ({ IN_PERSON: t('compte:rdv.mode.in_person', 'En présentiel'), VIDEO: t('compte:rdv.mode.video', 'À distance (visio)') });

/**
 * PKG-3 / K3 — Mes rendez-vous (/compte/rendez-vous): cancel, and move (D-2: until 24 hours before, at most twice, atomic on the server: the old slot is released only
 * when the new one is taken). Every rule is enforced by the server; this screen says why an action is not offered.
 */
export default function CompteRendezVous() {
  const { t } = useT('compte');
  const STATUS = statusLabels(t); const STATE = stateLabels(t); const MODE = modeLabels(t);
  const [mailOutcome, setMailOutcome] = useState(null);
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [moving, setMoving] = useState(null); // { id, days, pick, loading, mode, modes, consent }
  const [busy, setBusy] = useState(false);
  const [join, setJoin] = useState(null);
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', items: (await citizenApi.myAppointments()).appointments || [] }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? t('compte:rdv.login_required', 'Connectez-vous pour voir vos rendez-vous.') : err.message, auth: err.status === 401, items: [] }); }   // R18: « Se connecter » only when the session is really missing (401); any other failure offers to try again (it read as « please sign in »)
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  // the modality is kept unless the person explicitly picks another one that the service offers now (video needs their agreement)
  const startMove = async (a, mode = a.mode || 'IN_PERSON') => {
    setProblem(''); setMessage(''); setMoving({ id: a.id, days: [], pick: '', loading: true, mode, modes: [a.mode || 'IN_PERSON'], consent: false });
    try {
      const from = new Date(); const to = new Date(Date.now() + 13 * 86400000);
      const out = mode === (a.mode || 'IN_PERSON')
        ? await citizenApi.freeSlots(a.structure.slug, a.service.id, isoDay(from), isoDay(to))
        : await citizenApi.freeSlots(a.structure.slug, a.service.id, isoDay(from), isoDay(to), mode);
      let modes = [a.mode || 'IN_PERSON'];
      try { const svc = ((await citizenApi.bookingServices(a.structure.slug)).items || []).find((x) => x.id === a.service.id); if (svc && Array.isArray(svc.modes) && svc.modes.length) modes = [...new Set([a.mode || 'IN_PERSON', ...svc.modes])]; } catch { /* keep the current modality only */ }
      setMoving({ id: a.id, days: out.days || [], pick: '', loading: false, mode, modes, consent: false });
    } catch (err) { setMoving(null); setProblem(err.message); }
  };
  const confirmMove = async () => {
    setBusy(true); setProblem('');
    const a = state.items.find((x) => x.id === moving.id);
    const changed = a && moving.mode !== (a.mode || 'IN_PERSON');
    try {
      const out = changed ? await citizenApi.rescheduleAppointment(moving.id, moving.pick, { mode: moving.mode, ...(moving.mode === 'VIDEO' ? { videoConsent: moving.consent === true } : {}) })
        : await citizenApi.rescheduleAppointment(moving.id, moving.pick);
      setMailOutcome(out && typeof out === 'object' && out.notification ? out.notification.email : null);   // R42: the real e-mail outcome, never assumed
      setMoving(null); setMessage(changed ? (moving.mode === 'VIDEO' ? t('compte:rdv.moved_video', 'Rendez-vous déplacé, désormais à distance (visio). L’ancien créneau a été libéré.') : t('compte:rdv.moved_in_person', 'Rendez-vous déplacé, désormais en présentiel. L’ancien créneau a été libéré.')) : t('compte:rdv.moved', 'Rendez-vous déplacé. L’ancien créneau a été libéré.'));
      if (out && typeof out === 'object' && out.state === 'REQUESTED') setMessage(t('booking:journey.move_requested', 'Demande de déplacement envoyée : le nouveau créneau doit être accepté par la structure. L’ancien créneau a été libéré.'));
      await load();
    }
    catch (err) { setProblem(err.message); if (err.code === 'SLOT_TAKEN') startMove(a, moving.mode); }
    finally { setBusy(false); }
  };
  const visio = async (a, action) => {
    setBusy(true); setProblem(''); setMessage('');
    try {
      const out = await citizenApi.appointmentVisio(a.id, action);
      if (action === 'join') setJoin(out.join); else { setMessage(action === 'consent' ? t('compte:rdv.video_consent_saved', 'Votre accord pour la visio est enregistré.') : t('compte:rdv.video_consent_withdrawn', 'Votre accord pour la visio est retiré.')); await load(); }
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  // R18: cancelling frees the slot and cannot be undone: a second, explicit « Oui, annuler » (it was one click next to « Déplacer »)
  const [confirming, setConfirming] = useState(null);
  // R18: writing to the organization of an appointment from « Mes rendez-vous » (the conversation could only be opened from the booking pages)
  const navigate = useNavigate();
  const writeTo = async (a) => {
    setBusy(true); setProblem(''); setMessage('');
    try {
      const out = await rdvMessagingClient.user.getOrCreateFromAppointment(a.id);
      if (out?.conversationId) { navigate(`/compte/messages/${encodeURIComponent(out.conversationId)}`); return; }
      setProblem(t('compte:rdv.conversation_failed', 'La conversation n’a pas pu être ouverte.'));
    } catch (err) { setProblem(err?.message || t('compte:rdv.conversation_failed', 'La conversation n’a pas pu être ouverte.')); } finally { setBusy(false); }
  };
  // R43 (E6): withdrawing the optional message erases it at once (two steps, like a cancellation: it cannot be undone)
  const [withdrawing, setWithdrawing] = useState(null);
  const withdrawMessage = async (a) => {
    setWithdrawing(null);
    setBusy(true); setProblem(''); setMessage('');
    try { await citizenApi.withdrawAppointmentMessage(a.id); setMessage(t('booking:message.withdrawn_r43', 'Votre message a été effacé. La structure ne le voit plus.')); await load(); } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const cancel = async (a) => {
    setConfirming(null);
    setBusy(true); setProblem(''); setMessage('');
    try { await citizenApi.cancelAppointment(a.id); setMessage(t('compte:rdv.cancelled', 'Rendez-vous annulé.')); await load(); } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:rdv.chargement_vos_rendez_vous', 'Chargement de vos rendez-vous…')}</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-rdv">
      <SEO title={t('compte:rdv.mes_rendez_vous', 'Mes rendez-vous')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:rdv.mes_rendez_vous', 'Mes rendez-vous')}</h1>
      <p className="text-sm text-slate-700" data-testid="rdv-policy">{t('compte:rdv.vous_pouvez_deplacer_rendez', 'Vous pouvez déplacer un rendez-vous jusqu’à 24 heures avant, deux fois au plus. Le créneau actuel n’est libéré que lorsque le nouveau est réservé.')}</p>
      {state.error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><p>{state.error}</p>{state.auth ? <Button asChild variant="outline" className="mt-2"><Link to="/auth/login?next=/compte/rendez-vous">{t('compte:rdv.connecter', 'Se connecter')}</Link></Button> : <Button type="button" variant="outline" className="mt-2" onClick={load}>{t('compte:rdv.reessayer', 'Réessayer')}</Button>}</div> : null}
      {problem ? <p role="alert" data-testid="rdv-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="rdv-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}{message && mailOutcome ? <MailOutcomeNote outcome={mailOutcome} /> : null}</div>
      {!state.error && !state.items.length ? <p className="text-sm text-slate-700" data-testid="rdv-empty">{t('compte:rdv.aucun_rendez_vous', 'Aucun rendez-vous.')}</p> : null}
      <ul className="space-y-3">
        {state.items.map((a) => (
          <li key={a.id}>
            <Card data-testid="rdv-item">
              <CardHeader><CardTitle className="text-lg">{a.structure?.name} — {a.service?.name}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-800">
                <p><span data-testid="rdv-when">{when(a.startsAt)}</span> — <span data-testid="rdv-state">{STATE[a.state] || STATUS[a.status] || a.status}</span> — <strong data-testid="rdv-mode">{MODE[a.mode || 'IN_PERSON']}</strong></p>
                {/* R44: the structure's fixed reason (optional for the team; none chosen = the neutral sentence), in the person's language */}
                {a.state === 'REFUSED' ? <p className="text-slate-800" data-testid="rdv-refusal-reason">{refusalReasonText(t, a.refusal?.reasonCode)}</p> : null}
                {(a.mode || 'IN_PERSON') === 'IN_PERSON' ? (
                  <p data-testid="rdv-address">{a.location ? `${a.location.address}${a.location.verified ? '' : ` ${t('compte:rdv.address_unverified', '(adresse non encore vérifiée : confirmez-la auprès de la structure)')}`}${a.location.stepFreeAccess ? ` — ${t('compte:rdv.step_free', 'accessible aux personnes à mobilité réduite')}` : ''}` : t('compte:rdv.address_tbc', 'Adresse : à confirmer auprès de la structure.')}</p>
                ) : null}
                {a.mode === 'VIDEO' && a.video ? (
                  <div className="space-y-1 rounded-md border border-slate-200 p-2" data-testid="rdv-video">
                    {!a.video.service?.available ? <p data-testid="rdv-video-disabled">{t('compte:rdv.visio_est_pas_activee', 'La visio n’est pas activée sur ce service pour le moment : la structure vous contactera si besoin.')}</p> : null}
                    {a.video.service?.sandbox ? <p className="text-amber-900" data-testid="rdv-video-sandbox">{t('compte:rdv.environnement_test_connexion_fournisseur', 'Environnement de test : la connexion au fournisseur de visio n’est pas vérifiée ici.')}</p> : null}
                    <p data-testid="rdv-video-state">{a.video.approved ? t('compte:rdv.video_approved', 'Visio validée par la structure.') : t('compte:rdv.video_pending', 'En attente de validation de la visio par la structure.')} {a.video.consent ? t('compte:rdv.consent_yes', 'Votre accord est enregistré.') : t('compte:rdv.consent_no', 'Votre accord n’est pas enregistré.')} {a.video.opensAt ? t('compte:rdv.room_opens', 'La salle ouvre le {{when}}.', { when: when(a.video.opensAt) }) : ''}</p>
                    {a.canCancel ? (
                      <div className="flex flex-wrap gap-2">
                        {a.video.consent ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-video-withdraw" onClick={() => visio(a, 'withdraw')}>{t('compte:rdv.retirer_mon_accord', 'Retirer mon accord')}</Button>
                          : <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-video-consent" onClick={() => visio(a, 'consent')}>{t('compte:rdv.donner_mon_accord', 'Donner mon accord')}</Button>}
                        <Button type="button" size="sm" disabled={busy || !a.video.approved || !a.video.consent || !a.video.service?.available} data-testid="rdv-video-join" onClick={() => visio(a, 'join')}>{t('compte:rdv.rejoindre_visio', 'Rejoindre la visio')}</Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {a.reschedule && a.reschedule.count ? <p className="text-slate-700" data-testid="rdv-moves">{t('compte:rdv.moves_count', 'Déplacé {{n}} fois sur {{max}}.', { n: a.reschedule.count, max: a.reschedule.max })}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {a.canReschedule ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-move" onClick={() => startMove(a)}>{t('compte:rdv.deplacer', 'Déplacer')}</Button> : null}
                  <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-write" onClick={() => writeTo(a)}>{t('compte:rdv.ecrire_structure', 'Écrire à la structure')}</Button>
                  {a.canCancel ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="rdv-cancel" aria-expanded={confirming === a.id} onClick={() => setConfirming(confirming === a.id ? null : a.id)}>{t('compte:rdv.annuler', 'Annuler')}</Button> : null}
                  {/* R12 (C19): the calendar file of an upcoming appointment, from the server (same file as the confirmation e-mail) */}
                  {a.calendar?.content ? <Button type="button" size="sm" variant="outline" data-testid="rdv-ics" onClick={() => {
                    const url = URL.createObjectURL(new Blob([a.calendar.content], { type: a.calendar.contentType || 'text/calendar; charset=utf-8' }));
                    const link = document.createElement('a'); link.href = url; link.download = a.calendar.filename || 'acces-direct-aide-rendez-vous.ics'; link.rel = 'noopener';
                    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
                  }}>{t('compte:rdv.ajouter_calendrier_ics', 'Ajouter au calendrier (.ics)')}</Button> : null}
                </div>
                {confirming === a.id ? (
                  <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3" role="group" aria-labelledby={`rdv-cancel-q-${a.id}`} data-testid="rdv-cancel-confirm-panel">
                    <p id={`rdv-cancel-q-${a.id}`} className="font-medium text-red-900">{t('compte:rdv.annuler_rendez_vous_creneau', 'Annuler ce rendez-vous ? Le créneau sera libéré et la structure prévenue. Cette action ne peut pas être annulée.')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" className="bg-red-700 text-white hover:bg-red-800" disabled={busy} data-testid="rdv-cancel-confirm" onClick={() => cancel(a)}>{t('compte:rdv.oui_annuler_rendez_vous', 'Oui, annuler le rendez-vous')}</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-cancel-keep" onClick={() => setConfirming(null)}>{t('compte:rdv.non_garder', 'Non, le garder')}</Button>
                    </div>
                  </div>
                ) : null}
                {a.hasMessage ? (
                  <div className="space-y-2" data-testid="rdv-message">
                    <p className="text-slate-700">{t('booking:message.kept_r43', 'Votre message est transmis à la structure.')}</p>
                    {a.canWithdrawMessage ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-message-withdraw" aria-expanded={withdrawing === a.id} onClick={() => setWithdrawing(withdrawing === a.id ? null : a.id)}>{t('booking:message.withdraw_r43', 'Retirer mon message')}</Button> : null}
                    {withdrawing === a.id ? (
                      <div className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3" role="group" aria-labelledby={`rdv-msg-q-${a.id}`} data-testid="rdv-message-withdraw-panel">
                        <p id={`rdv-msg-q-${a.id}`} className="font-medium text-slate-900">{t('booking:message.withdraw_question_r43', 'Effacer votre message ? La structure ne pourra plus le lire. Le rendez-vous est conservé.')}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" disabled={busy} data-testid="rdv-message-withdraw-confirm" onClick={() => withdrawMessage(a)}>{t('booking:message.withdraw_confirm_r43', 'Oui, effacer le message')}</Button>
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setWithdrawing(null)}>{t('booking:message.withdraw_keep_r43', 'Non, le garder')}</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {a.canCancel && !a.canReschedule ? <p className="text-slate-700" data-testid="rdv-move-unavailable">{a.reschedule && a.reschedule.count >= a.reschedule.max ? t('compte:rdv.moved_twice', 'Ce rendez-vous a déjà été déplacé deux fois.') : t('compte:rdv.less_24h', 'Il reste moins de 24 heures : pour le déplacer, contactez la structure.')}</p> : null}
                {moving && moving.id === a.id ? (
                  <div className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="rdv-move-panel">
                    {moving.modes && moving.modes.length > 1 ? (
                      <fieldset className="space-y-1" data-testid="rdv-move-mode"><legend className="font-medium">{t('compte:rdv.modalite', 'Modalité')}</legend>
                        {moving.modes.map((m) => <label key={m} className="mr-4 inline-flex items-center gap-1"><input type="radio" name={`move-mode-${a.id}`} value={m} data-testid={`rdv-move-mode-${m}`} checked={moving.mode === m} onChange={() => startMove(a, m)} />{MODE[m]}</label>)}
                        {moving.mode !== (a.mode || 'IN_PERSON') ? <p className="text-amber-900" data-testid="rdv-move-mode-change">{moving.mode === 'VIDEO' ? t('compte:rdv.mode_change_video', 'Vous changez la modalité de ce rendez-vous : la structure devra valider la visio.') : t('compte:rdv.mode_change', 'Vous changez la modalité de ce rendez-vous.')}</p> : null}
                        {moving.mode === 'VIDEO' && moving.mode !== (a.mode || 'IN_PERSON') ? <label className="flex items-start gap-2"><input type="checkbox" data-testid="rdv-move-video-consent" checked={moving.consent} onChange={(e) => setMoving({ ...moving, consent: e.target.checked })} />{t('compte:rdv.accepte_que_rendez_vous', 'J’accepte que ce rendez-vous se fasse en visio (caméra et micro, aucun enregistrement).')}</label> : null}
                      </fieldset>
                    ) : null}
                    {moving.loading ? <p role="status">{t('compte:rdv.recherche_des_creneaux_libres', 'Recherche des créneaux libres…')}</p> : moving.days.length ? (
                      <fieldset><legend className="font-medium">{t('compte:rdv.choisissez_nouveau_creneau_14', 'Choisissez un nouveau créneau (14 prochains jours)')}</legend>
                        {moving.days.map((d) => (
                          <div key={d.date} className="mt-2"><p className="text-slate-700">{formatDate(`${d.date}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                            <div className="mt-1 flex flex-wrap gap-2">{d.slots.filter((x) => x.startAt !== a.startsAt).map((x) => (
                              <label key={x.startAt} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1"><input type="radio" name={`slot-${a.id}`} value={x.startAt} data-testid="rdv-slot" checked={moving.pick === x.startAt} onChange={() => setMoving({ ...moving, pick: x.startAt })} />{formatDate(x.startAt, { hour: '2-digit', minute: '2-digit' })}</label>
                            ))}</div></div>
                        ))}
                      </fieldset>
                    ) : <p data-testid="rdv-no-slot">{t('compte:rdv.aucun_autre_creneau_libre', 'Aucun autre créneau libre dans les 14 prochains jours.')}</p>}
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={!moving.pick || busy || (moving.mode === 'VIDEO' && moving.mode !== (a.mode || 'IN_PERSON') && !moving.consent)} data-testid="rdv-move-confirm" onClick={confirmMove}>{t('compte:rdv.confirmer_deplacement', 'Confirmer le déplacement')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setMoving(null)}>{t('compte:rdv.garder_rendez_vous', 'Garder ce rendez-vous')}</Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {join ? <VisioWindow join={join} onClose={() => setJoin(null)} /> : null}
    </div>
  );
}
