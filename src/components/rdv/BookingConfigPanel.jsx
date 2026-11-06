// R42 (owner decisions R42-A03 / R42-A04) — the structure controls how a request is confirmed and who can be chosen.
// Mode A « confirmation directe » or Mode B « validation par la structure », per structure and per service; team choice: which members take
// bookings and which are publicly selectable (shown by their public display name only). The server validates and journals every change.
import { useCallback, useEffect, useState } from 'react';
import { proRdvClient } from '@/api/pro-rdv-client';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/** @typedef {{ id: string, email: string, role: string, verified: boolean, displayName: string | null, jobTitle: string | null }} Member */
/** @typedef {{ bookable: boolean, selectable: boolean, serviceIds: string[] }} MemberConfig */
/** @typedef {{ confirmation: 'DIRECT' | 'APPROVAL', serviceConfirmation: Record<string, 'DIRECT' | 'APPROVAL'>, team: { enabled: boolean, members: Record<string, MemberConfig> }, members: Member[], services: Array<{ id: string, name: string }> }} BookingView */

/** @param {unknown} v @returns {BookingView | null} */
function readView(v) {
  if (!v || typeof v !== 'object' || !('booking' in v)) return null;
  const b = /** @type {{ booking: BookingView }} */ (v).booking;
  return b && typeof b === 'object' ? b : null;
}

