// R42-CDGG — « Mes horaires » : a professional's normal weekly working hours and dated exceptions (extra availability / unavailability over a date range).
// The server (GET/PUT /api/pro/rdv/hours) decides who may change what: every member their own hours; the administrator or a delegated schedule manager
// every member of the structure. Online slots stay inside the structure's opening hours: an extra availability never opens a closed time.
import { useCallback, useEffect, useState } from 'react';
import { proRdvClient } from '@/api/pro-rdv-client';
import { Button } from '@/components/ui/button';
import { formatDate, useT } from '@/i18n';

/** @typedef {{ weekday: number, startTime: string, endTime: string }} WeeklyRange */
/** @typedef {{ id?: string, kind: 'AVAILABLE' | 'UNAVAILABLE', from: string, to: string, startTime: string | null, endTime: string | null }} HoursException */
/** @typedef {{ weekly: WeeklyRange[] | null, exceptions: HoursException[] }} Hours */
/** @typedef {{ id: string, label: string, mine: boolean, hours: Hours }} MemberRow */
/** @typedef {{ canManageOthers: boolean, structureHours: WeeklyRange[], members: MemberRow[] }} HoursView */

const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** @param {unknown} v @returns {HoursView | null} */
function readView(v) {
  if (!v || typeof v !== 'object' || !('members' in v)) return null;
  const o = /** @type {HoursView} */ (v);
  return Array.isArray(o.members) ? { canManageOthers: o.canManageOthers === true, structureHours: Array.isArray(o.structureHours) ? o.structureHours : [], members: o.members } : null;
}

/** @param {unknown} err @returns {string} the server's French sentence for a 400, else '' */
function serverMessage(err) {
  if (!err || typeof err !== 'object') return '';
  const e = /** @type {{ status?: number, payload?: { error?: unknown } }} */ (err);
  return e.status === 400 && e.payload && typeof e.payload.error === 'string' ? e.payload.error : '';
}

/** @param {Hours} h @returns {Hours} */
const clone = (h) => ({ weekly: h.weekly ? h.weekly.map((r) => ({ ...r })) : null, exceptions: h.exceptions.map((e) => ({ ...e })) });

