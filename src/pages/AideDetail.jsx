// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { track } from '@vercel/analytics';
import { createPageUrl } from '@/utils';
import { client } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
import { frontendEnv } from '@/config/env';
import NotFound from "./NotFound";
import Gone from "./Gone";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  FileText,
  ExternalLink,
  Download,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  RotateCcw
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { buildAideDetailSchemas, truncateDescription } from '@/lib/seo';
import ProvenanceFreshness from '@/components/ProvenanceFreshness';
import FalcInvite from '@/components/FalcInvite';
import AutoVerificationNote from '@/components/AutoVerificationNote';
import { asList } from '@/lib/textLists';
import FalcToggle from '@/components/FalcToggle';
import FalcContent from '@/components/FalcContent';
import FeedbackButton from '@/components/FeedbackButton';
import { getProvenance } from '@/lib/provenance';
import { useAideDetail } from '@/lib/hooks/useAideDetail';
import CategoryChip, { resolveCategory } from '@/components/ui/CategoryChip';
import { useFalc } from '@/contexts/FalcContext';
import { buildPublicRdvPath } from '@/lib/rdvRouting';



import FavoriteButton from '@/components/FavoriteButton';
import { getCsrfHeaders } from '@/lib/csrf';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';
import ContentTranslationNotice from '@/components/i18n/ContentTranslationNotice';

/** the detail hook (useAideDetail) reports a failure with this French sentence: it is shown in the interface language */
const DETAIL_ERROR_FR = 'Impossible de charger cette aide. Vérifiez votre connexion et réessayez.';

