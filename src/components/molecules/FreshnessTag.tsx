import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { getFreshnessStatus, formatDateFR } from "@/lib/freshness";
import { cn } from "@/lib/utils";

export interface FreshnessTagProps {
    verifiedAt?: Date | string | null;
    now?: Date;
    sourceLabel?: string;
    sourceUrl?: string;
    unknownBehavior?: "label" | "hide";
    className?: string;
}

export function FreshnessTag({
    verifiedAt,
    now = new Date(),
    sourceLabel,
    sourceUrl,
    unknownBehavior = "hide",
    className
}: FreshnessTagProps) {
    const status = getFreshnessStatus(verifiedAt, now);

    if (status === "unknown" && unknownBehavior === "hide") {
        return null;
    }

    let formattedDate = "";
    if (verifiedAt) {
        const verifiedDate = typeof verifiedAt === 'string' ? new Date(verifiedAt) : verifiedAt;
        if (!isNaN(verifiedDate.getTime())) {
            formattedDate = formatDateFR(verifiedDate);
        }
    }

    return (
        <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid="aide-freshness-badge">
            {status === "fresh" && (
                <Badge variant="verified" className="shrink-0 pointer-events-none">
                    Vérifié le {formattedDate}
                </Badge>
            )}

            {status === "stale" && (
                <Badge variant="warning" className="shrink-0 pointer-events-none">
                    À actualiser (vérifié le {formattedDate})
                </Badge>
            )}

            {status === "unknown" && unknownBehavior === "label" && (
                <span className="text-muted-foreground text-sm italic">
                    Non vérifié
                </span>
            )}

            {sourceLabel && (
                <span className="text-muted-foreground text-sm">
                    Source : {" "}
                    {sourceUrl ? (
                        <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                        >
                            {sourceLabel}
                        </a>
                    ) : (
                        <span>{sourceLabel}</span>
                    )}
                </span>
            )}
        </div>
    );
}
