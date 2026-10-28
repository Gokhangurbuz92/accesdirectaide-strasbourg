import type { Meta, StoryObj } from "@storybook/react";
import HeroSearch from "./HeroSearch";

const meta = {
    title: "Organisms/HeroSearch",
    component: HeroSearch,
    tags: ["autodocs"],
    // MemoryRouter is provided globally by .storybook/preview.ts — no need here
} satisfies Meta<typeof HeroSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default state with standard copy */
export const Default: Story = {};

/** Simulates a narrow mobile viewport (375 px) */
export const Mobile: Story = {
    decorators: [
        (Story) => (
            <div style={{ maxWidth: 375 }}>
                <Story />
            </div>
        ),
    ],
};

/** Stress-test with long title and placeholder */
export const LongText: Story = {
    args: {
        title:
            "Trouvez rapidement une aide adaptée à votre situation personnelle, familiale et professionnelle.",
        subtitle:
            "Aides financières, démarches administratives, structures d\u2019accompagnement social et médico-social\u00a0— toutes les informations sourcées et mises à jour.",
        placeholder:
            "Allocation adultes handicapés, aide personnalisée au logement, complémentaire santé solidaire\u2026",
    },
};