export default function MemberHoursPanel() {
  const { t } = useT('pro');
  const [view, setView] = useState(/** @type {HoursView | null} */ (null));
  const [memberId, setMemberId] = useState('');
  const [draft, setDraft] = useState(/** @type {Hours} */ ({ weekly: null, exceptions: [] }));
  const [state, setState] = useState(/** @type {'loading' | 'idle' | 'saving' | 'saved' | 'error'} */ ('loading'));
  const [message, setMessage] = useState('');
  const [outside, setOutside] = useState(/** @type {Array<{ id: string, startAt: string }>} */ ([]));

  const dayName = (/** @type {number} */ d) => [
    t('pro:member_hours.day_0', 'Dimanche'), t('pro:member_hours.day_1', 'Lundi'), t('pro:member_hours.day_2', 'Mardi'), t('pro:member_hours.day_3', 'Mercredi'),
    t('pro:member_hours.day_4', 'Jeudi'), t('pro:member_hours.day_5', 'Vendredi'), t('pro:member_hours.day_6', 'Samedi'),
  ][d];

  const load = useCallback(async (/** @type {string} */ keep) => {
    try {
      const v = readView(await proRdvClient.hours.get());
      setView(v);
      const pick = v?.members.find((m) => m.id === keep) || v?.members.find((m) => m.mine) || v?.members[0];
      if (pick) { setMemberId(pick.id); setDraft(clone(pick.hours)); }
      setState(v ? 'idle' : 'error');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { load(''); }, [load]);

  if (state === 'loading') return <p role="status">{t('pro:member_hours.loading', 'Chargement de vos horaires…')}</p>;
  if (!view) return <p role="alert" className="text-sm text-red-800">{t('pro:member_hours.load_error', 'Les horaires n’ont pas pu être chargés.')}</p>;
  const current = view.members.find((m) => m.id === memberId);
  const busy = state === 'saving';

  /** @param {(h: Hours) => void} change */
  const edit = (change) => { const next = clone(draft); change(next); setDraft(next); setState('idle'); };

  const save = async () => {
    setState('saving'); setMessage(''); setOutside([]);
    try {
      const out = await proRdvClient.hours.save({ memberId, weekly: draft.weekly, exceptions: draft.exceptions.map((e) => ({ kind: e.kind, from: e.from, to: e.to, startTime: e.startTime, endTime: e.endTime })) });
      const list = out && typeof out === 'object' && 'appointmentsOutsideHours' in out && Array.isArray(out.appointmentsOutsideHours) ? out.appointmentsOutsideHours : [];
      setOutside(list);
      await load(memberId);
      setState('saved');
    } catch (err) {
      setMessage(serverMessage(err) || t('pro:member_hours.save_error', 'Les horaires n’ont pas pu être enregistrés.'));
      setState('error');
    }
  };

  const structureSummary = view.structureHours.length
    ? WEEK.flatMap((d) => view.structureHours.filter((r) => r.weekday === d).map((r) => `${dayName(d)} ${r.startTime}–${r.endTime}`)).join(' · ')
    : t('pro:member_hours.structure_none', 'aucun horaire d’ouverture');

  return (
    <section className="space-y-4" aria-labelledby="member-hours-title" data-testid="pro-member-hours">
      <h2 id="member-hours-title" className="text-lg font-semibold text-slate-900">{t('pro:member_hours.title', 'Horaires de travail par professionnel')}</h2>
      <p className="text-sm text-slate-700">{t('pro:member_hours.intro', 'Vos horaires réduisent les créneaux proposés en ligne quand une personne choisit un professionnel (ou « pas de préférence »). Ils restent toujours dans les horaires d’ouverture de la structure : une disponibilité exceptionnelle n’ouvre jamais un horaire où la structure est fermée.')}</p>
      <p className="text-sm text-slate-700" data-testid="pro-member-hours-structure"><span className="font-medium">{t('pro:member_hours.structure_hours', 'Horaires d’ouverture de la structure (heure de Paris) :')}</span> <span dir="ltr">{structureSummary}</span></p>

      {view.canManageOthers && view.members.length > 1 ? (
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-800">{t('pro:member_hours.member', 'Professionnel')}</span>
          <select className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="pro-member-hours-member" value={memberId} disabled={busy}
            onChange={(e) => { const m = view.members.find((x) => x.id === e.target.value); if (m) { setMemberId(m.id); setDraft(clone(m.hours)); setState('idle'); setOutside([]); } }}>
            {view.members.map((m) => <option key={m.id} value={m.id}>{m.mine ? t('pro:member_hours.me', 'Moi-même ({{who}})', { who: m.label }) : m.label}</option>)}
          </select>
        </label>
      ) : current ? <p className="text-sm text-slate-700">{t('pro:member_hours.own_only', 'Vous modifiez vos propres horaires. L’administrateur ou un membre désigné pour gérer le planning peut modifier ceux de l’équipe.')}</p> : null}

      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-base font-medium text-slate-900">{t('pro:member_hours.weekly', 'Horaires habituels de la semaine')}</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" data-testid="pro-member-hours-follow" checked={draft.weekly === null} disabled={busy}
            onChange={(e) => edit((h) => { h.weekly = e.target.checked ? null : (view.structureHours.length ? view.structureHours.map((r) => ({ weekday: r.weekday, startTime: r.startTime, endTime: r.endTime })) : []); })} />
          {t('pro:member_hours.follow', 'Suivre les horaires d’ouverture de la structure')}
        </label>
        {draft.weekly !== null ? WEEK.map((d) => {
          const ranges = (draft.weekly || []).map((r, i) => ({ r, i })).filter(({ r }) => r.weekday === d);
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2" data-testid={`pro-member-hours-day-${d}`}>
              <span className="min-w-24 text-sm font-medium text-slate-800">{dayName(d)}</span>
              {ranges.length === 0 ? <span className="text-sm text-slate-600">{t('pro:member_hours.day_off', 'Ne travaille pas')}</span> : null}
              {ranges.map(({ r, i }) => (
                <span key={i} className="flex flex-wrap items-center gap-1">
                  <input type="time" dir="ltr" className="h-11 rounded-md border border-slate-300 px-2 text-sm" value={r.startTime} disabled={busy}
                    aria-label={t('pro:member_hours.start_of', 'Début, {{day}}', { day: dayName(d) })} onChange={(e) => edit((h) => { if (h.weekly) h.weekly[i].startTime = e.target.value; })} />
                  <span aria-hidden="true">–</span>
                  <input type="time" dir="ltr" className="h-11 rounded-md border border-slate-300 px-2 text-sm" value={r.endTime} disabled={busy}
                    aria-label={t('pro:member_hours.end_of', 'Fin, {{day}}', { day: dayName(d) })} onChange={(e) => edit((h) => { if (h.weekly) h.weekly[i].endTime = e.target.value; })} />
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => edit((h) => { if (h.weekly) h.weekly.splice(i, 1); })}>
                    {t('pro:member_hours.remove_range', 'Retirer')}<span className="sr-only"> {t('pro:member_hours.range_of', 'la plage du {{day}}', { day: dayName(d) })}</span>
                  </Button>
                </span>
              ))}
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => edit((h) => { (h.weekly = h.weekly || []).push({ weekday: d, startTime: '09:00', endTime: '12:00' }); })}>
                {t('pro:member_hours.add_range', 'Ajouter une plage')}<span className="sr-only"> {t('pro:member_hours.for_day', 'pour le {{day}}', { day: dayName(d) })}</span>
              </Button>
            </div>
          );
        }) : null}
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-base font-medium text-slate-900">{t('pro:member_hours.exceptions', 'Exceptions datées (une journée, une semaine, un mois…)')}</legend>
        {draft.exceptions.length === 0 ? <p className="text-sm text-slate-600">{t('pro:member_hours.no_exception', 'Aucune exception.')}</p> : null}
        {draft.exceptions.map((e, i) => {
          const n = i + 1;
          const allDay = e.startTime === null;
          return (
            <div key={i} className="grid gap-2 border-t border-slate-100 pt-2 sm:grid-cols-2" data-testid="pro-member-hours-exception">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-800">{t('pro:member_hours.kind', 'Exception {{n}} : type', { n })}</span>
                <select className="h-11 w-full rounded-md border border-slate-300 bg-white px-3" value={e.kind} disabled={busy}
                  onChange={(ev) => edit((h) => { h.exceptions[i].kind = ev.target.value === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE'; })}>
                  <option value="UNAVAILABLE">{t('pro:member_hours.kind_unavailable', 'Indisponible (aucun créneau)')}</option>
                  <option value="AVAILABLE">{t('pro:member_hours.kind_available', 'Disponible en plus de mes horaires habituels')}</option>
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm text-slate-800">
                <input type="checkbox" checked={allDay} disabled={busy} onChange={(ev) => edit((h) => { h.exceptions[i].startTime = ev.target.checked ? null : '09:00'; h.exceptions[i].endTime = ev.target.checked ? null : '12:00'; })} />
                {t('pro:member_hours.all_day', 'Journées entières')}
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-800">{t('pro:member_hours.from', 'Du')}</span>
                <input type="date" dir="ltr" className="h-11 w-full rounded-md border border-slate-300 px-2" value={e.from} disabled={busy} onChange={(ev) => edit((h) => { h.exceptions[i].from = ev.target.value; })} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-800">{t('pro:member_hours.to', 'Au (inclus)')}</span>
                <input type="date" dir="ltr" className="h-11 w-full rounded-md border border-slate-300 px-2" value={e.to} disabled={busy} onChange={(ev) => edit((h) => { h.exceptions[i].to = ev.target.value; })} />
              </label>
              {!allDay ? <>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-800">{t('pro:member_hours.exc_start', 'De (heure)')}</span>
                  <input type="time" dir="ltr" className="h-11 w-full rounded-md border border-slate-300 px-2" value={e.startTime || ''} disabled={busy} onChange={(ev) => edit((h) => { h.exceptions[i].startTime = ev.target.value; })} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-800">{t('pro:member_hours.exc_end', 'À (heure)')}</span>
                  <input type="time" dir="ltr" className="h-11 w-full rounded-md border border-slate-300 px-2" value={e.endTime || ''} disabled={busy} onChange={(ev) => edit((h) => { h.exceptions[i].endTime = ev.target.value; })} />
                </label>
              </> : null}
              <div className="sm:col-span-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => edit((h) => { h.exceptions.splice(i, 1); })}>
                  {t('pro:member_hours.remove_exception', 'Supprimer l’exception {{n}}', { n })}
                </Button>
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" disabled={busy} data-testid="pro-member-hours-add-exception"
          onClick={() => edit((h) => { const today = new Date().toISOString().slice(0, 10); h.exceptions.push({ kind: 'UNAVAILABLE', from: today, to: today, startTime: null, endTime: null }); })}>
          {t('pro:member_hours.add_exception', 'Ajouter une exception')}
        </Button>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !current} onClick={save} data-testid="pro-member-hours-save">{t('pro:member_hours.save', 'Enregistrer les horaires')}</Button>
      </div>
      <div aria-live="polite" className="space-y-2 text-sm">
        {state === 'saved' ? <p className="text-emerald-900" data-testid="pro-member-hours-saved">{t('pro:member_hours.saved', 'Horaires enregistrés. Les créneaux en ligne en tiennent compte immédiatement.')}</p> : null}
        {state === 'error' ? <p className="text-red-800" role="alert" data-testid="pro-member-hours-error">{message || t('pro:member_hours.save_error', 'Les horaires n’ont pas pu être enregistrés.')}</p> : null}
        {outside.length ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950" role="status" data-testid="pro-member-hours-outside">
            <p>{t('pro:member_hours.outside', { count: outside.length, defaultValue_one: '{{count}} rendez-vous déjà pris en dehors de ces horaires reste maintenu : annulez-le ou déplacez-le depuis l’agenda (la personne sera prévenue).', defaultValue_other: '{{count}} rendez-vous déjà pris en dehors de ces horaires restent maintenus : annulez-les ou déplacez-les depuis l’agenda (la personne sera prévenue).' })}</p>
            <ul className="mt-1 list-disc ps-5">{outside.map((a) => <li key={a.id}>{formatDate(new Date(a.startAt), { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' })}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
