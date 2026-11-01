// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';

import { Link, useParams, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import NotFound from "./NotFound";
import { createPageUrl } from '@/utils';
import { useQuery } from '@tanstack/react-query';
import { generateBreadcrumbSchema, generateDispositifSchema } from '@/utils/schema';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  Banknote,
  Flag
} from 'lucide-react';
import SourceTraceability from '@/components/SourceTraceability';
import FalcSummary from '@/components/FalcSummary';
import AutoVerificationNote from '@/components/AutoVerificationNote';
import LoadError from '@/components/LoadError';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';
import ContentTranslationNotice from '@/components/i18n/ContentTranslationNotice';

export default function DispositifDetail() {
  const { t } = useT('dispositifs');
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const identifier = slug || id;

  const fetchDispositif = async () => {
    let url = `/api/dispositifs?`;
    if (slug) url += `slug=${slug}`;
    else if (id) url += `id=${id}`;

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch');
    }
    return res.json();
  };

  const { data: dispositif, isLoading, isError, refetch } = useQuery({
    queryKey: ['dispositif', identifier],
    queryFn: fetchDispositif,
    enabled: !!identifier
  });
  // R32: the record's own text — a verified translation when one may be shown, else the French text marked lang="fr" (the FALC fields stay French)
  const tr = useContentTranslation('dispositif', dispositif);

  if (isLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  if (isError) {
    return <div className="max-w-4xl mx-auto px-4 py-8"><LoadError what={t('dispositifs:load.one', 'ce dispositif')} onRetry={() => refetch()} testId="dispositif-error" headingLevel={1} /></div>;
  }

  if (!dispositif) {
    return <NotFound />;
  }

  const titre = tr.value('titre');
  const description = tr.value('description_falc');
  const montant = tr.value('montant');
  const liens = tr.value('liens');
  const breadcrumbs = [
    { name: t('dispositifs:breadcrumb.home', 'Accueil'), url: '/' },
    { name: t('dispositifs:breadcrumb.dispositifs', 'Dispositifs'), url: '/dispositifs' },
    { name: titre, url: `/dispositifs/${dispositif.slug}` }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateDispositifSchema(dispositif)
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={titre}
        description={description}
        path={`/dispositifs/${dispositif.slug}`}
        schema={schema}
      />

      {/* Breadcrumbs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">{t('dispositifs:breadcrumb.home', 'Accueil')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <Link to="/dispositifs" className="hover:text-blue-600">{t('dispositifs:breadcrumb.dispositifs', 'Dispositifs')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <span className="text-slate-900 truncate max-w-[200px]" {...tr.attrs('titre')}>{titre}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Link
          to="/dispositifs"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4 rtl-flip" />
          {t('dispositifs:detail.back', 'Retour aux dispositifs')}
        </Link>

        {/* Header */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {dispositif.departement && (
              <Badge variant="outline" className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {dispositif.departement === '67' ? 'Bas-Rhin (67)' :
                  dispositif.departement === '68' ? 'Haut-Rhin (68)' : <span {...tr.attrs('departement')}>{dispositif.departement}</span>}
              </Badge>
            )}
            {dispositif.public && dispositif.public.map((/** @type {any} */ p, /** @type {any} */ i) => (
              <Badge key={i} className="bg-blue-100 text-blue-800" {...tr.attrs('public')}>
                {p}
              </Badge>
            ))}
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4" {...tr.attrs('titre')}>
            {titre}
          </h1>
          <ContentTranslationNotice translation={tr} className="mb-4" />

          {montant && (
            <div className="flex items-center gap-2 text-green-700 font-medium bg-green-50 px-4 py-2 rounded-lg inline-flex mb-4">
              <Banknote className="h-5 w-5" />
              <span {...tr.attrs('montant')}>{montant}</span>
            </div>
          )}

          {/* Metadata / Source Info */}
          <div className="text-xs text-slate-600 mt-4 border-t pt-4">
            {t('dispositifs:detail.meta', 'Source : {{source}} • Mis à jour le {{date}}', {
              source: dispositif.source_url_exact ? t('dispositifs:detail.source_official', 'Officielle') : t('dispositifs:detail.source_internal', 'Interne'),
              date: formatDate(dispositif.updatedAt, { day: '2-digit', month: '2-digit', year: 'numeric' }),
            })}
          </div>
          {/* PKG-12: checked by the automatic verification chain like the aides (when, against which source, how the texts were written) */}
          <div className="mt-4"><AutoVerificationNote record={dispositif} kind="dispositif" /></div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* FALC Summary */}
            {/* R32: FalcSummary keeps the easy-to-read text in French (lang="fr") itself; its title is translated */}
            {dispositif?.summary_falc ? <FalcSummary text={dispositif.summary_falc} /> : null}

            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-3">{t('dispositifs:detail.description', 'Description')}</h2>
                <div className="prose prose-slate max-w-none text-slate-700 whitespace-pre-wrap" data-testid="dispositif-description" {...(description ? tr.attrs('description_falc') : {})}>
                  {description || t('dispositifs:detail.no_description', 'Aucune description disponible.')}
                </div>
              </CardContent>
            </Card>

            {/* Liens */}
            {liens && Array.isArray(liens) && liens.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">{t('dispositifs:detail.links', 'Liens utiles')}</h2>
                  <ul className="space-y-3">
                    {liens.map((/** @type {{ url: any; nom: any; }} */ link, /** @type {any} */ idx) => (
                      <li key={idx}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-blue-600 hover:underline font-medium"
                          {...(link.nom ? tr.attrs('liens') : {})}
                        >
                          <ExternalLink className="h-4 w-4" />
                          {link.nom || t('dispositifs:detail.link_fallback', 'Voir le lien')}
                        </a>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* PKG-11 / P09: the related aides and structures, only those that are public themselves (decided by the server) */}
            {dispositif.related?.aides?.length > 0 && (
              <Card data-testid="dispositif-related-aides">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">{t('dispositifs:detail.related_aides', 'Aides liées')}</h2>
                  <ul className="space-y-2">
                    {dispositif.related.aides.map((a) => (
                      <RelatedAide key={a.slug} aide={a} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            {dispositif.related?.structures?.length > 0 && (
              <Card data-testid="dispositif-related-structures">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">{t('dispositifs:detail.related_structures', 'Structures qui accompagnent')}</h2>
                  <ul className="space-y-2">
                    {dispositif.related.structures.map((st) => (
                      <RelatedStructure key={st.slug} structure={st} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Source Traceability */}
            <SourceTraceability
              source_url={dispositif.source_url || dispositif.source_url_exact}
              retrieved_at={dispositif.retrieved_at}
              last_checked_at={dispositif.last_checked_at}
              source_last_modified={dispositif.source_last_modified}
            />

            <Card>
              <CardContent className="p-6 space-y-3">
                <Link to={createPageUrl('Contact') + `?page=${encodeURIComponent(window.location.href)}&sujet=signalement_erreur`}>
                  <Button variant="ghost" className="w-full text-slate-600">
                    <Flag className="me-2 h-4 w-4" />
                    {t('dispositifs:detail.report_error', 'Signaler une erreur')}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/** a related aide: its title through its own content-translation view (the French title, marked lang="fr", until a translation may be shown) */
function RelatedAide({ aide }) {
  const tr = useContentTranslation('aide', aide);
  return (
    <li><Link to={`/aides/${aide.slug}`} className="inline-flex min-h-11 items-center text-blue-800 underline" {...tr.attrs('titre')}>{tr.value('titre')}</Link></li>
  );
}

/** a related structure: its name and town are never translated, only marked as French (lang="fr") outside French */
function RelatedStructure({ structure }) {
  const tr = useContentTranslation('structure', structure);
  return (
    <li><Link to={`/structures/${structure.slug}`} className="inline-flex min-h-11 items-center text-blue-800 underline" {...tr.attrs('nom')}>{structure.nom}{structure.ville ? ` — ${structure.ville}` : ''}</Link></li>
  );
}