/** @param {{ canEdit: boolean }} props */
export default function BookingConfigPanel({ canEdit }) {
  const { t } = useT('pro');
  const fr = useFrAttrs();   // R47: service names and the members' public names are the structure's own words (lang="fr" outside French)
  const [view, setView] = useState(/** @type {BookingView | null} */ (null));
  const [state, setState] = useState(/** @type {'loading' | 'idle' | 'saving' | 'saved' | 'error'} */ ('loading'));

  const load = useCallback(async () => {
    try { setView(readView(await proRdvClient.settings.get())); setState('idle'); } catch { setState('error'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** @param {Parameters<typeof proRdvClient.settings.updateBooking>[0]} patch */
  const save = async (patch) => {
    setState('saving');
    try { setView(readView(await proRdvClient.settings.updateBooking(patch))); setState('saved'); } catch { setState('error'); }
  };

  if (state === 'loading') return <p role="status">{t('pro:booking_config.loading', 'Chargement des règles de prise de rendez-vous…')}</p>;
  if (!view) return <p role="alert" className="text-sm text-red-800">{t('pro:booking_config.error', 'Les règles de prise de rendez-vous n’ont pas pu être chargées ou enregistrées.')}</p>;

  /** @param {string} id @param {Partial<MemberConfig>} change */
  const memberPatch = (id, change) => {
    const cur = view.team.members[id] || { bookable: false, selectable: false, serviceIds: [] };
    const next = { ...cur, ...change };
    if (!next.bookable) next.selectable = false;
    return { team: { members: { [id]: { bookable: next.bookable, selectable: next.selectable, serviceIds: next.serviceIds } } } };
  };

  return (
    <section className="space-y-4" aria-labelledby="booking-config-title" data-testid="pro-booking-config">
      <h3 id="booking-config-title" className="text-base font-semibold text-slate-900">{t('pro:booking_config.title', 'Confirmation des demandes et choix du professionnel')}</h3>
      <p className="text-sm text-slate-700">{t('pro:booking_config.account_required', 'Les personnes doivent avoir un compte particulier pour demander un rendez-vous. La prise de rendez-vous sans compte n’existe plus.')}</p>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-slate-800">{t('pro:booking_config.confirmation_label', 'Confirmation des demandes (structure)')}</span>
        <select className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="pro-booking-confirmation" disabled={!canEdit || state === 'saving'}
          value={view.confirmation} onChange={(e) => save({ confirmation: e.target.value === 'APPROVAL' ? 'APPROVAL' : 'DIRECT' })}>
          <option value="DIRECT">{t('pro:booking_config.mode_direct', 'Confirmation directe : le créneau est confirmé dès la demande')}</option>
          <option value="APPROVAL">{t('pro:booking_config.mode_approval', 'Validation par la structure : la demande attend votre accord')}</option>
        </select>
      </label>

      {view.services.length ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">{t('pro:booking_config.per_service', 'Par service (facultatif)')}</legend>
          {view.services.map((s) => (
            <label key={s.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <span className="min-w-40" {...fr}>{s.name}</span>
              <select className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm" disabled={!canEdit || state === 'saving'} value={view.serviceConfirmation[s.id] || ''}
                onChange={(e) => save({ serviceConfirmation: { [s.id]: e.target.value === 'APPROVAL' ? 'APPROVAL' : e.target.value === 'DIRECT' ? 'DIRECT' : null } })}>
                <option value="">{t('pro:booking_config.as_structure', 'Comme la structure')}</option>
                <option value="DIRECT">{t('pro:booking_config.short_direct', 'Confirmation directe')}</option>
                <option value="APPROVAL">{t('pro:booking_config.short_approval', 'Validation par la structure')}</option>
              </select>
            </label>
          ))}
        </fieldset>
      ) : null}

      <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
        <input type="checkbox" data-testid="pro-booking-team" disabled={!canEdit || state === 'saving'} checked={view.team.enabled} onChange={(e) => save({ team: { enabled: e.target.checked } })} />
        {t('pro:booking_config.team_enabled', 'Permettre de choisir un professionnel (ou « pas de préférence »)')}
      </label>

      {view.team.enabled ? (
        <table className="w-full text-left text-sm" data-testid="pro-booking-members">
          <caption className="sr-only">{t('pro:booking_config.members_caption', 'Membres de l’équipe et prise de rendez-vous')}</caption>
          <thead><tr>
            <th scope="col" className="py-1">{t('pro:booking_config.member', 'Membre')}</th>
            <th scope="col" className="py-1">{t('pro:booking_config.bookable', 'Reçoit des rendez-vous')}</th>
            <th scope="col" className="py-1">{t('pro:booking_config.selectable', 'Choisissable publiquement')}</th>
          </tr></thead>
          <tbody>
            {view.members.map((m) => {
              const cfg = view.team.members[m.id] || { bookable: false, selectable: false, serviceIds: [] };
              const blocked = !m.verified;
              return (
                <tr key={m.id} className="border-t border-slate-200">
                  <td className="py-2">
                    <span dir="ltr" {...(m.displayName ? fr : {})}>{m.displayName || m.email}</span>
                    {blocked ? <span className="block text-xs text-amber-900">{t('pro:booking_config.needs_mfa', 'Connexion à double facteur non activée : ne peut pas recevoir de rendez-vous en ligne.')}</span> : null}
                    {!m.displayName ? <span className="block text-xs text-slate-600">{t('pro:booking_config.needs_name', 'Sans nom public : jamais affiché aux personnes (adresse e-mail jamais montrée).')}</span> : null}
                  </td>
                  <td className="py-2"><input type="checkbox" aria-label={t('pro:booking_config.bookable_for', 'Reçoit des rendez-vous : {{who}}', { who: m.displayName || m.email })} disabled={!canEdit || blocked || state === 'saving'}
                    checked={cfg.bookable} onChange={(e) => save(memberPatch(m.id, { bookable: e.target.checked }))} /></td>
                  <td className="py-2"><input type="checkbox" aria-label={t('pro:booking_config.selectable_for', 'Choisissable publiquement : {{who}}', { who: m.displayName || m.email })} disabled={!canEdit || blocked || !cfg.bookable || !m.displayName || state === 'saving'}
                    checked={cfg.selectable} onChange={(e) => save(memberPatch(m.id, { selectable: e.target.checked }))} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      <div aria-live="polite" className="text-sm">
        {state === 'saved' ? <p className="text-emerald-900">{t('pro:booking_config.saved', 'Règles enregistrées.')}</p> : null}
        {state === 'error' ? <p className="text-red-800" role="alert">{t('pro:booking_config.error', 'Les règles de prise de rendez-vous n’ont pas pu être chargées ou enregistrées.')}</p> : null}
      </div>
      {state === 'error' ? <Button type="button" variant="outline" onClick={load}>{t('pro:booking_config.retry', 'Réessayer')}</Button> : null}
    </section>
  );
}
