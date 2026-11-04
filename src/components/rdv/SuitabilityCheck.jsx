// R42 (DEC-R42-02) — the light suitability check before booking: is this the right place? First contact or not, and the wish to see the same person again.
// No medical or diagnostic question. « My need is not listed » leads to alternatives (directory, orientation, the structure's own page), never to a dead end.
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';

/** @typedef {{ firstContact: '' | 'yes' | 'no', samePerson: boolean }} Suitability */

/** @param {{ value: Suitability, onChange: (value: Suitability) => void, teamChoice: boolean }} props */
export function SuitabilityQuestions({ value, onChange, teamChoice }) {
  const { t } = useT('booking');
  const name = useId();
  return (
    <fieldset className="space-y-2 rounded-xl border border-slate-300 bg-white p-4" data-testid="booking-suitability">
      <legend className="px-1 text-sm font-semibold text-slate-900">{t('booking:suitability.first_contact', 'Est-ce votre premier contact avec cette structure ? (facultatif)')}</legend>
      <div className="flex flex-wrap gap-4">
        {[['yes', t('booking:suitability.yes', 'Oui')], ['no', t('booking:suitability.no', 'Non, je l’ai déjà rencontrée')]].map(([v, label]) => (
          <label key={v} className="flex min-h-11 items-center gap-2 text-sm text-slate-900">
            <input type="radio" name={name} value={v} checked={value.firstContact === v} onChange={() => onChange({ ...value, firstContact: v === 'yes' ? 'yes' : 'no', samePerson: v === 'yes' ? false : value.samePerson })} />
            {label}
          </label>
        ))}
      </div>
      {value.firstContact === 'no' && teamChoice ? (
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-900" data-testid="booking-suitability-same-person">
          <input type="checkbox" checked={value.samePerson} onChange={(e) => onChange({ ...value, samePerson: e.target.checked })} />
          {t('booking:suitability.same_person', 'Je souhaite, si possible, revoir la même personne')}
        </label>
      ) : null}
      <p className="text-xs text-slate-700">{t('booking:suitability.no_health', 'Aucune question sur votre santé ou votre situation personnelle n’est posée ici.')}</p>
    </fieldset>
  );
}

/** @param {{ structureSlug: string, onBack: () => void }} props */
export function WrongStructure({ structureSlug, onBack }) {
  const { t } = useT('booking');
  return (
    <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-6" data-testid="booking-wrong-structure" aria-labelledby="wrong-structure-title">
      <h2 id="wrong-structure-title" className="text-lg font-semibold text-slate-900">{t('booking:suitability.wrong_title', 'Cette structure ne propose peut-être pas ce dont vous avez besoin')}</h2>
      <p className="text-sm text-slate-800">{t('booking:suitability.wrong_text', 'Les services ci-dessus sont les seuls qu’elle propose en ligne. D’autres pistes :')}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li><Link className="text-indigo-800 underline" to="/structures">{t('booking:suitability.alt_directory', 'Chercher une autre structure dans l’annuaire')}</Link></li>
        <li><Link className="text-indigo-800 underline" to="/orientation">{t('booking:suitability.alt_orientation', 'Être orienté selon ma situation')}</Link></li>
        <li><Link className="text-indigo-800 underline" to={`/structures/${encodeURIComponent(structureSlug)}`}>{t('booking:suitability.alt_contact', 'Voir les coordonnées de cette structure pour lui poser la question')}</Link></li>
      </ul>
      <button type="button" onClick={onBack} className="min-h-11 rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-900">{t('booking:suitability.back', 'Revenir aux services')}</button>
    </section>
  );
}
