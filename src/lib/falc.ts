/** Content variant: standard or FALC (Facile à Lire et à Comprendre) */
export type ContentVariant = "standard" | "falc";

/** FALC-specific content block */
export interface FalcSection {
    id: string;
    title: string;
    text: string | string[];
}

/** FALC content for an aide */
export interface FalcContent {
    title?: string;
    summary?: string;
    sections?: FalcSection[];
}

/** Returns true if meaningful FALC content exists */
export function hasFalc(content?: FalcContent | null): boolean {
    if (!content) return false;
    return !!(
        content.title ||
        content.summary ||
        (content.sections && content.sections.length > 0)
    );
}

export interface VariantContentArgs {
    variant: ContentVariant;
    standard: {
        title: string;
        summary?: string;
        sections: Array<{ id: string; title: string; content: string }>;
    };
    falc?: FalcContent | null;
}

/**
 * Returns the content to display based on the selected variant.
 * Falls back to standard if FALC is unavailable.
 */
export function getVariantContent(args: VariantContentArgs) {
    const { variant, standard, falc } = args;

    if (variant === "falc" && hasFalc(falc)) {
        const falcSections = (falc!.sections ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            content: Array.isArray(s.text) ? s.text.join("\n") : s.text,
        }));

        return {
            variant: "falc" as const,
            title: falc!.title ?? standard.title,
            summary: falc!.summary ?? standard.summary,
            sections: falcSections.length > 0 ? falcSections : standard.sections,
        };
    }

    return {
        variant: "standard" as const,
        title: standard.title,
        summary: standard.summary,
        sections: standard.sections,
    };
}
