import { useId } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { situationSignalsOpened } from '@/lib/observatoire';

/**
 * G14-OBS — the opt-in box of the Rights Graph page (/situation, branch g14-rg). UNTICKED by default; the choice lives in the page's memory only (the
 * parent's state: never written to the device, never a cookie), so a new visit starts unticked. Renders nothing unless the build opened the counter
 * (VITE_DEMAND_SIGNALS ∋ situation). The page then calls sendSituationSignal(id, { optedIn: checked }) (src/lib/observatoire.js) when a situation is chosen.
 * Minimal hook for g14-rg: `const [optIn, setOptIn] = useState(false)` · `<SituationSignalOptIn checked={optIn} onChange={setOptIn} />` ·
 * `sendSituationSignal(s.id, { optedIn: optIn })` in the choice handler.
 * @param {{ checked: boolean, onChange: (v: boolean) => void, opened?: boolean }} props
 */
export default function SituationSignalOptIn({ checked, onChange, opened = situationSignalsOpened() }) {
  const { t } = useT('observatory');
  const id = useId();
  if (!opened) return null;
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4" data-testid="situation-signal-optin">
      <div className="flex items-start gap-3">
        <input id={id} type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-help`} />
        <label htmlFor={id} className="font-medium text-slate-900">{t('observatory:optin.label', 'Aider l’Observatoire : envoyer la situation que je choisis, sans mon nom.')}</label>
      </div>
      <p id={`${id}-help`} className="mt-2 ps-8 text-sm text-slate-700">
        {t('observatory:optin.help', 'Seul le nom de la situation est envoyé (par exemple « Loyer impayé »). Rien d’autre : ni texte, ni nom, ni adresse. Si vous ne cochez pas, rien n’est envoyé.')}{' '}
        <Link to="/observatoire#methode" className="font-semibold text-blue-700 underline">{t('observatory:optin.more', 'En savoir plus')}</Link>
      </p>
    </div>
  );
}
SituationSignalOptIn.propTypes = { checked: PropTypes.bool.isRequired, onChange: PropTypes.func.isRequired, opened: PropTypes.bool };
