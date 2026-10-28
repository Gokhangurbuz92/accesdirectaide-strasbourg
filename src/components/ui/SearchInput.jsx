import { Search } from "lucide-react";

export function SearchInput({
  placeholder = "Rechercher une aide, une démarche...",
  showCommandHint = false,
  className = "",
  ...props
}) {
  return (
    <div className={`relative ${className}`}>
      <Search
        className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-bt-muted"
        aria-hidden="true"
      />
      <input
        type="search"
        placeholder={placeholder}
        className={
          "w-full h-16 pl-12 pr-4 rounded-xl border border-bt-border bg-bt-surface shadow-subtle " +
          "text-bt-ink placeholder:text-bt-muted " +
          "transition-all duration-240 ease-apple " +
          "focus:outline-none focus:ring-2 focus:ring-bt-accent focus:ring-offset-2 focus:shadow-float " +
          "motion-reduce:transform-none motion-reduce:transition-none"
        }
        {...props}
      />
      {showCommandHint && (
        <kbd className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-mono text-bt-muted border border-bt-border rounded bg-bt-background">
          ⌘K
        </kbd>
      )}
    </div>
  );
}
