// @ts-nocheck
import { htmlToPlainText } from '@/lib/htmlText';
import { useT } from '@/i18n';

/** R32: the summary is simplified French (FALC): its text stays in French (lang="fr"); the default title says so in the other languages. */
export default function FalcSummary({
  text,
  title = undefined,
  className = "",
}) {
  const { t } = useT('shared');
  const value = typeof text === "string" ? htmlToPlainText(text).trim() : "";
  if (!value) return null;
  const heading = title ?? t('shared:falc.summary.title', 'Résumé facile à lire');

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${className}`}
      aria-label={heading}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{heading}</h2>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
          FALC
        </span>
      </div>
      <div className="mt-3 whitespace-pre-wrap leading-relaxed text-slate-900" lang="fr" dir="ltr">
        {value}
      </div>
    </section>
  );
}
