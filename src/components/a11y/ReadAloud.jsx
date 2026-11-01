import { useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Square, TextSelect, Volume2 } from 'lucide-react';
import { formatNumber, languageOf, useLanguage, useT } from '@/i18n';
import useReadAloud from '@/hooks/useReadAloud';
import { voicesFor } from '@/lib/readAloud';

/**
 * R32 — « Écouter la page »: the page reader, at the top of the main content of every page (integrated in the layout, not a floating widget).
 * Closed by default; nothing is spoken until the visitor presses a button. Controls: read the page / the current section / the selected text,
 * pause, resume, stop, previous and next section, speed, voice of the interface language, highlighting of the passage being read. Hidden when
 * the device cannot speak (no dead control). It does not replace a screen reader and does not interfere with one: it announces only the
 * visitor's own actions (polite live region), never the text it reads.
 */
const btn = 'inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-50';

export default function ReadAloud() {
  const { t } = useT('reader');
  const { code } = useLanguage();
  const r = useReadAloud();
  const [open, setOpen] = useState(false);
  if (!r.supported) return null;
  const { status, section, total, heading, skipped, error } = r.state;
  const mine = voicesFor(r.voices, code, r.prefs.voices[code]);
  const langName = languageOf(code)?.name || code;
  const skippedNames = skipped.map((l) => languageOf(l)?.name || l).join(', ');
  const live = error === 'no-selection' ? t('reader:error.selection', 'Sélectionnez d’abord un passage du texte avec la souris ou le doigt.')
    : error === 'empty' ? t('reader:error.empty', 'Cette page n’a pas de texte à lire.')
      : error ? t('reader:error.speech', 'La lecture s’est arrêtée : la synthèse vocale de votre appareil a renvoyé une erreur.')
        : status === 'playing' ? t('reader:state.playing', 'Lecture en cours.')
          : status === 'paused' ? t('reader:state.paused', 'Lecture en pause.') : '';

  return (
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6" data-no-read="" data-testid="read-aloud">
      <div className="flex justify-end">
        <button type="button" className={btn} aria-expanded={open} aria-controls="read-aloud-controls" onClick={() => { if (open) r.stop(); setOpen(!open); }} data-testid="read-aloud-toggle">
          <Volume2 className="h-4 w-4" aria-hidden="true" />
          {open ? t('reader:close', 'Fermer la lecture à voix haute') : t('reader:open', 'Écouter la page')}
        </button>
      </div>
      {open ? (
        <div id="read-aloud-controls" role="group" aria-label={t('reader:group', 'Lecture à voix haute')} className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {status === 'paused'
              ? <button type="button" className={btn} onClick={r.resume} data-testid="read-resume"><Play className="h-4 w-4" aria-hidden="true" />{t('reader:resume', 'Reprendre')}</button>
              : <button type="button" className={btn} onClick={() => r.play('page')} disabled={status === 'playing'} data-testid="read-page"><Play className="h-4 w-4" aria-hidden="true" />{t('reader:play.page', 'Lire la page')}</button>}
            <button type="button" className={btn} onClick={r.pause} disabled={status !== 'playing'} data-testid="read-pause"><Pause className="h-4 w-4" aria-hidden="true" />{t('reader:pause', 'Pause')}</button>
            <button type="button" className={btn} onClick={r.stop} disabled={status === 'idle'} data-testid="read-stop"><Square className="h-4 w-4" aria-hidden="true" />{t('reader:stop', 'Arrêter')}</button>
            <button type="button" className={btn} onClick={r.previous} data-testid="read-previous"><ChevronLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t('reader:previous', 'Section précédente')}</button>
            <button type="button" className={btn} onClick={r.next} data-testid="read-next">{t('reader:next', 'Section suivante')}<ChevronRight className="h-4 w-4 rtl-flip" aria-hidden="true" /></button>
            <button type="button" className={btn} onClick={() => r.play('section')} data-testid="read-section">{t('reader:play.section', 'Lire la section actuelle')}</button>
            <button type="button" className={btn} onClick={() => r.play('selection')} data-testid="read-selection"><TextSelect className="h-4 w-4" aria-hidden="true" />{t('reader:play.selection', 'Lire le texte sélectionné')}</button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="read-rate" className="text-sm text-slate-700">{t('reader:rate', 'Vitesse')}</label>
              <select id="read-rate" className="min-h-11 rounded-md border border-slate-300 bg-white px-2 text-sm" value={String(r.prefs.rate)} onChange={(e) => r.setPrefs({ rate: Number(e.target.value) })}>
                {r.rates.map((x) => <option key={x} value={String(x)}>{x === 1 ? t('reader:rate.normal', 'Normale') : `× ${formatNumber(x)}`}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="read-voice" className="text-sm text-slate-700">{t('reader:voice', 'Voix ({{language}})', { language: langName })}</label>
              {mine.length ? (
                <select id="read-voice" className="min-h-11 max-w-[16rem] rounded-md border border-slate-300 bg-white px-2 text-sm" value={mine[0].voiceURI}
                  onChange={(e) => r.setPrefs({ voices: { [code]: e.target.value } })}>
                  {mine.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService === false ? ` — ${t('reader:voice.online', 'en ligne')}` : ''}</option>)}
                </select>
              ) : (
                <p id="read-voice" className="max-w-md text-sm text-amber-900" data-testid="read-no-voice">
                  {t('reader:voice.none', 'Aucune voix en {{language}} n’est installée sur cet appareil : les passages dans cette langue ne seront pas lus. Vous pouvez ajouter une voix dans les réglages de votre système.', { language: langName })}
                </p>
              )}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800" htmlFor="read-highlight">
              <input id="read-highlight" type="checkbox" className="h-5 w-5" checked={r.prefs.highlight} onChange={(e) => r.setPrefs({ highlight: e.target.checked })} />
              {t('reader:highlight', 'Surligner le passage lu')}
            </label>
          </div>
          <p className="mt-3 text-sm text-slate-800" data-testid="read-position">
            {status === 'idle' ? t('reader:position.idle', 'Prêt à lire.')
              : t('reader:position.section', 'Section {{current}} sur {{total}}', { current: section + 1, total }) + (heading ? ` — ${heading}` : '')}
          </p>
          <p className="sr-only" aria-live="polite">{live}</p>
          {error ? <p className="mt-1 text-sm text-red-800" role="alert">{live}</p> : null}
          {skipped.length ? <p className="mt-1 text-sm text-amber-900" data-testid="read-skipped">{t('reader:skipped', 'Passages non lus faute de voix installée : {{languages}}.', { languages: skippedNames })}</p> : null}
          <p className="mt-2 text-xs text-slate-600">
            {t('reader:help', 'La voix est celle de votre appareil : AccesDirectAide n’envoie le texte à aucun service. Selon votre système, certaines voix fonctionnent en ligne chez leur fabricant. Ce lecteur ne remplace pas un lecteur d’écran.')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
