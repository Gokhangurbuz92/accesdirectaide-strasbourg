import type { Meta } from "@storybook/react";
import { useState } from "react";
import AidDetailLayout from "./AidDetailLayout";
import type { AidDetailLayoutProps, AidSection } from "./AidDetailLayout";
import FalcToggle from "@/components/features/falc/FalcToggle";
import type { ContentVariant, FalcContent } from "@/lib/falc";
import { hasFalc, getVariantContent } from "@/lib/falc";

const NOW = new Date("2026-02-20T00:00:00.000Z");

/* ──── Standard content ──── */
const STANDARD_SECTIONS: Array<{ id: string; title: string; content: string }> =
    [
        {
            id: "cest-quoi",
            title: "C\u2019est quoi\u00a0?",
            content:
                "L\u2019APL est une aide financière destinée à réduire le montant de votre loyer. Elle est versée directement au bailleur et déduite de votre loyer mensuel. Le montant dépend de vos ressources, de la composition de votre foyer et du lieu de votre logement.",
        },
        {
            id: "pour-qui",
            title: "Pour qui\u00a0?",
            content:
                "Locataires d\u2019un logement conventionné, résidents en foyer ou résidence sociale, accédants à la propriété sous conditions.",
        },
        {
            id: "documents",
            title: "Documents nécessaires",
            content:
                "Pièce d\u2019identité en cours de validité, avis d\u2019imposition (N-2), bail ou attestation de loyer, RIB, justificatif de situation familiale.",
        },
        {
            id: "comment-faire",
            title: "Comment faire\u00a0?",
            content:
                "Rendez-vous sur le site de la CAF. Créez un compte ou connectez-vous. Remplissez le formulaire de demande en ligne. Transmettez les justificatifs demandés.",
        },
    ];

/* ──── FALC content ──── */
const FALC_CONTENT: FalcContent = {
    title: "Aide pour payer votre loyer (APL)",
    summary: "L\u2019APL est une aide. Elle sert à payer votre loyer.",
    sections: [
        {
            id: "cest-quoi",
            title: "C\u2019est quoi\u00a0?",
            text: [
                "L\u2019APL est une aide pour payer votre loyer.",
                "La CAF verse cette aide.",
                "Le montant dépend de vos revenus.",
            ],
        },
        {
            id: "pour-qui",
            title: "Pour qui\u00a0?",
            text: [
                "Vous louez un logement conventionné.",
                "Vous vivez en foyer.",
                "Vous achetez un logement (sous conditions).",
            ],
        },
        {
            id: "documents",
            title: "Documents nécessaires",
            text: [
                "Votre pièce d\u2019identité.",
                "Votre avis d\u2019impôts.",
                "Votre bail (contrat de location).",
                "Votre RIB (coordonnées bancaires).",
            ],
        },
        {
            id: "comment-faire",
            title: "Comment faire\u00a0?",
            text: [
                "Allez sur le site de la CAF.",
                "Créez un compte.",
                "Remplissez le formulaire.",
                "Envoyez vos documents.",
            ],
        },
    ],
};

/* ──── Helper to build AidSection[] from variant ──── */
function toAidSections(
    raw: Array<{ id: string; title: string; content: string }>,
    collapsibleIds: string[] = ["documents", "comment-faire"],
): AidSection[] {
    return raw.map((s) => ({
        id: s.id,
        title: s.title,
        content: s.content,
        collapsible: collapsibleIds.includes(s.id),
    }));
}

/* ──── Story wrapper ──── */
function AidDetailWithFalc(props: {
    falcContent: FalcContent | null;
    layoutProps: Omit<AidDetailLayoutProps, "sections">;
}) {
    const falcAvailable = hasFalc(props.falcContent);
    const [variant, setVariant] = useState<ContentVariant>("standard");

    const resolved = getVariantContent({
        variant,
        standard: { title: props.layoutProps.title, summary: props.layoutProps.summary, sections: STANDARD_SECTIONS },
        falc: props.falcContent,
    });

    const sections = toAidSections(resolved.sections);

    return (
        <div className="space-y-0">
            <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
                <FalcToggle
                    enabled={falcAvailable}
                    value={variant}
                    onChange={setVariant}
                />
            </div>
            <AidDetailLayout
                {...props.layoutProps}
                title={resolved.title}
                summary={resolved.summary}
                sections={sections}
            />
        </div>
    );
}

const meta: Meta = {
    title: "Organisms/AidDetailLayout/FALC",
    tags: ["autodocs"],
};

export default meta;

/** FALC available — user can toggle between standard and FALC */
export const WithFalc = {
    render: () => (
        <AidDetailWithFalc
            falcContent={FALC_CONTENT}
            layoutProps={{
                title: "Aide personnalisée au logement (APL)",
                summary:
                    "Réduisez votre loyer grâce à cette aide versée directement à votre bailleur.",
                isUrgent: false,
                verifiedAt: new Date("2026-02-15T00:00:00.000Z"),
                sourceLabel: "CAF",
                sourceUrl: "https://www.caf.fr",
                now: NOW,
                primaryCta: {
                    label: "Faire ma demande",
                    href: "https://www.caf.fr/allocataires/mes-services-en-ligne/faire-une-demande-de-prestation",
                },
            }}
        />
    ),
};

/** FALC not available — toggle disabled + message */
export const WithoutFalc = {
    render: () => (
        <AidDetailWithFalc
            falcContent={null}
            layoutProps={{
                title: "Complémentaire santé solidaire (CSS)",
                summary:
                    "La CSS prend en charge la part complémentaire de vos dépenses de santé.",
                isUrgent: false,
                verifiedAt: new Date("2026-02-01T00:00:00.000Z"),
                sourceLabel: "Ameli",
                sourceUrl: "https://www.ameli.fr",
                now: NOW,
                primaryCta: {
                    label: "Faire ma demande",
                    href: "https://www.ameli.fr",
                },
            }}
        />
    ),
};
