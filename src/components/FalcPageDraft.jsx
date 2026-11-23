import PropTypes from 'prop-types';
import { useFalc } from '@/contexts/FalcContext';
import { useT } from '@/i18n';
import { FALC_PAGE_DRAFTS, FALC_DRAFT_STATUS } from '@/content/falc/citizenPages.fr';
import { FALC_AUDIO_VOICE, falcAudioFor } from '@/content/falc/falcAudio';

/**
 * FA-D4 — the simplified French draft of a key citizen page (src/content/falc/citizenPages.fr.js), shown only when the reader has turned on « Facile à
 * lire » (FalcContext). Layout per the Unapei rules: one sentence per line, text aligned to the start, sans-serif at 18 px (≈ 14 pt), short headings.
 * It always says what it is: a provisional simplified text NOT yet proofread by people with an intellectual disability (never « FALC validé »).
 * The text is French whatever the interface language (lang="fr" dir="ltr"); only the label around it is translated.
 * G14-CHAN: when a pre-recorded audio of THIS text exists (src/content/falc/falcAudio.js), a native audio player (keyboard and screen-reader operable,
 * never autoplay, preload none) reads it aloud, with the voice's attribution (CC BY 4.0). Otherwise nothing: the page reader stays available.
 * @param {{ id: keyof typeof FALC_PAGE_DRAFTS, force?: boolean }} props   force: render without the FALC switch (tests, the FALC review screen)
 */
export default function FalcPageDraft({ id, force = false }) {
  const { isFalcEnabled } = useFalc();
  const { t } = useT('shared');
  const draft = FALC_PAGE_DRAFTS[id];
  if (!draft || (!isFalcEnabled && !force)) return null;
  const headingId = `falc-draft-${draft.id}`;
  const audio = falcAudioFor(draft);
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
      {audio ? (
        <figure className="mt-2" data-testid="falc-audio">
          <figcaption id={`${headingId}-audio`} className="mb-1 text-base font-semibold">{t('shared:falc.audio.label_duration', 'Écouter ce texte ({{minutes}} min)', { minutes: Math.max(1, Math.round(audio.seconds / 60)) })}</figcaption>
          {/* WCAG 1.2.1 (audio only): the transcript is the simplified text itself, shown just above — no caption track applies to audio */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="none" src={audio.file} aria-labelledby={`${headingId}-audio`} className="w-full max-w-md">
            <a href={audio.file}>{t('shared:falc.audio.download', 'Télécharger l’enregistrement')}</a>
          </audio>
          <p className="mt-1 text-sm text-slate-700"><span lang="fr">{FALC_AUDIO_VOICE.attribution}</span> <a className="underline" href={FALC_AUDIO_VOICE.licenceUrl} rel="noopener noreferrer">{t('shared:falc.audio.licence', 'Licence')}</a></p>
        </figure>
      ) : null}
    </section>
  );
}
FalcPageDraft.propTypes = { id: PropTypes.oneOf(Object.keys(FALC_PAGE_DRAFTS)).isRequired, force: PropTypes.bool };
export { FALC_DRAFT_STATUS };
