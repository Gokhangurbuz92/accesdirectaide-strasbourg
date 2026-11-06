// R47 — the structure moves an appointment to another free slot of the same service (GET / POST /api/pro/appointments/reschedule). The server offers only
// the slots the booking itself would accept (the assigned professional's hours, absences, calendar; closures; the 60-day window) and re-checks the slot
// under the booking locks; the person is told through the notice path. Keyboard: a disclosure button, a radio group per day, period buttons, a confirmation.
import { useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/button';
import { getCsrfHeaders } from '@/lib/csrf';
import { formatDate, formatTime, useT } from '@/i18n';

const MOVABLE = ['booked', 'confirmed'];
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** @param {{ appointment: { id: string, status: string, startAt?: string, start_at?: string }, onMoved?: () => void }} props */
export default function ProReschedulePanel({ appointment, onMoved = () => {} }) {
  const { t } = useT('pro');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(/** @type {any} */ (null));
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;
  const startAt = appointment.startAt || appointment.start_at || '';
  if (!MOVABLE.includes(String(appointment.status || '').toLowerCase()) || !(Date.parse(startAt) > Date.now())) {
    return done ? <p role="status" className="text-sm text-emerald-800" data-testid="pro-move-done">{done}</p> : null;
  }

  const problemOf = (/** @type {any} */ body, /** @type {number} */ status) => (/** @type {Record<string, string>} */ ({
    SLOT_TAKEN: t('pro:reschedule.slot_taken_r47', 'Ce créneau n’est plus libre. Choisissez-en un autre.'),
    APPOINTMENT_CHANGED: t('pro:reschedule.changed_r47', 'Ce rendez-vous vient d’être modifié : rechargez la page.'),
    REQUEST_PENDING: t('pro:reschedule.request_pending_r47', 'Cette demande attend une réponse : acceptez-la ou refusez-la d’abord.'),
    APPOINTMENT_NOT_ACTIVE: t('pro:reschedule.not_active_r47', 'Ce rendez-vous n’est plus actif : il ne peut pas être déplacé.'),
    APPOINTMENT_STARTED: t('pro:reschedule.started_r47', 'Ce rendez-vous a déjà commencé : il ne peut plus être déplacé.'),
    SENSITIVE_CONSENT_MISSING: t('pro:reschedule.consent_missing_r47', 'La personne n’a pas donné l’accord que ce service demande : elle peut déplacer le rendez-vous depuis son espace, ou convenez d’une autre date avec elle.'),
    SENSITIVE_CONSENT_REQUIRED: t('pro:reschedule.attest_required_r47', 'Cochez la case pour confirmer l’accord de la personne.'),
    RESCHEDULE_FORBIDDEN: t('pro:reschedule.forbidden_r47', 'Seuls la personne qui suit ce rendez-vous, l’administrateur ou un membre chargé du planning peuvent le déplacer.'),
    OUT_OF_WINDOW: t('pro:reschedule.out_of_window_r47', 'Le nouveau créneau doit être dans les 60 prochains jours.'),
  }))[String(body?.code || '')] || (status === 429 ? t('pro:reschedule.too_many_r47', 'Trop de demandes : réessayez dans un instant.') : t('pro:reschedule.failed_r47', 'Le rendez-vous n’a pas pu être déplacé.'));

  /** @param {string} [from] */
  const load = async (from) => {
    setLoading(true); setProblem(''); setPick('');
    try {
      const res = await fetch(`/api/pro/appointments/reschedule?id=${encodeURIComponent(appointment.id)}${from ? `&from=${from}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setData(body); else { setData(null); setProblem(problemOf(body, res.status)); }
    } catch {
      setProblem(t('pro:reschedule.load_failed_r47', 'Les créneaux libres n’ont pas pu être chargés.'));
    } finally {
      setLoading(false);
    }
  };
  const toggle = () => { const next = !open; setOpen(next); setDone(''); if (next) load(); };
  const shift = (/** @type {number} */ days) => {
    const d = new Date(`${data.from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
    load(d.toISOString().slice(0, 10));
  };
  const confirm = async () => {
    setBusy(true); setProblem('');
    try {
      const res = await fetch('/api/pro/appointments/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...getCsrfHeaders() },
        body: JSON.stringify({ id: appointment.id, startAt: pick, expectedStartAt: new Date(startAt).toISOString(), ...(data?.consent === 'ATTEST' ? { sensitiveConsent: attest } : {}) }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(t('pro:reschedule.done_r47', 'Rendez-vous déplacé au {{when}}. La personne est prévenue dans son espace (et par e-mail selon ses préférences).', { when: formatDate(body?.item?.startAt || pick, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }));
        setOpen(false); setData(null); onMoved();
      } else {
        setProblem(problemOf(body, res.status));
        if (body?.code === 'SLOT_TAKEN') load(data?.from);
      }
    } catch {
      setProblem(t('pro:reschedule.failed_r47', 'Le rendez-vous n’a pas pu être déplacé.'));
    } finally {
      setBusy(false);
    }
  };

  /** @type {Map<string, Array<{ startAt: string, endAt: string }>>} */
  const days = new Map();
  for (const s of data?.slots || []) { const k = PARIS_DAY.format(new Date(s.startAt)); days.set(k, [...(days.get(k) || []), s]); }
  const panelId = `pro-move-panel-${appointment.id}`;
  return (
    <div className="space-y-3" data-testid="pro-move">
      <Button type="button" variant="outline" aria-expanded={open} aria-controls={panelId} onClick={toggle} data-testid="pro-move-open">{t('pro:reschedule.open_r47', 'Déplacer le rendez-vous')}</Button>
      {done ? <p role="status" className="text-sm text-emerald-800" data-testid="pro-move-done">{done}</p> : null}
      {open ? (
        <div id={panelId} role="group" aria-labelledby={`${panelId}-title`} className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="pro-move-panel">
          <h4 id={`${panelId}-title`} className="font-semibold text-slate-900">{t('pro:reschedule.title_r47', 'Choisir un nouveau créneau')}</h4>
          <p className="text-sm text-slate-700">{t('pro:reschedule.intro_r47', 'Seuls les créneaux libres du même service et de la même personne de l’équipe sont proposés. La personne est prévenue du nouvel horaire ; ses propres possibilités de déplacement ne sont pas utilisées.')}</p>
          {problem ? <p role="alert" className="text-sm text-red-800" data-testid="pro-move-error">{problem}</p> : null}
          {loading ? <p role="status">{t('pro:reschedule.loading_r47', 'Recherche des créneaux libres…')}</p> : null}
          {!loading && data && data.consent === 'NOT_OPEN' ? <p className="text-sm text-amber-900" data-testid="pro-move-not-open">{t('pro:reschedule.not_open_r47', 'Ce service n’est pas ouvert à la prise de rendez-vous sur la plateforme : convenez d’une autre date avec la personne par vos moyens habituels.')}</p> : null}
          {!loading && data && data.consent !== 'NOT_OPEN' ? (
            <>
              {days.size ? (
                <fieldset>
                  <legend className="font-medium">{t('pro:reschedule.period_r47', 'Créneaux libres du {{from}} au {{to}}', { from: formatDate(`${data.from}T12:00:00Z`, { day: 'numeric', month: 'long' }), to: formatDate(`${data.to}T12:00:00Z`, { day: 'numeric', month: 'long' }) })}</legend>
                  {[...days.entries()].map(([day, slots]) => (
                    <div key={day} className="mt-2">
                      <p className="text-sm text-slate-700">{formatDate(`${day}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {slots.map((s) => (
                          <label key={s.startAt} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-sm">
                            <input type="radio" name={`pro-move-slot-${appointment.id}`} value={s.startAt} checked={pick === s.startAt} onChange={() => setPick(s.startAt)} data-testid="pro-move-slot" />
                            {formatTime(s.startAt)}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </fieldset>
              ) : <p data-testid="pro-move-no-slot">{t('pro:reschedule.no_slot_r47', 'Aucun créneau libre sur cette période.')}</p>}
              <div className="flex flex-wrap gap-2">
                {data.hasPrevious ? <Button type="button" size="sm" variant="outline" onClick={() => shift(-14)} data-testid="pro-move-earlier">{t('pro:reschedule.earlier_r47', '‹ 14 jours précédents')}</Button> : null}
                {data.hasNext ? <Button type="button" size="sm" variant="outline" onClick={() => shift(14)} data-testid="pro-move-later">{t('pro:reschedule.later_r47', '14 jours suivants ›')}</Button> : null}
              </div>
              {data.consent === 'ATTEST' ? (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} data-testid="pro-move-attest" />
                  {t('pro:reschedule.attest_r47', 'La personne a donné son accord explicite pour ce rendez-vous, en connaissant la nature de ce service.')}
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={!pick || busy || (data.consent === 'ATTEST' && !attest)} onClick={confirm} data-testid="pro-move-confirm">{t('pro:reschedule.confirm_r47', 'Confirmer le déplacement')}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>{t('pro:reschedule.keep_r47', 'Garder l’horaire actuel')}</Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

ProReschedulePanel.propTypes = {
  appointment: PropTypes.shape({ id: PropTypes.string.isRequired, status: PropTypes.string, startAt: PropTypes.string, start_at: PropTypes.string }).isRequired,
  onMoved: PropTypes.func,
};
