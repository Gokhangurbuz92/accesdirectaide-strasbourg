// @ts-nocheck
import { htmlToPlainText } from '@/lib/htmlText';

export default function FalcSummary({
  text,
  title = "Résumé facile à lire",
  className = "",
}) {
  const value = typeof text === "string" ? htmlToPlainText(text).trim() : "";
  if (!value) return null;

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${className}`}
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
          FALC
        </span>
      </div>
      <div className="mt-3 whitespace-pre-wrap leading-relaxed text-slate-900">
        {value}
      </div>
    </section>
  );
}
