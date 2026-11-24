import { cn } from "@/lib/utils";

/** a colour passed in className replaces the neutral base (tailwind-merge): before, the base bg could win by CSS order (« Personnes âgées » showed grey) */
export function Badge({
  className = "",
  ...props
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-bt-border bg-bt-background " +
        "px-2 py-0.5 text-[12px] font-mono font-medium tracking-[0.05em] uppercase text-bt-ink",
        className
      )}
      {...props}
    />
  );
}
