import PropTypes from 'prop-types';
import { Languages } from 'lucide-react';
import { setLanguage, useLanguage, useT } from '@/i18n';

/**
 * R32 — at the top of each legal page (mentions légales, confidentialité, cookies, CGU, sécurité) when the interface is not in French: the translation
 * is only a help to understand, the French text is the legal reference, and one button shows the site in French again. Renders nothing in French.
 */
export default function LegalTranslationNotice({ className = '' }) {
  const { t } = useT('legal');
  const { isSource } = useLanguage();
  if (isSource) return null;
  return (
    <div role="note" data-testid="legal-translation-notice" className={`rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950 shadow-sm ${className}`}>
      <div className="flex items-start gap-3">
        <Languages className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />
        <div className="text-sm leading-relaxed">
          <p className="font-medium">
            {t('legal:notice.text', 'Cette traduction vous est proposée pour vous aider à comprendre. La version française est la référence juridique.')}
          </p>
          <button
            type="button"
            onClick={() => { void setLanguage('fr'); }}
            className="mt-2 min-h-11 rounded-md px-1 font-semibold text-sky-900 underline underline-offset-2 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-600"
            data-testid="legal-translation-notice-french"
          >
            {t('legal:notice.switch', 'Afficher la version française')}
          </button>
        </div>
      </div>
    </div>
  );
}

LegalTranslationNotice.propTypes = { className: PropTypes.string };
