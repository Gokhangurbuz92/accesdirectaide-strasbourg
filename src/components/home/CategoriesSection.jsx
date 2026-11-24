import { Link } from 'react-router-dom';
import { Accessibility, Briefcase, ChevronRight, Globe2, GraduationCap, HeartPulse, Home, Hourglass, Users } from 'lucide-react';
import { topicTone } from '@/design/categoryTone';
import { PAGE } from '@/design/layout';

/** each situation keeps its topic colour on every page (src/design/categoryTone.js) */
/** @type {Record<string, [string, import('react').ElementType]>} */
const LOOK = { 'Étudiant': ['etudiant', GraduationCap], Travail: ['travail', Briefcase], Handicap: ['handicap', Accessibility], Famille: ['famille', Users],
  Senior: ['senior', Hourglass], 'Étranger': ['etranger', Globe2], Logement: ['logement', Home], 'Santé': ['sante', HeartPulse] };
import { useT } from '@/i18n';

import { SITUATIONS as categories } from '@/config/situations';   // R18: each situation opens the search on its own words

/** R32: the name of a situation in the interface language. Its search words stay the French ones: the catalogue is searched in French. @param {(key: string, fallback: string) => string} t @param {string} label */
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
      <div className={PAGE}>
        <h2 className="text-3xl font-bold text-slate-900">{t('home:situations.title', 'Quelle est votre situation ?')}</h2>
        <p className="mt-3 max-w-3xl text-slate-700">
          {t('home:situations.intro', 'Nous avons organisé les dispositifs par situation pour vous aider à accéder plus vite aux informations utiles.')}
        </p>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.map(([category, query]) => {
            const [topic, Icon] = LOOK[category] || ['', ChevronRight];
            const tone = topicTone(topic, 'blue');
            return (
              <Link
                key={category}
                to={`/recherche?q=${encodeURIComponent(query)}`}
                className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none ${tone.hover}`}
                data-testid="home-situation"
              >
                <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${tone.bar}`} />
                <div className="flex items-center gap-3">
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.tile}`} aria-hidden="true"><Icon className="h-5 w-5" /></span>
                  <p className="flex-1 font-semibold text-slate-900">{situationLabel(t, category)}</p>
                  <ChevronRight className="rtl-flip h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm text-slate-700">{t('home:situations.see', 'Voir les aides et les lieux d’aide →')}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
