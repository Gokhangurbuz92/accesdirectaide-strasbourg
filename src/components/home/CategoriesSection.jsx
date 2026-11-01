import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useT } from '@/i18n';

import { SITUATIONS as categories } from '@/config/situations';   // R18: each situation opens the search on its own words

/** R32: the name of a situation in the interface language. Its search words stay the French ones: the catalogue is searched in French. */
function situationLabel(t, label) {
  switch (label) {
    case 'Étudiant': return t('home:situations.student', 'Étudiant');
    case 'Travail': return t('home:situations.work', 'Travail');
    case 'Handicap': return t('home:situations.disability', 'Handicap');
    case 'Famille': return t('home:situations.family', 'Famille');
    case 'Senior': return t('home:situations.senior', 'Senior');
    case 'Étranger': return t('home:situations.foreigner', 'Étranger');
    case 'Logement': return t('home:situations.housing', 'Logement');
    case 'Santé': return t('home:situations.health', 'Santé');
    default: return label;
  }
}

export default function CategoriesSection() {
  const { t } = useT('home');
  return (
    <section className="py-14 lg:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-3xl font-bold text-slate-900">{t('home:situations.title', 'Quelle est votre situation ?')}</h2>
        <p className="mt-3 max-w-3xl text-slate-700">
          {t('home:situations.intro', 'Nous avons organisé les dispositifs par situation pour vous aider à accéder plus vite aux informations utiles.')}
        </p>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.map(([category, query]) => (
            <Link
              key={category}
              to={`/recherche?q=${encodeURIComponent(query)}`}
              className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-500 hover:bg-blue-50/30"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{situationLabel(t, category)}</p>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition group-hover:bg-blue-600 group-hover:text-white">
                  <ChevronRight className="rtl-flip h-4 w-4 transition group-hover:rotate-90" />
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-700">{t('home:situations.see', 'Voir les aides et les lieux d’aide →')}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
