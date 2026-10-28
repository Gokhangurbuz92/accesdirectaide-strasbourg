import { Badge } from "@/components/ui/badge";

export function TrustBand() {
  const sources = ["CAF", "MSA", "France Travail", "CPAM", "Pôle Emploi"];

  return (
    <section className="border-y border-bt-border bg-bt-surface py-6">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6">
          <span className="text-sm font-medium text-bt-muted uppercase tracking-wide">
            Sources officielles :
          </span>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {sources.map((source) => (
              <Badge key={source}>{source}</Badge>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