export default function AideDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t } = useT('aides');

  // ------------------------------------------------------------------
  // V2-03: Use useAideDetail hook instead of react-query + direct fetch
  // ------------------------------------------------------------------
  const { status, data, raw: aide, errorMessage, refetch } = useAideDetail(slug);
  // R32: the record's own text — a verified translation when one may be shown, else the French text marked lang="fr" (the FALC fields stay French)
  const tr = useContentTranslation('aide', aide);

  // FALC mode — use global context
  const { isFalcEnabled: isFalcMode } = useFalc();
  const [isGeneratingFalc, setIsGeneratingFalc] = useState(false);
  const [falcPreview, setFalcPreview] = useState(/** @type {string | null} */ (null));
  const [falcError, setFalcError] = useState('');   // R12: a failed automatic summary is said, not swallowed (R32: '' | 'rate_limited' | 'unavailable' | 'offline', worded at render)   // PKG-6 / D22: automatic preview, never stored, never reviewed
  const hasFalcContent = !!(aide?.summary_falc || aide?.conditions_falc || aide?.montant_falc);

  // Canonical Redirect: If accessed via query ?id= but slug exists, redirect
  useEffect(() => {
    if (aide && !slug && aide.slug) {
      navigate(`/aides/${aide.slug}`, { replace: true });
    }
  }, [aide, slug, navigate]);

  // Vercel Analytics Tracking: View Aide Detail
  useEffect(() => {
    if (aide?.slug && status === 'success') {
      track('view_aide_detail', { slug: aide.slug, categorie: aide.categorie });
    }
  }, [aide?.slug, aide?.categorie, status]);

  // Structures sidebar (keep react-query — it's not aide data)
  const { data: structuresData } = useQuery({
    queryKey: ['structures-aide', aide?.categorie],
    // owner usefulness pass (2026-10-25): '-created_date' is not an accepted sort for structures (400: the block never appeared), and only 5 structures were
    // fetched before filtering by category; a valid sort and a full page, then the category filter below
    queryFn: () => client.entities.Structure.filter({
      statut: 'actif'
    }, 'quality', 50),
    enabled: !!aide?.categorie
  });

  const structures = Array.isArray(structuresData)
    ? structuresData
    : (structuresData?.items || []);

  const filteredStructures = structures.filter(/** @type {{ categories_aidees: (string | null | undefined)[]; }} */ (/** @type {{ categories_aidees: (string | null | undefined)[]; }} */ s) =>
    s.categories_aidees?.includes(aide?.categorie)
  ).slice(0, 3);

  // SEO
  const canonicalPath = aide?.slug ? `/aides/${aide.slug}` : (slug ? `/aides/${slug}` : '/aides');
  const seoTitle = tr.value('titre') || data?.title || t('aides:detail.seo_title', 'Aide');
  const seoDescription = truncateDescription(
    tr.value('summary_falc') || tr.value('cest_quoi') || t('aides:detail.seo_description', "Consultez le détail d'une aide sociale.")
  ) || t('aides:detail.seo_description', "Consultez le détail d'une aide sociale.");
  const schema = useMemo(
    () => buildAideDetailSchemas(aide, canonicalPath),
    [aide, canonicalPath]
  );

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  if (status === 'loading') {
    return (
      <>
        <SEO
          title={seoTitle}
          description={seoDescription}
          path={canonicalPath}
          ogType="article"
        />
        <div className="min-h-screen bg-slate-50">
          <div className="bg-white border-b border-slate-200">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
            <Skeleton className="h-4 w-32 mb-6" />
            <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 mb-6">
              <Skeleton className="h-6 w-20 mb-4" />
              <Skeleton className="h-8 w-3/4 mb-4" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {[1, 2, 3].map((v) => (
                  <div key={v} className="bg-white rounded-xl border border-slate-200 p-6">
                    <Skeleton className="h-5 w-32 mb-3" />
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ))}
              </div>
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <Skeleton className="h-4 w-24 mb-3" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Error state
  // ------------------------------------------------------------------
  // the detail hook's own French failure sentence, in the interface language
  const detailErrorText = errorMessage === DETAIL_ERROR_FR
    ? t('aides:detail.error_message', 'Impossible de charger cette aide. Vérifiez votre connexion et réessayez.')
    : errorMessage || t('aides:detail.error_hint', 'Vérifiez votre connexion et réessayez.');
  if (status === 'error') {
    return (
      <>
        <SEO
          title={t('aides:detail.error_seo_title', 'Erreur — Aide')}
          description={t('aides:detail.error_seo_description', 'Une erreur est survenue.')}
          path={canonicalPath}
        />
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
          <div
            className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-destructive max-w-md text-center"
            role="alert"
            data-testid="aide-detail-error"
          >
            <AlertCircle className="h-10 w-10 mx-auto mb-4 opacity-60" />
            <h1 className="text-xl font-semibold mb-2">{t('aides:detail.error_title', 'Impossible de charger cette aide')}</h1>
            <p className="text-sm mb-6">
              {detailErrorText}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button type="button" variant="outline" onClick={() => refetch()}>
                <RotateCcw className="me-2 h-4 w-4" />
                {t('aides:error.retry', 'Réessayer')}
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/aides">{t('aides:detail.back', 'Retour aux aides')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Not found state
  // ------------------------------------------------------------------
  if (status === 'gone') {
    return <Gone />;
  }

  if (status === 'not_found' || !aide) {
    return <NotFound />;
  }

  // ------------------------------------------------------------------
  // Success — render full detail
  // ------------------------------------------------------------------
  const categorySlug = (() => {
    const raw = aide?.categorie || aide?.theme || aide?.category?.slug;
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    return /^[A-Z_]+$/.test(value) ? value.toLowerCase() : value;
  })();

  const resolved = resolveCategory(categorySlug) || (aide?.category?.label ? { label: aide.category.label } : null);
  const categoryLabel = resolved?.label || null;
  const provenance = getProvenance(aide);
  // R27: the header gives the date of the VERIFICATION (like the démarche page), only for a record the server says is verified; it used to give the
  // date the record was first fetched (« Mise à jour : 24/10 ») next to « vérifiées le 31 octobre » further down
  const verifiedAtLabel = provenance.contentStatus === 'VERIFIED' ? formatDate(provenance.verifiedAt, { day: '2-digit', month: '2-digit', year: 'numeric' }) || null : null;
  const pdfDownloadUrl = (aide?.slug || aide?.id)
    ? `/api/pdf/aides/${encodeURIComponent(aide.slug || aide.id)}`
    : null;

  const getTerritoireLabel = () => {
    if (!aide.territoires?.length) return null;
    if (aide.territoires.includes('national')) return t('aides:territory.national', 'France entière');
    return aide.territoires.map((code) => {
      if (code === '67') return 'Bas-Rhin (67)';
      if (code === '68') return 'Haut-Rhin (68)';
      return code;
    }).join(', ');
  };

  const territoireLabel = getTerritoireLabel();
  // the names of territories are never translated: marked as French outside French (« France entière » is interface text)
  const territoireAttrs = aide.territoires?.includes?.('national') ? {} : tr.attrs('territoires');
  const falcErrorText = falcError === 'rate_limited'
    ? t('aides:falc.error_rate_limited', 'Trop de demandes : réessayez dans une minute.')
    : falcError === 'offline'
      ? t('aides:falc.error_offline', 'Le service ne répond pas pour le moment. La fiche complète ci-dessous reste valable.')
      : t('aides:falc.error_unavailable', 'Le résumé simplifié automatique n’est pas disponible pour le moment. La fiche complète ci-dessous reste valable.');

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={seoTitle}
        description={seoDescription}
        path={canonicalPath}
        ogType="article"
        schema={schema}
      />
      {/* Fil d'Ariane */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600" aria-label={t('aides:detail.breadcrumb', "Fil d'Ariane")} data-testid="aide-breadcrumb">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">{t('aides:breadcrumb.home', 'Accueil')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <Link to={createPageUrl('Aides')} className="hover:text-blue-600">{t('aides:breadcrumb.aides', 'Aides')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <span className="text-slate-900" aria-current="page" {...tr.attrs('titre')}>{tr.value('titre')}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Retour */}
        <Link
          to={createPageUrl('Aides')}
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4 rtl-flip" />
          {t('aides:detail.back', 'Retour aux aides')}
        </Link>

        {/* En-tête */}
        <header className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {categoryLabel && <CategoryChip slug={categorySlug} label={categoryLabel} />}
            {aide.est_urgent && (
              <Badge className="bg-red-100 text-red-800">
                <AlertCircle className="h-3 w-3 me-1" />
                {t('aides:detail.urgent', 'Urgence')}
              </Badge>
            )}
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4" {...tr.attrs('titre')}>
            {tr.value('titre')}
          </h1>
          <ContentTranslationNotice translation={tr} className="mb-4" />

          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            {territoireLabel && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                <span {...territoireAttrs}>{territoireLabel}</span>
              </span>
            )}
            {verifiedAtLabel && (
              <span className="flex items-center gap-1" title={t('aides:detail.verified_title', 'Date de la dernière vérification sur la source officielle')}>
                <Calendar className="h-4 w-4" />
                {t('aides:detail.verified_on', 'Vérifié le {{date}}', { date: verifiedAtLabel })}
              </span>
            )}
            {tr.value('delai_indicatif') && (
              <span className="flex items-center gap-1" {...tr.attrs('delai_indicatif')}>
                <Clock className="h-4 w-4" />
                {tr.value('delai_indicatif')}
              </span>
            )}
          </div>
        </header>

        {/* automatic verification: when, against which official source */}
        <div className="mb-4"><AutoVerificationNote record={aide} kind="aide" /></div>

        {/* FALC Toggle + On-demand AI generation */}
        <div className="mb-6">
          <FalcToggle
            hasFalcContent={hasFalcContent}
            review={{ at: aide?.falc_reviewed_at, origin: aide?.falc_origin, fields: aide?.falc_field_review, auto: aide?.verification_auto?.textsWrittenAt || null }}
            onChange={() => { }}
          />
          {/* R29: in the public beta no text is generated on demand (the service is closed): say so instead of a button that always fails */}
          {isFalcMode && !hasFalcContent && frontendEnv.flags.publicBeta && (
            <p className="mt-3 text-sm text-slate-700" data-testid="falc-not-available">{t('aides:falc.not_available', 'Il n’y a pas encore de version facile à lire pour cette fiche. La fiche complète ci-dessous reste valable.')}</p>
          )}
          {isFalcMode && !hasFalcContent && !frontendEnv.flags.publicBeta && (
            <button
              type="button"
              disabled={isGeneratingFalc}
              onClick={async () => {
                track('generate_falc', { slug: aide.slug });
                setIsGeneratingFalc(true);
                setFalcError('');
                try {
                  const res = await fetch('/api/public/falc/summarize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                    body: JSON.stringify({ aideId: aide.id }),
                  });
                  if (res.ok) {
                    const j = await res.json();
                    if (j.cached) refetch(); else setFalcPreview(typeof j.summary_falc === 'string' ? j.summary_falc : null);
                  } else {
                    setFalcError(res.status === 429 ? 'rate_limited' : 'unavailable');
                  }
                } catch {
                  setFalcError('offline');
                } finally {
                  setIsGeneratingFalc(false);
                }
              }}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {isGeneratingFalc ? (
                <>
                  <span className="animate-spin">⏳</span>
                  {t('aides:falc.generating', 'Simplification en cours...')}
                </>
              ) : (
                <>
                  {t('aides:falc.generate', 'Résumé simplifié automatique')}
                </>
              )}
            </button>
          )}
          {isFalcMode && falcError && <p role="alert" data-testid="falc-preview-error" className="mt-3 text-sm text-red-800">{falcErrorText}</p>}
          {isFalcMode && falcPreview && (
            <div role="status" data-testid="falc-preview" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-slate-900">
              <p className="text-sm font-semibold">{t('aides:falc.preview_warning', 'Résumé automatique, non relu par une personne. Il peut être incomplet : la fiche complète fait foi.')}</p>
              {/* the automatic summary is simplified French, whatever the interface language */}
              <p className="mt-2 whitespace-pre-line" lang="fr" dir="ltr">{falcPreview}</p>
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Contenu principal */}
          <article className="lg:col-span-2 space-y-6">
            {isFalcMode ? (
              /* FALC Mode Content */
              <section aria-label={t('aides:detail.falc_section', 'Version simplifiée (FALC)')}>
                <Card>
                  {/* R32: FalcContent marks the easy-to-read texts as French itself (its headings are translated) */}
                  <CardContent className="p-6">
                    <FalcContent falcData={aide} entityType="aide" />
                  </CardContent>
                </Card>
              </section>
            ) : (
              /* Normal Mode Content */
              <>
                {/* C'est quoi ? */}
                {tr.value('cest_quoi') && (
                  <section aria-labelledby="heading-cest-quoi">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-cest-quoi" className="text-lg font-bold text-slate-900 mb-3">{t('aides:detail.what', "C'est quoi ?")}</h2>
                        <p className="text-slate-700 leading-relaxed" {...tr.attrs('cest_quoi')}>{tr.value('cest_quoi')}</p>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* the easy-to-read version is a page of its own, not a copy inside this one */}
                {hasFalcContent && <FalcInvite />}

                {/* Pour qui ? */}
                {tr.value('pour_qui') && (
                  <section aria-labelledby="heading-pour-qui">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-pour-qui" className="text-lg font-bold text-slate-900 mb-3">{t('aides:detail.who', 'Pour qui ?')}</h2>
                        {asList(tr.value('pour_qui')).length > 1 ? (
                          <ul className="list-disc space-y-1 ps-5 text-slate-700" {...tr.attrs('pour_qui')}>{asList(tr.value('pour_qui')).map((x, i) => <li key={i}>{x}</li>)}</ul>
                        ) : <p className="text-slate-700 leading-relaxed" {...tr.attrs('pour_qui')}>{tr.value('pour_qui')}</p>}
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Ce que ça aide */}
                {tr.value('ce_que_ca_aide') && (
                  <section aria-labelledby="heading-ce-que">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-ce-que" className="text-lg font-bold text-slate-900 mb-3">{t('aides:detail.helps_with', 'Ce que ça peut aider')}</h2>
                        <p className="text-slate-700 leading-relaxed" {...tr.attrs('ce_que_ca_aide')}>{tr.value('ce_que_ca_aide')}</p>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Documents nécessaires */}
                {asList(tr.value('documents_necessaires')).length > 0 && (
                  <section aria-labelledby="heading-documents">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-documents" className="text-lg font-bold text-slate-900 mb-3">
                          <FileText className="inline h-5 w-5 me-2 text-slate-500" aria-hidden="true" />
                          {t('aides:detail.documents', 'Documents à préparer')}
                        </h2>
                        <ul className="space-y-2" {...tr.attrs('documents_necessaires')}>
                          {asList(tr.value('documents_necessaires')).map((doc, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-slate-700">
                              <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
                              <span>{doc}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Étapes */}
                {tr.value('etapes')?.length > 0 && (
                  <section aria-labelledby="heading-etapes">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-etapes" className="text-lg font-bold text-slate-900 mb-4">{t('aides:detail.steps', 'Étapes de la demande')}</h2>
                        <div className="space-y-4" {...tr.attrs('etapes')}>
                          {tr.value('etapes').map((/** @type {{ description: string | number | boolean | null | undefined, numero: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ etape, /** @type {string} */ idx) => (
                            <div key={idx} className="flex gap-4">
                              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold flex-shrink-0" aria-hidden="true">
                                {etape.numero || idx + 1}
                              </div>
                              <div>
                                <h3 className="font-semibold text-slate-900">{etape.titre}</h3>
                                <p className="text-slate-600 text-sm mt-1">{etape.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Où faire la demande */}
                {(tr.value('ou_demander') || aide.lien_demande) && (
                  <section aria-labelledby="heading-ou-demander">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-ou-demander" className="text-lg font-bold text-slate-900 mb-3">{t('aides:detail.where', 'Où faire la demande ?')}</h2>
                        {tr.value('ou_demander') && <p className="text-slate-700 mb-4" {...tr.attrs('ou_demander')}>{tr.value('ou_demander')}</p>}
                        {aide.lien_demande && (
                          <Button asChild onClick={() => track('click_request_aide', { slug: aide.slug, location: 'body' })}>
                            <a href={aide.lien_demande} target="_blank" rel="noopener noreferrer">
                              {t('aides:detail.apply', 'Faire ma demande')}
                              <ExternalLink className="ms-2 h-4 w-4" aria-hidden="true" />
                            </a>
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Sources — "Consulter la source officielle" */}
                {aide.source_url && (
                  <section aria-labelledby="heading-sources">
                    <Card className="bg-slate-50">
                      <CardContent className="p-6">
                        <h2 id="heading-sources" className="text-lg font-bold text-slate-900 mb-3">{t('aides:detail.sources', 'Sources')}</h2>
                        <ul className="space-y-2">
                          <li>
                            <a href={aide.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                              {t('aides:detail.official_source', 'Consulter la source officielle')}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                            {tr.value('source_name') && (
                              <span className="text-xs text-slate-500 ms-2" {...tr.attrs('source_name')}>({tr.value('source_name')})</span>
                            )}
                          </li>
                        </ul>
                      </CardContent>
                    </Card>
                  </section>
                )}
              </>
            )}
          </article>

          {/* Sidebar */}
          <aside className="space-y-6" aria-label={t('aides:detail.sidebar', 'Actions et informations complémentaires')}>
            <ProvenanceFreshness provenance={provenance} />

            {/* Actions */}
            <Card>
              <CardContent className="p-6 space-y-3">
                {aide.lien_demande && (
                  <Button className="w-full" asChild onClick={() => track('click_request_aide', { slug: aide.slug, location: 'sidebar' })}>
                    <a href={aide.lien_demande} target="_blank" rel="noopener noreferrer">
                      {t('aides:detail.apply', 'Faire ma demande')}
                      <ExternalLink className="ms-2 h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                )}
                {pdfDownloadUrl && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      track('download_aide_pdf', { slug: aide.slug });
                      // R29: the PDF service is closed in the public beta — the browser's own print (« Enregistrer en PDF ») makes the same document
                      if (frontendEnv.flags.publicBeta) window.print(); else window.open(pdfDownloadUrl, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    <Download className="me-2 h-4 w-4" aria-hidden="true" />
                    {frontendEnv.flags.publicBeta ? t('aides:detail.pdf_print', 'Imprimer ou enregistrer en PDF') : t('aides:detail.pdf_download', 'Télécharger en PDF')}
                  </Button>
                )}
                <FavoriteButton entityType="aide" entityId={aide.id} label={tr.value('titre')} />
                <FeedbackButton
                  type="aide"
                  entityId={aide.id}
                  entitySlug={aide.slug}
                  pageUrl={typeof window !== 'undefined' ? window.location.href : null}
                  variant="ghost"
                  size="default"
                />
              </CardContent>
            </Card>

            {/* Structures locales */}
            {filteredStructures.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h3 className="font-bold text-slate-900 mb-4">
                    {t('aides:detail.structures_title', 'Structures qui peuvent vous aider')}
                  </h3>
                  <div className="space-y-3">
                    {filteredStructures.map((/** @type {Record<string, string | number>} */ struct) => (
                      <StructureSuggestion key={struct.id} struct={struct} nextPath={canonicalPath} aideSlug={aide.slug} />
                    ))}
                  </div>
                  <Link to="/structures">
                    <Button variant="link" className="mt-4 p-0">
                      {t('aides:detail.structures_all', 'Voir toutes les structures')}
                      <ChevronRight className="ms-1 h-4 w-4 rtl-flip" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * One local structure next to the aide. R32: a structure's name and town are never translated — they are only marked as French (lang="fr") when
 * the interface is in another language, through its own content-translation view.
 * @param {{ struct: Record<string, any>, nextPath: string, aideSlug: string }} props
 */
function StructureSuggestion({ struct, nextPath, aideSlug }) {
  const { t } = useT('aides');
  const tr = useContentTranslation('structure', struct);
  const bookingPath = struct.slug
    ? buildPublicRdvPath(struct, {
        nextPath,
        aideSlug,
        origin: 'aide',
      })
    : null;

  return (
    <div
      className="p-3 rounded-lg bg-slate-50 border border-slate-100"
    >
      <Link
        to={struct.slug ? `/structures/${struct.slug}` : `/structures/view?id=${struct.id}`}
        className="block hover:text-blue-700 transition-colors"
      >
        <p className="font-medium text-slate-900" {...tr.attrs('nom')}>{struct.nom}</p>
        <p className="text-sm text-slate-600" {...tr.attrs('ville')}>{struct.ville}</p>
      </Link>
      <div className="mt-3 flex flex-wrap gap-2">
        {bookingPath && (
          <Link
            to={bookingPath}
            data-testid={`aide-booking-${struct.id}`}
            className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
          >
            {t('aides:detail.book', 'Prendre rendez-vous')}
          </Link>
        )}
        <Link
          to={struct.slug ? `/structures/${struct.slug}` : `/structures/view?id=${struct.id}`}
          className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
        >
          {t('aides:detail.structure_view', 'Voir la structure')}
        </Link>
      </div>
    </div>
  );
}
