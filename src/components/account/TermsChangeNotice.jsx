import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentDraftContext } from '@/config/legal-drafts';
import { TERMS_CHANGE_NOTICES, termsChangeStorageKey, termsChangeVersion } from '@/lib/termsChange';
import { formatDate, useT } from '@/i18n';

/**
 * Release 3 (owner approval 24/11/2026, CONTROL/master/completion/R3_OWNER_APPROVAL_2026-11-24.md: « değişiklik hesap sahiplerine Mon Espace bildirimiyle
 * duyurulur ») — the account holders are told in Mon Espace that the citizen terms changed. Shown ONLY when this build puts in force a citizen-terms
 * version listed in TERMS_CHANGE_NOTICES (VITE_LEGAL_DOCS_APPROVED_VERSION, src/config/legal-drafts.js): no notice for a draft, nor in a LAB preview.
 * One-time: « J'ai compris » hides it for that version on this browser (localStorage, wrapped: a blocked storage only means it shows again). No e-mail
 * (owner decision: Mon Espace notice, Mailjet quota), nothing sent to the server, no personal data.
 * RGAA: a labelled region (h2) — not an alert, nothing urgent; real links to the two documents; a real button; after dismissal the focus goes to the
 * page heading so keyboard and screen-reader users are not left on a removed element.
 */
const seen = (/** @type {string} */ version) => { try { return window.localStorage.getItem(termsChangeStorageKey(version)) === '1'; } catch { return false; } };

/** @param {{ approved?: string, focusAfterDismiss?: () => void }} props `approved` overrides the build value (tests) */
export default function TermsChangeNotice({ approved, focusAfterDismiss } = {}) {
  const { t } = useT('compte');
  const version = termsChangeVersion(approved === undefined ? currentDraftContext() : { approved });
  const [hidden, setHidden] = useState(() => !version || seen(version));
  const headingId = `terms-change-${useId().replace(/:/g, '')}`;
  if (!version || hidden) return null;
  const date = new Date(`${TERMS_CHANGE_NOTICES[/** @type {'v13-2026-11-24'} */ (version)]}T12:00:00Z`);
  const dismiss = () => {
    try { window.localStorage.setItem(termsChangeStorageKey(version), '1'); } catch { /* storage blocked: hidden for this visit only */ }
    setHidden(true);
    if (focusAfterDismiss) focusAfterDismiss();
  };
  return (
    <section aria-labelledby={headingId} data-testid="terms-change-notice" className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-slate-900">
      <h2 id={headingId} className="text-base font-semibold">{t('compte:terms_change.title', 'Nos conditions d’utilisation ont changé')}</h2>
      <p className="mt-1 text-sm">
        {t('compte:terms_change.body', 'Une nouvelle version est en vigueur depuis le {{date}}. Elle décrit de nouvelles fonctions, quand elles sont ouvertes : Mon foyer, les personnes de confiance, la protection juridique, Mon Coffre et les messages d’un rendez-vous. Notre notice de confidentialité a changé aussi.', { date: formatDate(date) })}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <li><Link to="/cgu/citoyen" data-testid="terms-change-cgu" className="font-medium text-blue-800 underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{t('compte:terms_change.link_cgu', 'Lire les conditions d’utilisation')}</Link></li>
        <li><Link to="/confidentialite/notice" data-testid="terms-change-notice-link" className="font-medium text-blue-800 underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{t('compte:terms_change.link_notice', 'Lire la notice de confidentialité')}</Link></li>
      </ul>
      <button type="button" onClick={dismiss} data-testid="terms-change-dismiss" className="mt-3 min-h-[44px] rounded-md border border-blue-700 bg-white px-4 text-sm font-medium text-blue-900 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
        {t('compte:terms_change.dismiss', 'J’ai compris')}
      </button>
    </section>
  );
}
