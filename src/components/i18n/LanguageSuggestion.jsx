import { useEffect, useState } from 'react';
import { LANGUAGE_EVENT, SOURCE_LANGUAGE, STORAGE_KEY, browserLanguage, languageOf, loadLanguage, setLanguage, storedLanguage, useLanguage } from '@/i18n';
import i18n from '@/i18n';

/**
 * R32 — when the browser prefers one of our languages other than French and the visitor has not chosen yet, a one-line offer in THAT language:
 * « This site is also available in English — Switch / Stay in French ». The site never switches by itself (French is the authoritative language and
 * the visitor may read it well). Either answer is remembered (localStorage « ada_lang »), so the offer appears once. Not a dialog: no focus trap,
 * nothing covers the page, no announcement interrupts a screen reader.
 */
export default function LanguageSuggestion() {
  const { code } = useLanguage();
  const [offer, setOffer] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    const suggested = browserLanguage();
    if (!suggested || storedLanguage() || code !== SOURCE_LANGUAGE) return undefined;
    let alive = true;
    loadLanguage(suggested).then(() => { if (alive) setOffer(suggested); }).catch(() => {});
    return () => { alive = false; };
  }, [code]);
  useEffect(() => {
    const close = () => setOffer(null);
    window.addEventListener(LANGUAGE_EVENT, close);
    return () => window.removeEventListener(LANGUAGE_EVENT, close);
  }, []);

  if (!offer || code !== SOURCE_LANGUAGE) return null;
  const l = languageOf(offer);
  // the offer is written in the suggested language (fixedT), with the French default as a fallback
  const t = i18n.getFixedT(offer, 'common');
  const stay = () => { try { window.localStorage.setItem(STORAGE_KEY, SOURCE_LANGUAGE); } catch { /* private browsing */ } setOffer(null); };
  return (
    <div className="border-b border-sky-200 bg-sky-50" data-testid="language-suggestion" lang={offer} dir={l?.dir}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm text-sky-950">
        <p>{t('common:suggestion.text', 'Ce site existe aussi en {{language}}.', { language: l?.name })}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-md bg-brand-primary px-3 py-1 font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary"
            onClick={() => { void setLanguage(offer); }}>
            {t('common:suggestion.switch', 'Passer en {{language}}', { language: l?.name })}
          </button>
          <button type="button" className="min-h-11 rounded-md border border-sky-300 bg-white px-3 py-1 text-sky-950 focus:outline-none focus:ring-2 focus:ring-brand-primary" onClick={stay}>
            {t('common:suggestion.stay', 'Rester en français')}
          </button>
        </div>
      </div>
    </div>
  );
}
