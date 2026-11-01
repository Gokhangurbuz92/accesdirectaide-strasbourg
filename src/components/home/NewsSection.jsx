import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { htmlToPlainText } from '@/lib/htmlText';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

/** one news card: title and summary through the content-translation hook (French marked lang="fr" until a checked translation exists) */
function NewsCard({ item }) {
  const tr = useContentTranslation('actualite', item);
  const summary = htmlToPlainText(item.summary_falc || tr.value('resume') || '', { maxLength: 120 });
  const path = item.slug ? `/actualites/${item.slug}` : '/actualites';
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{formatDate(item.date_publication || item.published_at || Date.now(), { day: 'numeric', month: 'numeric', year: 'numeric' })}</p>
      <h3 className="mt-2 text-lg font-bold text-slate-900 line-clamp-2" {...tr.attrs('titre')}>
        <Link to={path} className="hover:text-blue-700">{tr.value('titre')}</Link>
      </h3>
      <p className="mt-2 text-sm text-slate-600 line-clamp-3" {...(item.summary_falc ? { lang: 'fr' } : tr.attrs('resume'))}>{summary}</p>
    </article>
  );
}

export default function NewsSection() {
  const { t } = useT('home');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['home-news', { limit: 3 }],
    queryFn: () => client.entities.Actualite.filter({
      limit: 3,
      sort: 'recent',
      statut: 'publie',
    }),
    staleTime: 1000 * 60 * 5,
  });

  const items = Array.isArray(data?.items) ? data.items.slice(0, 3) : [];

  if (isLoading || isError || items.length === 0) {
    return null;
  }

  return (
    <section className="border-t border-slate-200 bg-slate-50 py-14 lg:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-8 flex items-center gap-3">
          <span className="h-8 w-1 rounded-full bg-blue-500" aria-hidden="true" />
          <h2 className="text-3xl font-bold text-slate-900">{t('home:news.title', 'Actualités officielles')}</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {items.map((item) => <NewsCard key={item.id} item={item} />)}
        </div>

        <div className="mt-6">
          <Link to="/actualites" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800">
            {t('home:news.all', 'Voir toutes les actualités')}
            <ArrowRight className="h-4 w-4 rtl-flip" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
