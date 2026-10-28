import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

// R18: each situation opens the search on its own words (aides, démarches and lieux d'accueil); every tile used to open the same unfiltered list of aides
const categories = [['Étudiant', 'étudiant'], ['Travail', 'emploi'], ['Handicap', 'handicap'], ['Famille', 'famille'], ['Senior', 'personnes âgées'], ['Étranger', 'étranger'],
  ['Logement', 'logement'], ['Santé', 'santé']];

export default function CategoriesSection() {
  return (
    <section className="py-14 lg:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-3xl font-bold text-slate-900">Quelle est votre situation ?</h2>
        <p className="mt-3 max-w-3xl text-slate-700">
          Nous avons organisé les dispositifs par situation pour vous aider à accéder plus vite aux informations utiles.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.map(([category, query]) => (
            <Link
              key={category}
              to={`/recherche?q=${encodeURIComponent(query)}`}
              className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-500 hover:bg-blue-50/30"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{category}</p>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition group-hover:bg-blue-600 group-hover:text-white">
                  <ChevronRight className="h-4 w-4 transition group-hover:rotate-90" />
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-700">Voir les aides et les lieux d’aide →</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
