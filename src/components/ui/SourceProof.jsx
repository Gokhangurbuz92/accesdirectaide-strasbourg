// @ts-nocheck
import { ShieldCheck } from "lucide-react";

export function SourceProof({
  publisher = "Source officielle",
  date,
  url,
  className = "",
}) {
  const formattedDate = date
    ? new Date(date).toLocaleDateString("fr-FR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : null;

  const content = (
    <div
      className={`inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.05em] text-bt-muted ${className}`}
    >
      <ShieldCheck className="h-4 w-4 text-bt-accent" aria-hidden="true" />
      <span>
        SOURCE : {publisher}
        {formattedDate && ` • VÉRIFIÉ LE ${formattedDate}`}
      </span>
    </div>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bt-accent focus-visible:ring-offset-2 ring-offset-bt-surface rounded-sm"
      >
        {content}
      </a>
    );
  }

  return content;
}
