import { getFreshnessStatus, type FreshnessStatus } from "@/lib/freshness";
import {
    resolveDateDisplay,
    DEFAULT_TRUST_POLICY,
    type TrustDisplayPolicy,
} from "@/lib/trust";
import { ExternalLink, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

export interface ProvenancePanelProps {
    verifiedAt?: Date | string | null;
    collectedAt?: Date | string | null;
    sourceLabel?: string;
    sourceUrl?: string;
    status?: FreshnessStatus;
    policy?: TrustDisplayPolicy;
    now?: Date;
    /** Heading level — use "h2" on detail page, "h3" in sidebar */
    as?: "h2" | "h3";
}

const STATUS_CONFIG: Record<
    FreshnessStatus,
    { icon: typeof ShieldCheck; label: string }
> = {
    fresh: {
        icon: ShieldCheck,
        label: "Source vérifiée récemment",
    },
    stale: {
        icon: ShieldAlert,
        label: "Vérification ancienne",
    },
    unknown: {
        icon: ShieldQuestion,
        label: "Statut de vérification inconnu",
    },
};

export default function ProvenancePanel({
    verifiedAt,
    collectedAt,
    sourceLabel,
    sourceUrl,
    status,
    policy = DEFAULT_TRUST_POLICY,
    now,
    as: Heading = "h2",
}: ProvenancePanelProps) {
    const computedStatus =
        status ?? getFreshnessStatus(verifiedAt, now ?? new Date());
    const cfg = STATUS_CONFIG[computedStatus];
    const StatusIcon = cfg.icon;

    const verifiedDisplay = resolveDateDisplay(verifiedAt, policy.missingDate);
    const collectedDisplay = resolveDateDisplay(collectedAt, policy.missingDate);

    const hasDateRows = verifiedDisplay !== null || collectedDisplay !== null;
    const hasSourceRow = !!(sourceUrl || sourceLabel);

    return (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
                <StatusIcon
                    className="h-5 w-5 text-muted-foreground"
                    aria-hidden="true"
                />
                <Heading className="text-sm font-semibold text-foreground">
                    Provenance et fraîcheur
                </Heading>
            </div>

            <p className="text-xs font-medium text-muted-foreground">{cfg.label}</p>

            {hasDateRows && (
                <dl className="space-y-2 text-sm">
                    {verifiedDisplay !== null && (
                        <div className="flex justify-between">
                            <dt className="text-muted-foreground">Dernière vérification</dt>
                            <dd className="font-medium text-foreground">
                                {verifiedDisplay}
                            </dd>
                        </div>
                    )}
                    {collectedDisplay !== null && (
                        <div className="flex justify-between">
                            <dt className="text-muted-foreground">Dernière collecte</dt>
                            <dd className="font-medium text-foreground">
                                {collectedDisplay}
                            </dd>
                        </div>
                    )}
                </dl>
            )}

            {sourceUrl && (
                <div className="pt-1">
                    <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                    >
                        Consulter la source officielle
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                </div>
            )}
            {!sourceUrl && sourceLabel && (
                <p className="text-sm text-muted-foreground">
                    Source : {sourceLabel}
                </p>
            )}
        </div>
    );
}
