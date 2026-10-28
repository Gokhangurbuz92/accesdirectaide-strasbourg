
import SEO from '@/components/SEO';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Wizard from '@/components/assistant/Wizard';

export default function Orientation() {
  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title="Mon Assistant"
        description="Assistant d'orientation pour trouver les aides et démarches adaptées à votre situation."
        path="/orientation"
        noindex
      />
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="mb-2 text-3xl font-black text-slate-900 uppercase italic">Mon Assistant</h1>
        <p className="mb-6 text-slate-700 font-medium">
          Répondez à quelques questions pour recevoir des recommandations personnalisées.
        </p>

        <Wizard />

        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/aides">
            <Button variant="outline">Voir toutes les aides</Button>
          </Link>
          <Link to="/demarches">
            <Button variant="outline">Voir les demarches</Button>
          </Link>
          <Link to="/annuaire">
            <Button variant="outline" className="gap-2">
              Voir l&apos;annuaire
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
