import { Globe } from 'lucide-react';
import PropTypes from 'prop-types';
import { LANGUAGES, setLanguage, useLanguage, useT } from '@/i18n';

/**
 * R32 — the language choice. A native <select> on purpose: keyboard, screen readers and phones already know how to use it, and each option carries its
 * own `lang` so a screen reader pronounces « العربية » or « Українська » correctly. The label is bilingual (current language + « Langue ») so a
 * person who landed on the wrong language still recognises it. Changing the language stops any reading aloud (useReadAloud listens to the change).
 */
export default function LanguageSelector({ id = 'language-select', className = '', compact = false }) {
  const { t } = useT('common');
  const { code } = useLanguage();
  const label = t('common:language.label', 'Langue');
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Globe className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
      <label htmlFor={id} className={compact ? 'sr-only' : 'text-sm text-slate-700'}>
        {code === 'fr' ? label : `${label} · Langue`}
      </label>
      <select
        id={id}
        value={code}
        onChange={(e) => { void setLanguage(e.target.value); }}
        className="min-h-11 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary"
        data-testid="language-select"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>{l.name}</option>
        ))}
      </select>
    </div>
  );
}

LanguageSelector.propTypes = { id: PropTypes.string, className: PropTypes.string, compact: PropTypes.bool };
