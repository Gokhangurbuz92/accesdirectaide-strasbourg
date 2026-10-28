import type { Meta, StoryObj } from "@storybook/react";
import AidGrid from "./AidGrid";
import type { AidGridProps } from "./AidGrid";

const NOW = new Date("2026-02-20T00:00:00.000Z");

const MOCK_ITEMS: AidGridProps["items"] = [
    {
        title: "Aide personnalisée au logement (APL)",
        href: "/aides/apl",
        summary:
            "L\u2019APL est une aide financière destinée à réduire le montant de votre loyer ou de votre redevance en foyer.",
        isUrgent: false,
        verifiedAt: new Date("2026-02-10T00:00:00.000Z"),
        sourceLabel: "CAF",
        sourceUrl: "https://www.caf.fr",
        now: NOW,
    },
    {
        title: "Aide d\u2019urgence hébergement",
        href: "/aides/urgence-hebergement",
        summary:
            "Dispositif d\u2019hébergement d\u2019urgence pour les personnes sans domicile fixe.",
        isUrgent: true,
        verifiedAt: new Date("2026-01-28T00:00:00.000Z"),
        sourceLabel: "SIAO",
        sourceUrl: "https://www.siao.fr",
        now: NOW,
    },
    {
        title: "Complémentaire santé solidaire (CSS)",
        href: "/aides/css",
        summary:
            "La CSS prend en charge la part complémentaire de vos dépenses de santé.",
        isUrgent: false,
        verifiedAt: new Date("2026-02-01T00:00:00.000Z"),
        sourceLabel: "Ameli",
        sourceUrl: "https://www.ameli.fr",
        now: NOW,
    },
];

const meta = {
    title: "Organisms/AidGrid",
    component: AidGrid,
    tags: ["autodocs"],
} satisfies Meta<typeof AidGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Grid with 3 items */
export const WithItems: Story = {
    args: {
        items: MOCK_ITEMS,
        hasActiveFilters: false,
    },
};

/** Empty with active filters → shows EmptyState */
export const EmptyWithActiveFilters: Story = {
    args: {
        items: [],
        hasActiveFilters: true,
        onReset: () => { },
    },
};

/** Empty without active filters → neutral text, NOT EmptyState */
export const EmptyWithoutActiveFilters: Story = {
    args: {
        items: [],
        hasActiveFilters: false,
    },
};

/** Mobile viewport (375 px) — single column, full width */
export const MobileWidth: Story = {
    args: {
        items: MOCK_ITEMS,
        hasActiveFilters: false,
    },
    decorators: [
        (Story) => (
            <div style={{ maxWidth: 375 }}>
                <Story />
            </div>
        ),
    ],
};

// ---------------------------------------------------------------------------
// Page-level state demos (loading / error)
// These render the same skeleton/error patterns used in Aides.jsx
// ---------------------------------------------------------------------------

/** Loading state — skeleton cards as shown on the real page */
export const Loading: Story = {
    args: { items: [], hasActiveFilters: false },
    render: () => (
        <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6].map((value) => (
                <div key={value} className="rounded-xl border border-border bg-card p-5 animate-pulse">
                    <div className="h-4 w-24 rounded bg-muted" />
                    <div className="mt-3 h-5 w-3/4 rounded bg-muted" />
                    <div className="mt-2 h-4 w-full rounded bg-muted" />
                    <div className="mt-2 h-4 w-2/3 rounded bg-muted" />
                </div>
            ))}
        </div>
    ),
};

/** Error state — error banner with retry button as shown on the real page */
export const Error: Story = {
    args: { items: [], hasActiveFilters: false },
    render: () => (
        <div
            className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-destructive"
            role="alert"
        >
            <h2 className="text-lg font-semibold">Impossible de charger les aides</h2>
            <p className="mt-2 text-sm">
                Impossible de charger les aides. Réessayez.
            </p>
            <button
                type="button"
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                onClick={() => alert("Refetch triggered")}
            >
                ↻ Réessayer
            </button>
        </div>
    ),
};
