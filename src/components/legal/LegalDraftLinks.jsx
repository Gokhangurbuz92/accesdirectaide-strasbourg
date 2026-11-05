import { Link } from 'react-router-dom';
import { LEGAL_DRAFT_DOCUMENTS, currentDraftContext, draftVisibility } from '@/config/legal-drafts';
import { useT } from '@/i18n';

/**
 * R45 (ENG-LR-5) — links to the R45 legal documents that this build may show: the approved ones (Production) or, in LAB preview, the drafts, each
 * marked « Projet — non approuvé ». Renders NOTHING when no document is visible (Production today), so no draft is ever linked as in force.
 */
export default function LegalDraftLinks() {
  const { t } = useT('legal');
  const ctx = currentDraftContext();
  const visible = LEGAL_DRAFT_DOCUMENTS.map((d) => ({ d, state: draftVisibility(d, ctx) })).filter((x) => x.state !== 'HIDDEN');
  if (!visible.length) return null;
  return (
    <nav aria-labelledby="legal-draft-links-title" data-testid="legal-draft-links" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 id="legal-draft-links-title" className="text-base font-semibold text-slate-900">{t('legal:draft.links.title', 'Autres documents')}</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {visible.map(({ d, state }) => (
          <li key={d.id}>
            <Link to={/** @type {string} */ (d.path)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
              {t(`legaldraft:${d.key}.title`, d.title)}
            </Link>
            {state === 'PREVIEW' && <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{t('legal:draft.banner.title', 'Projet — non approuvé')}</span>}
          </li>
        ))}
      </ul>
    </nav>
  );
}
