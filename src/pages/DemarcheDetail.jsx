// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import SEO from '@/components/SEO';
import { frontendEnv } from '@/config/env';
import NotFound from "./NotFound";
import Gone from "./Gone";
import { createPageUrl } from '@/utils';
import { client } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  ExternalLink,
  Download,
  CheckCircle2,
  ChevronRight,
  AlertCircle,
  Euro,
  Lightbulb
} from 'lucide-react';
import { generateBreadcrumbSchema, generateDemarcheSchema } from '@/utils/schema';
import ProvenanceFreshness from '@/components/ProvenanceFreshness';
import FalcInvite from '@/components/FalcInvite';
import AutoVerificationNote from '@/components/AutoVerificationNote';
import { asList } from '@/lib/textLists';
import FalcToggle from '@/components/FalcToggle';
import FalcContent from '@/components/FalcContent';
import FeedbackButton from '@/components/FeedbackButton';
import { getProvenance } from '@/lib/provenance';
import CategoryChip, { resolveCategory } from '@/components/ui/CategoryChip';
import { useFalc } from '@/contexts/FalcContext';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';
import ContentTranslationNotice from '@/components/i18n/ContentTranslationNotice';

import FavoriteButton from '@/components/FavoriteButton';
import { getCsrfHeaders } from '@/lib/csrf';
/** @typedef {Error & { status?: number, payload?: unknown }} ApiError */
/** @typedef {{ numero?: number, titre?: string, title?: string, nom?: string, description?: string, contenu?: string, text?: string, conseils?: string }} DemarcheStep */
/** @typedef {{ url?: string, nom?: string }} DemarcheSource */

/** the verification date as the page has always shown it (« 30/10/2026 »), in the interface language */
const NUMERIC_DATE = { day: '2-digit', month: '2-digit', year: 'numeric' };

/** the record texts the easy-to-read view reads (FalcContent), each one through the content translation */
const FALC_VIEW_FIELDS = ['summary_falc', 'resume_falc', 'description_falc', 'conditions_falc', 'etapes_falc', 'description_courte', 'description', 'pour_qui', 'delai', 'cout', 'ou_faire', 'etapes', 'documents_necessaires'];

/**
 * @param {string} slug
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<any>}
 */
