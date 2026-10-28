export type FreshnessStatus = "fresh" | "stale" | "unknown";

export function getFreshnessStatus(verifiedAt?: Date | string | null, now: Date = new Date()): FreshnessStatus {
    if (!verifiedAt) return "unknown";

    const verifiedDate = typeof verifiedAt === 'string' ? new Date(verifiedAt) : verifiedAt;

    if (isNaN(verifiedDate.getTime())) {
        return "unknown";
    }

    const diffTime = now.getTime() - verifiedDate.getTime();
    const diffDays = diffTime / (1000 * 3600 * 24);

    if (diffDays >= 183) {
        return "stale";
    }

    return "fresh";
}

export function formatDateFR(date: Date): string {
    return new Intl.DateTimeFormat('fr-FR').format(date);
}
