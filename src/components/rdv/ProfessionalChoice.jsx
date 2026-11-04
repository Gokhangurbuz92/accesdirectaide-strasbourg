// R42 (owner decision R42-A04) — choose who to meet: no preference, the person of my previous appointment (only when this account really had one here),
// or a publicly selectable professional (display name and role only). The server re-checks every choice; a refused one is « not available », nothing more.
import { useId } from 'react';
import { useT } from '@/i18n';

/** @typedef {{ id: string, displayName: string | null, role: string | null }} Professional */
/** @typedef {{ choice: boolean, professionals: Professional[], previous: { available: boolean, displayName: string | null } }} TeamView */

/** @param {{ team: TeamView, value: string, onChange: (value: string) => void }} props */
export default function ProfessionalChoice({ team, value, onChange }) {
  const { t } = useT('booking');
  const name = useId();
  /** @type {Array<{ id: string, label: string, hint?: string | null }>} */
  const options = [{ id: 'ANY', label: t('booking:pro_choice.any', 'Pas de préférence'), hint: t('booking:pro_choice.any_hint', 'La structure vous oriente vers une personne disponible.') }];
  if (team.previous.available) {
    options.push({ id: 'PREVIOUS', label: team.previous.displayName
      ? t('booking:pro_choice.previous_named', 'La même personne que lors de mon précédent rendez-vous ({{name}})', { name: team.previous.displayName })
      : t('booking:pro_choice.previous', 'La même personne que lors de mon précédent rendez-vous') });
  }
  for (const p of team.professionals) options.push({ id: p.id, label: p.displayName || '', hint: p.role });
  return (
    <fieldset className="space-y-2" data-testid="booking-professional-choice">
      <legend className="text-base font-semibold text-slate-900">{t('booking:pro_choice.legend', 'Avec qui souhaitez-vous prendre rendez-vous ?')}</legend>
      {options.map((o) => (
        <label key={o.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${value === o.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300 bg-white'}`}>
          <input type="radio" className="mt-1" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} data-testid={`booking-professional-${o.id === 'ANY' || o.id === 'PREVIOUS' ? o.id : 'named'}`} />
          <span>
            <span className="block font-medium text-slate-900" dir="auto">{o.label}</span>
            {o.hint ? <span className="block text-sm text-slate-700" dir="auto">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
