import type { Meta, StoryObj } from "@storybook/react";
import ProvenancePanel from "./ProvenancePanel";

const NOW = new Date("2026-02-20T00:00:00.000Z");

const meta = {
    title: "Organisms/ProvenancePanel",
    component: ProvenancePanel,
    tags: ["autodocs"],
} satisfies Meta<typeof ProvenancePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fresh — all data present */
export const FreshComplete: Story = {
    args: {
        verifiedAt: new Date("2026-02-15T00:00:00.000Z"),
        collectedAt: new Date("2026-02-18T00:00:00.000Z"),
        sourceLabel: "CAF",
        sourceUrl: "https://www.caf.fr",
        now: NOW,
    },
};

/** Stale — old verification date */
export const StaleComplete: Story = {
    args: {
        verifiedAt: new Date("2025-06-01T00:00:00.000Z"),
        collectedAt: new Date("2026-01-10T00:00:00.000Z"),
        sourceLabel: "SIAO",
        sourceUrl: "https://www.siao.fr",
        now: NOW,
    },
};

/** Unknown — both dates null, policy=label → date lines hidden (policy default is now "hide") */
export const UnknownDates: Story = {
    args: {
        verifiedAt: null,
        collectedAt: null,
        sourceLabel: "Ameli",
        sourceUrl: "https://www.ameli.fr",
        now: NOW,
        policy: { missingDate: "label" },
    },
};

/** Unknown — both dates null, policy=hide → lines hidden */
export const UnknownDatesHidden: Story = {
    args: {
        verifiedAt: null,
        collectedAt: null,
        sourceLabel: "MSA",
        sourceUrl: "https://www.msa.fr",
        now: NOW,
        policy: { missingDate: "hide" },
    },
};

/** No source URL — sourceLabel only (muted text) */
export const NoSourceUrl: Story = {
    args: {
        verifiedAt: new Date("2026-02-10T00:00:00.000Z"),
        collectedAt: new Date("2026-02-12T00:00:00.000Z"),
        sourceLabel: "Mairie de Strasbourg",
        now: NOW,
    },
};
