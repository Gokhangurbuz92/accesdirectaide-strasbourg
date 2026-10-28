import { SearchInput } from "@/components/ui/SearchInput";

export function Hero() {
  return (
    <section className="relative bg-bt-background bg-blueprint-grid bg-[size:40px_40px] py-20 md:py-32">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          {/* Heading */}
          <h1 className="font-heading font-extrabold text-4xl md:text-5xl lg:text-6xl text-bt-ink leading-tight">
            Vos droits, clarifiés et sourcés.
          </h1>

          {/* Subheading */}
          <p className="text-lg md:text-xl text-bt-muted max-w-2xl mx-auto">
            Trouvez les aides sociales, préparez vos démarches et prenez rendez-vous avec des structures d'accompagnement.
          </p>

          {/* Search */}
          <div className="max-w-2xl mx-auto">
            <SearchInput
              placeholder="Rechercher une aide, une démarche..."
              showCommandHint={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
