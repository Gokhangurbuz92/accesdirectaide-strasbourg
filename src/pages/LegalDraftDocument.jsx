import PropTypes from 'prop-types';
import { Link, useLocation } from 'react-router-dom';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import LegalTranslationNotice from '@/components/legal/LegalTranslationNotice';
import LegalDraftBanner from '@/components/legal/LegalDraftBanner';
import { Card, CardContent } from '@/components/ui/card';
import { LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
import { currentDraftContext, draftByPath, draftVisibility } from '@/config/legal-drafts';
import brand from '@/lib/brand-config';
import { useLanguage, useT } from '@/i18n';

/**
 * R45 (ENG-LR-5) — renders one R45 legal document (citizen terms, professional terms, structure conditions, privacy notice art. 13/14).
 * French text = src/config/legal-drafts.js (authoritative); other languages = namespace « legaldraft » (translations, labelled as such).
 * HIDDEN (Production, not approved): a neutral « not in force » page that links to the in-force pages; the draft text is not rendered.
 * PREVIEW (LAB): the text with the « Projet — non approuvé » banner. IN_FORCE: the approved text.
 */
/** @param {{ path?: string }} props */
export default function LegalDraftDocument({ path: forcedPath }) {
  const { t } = useT('legal');
  const { isSource } = useLanguage();
  const location = useLocation();
  const doc = draftByPath(forcedPath || location.pathname);
  const state = doc ? draftVisibility(doc, currentDraftContext()) : 'HIDDEN';

  if (!doc || state === 'HIDDEN') {
    return (
      <div className="min-h-screen bg-slate-50 pb-20">
        <SEO title={t('legal:draft.hidden.title', 'Document en préparation')} path={forcedPath || location.pathname} noindex />
        <PageHeader width="reading" title={t('legal:draft.hidden.title', 'Document en préparation')} description={t('legal:draft.hidden.text', "Ce document est en préparation. Il n'est pas en vigueur.")} />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="legal-draft-hidden">
          <p className="text-slate-700">{t('legal:draft.hidden.inForce', 'Les textes en vigueur sont :')}</p>
          <ul className="mt-2 list-disc ps-5 space-y-1">
            <li><Link to="/cgu" className="text-blue-700 underline underline-offset-2">{t('legal:terms.title', 'Conditions générales d’utilisation')}</Link></li>
            <li><Link to="/politique-confidentialite" className="text-blue-700 underline underline-offset-2">{t('legal:privacy.title', 'Politique de confidentialité')}</Link></li>
            <li><Link to="/mentions-legales" className="text-blue-700 underline underline-offset-2">{t('legal:mentions.title', 'Mentions légales')}</Link></li>
          </ul>
        </div>
      </div>
    );
  }

  const values = {
    operator: LEGAL_PLACEHOLDERS.controllerIdentity,
    controller: LEGAL_PLACEHOLDERS.controllerIdentity,
    contact: LEGAL_PLACEHOLDERS.dataProtectionContact || brand.contact.email,
    interpolation: { escapeValue: false },
  };
  const k = (/** @type {string} */ suffix) => `legaldraft:${doc.key}.${suffix}`;
  const proposed = t('legaldraft:badge.proposed', 'proposé — en attente de validation du responsable');

  return (
    <div className="min-h-screen bg-slate-50 pb-20" data-legal-draft={doc.id} data-legal-draft-state={state}>
      <SEO title={t(k('title'), doc.title)} path={doc.path || undefined} noindex={state !== 'IN_FORCE'} />
      <PageHeader width="reading" title={t(k('title'), doc.title)} description={t(k('intro'), doc.intro)} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {state === 'PREVIEW' && <LegalDraftBanner version={`${doc.id}@${doc.version}`} />}
        <LegalTranslationNotice />
        {!isSource && (
          <p className="text-sm text-slate-600" data-testid="legal-draft-french-reference">
            {t('legaldraft:frenchReference', 'Version française seule juridiquement de référence.')}
          </p>
        )}
        <Card className="border-slate-200 shadow-md">
          <CardContent className="p-6 md:p-10 space-y-10">
            {doc.sections.map((s) => (
              <section key={s.id} className="space-y-3" aria-labelledby={`${doc.id}-${s.id}`}>
                <h2 id={`${doc.id}-${s.id}`} className="text-xl md:text-2xl font-bold text-slate-900 border-b border-slate-100 pb-3">{t(k(`${s.id}.title`), s.title)}</h2>
                {s.items && (
                  <ul className="list-disc ps-5 space-y-2 text-slate-700 leading-relaxed">
                    {s.items.map((txt, i) => (
                      <li key={i}>
                        {t(k(`${s.id}.i${i + 1}`), txt, values)}
                        {s.proposed && <span className="ms-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700" data-testid="legal-proposed-badge">{proposed}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {(s.paras || []).map((txt, i) => (
                  <p key={i} className="text-slate-700 leading-relaxed">{t(k(`${s.id}.p${i + 1}`), txt, values)}</p>
                ))}
              </section>
            ))}
            <p className="text-sm text-slate-500 border-t border-slate-100 pt-4" lang="fr" dir="ltr" data-legal-draft-version={doc.version}>
              {doc.id}@{doc.version}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

LegalDraftDocument.propTypes = { path: PropTypes.string };
