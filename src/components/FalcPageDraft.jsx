import PropTypes from 'prop-types';
import { useFalc } from '@/contexts/FalcContext';
import { useT } from '@/i18n';
import { FALC_PAGE_DRAFTS, FALC_DRAFT_STATUS } from '@/content/falc/citizenPages.fr';

/**
 * FA-D4 — the simplified French draft of a key citizen page (src/content/falc/citizenPages.fr.js), shown only when the reader has turned on « Facile à
 * lire » (FalcContext). Layout per the Unapei rules: one sentence per line, text aligned to the start, sans-serif at 18 px (≈ 14 pt), short headings.
 * It always says what it is: a provisional simplified text NOT yet proofread by people with an intellectual disability (never « FALC validé »).
 * The text is French whatever the interface language (lang="fr" dir="ltr"); only the label around it is translated.
 * @param {{ id: keyof typeof FALC_PAGE_DRAFTS, force?: boolean }} props   force: render without the FALC switch (tests, the FALC review screen)
 */
export default function FalcPageDraft({ id, force = false }) {
  const { isFalcEnabled } = useFalc();
  const { t } = useT('shared');
  const draft = FALC_PAGE_DRAFTS[id];
  if (!draft || (!isFalcEnabled && !force)) return null;
  const headingId = `falc-draft-${draft.id}`;
  return (
    <section aria-labelledby={headingId} className="my-6 rounded-2xl border-2 border-blue-200 bg-white p-5 text-start font-sans text-lg leading-relaxed text-slate-900"
      data-testid="falc-page-draft" data-falc-status={draft.status} data-falc-draft={draft.id}>
      <p className="mb-3 inline-block rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-950" data-testid="falc-draft-label">
        {t('shared:falc.draft.label', 'Texte simplifié provisoire : pas encore relu par des personnes en situation de handicap intellectuel')}
      </p>
      <div lang="fr" dir="ltr">
        <h2 id={headingId} className="mb-3 text-xl font-bold">{draft.title}</h2>
        {draft.blocks.map((b) => (
          <div key={b.heading} className="mb-4">
            <h3 className="mb-1 text-lg font-semibold">{b.heading}</h3>
            {b.lines.map((line) => <p key={line} className="mb-1">{line}</p>)}
          </div>
        ))}
      </div>
    </section>
  );
}
FalcPageDraft.propTypes = { id: PropTypes.oneOf(Object.keys(FALC_PAGE_DRAFTS)).isRequired, force: PropTypes.bool };
export { FALC_DRAFT_STATUS };
