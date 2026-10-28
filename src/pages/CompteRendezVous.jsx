// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import VisioWindow from '@/components/Visio/VisioWindow';

const STATUS = { BOOKED: 'Réservé', CONFIRMED: 'Confirmé', REQUESTED: 'Demandé', CANCELLED: 'Annulé', LOCKED: 'Réservé', DONE: 'Passé', NO_SHOW: 'Absent' };
const when = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const isoDay = (d) => d.toISOString().slice(0, 10);
const MODE = { IN_PERSON: 'En présentiel', VIDEO: 'À distance (visio)' };

/**
 * PKG-3 / K3 — Mes rendez-vous (/compte/rendez-vous): cancel, and move (D-2: until 24 hours before, at most twice, atomic on the server: the old slot is released only
 * when the new one is taken). Every rule is enforced by the server; this screen says why an action is not offered.
 */
export default function CompteRendezVous() {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [moving, setMoving] = useState(null); // { id, days, pick, loading, mode, modes, consent }
  const [busy, setBusy] = useState(false);
  const [join, setJoin] = useState(null);
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', items: (await citizenApi.myAppointments()).appointments || [] }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? 'Connectez-vous pour voir vos rendez-vous.' : err.message, auth: err.status === 401, items: [] }); }   // R18: « Se connecter » only when the session is really missing (401); any other failure offers to try again (it read as « please sign in »)
  }, []);
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
      if (changed) await citizenApi.rescheduleAppointment(moving.id, moving.pick, { mode: moving.mode, ...(moving.mode === 'VIDEO' ? { videoConsent: moving.consent === true } : {}) });
      else await citizenApi.rescheduleAppointment(moving.id, moving.pick);
      setMoving(null); setMessage(changed ? `Rendez-vous déplacé, désormais ${MODE[moving.mode].toLowerCase()}. L’ancien créneau a été libéré.` : 'Rendez-vous déplacé. L’ancien créneau a été libéré.'); await load();
    }
    catch (err) { setProblem(err.message); if (err.code === 'SLOT_TAKEN') startMove(a, moving.mode); }
    finally { setBusy(false); }
  };
  const visio = async (a, action) => {
    setBusy(true); setProblem(''); setMessage('');
    try {
      const out = await citizenApi.appointmentVisio(a.id, action);
      if (action === 'join') setJoin(out.join); else { setMessage(action === 'consent' ? 'Votre accord pour la visio est enregistré.' : 'Votre accord pour la visio est retiré.'); await load(); }
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
      setProblem('La conversation n’a pas pu être ouverte.');
    } catch (err) { setProblem(err?.message || 'La conversation n’a pas pu être ouverte.'); } finally { setBusy(false); }
  };
  const cancel = async (a) => {
    setConfirming(null);
    setBusy(true); setProblem(''); setMessage('');
    try { await citizenApi.cancelAppointment(a.id); setMessage('Rendez-vous annulé.'); await load(); } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">Chargement de vos rendez-vous…</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-rdv">
      <SEO title="Mes rendez-vous" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Mes rendez-vous</h1>
      <p className="text-sm text-slate-700" data-testid="rdv-policy">Vous pouvez déplacer un rendez-vous jusqu’à 24 heures avant, deux fois au plus. Le créneau actuel n’est libéré que lorsque le nouveau est réservé.</p>
      {state.error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><p>{state.error}</p>{state.auth ? <Button asChild variant="outline" className="mt-2"><Link to="/auth/login?next=/compte/rendez-vous">Se connecter</Link></Button> : <Button type="button" variant="outline" className="mt-2" onClick={load}>Réessayer</Button>}</div> : null}
      {problem ? <p role="alert" data-testid="rdv-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div aria-live="polite" role="status" data-testid="rdv-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {!state.error && !state.items.length ? <p className="text-sm text-slate-700" data-testid="rdv-empty">Aucun rendez-vous.</p> : null}
      <ul className="space-y-3">
        {state.items.map((a) => (
          <li key={a.id}>
            <Card data-testid="rdv-item">
              <CardHeader><CardTitle className="text-lg">{a.structure?.name} — {a.service?.name}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-800">
                <p><span data-testid="rdv-when">{when(a.startsAt)}</span> — <span data-testid="rdv-state">{STATUS[a.status] || a.status}</span> — <strong data-testid="rdv-mode">{MODE[a.mode || 'IN_PERSON']}</strong></p>
                {(a.mode || 'IN_PERSON') === 'IN_PERSON' ? (
                  <p data-testid="rdv-address">{a.location ? `${a.location.address}${a.location.verified ? '' : ' (adresse non encore vérifiée : confirmez-la auprès de la structure)'}${a.location.stepFreeAccess ? ' — accessible aux personnes à mobilité réduite' : ''}` : 'Adresse : à confirmer auprès de la structure.'}</p>
                ) : null}
                {a.mode === 'VIDEO' && a.video ? (
                  <div className="space-y-1 rounded-md border border-slate-200 p-2" data-testid="rdv-video">
                    {!a.video.service?.available ? <p data-testid="rdv-video-disabled">La visio n’est pas activée sur ce service pour le moment : la structure vous contactera si besoin.</p> : null}
                    {a.video.service?.sandbox ? <p className="text-amber-900" data-testid="rdv-video-sandbox">Environnement de test : la connexion au fournisseur de visio n’est pas vérifiée ici.</p> : null}
                    <p data-testid="rdv-video-state">{a.video.approved ? 'Visio validée par la structure.' : 'En attente de validation de la visio par la structure.'} {a.video.consent ? 'Votre accord est enregistré.' : 'Votre accord n’est pas enregistré.'} {a.video.opensAt ? `La salle ouvre le ${when(a.video.opensAt)}.` : ''}</p>
                    {a.canCancel ? (
                      <div className="flex flex-wrap gap-2">
                        {a.video.consent ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-video-withdraw" onClick={() => visio(a, 'withdraw')}>Retirer mon accord</Button>
                          : <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-video-consent" onClick={() => visio(a, 'consent')}>Donner mon accord</Button>}
                        <Button type="button" size="sm" disabled={busy || !a.video.approved || !a.video.consent || !a.video.service?.available} data-testid="rdv-video-join" onClick={() => visio(a, 'join')}>Rejoindre la visio</Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {a.reschedule && a.reschedule.count ? <p className="text-slate-700" data-testid="rdv-moves">Déplacé {a.reschedule.count} fois sur {a.reschedule.max}.</p> : null}
                <div className="flex flex-wrap gap-2">
                  {a.canReschedule ? <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-move" onClick={() => startMove(a)}>Déplacer</Button> : null}
                  <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-write" onClick={() => writeTo(a)}>Écrire à la structure</Button>
                  {a.canCancel ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid="rdv-cancel" aria-expanded={confirming === a.id} onClick={() => setConfirming(confirming === a.id ? null : a.id)}>Annuler</Button> : null}
                  {/* R12 (C19): the calendar file of an upcoming appointment, from the server (same file as the confirmation e-mail) */}
                  {a.calendar?.content ? <Button type="button" size="sm" variant="outline" data-testid="rdv-ics" onClick={() => {
                    const url = URL.createObjectURL(new Blob([a.calendar.content], { type: a.calendar.contentType || 'text/calendar; charset=utf-8' }));
                    const link = document.createElement('a'); link.href = url; link.download = a.calendar.filename || 'acces-direct-aide-rendez-vous.ics'; link.rel = 'noopener';
                    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
                  }}>Ajouter au calendrier (.ics)</Button> : null}
                </div>
                {confirming === a.id ? (
                  <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3" role="group" aria-labelledby={`rdv-cancel-q-${a.id}`} data-testid="rdv-cancel-confirm-panel">
                    <p id={`rdv-cancel-q-${a.id}`} className="font-medium text-red-900">Annuler ce rendez-vous ? Le créneau sera libéré et la structure prévenue. Cette action ne peut pas être annulée.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" className="bg-red-700 text-white hover:bg-red-800" disabled={busy} data-testid="rdv-cancel-confirm" onClick={() => cancel(a)}>Oui, annuler le rendez-vous</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="rdv-cancel-keep" onClick={() => setConfirming(null)}>Non, le garder</Button>
                    </div>
                  </div>
                ) : null}
                {a.canCancel && !a.canReschedule ? <p className="text-slate-700" data-testid="rdv-move-unavailable">{a.reschedule && a.reschedule.count >= a.reschedule.max ? 'Ce rendez-vous a déjà été déplacé deux fois.' : 'Il reste moins de 24 heures : pour le déplacer, contactez la structure.'}</p> : null}
                {moving && moving.id === a.id ? (
                  <div className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="rdv-move-panel">
                    {moving.modes && moving.modes.length > 1 ? (
                      <fieldset className="space-y-1" data-testid="rdv-move-mode"><legend className="font-medium">Modalité</legend>
                        {moving.modes.map((m) => <label key={m} className="mr-4 inline-flex items-center gap-1"><input type="radio" name={`move-mode-${a.id}`} value={m} data-testid={`rdv-move-mode-${m}`} checked={moving.mode === m} onChange={() => startMove(a, m)} />{MODE[m]}</label>)}
                        {moving.mode !== (a.mode || 'IN_PERSON') ? <p className="text-amber-900" data-testid="rdv-move-mode-change">Vous changez la modalité de ce rendez-vous{moving.mode === 'VIDEO' ? ' : la structure devra valider la visio.' : '.'}</p> : null}
                        {moving.mode === 'VIDEO' && moving.mode !== (a.mode || 'IN_PERSON') ? <label className="flex items-start gap-2"><input type="checkbox" data-testid="rdv-move-video-consent" checked={moving.consent} onChange={(e) => setMoving({ ...moving, consent: e.target.checked })} />J’accepte que ce rendez-vous se fasse en visio (caméra et micro, aucun enregistrement).</label> : null}
                      </fieldset>
                    ) : null}
                    {moving.loading ? <p role="status">Recherche des créneaux libres…</p> : moving.days.length ? (
                      <fieldset><legend className="font-medium">Choisissez un nouveau créneau (14 prochains jours)</legend>
                        {moving.days.map((d) => (
                          <div key={d.date} className="mt-2"><p className="text-slate-700">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                            <div className="mt-1 flex flex-wrap gap-2">{d.slots.filter((x) => x.startAt !== a.startsAt).map((x) => (
                              <label key={x.startAt} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1"><input type="radio" name={`slot-${a.id}`} value={x.startAt} data-testid="rdv-slot" checked={moving.pick === x.startAt} onChange={() => setMoving({ ...moving, pick: x.startAt })} />{new Date(x.startAt).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}</label>
                            ))}</div></div>
                        ))}
                      </fieldset>
                    ) : <p data-testid="rdv-no-slot">Aucun autre créneau libre dans les 14 prochains jours.</p>}
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={!moving.pick || busy || (moving.mode === 'VIDEO' && moving.mode !== (a.mode || 'IN_PERSON') && !moving.consent)} data-testid="rdv-move-confirm" onClick={confirmMove}>Confirmer le déplacement</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setMoving(null)}>Garder ce rendez-vous</Button>
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
