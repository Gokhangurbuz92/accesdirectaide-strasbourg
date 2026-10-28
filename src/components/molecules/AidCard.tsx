import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FreshnessTag } from "./FreshnessTag";
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

export function AidCard({
    title,
    href,
    summary,
    isUrgent,
    verifiedAt,
    sourceLabel,
    sourceUrl,
    now,
    className,
}: AidCardProps) {
    return (
        <Card className={cn("flex flex-col h-full bg-card text-card-foreground border-border", className)} data-testid="aide-card">
            <CardHeader className="gap-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg font-semibold leading-tight text-foreground">
                        <Link
                            to={href}
                            data-testid="aide-card-link"
                            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                        >
                            <span data-testid="aide-title">{title}</span>
                        </Link>
                    </CardTitle>
                    {isUrgent && (
                        <Badge variant="destructive" className="shrink-0 pointer-events-none">
                            Urgent
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 flex-1">
                {summary && (
                    <CardDescription className="text-sm text-muted-foreground line-clamp-3">
                        {summary}
                    </CardDescription>
                )}

                <div className="mt-auto pt-4 border-t border-border">
                    <FreshnessTag
                        verifiedAt={verifiedAt}
                        now={now}
                        sourceLabel={sourceLabel}
                        sourceUrl={sourceUrl}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
