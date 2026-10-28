import type { ReactNode } from "react";
import { FreshnessTag } from "@/components/molecules/FreshnessTag";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, ChevronDown } from "lucide-react";

export interface AidSection {
    id: string;
    title: string;
    content: ReactNode;
    /** If true, rendered inside a native disclosure (details/summary) */
    collapsible?: boolean;
}

export interface AidDetailLayoutProps {
    title: string;
    summary?: string;
    isUrgent?: boolean;
    verifiedAt?: Date | string | null;
    sourceLabel?: string;
    sourceUrl?: string;
    now?: Date;
    sections: AidSection[];
    primaryCta?: { label: string; href: string };
    secondaryCta?: { label: string; href: string };
    backHref?: string;
}

export default function AidDetailLayout({
    title,
    summary,
    isUrgent,
    verifiedAt,
    sourceLabel,
    sourceUrl,
    now,
    sections,
    primaryCta,
    secondaryCta,
    backHref = "/aides",
}: AidDetailLayoutProps) {
    const openSections = sections.filter((s) => !s.collapsible);
    const collapsibleSections = sections.filter((s) => s.collapsible);

    return (
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
            {/* Back link */}
            <a
                href={backHref}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Retour aux aides
            </a>

            {/* Header */}
            <header className="space-y-4">
                <div className="flex flex-wrap items-start gap-2">
                    <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
                        {title}
                    </h1>
                    {isUrgent && (
                        <Badge variant="destructive" className="shrink-0">
                            Urgent
                        </Badge>
                    )}
                </div>

                {summary && (
                    <p className="text-base leading-relaxed text-muted-foreground">
                        {summary}
                    </p>
                )}

                <FreshnessTag
                    verifiedAt={verifiedAt}
                    now={now}
                    sourceLabel={sourceLabel}
                    sourceUrl={sourceUrl}
                    unknownBehavior="hide"
                />
            </header>

            {/* CTAs */}
            {(primaryCta || secondaryCta) && (
                <nav aria-label="Actions" className="flex flex-wrap gap-3">
                    {primaryCta && (
                        <a
                            href={primaryCta.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {primaryCta.label}
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </a>
                    )}
                    {secondaryCta && (
                        <a
                            href={secondaryCta.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {secondaryCta.label}
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </a>
                    )}
                </nav>
            )}

            {/* Always-open sections */}
            {openSections.map((section) => (
                <div key={section.id}>
                    <h2
                        id={`section-${section.id}`}
                        className="mb-3 text-lg font-semibold text-foreground"
                    >
                        {section.title}
                    </h2>
                    <div className="text-sm leading-relaxed text-muted-foreground">
                        {section.content}
                    </div>
                </div>
            ))}

            {/* Collapsible sections — native <details>/<summary> */}
            {collapsibleSections.map((section) => (
                <details
                    key={section.id}
                    className="group rounded-lg border border-border bg-card"
                >
                    <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-lg font-semibold text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg [&::-webkit-details-marker]:hidden">
                        <span>{section.title}</span>
                        <ChevronDown
                            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                            aria-hidden="true"
                        />
                    </summary>
                    <div className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                        {section.content}
                    </div>
                </details>
            ))}

            {/* Source / provenance footer */}
            {sourceUrl && (
                <footer className="border-t border-border pt-6">
                    <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                    >
                        Consulter la source officielle
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                </footer>
            )}
            {!sourceUrl && sourceLabel && (
                <footer className="border-t border-border pt-6">
                    <p className="text-sm text-muted-foreground">
                        Source : {sourceLabel}
                    </p>
                </footer>
            )}
        </div>
    );
}
