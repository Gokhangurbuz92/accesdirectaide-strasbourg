import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { htmlToPlainText } from '@/lib/htmlText';

export default function NewsSection() {
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
          <h2 className="text-3xl font-bold text-slate-900">Actualités officielles</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {items.map((/** @type {{ date_publication: string | number, id: string | number, published_at: string | number, resume: string | number, slug: string | number, summary_falc: string | number, titre: string | number }} */ item) => {
            const summary = htmlToPlainText(item.summary_falc || item.resume || '', { maxLength: 120 });
            const path = item.slug ? `/actualites/${item.slug}` : '/actualites';

            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  {new Date(item.date_publication || item.published_at || Date.now()).toLocaleDateString('fr-FR')}
                </p>
                <h3 className="mt-2 text-lg font-bold text-slate-900 line-clamp-2">
                  <Link to={path} className="hover:text-blue-700">
                    {item.titre}
                  </Link>
                </h3>
                <p className="mt-2 text-sm text-slate-600 line-clamp-3">{summary}</p>
              </article>
            );
          })}
        </div>

        <div className="mt-6">
          <Link to="/actualites" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800">
            Voir toutes les actualités
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
