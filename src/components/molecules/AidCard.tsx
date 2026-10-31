import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFreshnessStatus, formatDateFR } from "@/lib/freshness";
import { RecordProvenance, CardActionStrip } from "@/components/cards/RecordCardParts";
import { cn } from "@/lib/utils";

export interface AidCardProps {
    title: string;
    href: string;
    summary?: string;
    isUrgent?: boolean;
    verifiedAt?: Date | string | null;
    sourceLabel?: string;
    sourceUrl?: string;
    now?: Date;
    className?: string;
}

/**
 * R27: the aide card has the démarche card's structure — the whole card is the link, the same provenance line (« Vérifié le … · Source : … ») and the
 * same action strip (« Voir l'aide »). It used to show an uppercase « VÉRIFIÉ LE » pill and no action at all.
 */
export function AidCard({ title, href, summary, isUrgent, verifiedAt, sourceLabel, sourceUrl, now, className }: AidCardProps) {
    const status = getFreshnessStatus(verifiedAt, now ?? new Date());
    const date = verifiedAt ? new Date(verifiedAt) : null;
    const formatted = date && !Number.isNaN(date.getTime()) && status !== "unknown" ? formatDateFR(date) : undefined;
    return (
        <Card className={cn("group relative flex h-full flex-col overflow-hidden border-slate-200 bg-white transition-all hover:border-blue-300 hover:shadow-md", className)} data-testid="aide-card">
            <CardContent className="flex h-full flex-col p-0">
                <div className="flex flex-1 flex-col gap-3 p-6">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold leading-tight text-slate-900 group-hover:text-blue-800">
                            <Link
                                to={href}
                                data-testid="aide-card-link"
                                className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                            >
                                <span data-testid="aide-title">{title}</span>
                            </Link>
                        </h3>
                        {isUrgent && (
                            <Badge variant="destructive" className="pointer-events-none shrink-0">Urgent</Badge>
                        )}
                    </div>
                    {summary && <p className="line-clamp-3 text-sm text-slate-600">{summary}</p>}
                    <div className="mt-auto pt-2" data-testid="aide-freshness-badge">
                        <RecordProvenance verifiedAt={formatted} sourceHost={sourceLabel} sourceUrl={sourceUrl} stale={status === "stale"} />
                    </div>
                </div>
                <CardActionStrip label="Voir l’aide" />
            </CardContent>
        </Card>
    );
}
