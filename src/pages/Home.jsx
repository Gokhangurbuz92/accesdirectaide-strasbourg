
import { lazy, Suspense } from 'react';
import SEO from '@/components/SEO';
import HeroSearch from '@/components/organisms/HeroSearch';
import QuickAccessSection from '@/components/home/QuickAccessSection';
import CategoriesSection from '@/components/home/CategoriesSection';
import { buildSiteSchema } from '@/lib/seo';
import { frontendEnv } from '@/config/env';
import { Link } from 'react-router-dom';
import VerifiedCatalogue from '@/components/layout/VerifiedCatalogue';
import { useT } from '@/i18n';

/** R26: how a record gets onto the site — the three facts behind « vérifiée le … », in plain words, with the full method one click away */
function HowWeVerify() {
  const { t } = useT('home');
  const steps = [
    [t('home:verify.source.title', 'Une source officielle'), t('home:verify.source.text', 'Chaque fiche part d’une source publique : Service-Public, répertoire FINESS, Annuaire de l’administration, sites des collectivités.')],
    [t('home:verify.dated.title', 'Une vérification datée'), t('home:verify.dated.text', 'La fiche n’est publiée qu’après un contrôle automatique sur cette source ; la date du contrôle est affichée.')],
    [t('home:verify.withdrawn.title', 'Un retrait si la source change'), t('home:verify.withdrawn.text', 'Si la source disparaît ou ne confirme plus l’information, la fiche est retirée jusqu’à la prochaine vérification.')],
  ];
  return (
    <section className="py-12" aria-labelledby="how-we-verify">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="how-we-verify" className="text-xl font-bold text-slate-900">{t('home:verify.title', 'Des informations sourcées et datées')}</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-800" aria-hidden="true">{i + 1}</span>
              <p className="mt-3 font-semibold text-slate-900">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
        <Link to="/sourcesmethode" className="mt-5 inline-block font-semibold text-blue-700 hover:underline">{t('home:verify.method', 'Notre méthode en détail')}</Link>
      </div>
    </section>
  );
}

// Below-fold sections — lazy-loaded to improve LCP and Time to Interactive
const AssistantFeatureSection = lazy(() => import('@/components/home/AssistantFeatureSection'));
const NewsSection = lazy(() => import('@/components/home/NewsSection'));

export default function Home() {
  const { t } = useT('home');
  const schema = buildSiteSchema();

  return (
    <div className="min-h-screen bg-white">
      <SEO
        title={t('home:seo.title', 'Accueil')}
        description={t('home:seo.description', 'Vos droits et démarches sociales, simplement.')}
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
