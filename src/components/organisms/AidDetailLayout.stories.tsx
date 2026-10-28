import type { Meta, StoryObj } from "@storybook/react";
import AidDetailLayout from "./AidDetailLayout";
import type { AidDetailLayoutProps } from "./AidDetailLayout";
import type React from "react";

const NOW = new Date("2026-02-20T00:00:00.000Z");

const BASE_SECTIONS: AidDetailLayoutProps["sections"] = [
    {
        id: "cest-quoi",
        title: "C\u2019est quoi\u00a0?",
        content: (
            <p>
                L&apos;APL est une aide financière destinée à réduire le montant de votre
                loyer. Elle est versée directement au bailleur et déduite de votre loyer
                mensuel. Le montant dépend de vos ressources, de la composition de votre
                foyer et du lieu de votre logement.
            </p>
        ),
    },
    {
        id: "pour-qui",
        title: "Pour qui\u00a0?",
        content: (
            <ul className="list-disc space-y-1 pl-5">
                <li>Locataires d&apos;un logement conventionné</li>
                <li>Résidents en foyer ou résidence sociale</li>
                <li>Accédants à la propriété (sous conditions)</li>
            </ul>
        ),
    },
    {
        id: "documents",
        title: "Documents nécessaires",
        collapsible: true,
        content: (
            <ul className="list-disc space-y-1 pl-5">
                <li>Pièce d&apos;identité en cours de validité</li>
                <li>Avis d&apos;imposition (N-2)</li>
                <li>Bail ou attestation de loyer</li>
                <li>RIB</li>
                <li>Justificatif de situation familiale</li>
            </ul>
        ),
    },
    {
        id: "comment-faire",
        title: "Comment faire\u00a0?",
        collapsible: true,
        content: (
            <ol className="list-decimal space-y-2 pl-5">
                <li>
                    Rendez-vous sur le site de la CAF ou de la MSA selon votre régime.
                </li>
                <li>
                    Créez un compte ou connectez-vous à votre espace personnel.
                </li>
                <li>Remplissez le formulaire de demande en ligne.</li>
                <li>
                    Transmettez les justificatifs demandés (bail, avis d&apos;imposition).
                </li>
                <li>Suivez l&apos;avancement de votre dossier depuis votre espace.</li>
            </ol>
        ),
    },
];

const meta = {
    title: "Organisms/AidDetailLayout",
    component: AidDetailLayout,
    tags: ["autodocs"],
} satisfies Meta<typeof AidDetailLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default — verified recently */
export const Default: Story = {
    args: {
        title: "Aide personnalisée au logement (APL)",
        summary:
            "Réduisez votre loyer grâce à cette aide versée directement à votre bailleur.",
        isUrgent: false,
        verifiedAt: new Date("2026-02-15T00:00:00.000Z"),
        sourceLabel: "CAF",
        sourceUrl: "https://www.caf.fr/allocataires/droits-et-prestations/s-informer-sur-les-aides/logement-et-cadre-de-vie/les-aides-personnelles-au-logement",
        now: NOW,
        sections: BASE_SECTIONS,
        primaryCta: {
            label: "Faire ma demande",
            href: "https://www.caf.fr/allocataires/mes-services-en-ligne/faire-une-demande-de-prestation",
        },
        secondaryCta: {
            label: "Simuler mes droits",
            href: "https://www.caf.fr/allocataires/mes-services-en-ligne/faire-une-simulation",
        },
        backHref: "/aides",
    },
};

/** Urgent + stale verification date */
export const UrgentAndStale: Story = {
    args: {
        ...Default.args,
        title: "Aide d\u2019urgence hébergement",
        summary:
            "Dispositif d\u2019hébergement d\u2019urgence pour les personnes sans domicile fixe.",
        isUrgent: true,
        verifiedAt: new Date("2025-06-01T00:00:00.000Z"),
        sourceLabel: "SIAO",
        sourceUrl: "https://www.siao.fr",
        now: NOW,
        sections: BASE_SECTIONS,
    },
};

/** No verification date — FreshnessTag hidden via unknownBehavior=hide */
export const UnknownDate: Story = {
    args: {
        ...Default.args,
        title: "Prime d\u2019activité",
        summary:
            "La prime d\u2019activité complète les revenus des travailleurs modestes.",
        verifiedAt: null,
        sourceLabel: "CAF",
        sourceUrl: undefined,
        now: NOW,
        sections: BASE_SECTIONS,
    },
};

/** Mobile width (375 px) */
export const MobileWidth: Story = {
    args: {
        ...Default.args,
    },
    decorators: [
        (Story: () => React.ReactNode) => (
            <div style={{ maxWidth: 375 }}>
                <Story />
            </div>
        ),
    ],
};
