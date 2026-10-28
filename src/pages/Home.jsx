
import { lazy, Suspense } from 'react';
import SEO from '@/components/SEO';
import HeroSearch from '@/components/organisms/HeroSearch';
import QuickAccessSection from '@/components/home/QuickAccessSection';
import CategoriesSection from '@/components/home/CategoriesSection';
import { buildSiteSchema } from '@/lib/seo';

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
      <QuickAccessSection />
      <CategoriesSection />

      {/* Below-fold — lazy-loaded for performance */}
      <Suspense fallback={null}>
        <AssistantFeatureSection />
      </Suspense>
      <Suspense fallback={null}>
        <NewsSection />
      </Suspense>
    </div>
  );
}
