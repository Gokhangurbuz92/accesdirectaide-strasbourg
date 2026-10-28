import type { ContentVariant } from "@/lib/falc";

export interface FalcToggleProps {
    /** Whether FALC content is available */
    enabled: boolean;
    /** Current variant */
    value: ContentVariant;
    /** Called when the user toggles */
    onChange: (next: ContentVariant) => void;
}

export default function FalcToggle({
    enabled,
    value,
    onChange,
}: FalcToggleProps) {
    const isActive = value === "falc";

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    aria-label="Version facile à lire"
                    disabled={!enabled}
                    onClick={() => onChange(isActive ? "standard" : "falc")}
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                        backgroundColor: isActive
                            ? "hsl(var(--primary))"
                            : "hsl(var(--muted))",
                    }}
                >
                    <span
                        className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200"
                        style={{
                            transform: isActive ? "translateX(1.25rem)" : "translateX(0)",
                        }}
                    />
                </button>
                <span className="text-sm font-medium text-foreground">
                    Version facile à lire
                </span>
            </div>

            {enabled ? (
                <p className="text-xs text-muted-foreground">
                    Simplifie le texte, sans changer les informations importantes.
                </p>
            ) : (
                <p className="text-xs text-muted-foreground">
                    Version facile à lire indisponible pour cette fiche.
                </p>
            )}
        </div>
    );
}
