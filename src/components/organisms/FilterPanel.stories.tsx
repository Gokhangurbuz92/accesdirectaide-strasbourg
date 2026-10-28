import type { Meta, StoryObj } from "@storybook/react";
import FilterPanel from "./FilterPanel";
import type { FilterState } from "./FilterPanel";
import { useState } from "react";

const INITIAL_FILTERS: FilterState = {
    search: "",
    category: "",
    urgentOnly: false,
};

function FilterPanelWrapper(props: { initial?: Partial<FilterState> }) {
    const [filters, setFilters] = useState<FilterState>({
        ...INITIAL_FILTERS,
        ...props.initial,
    });
    return (
        <FilterPanel
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(INITIAL_FILTERS)}
        />
    );
}

const meta: Meta = {
    title: "Organisms/FilterPanel",
    tags: ["autodocs"],
};

export default meta;

/** Default empty state */
export const Default = {
    render: () => <FilterPanelWrapper />,
};

/** With search query pre-filled */
export const WithSearch = {
    render: () => <FilterPanelWrapper initial={{ search: "logement" }} />,
};

/** With category selected */
export const WithCategory = {
    render: () => <FilterPanelWrapper initial={{ category: "sante" }} />,
};

/** Mobile viewport (375 px container) */
export const MobileWidth = {
    render: () => (
        <div style={{ maxWidth: 375 }}>
            <FilterPanelWrapper />
        </div>
    ),
};
