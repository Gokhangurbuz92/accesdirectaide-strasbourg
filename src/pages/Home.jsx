
import { lazy, Suspense } from 'react';
import SEO from '@/components/SEO';
import HeroSearch from '@/components/organisms/HeroSearch';
import QuickAccessSection from '@/components/home/QuickAccessSection';
import CategoriesSection from '@/components/home/CategoriesSection';
import { buildSiteSchema } from '@/lib/seo';
import { frontendEnv } from '@/config/env';
import { Link } from 'react-router-dom';
import VerifiedCatalogue from '@/components/layout/VerifiedCatalogue';

/** R26: how a record gets onto the site — the three facts behind « vérifiée le … », in plain words, with the full method one click away */
function HowWeVerify() {
  const steps = [
    ['Une source officielle', 'Chaque fiche part d’une source publique : Service-Public, répertoire FINESS, Annuaire de l’administration, sites des collectivités.'],
    ['Une vérification datée', 'La fiche n’est publiée qu’après un contrôle automatique sur cette source ; la date du contrôle est affichée.'],
    ['Un retrait si la source change', 'Si la source disparaît ou ne confirme plus l’information, la fiche est retirée jusqu’à la prochaine vérification.'],
  ];
  return (
    <section className="py-12" aria-labelledby="how-we-verify">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="how-we-verify" className="text-xl font-bold text-slate-900">Des informations sourcées et datées</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-800" aria-hidden="true">{i + 1}</span>
              <p className="mt-3 font-semibold text-slate-900">{t}</p>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </li>
          ))}
        </ol>
        <Link to="/sourcesmethode" className="mt-5 inline-block font-semibold text-blue-700 hover:underline">Notre méthode en détail</Link>
      </div>
    </section>
  );
}

// Below-fold sections — lazy-loaded to improve LCP and Time to Interactive
const AssistantFeatureSection = lazy(() => import('@/components/home/AssistantFeatureSection'));
const NewsSection = lazy(() => import('@/components/home/NewsSection'));

export default function Home() {
  const schema = buildSiteSchema();

  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="Accueil"
        description="Vos droits et démarches sociales, simplement."
        path="/"
        schema={schema}
      />

      {/* Above-fold — critical for LCP */}
      <HeroSearch />
      {frontendEnv.flags.publicBeta ? (
        <section className="border-y border-slate-200 bg-slate-50 py-12">
          <div className="mx-auto max-w-6xl px-4 sm:px-6"><VerifiedCatalogue /></div>
        </section>
      ) : <QuickAccessSection />}
      <CategoriesSection />
      {frontendEnv.flags.publicBeta && <HowWeVerify />}

      {/* Below-fold — lazy-loaded for performance */}
      {/* public beta: the guided assistant is closed, so it is not advertised */}
      {!frontendEnv.flags.publicBeta && (
        <Suspense fallback={null}>
          <AssistantFeatureSection />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <NewsSection />
      </Suspense>
    </div>
  );
}
