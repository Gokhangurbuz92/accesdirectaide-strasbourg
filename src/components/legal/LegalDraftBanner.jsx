import PropTypes from 'prop-types';
import { AlertTriangle } from 'lucide-react';
import { useT } from '@/i18n';

/**
 * R45 (ENG-LR-5) — shown on every draft legal text rendered in LAB (VITE_LEGAL_DRAFT_PREVIEW=1): the text is a project, not approved by the owner,
 * not in force. Never rendered for an approved document; drafts are never rendered at all in a Production build (src/config/legal-drafts.js).
 */
export default function LegalDraftBanner({ version, className = '' }) {
  const { t } = useT('legal');
  return (
    <div role="note" data-testid="legal-draft-banner" className={`rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-sm ${className}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="text-sm leading-relaxed">
          <p className="font-bold">{t('legal:draft.banner.title', 'Projet — non approuvé')}</p>
          <p>{t('legal:draft.banner.text', "Ce texte est un projet. Il n'est pas approuvé par le responsable du service et n'est pas en vigueur. Il ne constitue pas un avis juridique.")}</p>
          <p className="mt-1 text-amber-900" lang="fr" dir="ltr">{t('legal:draft.banner.version', 'Version : {{version}}', { version })}</p>
        </div>
      </div>
    </div>
  );
}

LegalDraftBanner.propTypes = { version: PropTypes.string.isRequired, className: PropTypes.string };