async function fetchDemarcheBySlug(slug, signal) {
  const res = await fetch(`/api/demarches/${encodeURIComponent(slug)}`, { signal });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    /** @type {ApiError} */
    const err = new Error(`API Error: ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

export default function DemarcheDetail() {
  const { t } = useT('demarches');
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = searchParams.get('id');
  const identifier = slug || id;

  // FALC mode — use global context
  const { isFalcEnabled: isFalcMode } = useFalc();
  const [isGeneratingFalc, setIsGeneratingFalc] = useState(false);
  const [falcPreview, setFalcPreview] = useState(/** @type {string | null} */ (null));   // PKG-6 / D22: automatic preview, never stored, never reviewed

  const {
    data: queryData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['demarche', identifier],
    queryFn: ({ signal }) => {
      if (slug) return fetchDemarcheBySlug(slug, signal);
      return client.entities.Demarche.get(id);
    },
    enabled: !!identifier
  });

  // Safe unwrap: some endpoints may still return arrays or { items: [] }.
  const demarche = Array.isArray(queryData)
    ? queryData[0]
    : (queryData?.items ? queryData?.items[0] : queryData);

  // R32: the record's texts in the interface language when a translation may be shown, otherwise French (marked lang="fr")
  const tr = useContentTranslation('demarche', demarche);

  // Canonical Redirect: If accessed via ID but slug exists, redirect to slug URL
  useEffect(() => {
    if (demarche && !slug && demarche.slug) {
      navigate(`/demarches/${demarche.slug}`, { replace: true });
    }
  }, [demarche, slug, navigate]);

  if (isLoading || isFetching) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  if (error) {
    /** @type {ApiError} */
    const apiError = error;
    const status = apiError?.status;
    if (status === 410) return <Gone />;
    if (status === 404) return <NotFound />;

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 sm:px-6 py-12">
        <EmptyState
          headingLevel={1}
          title={t('demarches:detail.error.title', 'Impossible de charger la démarche')}
          description={t('demarches:error.description', 'Vérifiez votre connexion puis réessayez.')}
          icon={<AlertCircle className="h-6 w-6" />}
          actions={
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => refetch()}>
                {t('demarches:error.retry', 'Réessayer')}
              </Button>
              <Link to={createPageUrl('Demarches')}>
                <Button type="button" variant="ghost">
                  {t('demarches:detail.back', 'Retour aux démarches')}
                </Button>
              </Link>
            </div>
          }
          role="alert"
        />
      </div>
    );
  }

  if (!demarche) {
    return <NotFound />;
  }

  const categorySlug = (() => {
    const raw = demarche?.categorie || demarche?.category?.slug;
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    return /^[A-Z_]+$/.test(value) ? value.toLowerCase() : value;
  })();

  const resolved = resolveCategory(categorySlug) || (demarche?.category?.label ? { label: demarche.category.label } : null);
  const categoryLabel = resolved?.label || null;
  const provenance = getProvenance(demarche);
  const pdfDownloadUrl = (demarche?.slug || demarche?.id)
    ? `/api/pdf/demarches/${encodeURIComponent(demarche.slug || demarche.id)}`
    : null;

  const canonicalPath = demarche.slug
    ? `/demarches/${demarche.slug}`
    : `/demarches/view?id=${encodeURIComponent(demarche.id)}`;

  const title = tr.value('titre');
  // the lead under the title: the short description, or the easy-to-read summary when there is none
  const leadField = tr.value('description_courte') ? 'description_courte' : 'summary_falc';

  /** @type {string[]} */
  const documentsNecessaires = asList(tr.value('documents_necessaires'));   // a list, or one document per line (automatic verification chain)

  /** @type {DemarcheStep[]} */
  const steps = Array.isArray(tr.value('etapes')) ? tr.value('etapes') : [];

  /** @type {DemarcheSource[]} */
  const sources = Array.isArray(tr.value('sources')) ? tr.value('sources') : [];

  // the easy-to-read view reads the same record, its texts through the content translation
  const falcView = { ...demarche, ...Object.fromEntries(FALC_VIEW_FIELDS.map((field) => [field, tr.value(field)])) };

  const breadcrumbs = [
    { name: t('demarches:breadcrumb.home', 'Accueil'), url: '/' },
    { name: t('demarches:breadcrumb.demarches', 'Démarches'), url: '/demarches' },
    { name: title, url: canonicalPath }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateDemarcheSchema(demarche)
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={t('demarches:detail.seo_title', '{{title}} – Démarches', { title })}
        description={tr.value('description_courte') || tr.value('summary_falc')}
        path={canonicalPath}
        schema={schema}
      />
      {/* Fil d'Ariane */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">{t('demarches:breadcrumb.home', 'Accueil')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <Link to={createPageUrl('Demarches')} className="hover:text-blue-600">{t('demarches:breadcrumb.demarches', 'Démarches')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <span className="text-slate-900" {...tr.attrs('titre')}>{title}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Retour */}
        <Link
          to={createPageUrl('Demarches')}
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4 rtl-flip" />
          {t('demarches:detail.back', 'Retour aux démarches')}
        </Link>

        {/* En-tête */}
        <Card className="mb-6">
          <CardContent className="p-6 md:p-8">
            {categoryLabel && <CategoryChip slug={categorySlug} label={categoryLabel} className="mb-4" />}

            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4" {...tr.attrs('titre')}>
              {title}
            </h1>
            <ContentTranslationNotice translation={tr} className="mb-4" />

            <p className="text-lg text-slate-600 mb-6" {...tr.attrs(leadField)}>
              {tr.value(leadField)}
            </p>

            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              {demarche.delai && (
                <span className="flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-full">
                  <Clock className="h-4 w-4" />
                  <span {...tr.attrs('delai')}>{tr.value('delai')}</span>
                </span>
              )}
              {demarche.cout && (
                <span className="flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-full">
                  <Euro className="h-4 w-4" />
                  <span {...tr.attrs('cout')}>{tr.value('cout')}</span>
                </span>
              )}
              {/* PKG-11 audit: a date is a verification only when the server says the content is VERIFIED (a lab / unverified row's date is not) */}
              {demarche.provenance?.contentStatus === 'VERIFIED' && demarche.provenance?.verifiedAt && (
                <span className="flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-full">
                  <Calendar className="h-4 w-4" />
                  {t('demarches:verified_on', 'Vérifié le {{date}}', { date: formatDate(demarche.provenance.verifiedAt, NUMERIC_DATE) })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* automatic verification: when, against which official source */}
        <div className="mb-4"><AutoVerificationNote record={demarche} kind="demarche" /></div>

        {/* FALC Toggle + On-demand AI generation */}
        <div className="mb-6">
          <FalcToggle
            hasFalcContent={!!(demarche?.summary_falc || demarche?.description_falc || demarche?.resume_falc)}
            review={{ at: demarche?.falc_reviewed_at, origin: demarche?.falc_origin, fields: demarche?.falc_field_review, auto: demarche?.verification_auto?.textsWrittenAt || null }}
            onChange={() => { }}
          />
          {/* R29: in the public beta no text is generated on demand (the service is closed): say so instead of a button that always fails */}
          {isFalcMode && !(demarche?.summary_falc || demarche?.description_falc || demarche?.resume_falc) && frontendEnv.flags.publicBeta && (
            <p className="mt-3 text-sm text-slate-700" data-testid="falc-not-available">{t('demarches:detail.falc.not_available', 'Il n’y a pas encore de version facile à lire pour cette démarche. La fiche complète ci-dessous reste valable.')}</p>
          )}
          {isFalcMode && !(demarche?.summary_falc || demarche?.description_falc || demarche?.resume_falc) && !frontendEnv.flags.publicBeta && (
            <button
              type="button"
              disabled={isGeneratingFalc}
              onClick={async () => {
                setIsGeneratingFalc(true);
                try {
                  const res = await fetch('/api/public/falc/summarize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                    body: JSON.stringify({ entityId: demarche.id, type: 'demarche' }),
                  });
                  if (res.ok) {
                    const j = await res.json();
                    if (j.cached) refetch(); else setFalcPreview(typeof j.summary_falc === 'string' ? j.summary_falc : null);
                  }
                } catch {
                  // Silently handle
                } finally {
                  setIsGeneratingFalc(false);
                }
              }}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {isGeneratingFalc ? (
                <>
                  <span className="animate-spin">⏳</span>
                  {t('demarches:detail.falc.generating', 'Simplification en cours...')}
                </>
              ) : (
                <>
                  {t('demarches:detail.falc.generate', 'Résumé simplifié automatique')}
                </>
              )}
            </button>
          )}
          {isFalcMode && falcPreview && (
            <div role="status" data-testid="falc-preview" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-slate-900">
              <p className="text-sm font-semibold">{t('demarches:detail.falc.preview_warning', 'Résumé automatique, non relu par une personne. Il peut être incomplet : la fiche complète fait foi.')}</p>
              {/* the automatic summary is always written in French */}
              <p className="mt-2 whitespace-pre-line" lang="fr" dir="ltr">{falcPreview}</p>
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Contenu principal */}
          <div className="lg:col-span-2 space-y-6">
            {isFalcMode ? (
              /* FALC Mode Content */
              <Card>
                <CardContent className="p-6">
                  <FalcContent falcData={falcView} entityType="demarche" />
                </CardContent>
              </Card>
            ) : (
              /* Normal Mode Content */
              <>
                {/* FALC Summary */}
                {!!(demarche?.summary_falc || demarche?.description_falc || demarche?.resume_falc) && <FalcInvite />}

                {/* Pour qui */}
                {demarche.pour_qui && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-3">{t('demarches:detail.for_whom', 'Pour qui ?')}</h2>
                      {asList(tr.value('pour_qui')).length > 1 ? (
                        <ul className="list-disc space-y-1 ps-5 text-slate-700" {...tr.attrs('pour_qui')}>{asList(tr.value('pour_qui')).map((x, i) => <li key={i}>{x}</li>)}</ul>
                      ) : <p className="text-slate-700" {...tr.attrs('pour_qui')}>{tr.value('pour_qui')}</p>}
                    </CardContent>
                  </Card>
                )}

                {/* Documents nécessaires */}
                {documentsNecessaires.length > 0 && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-600" />
                        {t('demarches:detail.documents', 'Documents à préparer')}
                      </h2>
                      <ul className="space-y-3">
                        {documentsNecessaires.map((doc, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <CheckCircle2 className="h-4 w-4 text-blue-600" />
                            </div>
                            <span className="text-slate-700" {...tr.attrs('documents_necessaires')}>{doc}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Étapes */}
                {steps.length > 0 && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-6">
                        {t('demarches:detail.steps', 'Les étapes à suivre')}
                      </h2>
                      <div className="space-y-6">
                        {steps.map((etape, idx) => (
                          <div key={idx} className="relative">
                            {idx < steps.length - 1 && (
                              <div className="absolute start-4 top-10 bottom-0 w-0.5 bg-slate-200" />
                            )}
                            <div className="flex gap-4">
                              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold flex-shrink-0 z-10">
                                {etape.numero || idx + 1}
                              </div>
                              <div className="flex-1 pb-6">
                                <h3 className="font-semibold text-slate-900 text-lg mb-2" {...tr.attrs('etapes')}>
                                  {etape.titre}
                                </h3>
                                <p className="text-slate-600 mb-3" {...tr.attrs('etapes')}>
                                  {etape.description}
                                </p>
                                {etape.conseils && (
                                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                                    <Lightbulb className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-amber-800" {...tr.attrs('etapes')}>{etape.conseils}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Où faire */}
                {demarche.ou_faire && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-3">{t('demarches:detail.where', 'Où faire cette démarche ?')}</h2>
                      <p className="text-slate-700 mb-4" {...tr.attrs('ou_faire')}>{tr.value('ou_faire')}</p>
                      {demarche.lien_officiel && (
                        <Button asChild>
                          <a href={demarche.lien_officiel} target="_blank" rel="noopener noreferrer">
                            {t('demarches:detail.online_service', 'Accéder au service en ligne')}
                            <ExternalLink className="ms-2 h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Sources */}
                {sources.length > 0 && (
                  <Card className="bg-slate-50">
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-3">{t('demarches:detail.sources', 'Sources')}</h2>
                      <ul className="space-y-2">
                        {sources.map((source, idx) => (
                          <li key={idx}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1"
                            >
                              <span {...tr.attrs('sources')}>{source.nom}</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <ProvenanceFreshness provenance={provenance} />

            {/* Actions */}
            <Card>
              <CardContent className="p-6 space-y-3">
                {demarche.lien_officiel && (
                  <Button className="w-full" asChild>
                    <a href={demarche.lien_officiel} target="_blank" rel="noopener noreferrer">
                      {t('demarches:detail.start', 'Commencer la démarche')}
                      <ExternalLink className="ms-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
                {pdfDownloadUrl && (
                  <Button
                    variant="outline"
                    className="w-full"
                    // R29: the PDF service is closed in the public beta — the browser's own print (« Enregistrer en PDF ») makes the same document
                    onClick={() => (frontendEnv.flags.publicBeta ? window.print() : window.open(pdfDownloadUrl, '_blank', 'noopener,noreferrer'))}
                  >
                    <Download className="me-2 h-4 w-4" />
                    {frontendEnv.flags.publicBeta ? t('demarches:detail.pdf_print', 'Imprimer ou enregistrer en PDF') : t('demarches:detail.pdf_download', 'Télécharger en PDF')}
                  </Button>
                )}
                <FavoriteButton entityType="demarche" entityId={demarche.id} label={demarche.titre} />
                <FeedbackButton
                  type="demarche"
                  entityId={demarche.id}
                  entitySlug={demarche.slug}
                  pageUrl={typeof window !== 'undefined' ? window.location.href : null}
                  variant="ghost"
                  size="default"
                />
              </CardContent>
            </Card>

            {/* Résumé */}
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-6">
                <h3 className="font-bold text-slate-900 mb-3">{t('demarches:detail.summary', 'En résumé')}</h3>
                <div className="space-y-3 text-sm">
                  {steps.length > 0 && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-blue-600" />
                      <span>{t('demarches:detail.steps_count', { count: steps.length, defaultValue_one: '{{count}} étape', defaultValue_other: '{{count}} étapes' })}</span>
                    </div>
                  )}
                  {documentsNecessaires.length > 0 && (
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <span>{t('demarches:detail.documents_count', { count: documentsNecessaires.length, defaultValue_one: '{{count}} document à préparer', defaultValue_other: '{{count}} documents à préparer' })}</span>
                    </div>
                  )}
                  {demarche.delai && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-blue-600" />
                      <span {...tr.attrs('delai')}>{tr.value('delai')}</span>
                    </div>
                  )}
                  {demarche.cout && (
                    <div className="flex items-center gap-2">
                      <Euro className="h-4 w-4 text-blue-600" />
                      <span {...tr.attrs('cout')}>{tr.value('cout')}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
