import type { Meta, StoryObj } from "@storybook/react";
import FalcToggle from "./FalcToggle";
import { useState } from "react";
import type { ContentVariant } from "@/lib/falc";

function FalcToggleWrapper(props: {
    enabled: boolean;
    initial?: ContentVariant;
}) {
    const [value, setValue] = useState<ContentVariant>(
        props.initial ?? "standard",
    );
    return (
        <FalcToggle enabled={props.enabled} value={value} onChange={setValue} />
    );
}

const meta: Meta = {
    title: "Features/FALC/Toggle",
    tags: ["autodocs"],
};

export default meta;

/** Toggle enabled, starting in standard mode */
export const EnabledStandard = {
    render: () => <FalcToggleWrapper enabled initial="standard" />,
};

/** Toggle enabled, starting in FALC mode */
export const EnabledFalc = {
    render: () => <FalcToggleWrapper enabled initial="falc" />,
};

/** Toggle disabled — FALC unavailable */
export const DisabledUnavailable = {
    render: () => <FalcToggleWrapper enabled={false} initial="standard" />,
};
