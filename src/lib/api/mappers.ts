/**
 * Mappers: API response → UI view-models.
 *
 * These functions translate the API shapes (ApiAideListItem / ApiAideDetail)
 * into the prop shapes expected by AidCard and AidDetailLayout.
 *
 * Rules:
 *   - Dates are normalized via trust/normalize (future-clamped, parsed safely)
 *   - Missing fields → null/undefined (never "Non renseigné")
 *   - sourceLabel comes from provenance.sourceHost (domain name)
 *   - Invalid URLs → null
 */

import type { ApiAideListItem, ApiAideDetail } from "@/types/api";
import { buildProvenance } from "@/lib/trust/normalize";

// ---------------------------------------------------------------------------
// View-model types (match AidCardProps / AidDetailLayoutProps without React)
// ---------------------------------------------------------------------------

export interface AidCardViewModel {
    title: string;
    href: string;
    summary?: string;
    isUrgent?: boolean;
    verifiedAt?: string | null;
    sourceLabel?: string;
    sourceUrl?: string;
}

export interface AidDetailSection {
    id: string;
    title: string;
    /** Raw HTML/text content — will be rendered by AidDetailLayout */
    content: string;
    collapsible?: boolean;
}

export interface AidDetailViewModel {
    title: string;
    summary?: string;
    isUrgent?: boolean;
    verifiedAt?: string | null;
    sourceLabel?: string;
    sourceUrl?: string;
    sections: AidDetailSection[];
    primaryCta?: { label: string; href: string };
    secondaryCta?: { label: string; href: string };
    backHref: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHref(slug: string | null): string {
    if (!slug) return "/aides";
    return `/aides/${encodeURIComponent(slug)}`;
}

/**
 * Pick the best available summary text.
 * Prefer summary_falc (accessible), fall back to cest_quoi.
 */
function pickSummary(
    summaryFalc: string | null | undefined,
    cestQuoi: string | null | undefined,
): string | undefined {
    const text = summaryFalc || cestQuoi;
    return text || undefined;
}

// ---------------------------------------------------------------------------
// Card mapper
// ---------------------------------------------------------------------------

export function mapAideToCard(item: ApiAideListItem): AidCardViewModel {
    const prov = buildProvenance(item.provenance, item.date_verification);

    return {
        title: item.titre,
        href: buildHref(item.slug),
        summary: pickSummary(item.summary_falc, item.cest_quoi),
        isUrgent: item.est_urgent || undefined,
        verifiedAt: prov.verifiedAt,
        sourceLabel: prov.sourceLabel ?? undefined,
        sourceUrl: prov.sourceUrl ?? undefined,
    };
}

// ---------------------------------------------------------------------------
// Detail mapper
// ---------------------------------------------------------------------------

/**
 * Format étapes (stored as JSON) into a readable string.
 * The backend stores étapes as either a JSON array of strings,
 * an array of objects with `label` field, or a raw string.
 */
function formatEtapes(etapes: unknown): string | null {
    if (!etapes) return null;

    if (typeof etapes === "string") return etapes;

    if (Array.isArray(etapes)) {
        const lines = etapes.map((step, i) => {
            if (typeof step === "string") return `${i + 1}. ${step}`;
            if (step && typeof step === "object" && "label" in step) {
                return `${i + 1}. ${(step as { label: string }).label}`;
            }
            return `${i + 1}. ${String(step)}`;
        });
        return lines.join("\n");
    }

    return String(etapes);
}

export function mapAideToDetail(item: ApiAideDetail): AidDetailViewModel {
    const sections: AidDetailSection[] = [];

    // Build sections from available fields — skip if empty
    if (item.cest_quoi) {
        sections.push({
            id: "cest-quoi",
            title: "C'est quoi ?",
            content: item.cest_quoi,
        });
    }

    if (item.pour_qui) {
        sections.push({
            id: "pour-qui",
            title: "Pour qui ?",
            content: item.pour_qui,
        });
    }

    if (item.ce_que_ca_aide) {
        sections.push({
            id: "ce-que-ca-aide",
            title: "Ce que ça aide",
            content: item.ce_que_ca_aide,
        });
    }

    if (item.montant_falc) {
        sections.push({
            id: "montant",
            title: "Montant",
            content: item.montant_falc,
        });
    }

    if (item.conditions_falc) {
        sections.push({
            id: "conditions",
            title: "Conditions",
            content: item.conditions_falc,
        });
    }

    if (item.documents_necessaires && item.documents_necessaires.length > 0) {
        sections.push({
            id: "documents",
            title: "Documents nécessaires",
            content: item.documents_necessaires.map((d: string) => `• ${d}`).join("\n"),
            collapsible: true,
        });
    }

    const formattedEtapes = formatEtapes(item.etapes);
    if (formattedEtapes) {
        sections.push({
            id: "etapes",
            title: "Étapes",
            content: formattedEtapes,
            collapsible: true,
        });
    }

    if (item.ou_demander) {
        sections.push({
            id: "ou-demander",
            title: "Où demander ?",
            content: item.ou_demander,
            collapsible: true,
        });
    }

    if (item.delai_indicatif) {
        sections.push({
            id: "delai",
            title: "Délai indicatif",
            content: item.delai_indicatif,
            collapsible: true,
        });
    }

    // Primary CTA: link to make a request
    const primaryCta = item.lien_demande
        ? { label: "Faire la demande", href: item.lien_demande }
        : undefined;

    const prov = buildProvenance(item.provenance, item.date_verification);

    return {
        title: item.titre,
        summary: pickSummary(item.summary_falc, item.cest_quoi),
        isUrgent: item.est_urgent || undefined,
        verifiedAt: prov.verifiedAt,
        sourceLabel: prov.sourceLabel ?? undefined,
        sourceUrl: prov.sourceUrl ?? undefined,
        sections,
        primaryCta,
        backHref: "/aides",
    };
}
