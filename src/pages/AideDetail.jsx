// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { track } from '@vercel/analytics';
import { createPageUrl } from '@/utils';
import { client } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
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
import { formatProvenanceDate, getProvenance } from '@/lib/provenance';
import { useAideDetail } from '@/lib/hooks/useAideDetail';
import CategoryChip, { resolveCategory } from '@/components/ui/CategoryChip';
import { useFalc } from '@/contexts/FalcContext';
import { buildPublicRdvPath } from '@/lib/rdvRouting';



import FavoriteButton from '@/components/FavoriteButton';
import { getCsrfHeaders } from '@/lib/csrf';
export default function AideDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();

  // ------------------------------------------------------------------
  // V2-03: Use useAideDetail hook instead of react-query + direct fetch
  // ------------------------------------------------------------------
  const { status, data, raw: aide, errorMessage, refetch } = useAideDetail(slug);

  // FALC mode — use global context
  const { isFalcEnabled: isFalcMode } = useFalc();
  const [isGeneratingFalc, setIsGeneratingFalc] = useState(false);
  const [falcPreview, setFalcPreview] = useState(/** @type {string | null} */ (null));
  const [falcError, setFalcError] = useState('');   // R12: a failed automatic summary is said, not swallowed   // PKG-6 / D22: automatic preview, never stored, never reviewed
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
  const seoTitle = aide?.titre || data?.title || 'Aide';
  const seoDescription = truncateDescription(
    aide?.summary_falc || aide?.cest_quoi || "Consultez le détail d'une aide sociale."
  ) || "Consultez le détail d'une aide sociale.";
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
  if (status === 'error') {
    return (
      <>
        <SEO
          title="Erreur — Aide"
          description="Une erreur est survenue."
          path={canonicalPath}
        />
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
          <div
            className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-destructive max-w-md text-center"
            role="alert"
            data-testid="aide-detail-error"
          >
            <AlertCircle className="h-10 w-10 mx-auto mb-4 opacity-60" />
            <h1 className="text-xl font-semibold mb-2">Impossible de charger cette aide</h1>
            <p className="text-sm mb-6">
              {errorMessage || 'Vérifiez votre connexion et réessayez.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button type="button" variant="outline" onClick={() => refetch()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Réessayer
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/aides">Retour aux aides</Link>
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
  const fetchedAtLabel = formatProvenanceDate(provenance.fetchedAt);
  const pdfDownloadUrl = (aide?.slug || aide?.id)
    ? `/api/pdf/aides/${encodeURIComponent(aide.slug || aide.id)}`
    : null;

  const getTerritoireLabel = () => {
    if (!aide.territoires?.length) return null;
    if (aide.territoires.includes('national')) return 'France entière';
    return aide.territoires.map(t => {
      if (t === '67') return 'Bas-Rhin (67)';
      if (t === '68') return 'Haut-Rhin (68)';
      return t;
    }).join(', ');
  };

  const territoireLabel = getTerritoireLabel();

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
          <nav className="flex items-center gap-2 text-sm text-slate-600" aria-label="Fil d'Ariane" data-testid="aide-breadcrumb">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">Accueil</Link>
            <ChevronRight className="h-4 w-4" />
            <Link to={createPageUrl('Aides')} className="hover:text-blue-600">Aides</Link>
            <ChevronRight className="h-4 w-4" />
            <span className="text-slate-900" aria-current="page">{aide.titre}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Retour */}
        <Link
          to={createPageUrl('Aides')}
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux aides
        </Link>

        {/* En-tête */}
        <header className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {categoryLabel && <CategoryChip slug={categorySlug} label={categoryLabel} />}
            {aide.est_urgent && (
              <Badge className="bg-red-100 text-red-800">
                <AlertCircle className="h-3 w-3 mr-1" />
                Urgence
              </Badge>
            )}
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
            {aide.titre}
          </h1>

          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            {territoireLabel && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {territoireLabel}
              </span>
            )}
            {fetchedAtLabel && (
              <span className="flex items-center gap-1" title="Date de dernière mise à jour de la source">
                <Calendar className="h-4 w-4" />
                Mise à jour : {fetchedAtLabel}
              </span>
            )}
            {aide.delai_indicatif && (
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {aide.delai_indicatif}
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
          {isFalcMode && !hasFalcContent && (
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
                    setFalcError(res.status === 429 ? 'Trop de demandes : réessayez dans une minute.' : 'Le résumé simplifié automatique n’est pas disponible pour le moment. La fiche complète ci-dessous reste valable.');
                  }
                } catch {
                  setFalcError('Le service ne répond pas pour le moment. La fiche complète ci-dessous reste valable.');
                } finally {
                  setIsGeneratingFalc(false);
                }
              }}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {isGeneratingFalc ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Simplification en cours...
                </>
              ) : (
                <>
                  Résumé simplifié automatique
                </>
              )}
            </button>
          )}
          {isFalcMode && falcError && <p role="alert" data-testid="falc-preview-error" className="mt-3 text-sm text-red-800">{falcError}</p>}
          {isFalcMode && falcPreview && (
            <div role="status" data-testid="falc-preview" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-slate-900">
              <p className="text-sm font-semibold">Résumé automatique, non relu par une personne. Il peut être incomplet : la fiche complète fait foi.</p>
              <p className="mt-2 whitespace-pre-line">{falcPreview}</p>
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Contenu principal */}
          <article className="lg:col-span-2 space-y-6">
            {isFalcMode ? (
              /* FALC Mode Content */
              <section aria-label="Version simplifiée (FALC)">
                <Card>
                  <CardContent className="p-6">
                    <FalcContent falcData={aide} entityType="aide" />
                  </CardContent>
                </Card>
              </section>
            ) : (
              /* Normal Mode Content */
              <>
                {/* C'est quoi ? */}
                {aide.cest_quoi && (
                  <section aria-labelledby="heading-cest-quoi">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-cest-quoi" className="text-lg font-bold text-slate-900 mb-3">C&apos;est quoi ?</h2>
                        <p className="text-slate-700 leading-relaxed">{aide.cest_quoi}</p>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* the easy-to-read version is a page of its own, not a copy inside this one */}
                {hasFalcContent && <FalcInvite />}

                {/* Pour qui ? */}
                {aide.pour_qui && (
                  <section aria-labelledby="heading-pour-qui">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-pour-qui" className="text-lg font-bold text-slate-900 mb-3">Pour qui ?</h2>
                        {asList(aide.pour_qui).length > 1 ? (
                          <ul className="list-disc space-y-1 pl-5 text-slate-700">{asList(aide.pour_qui).map((x, i) => <li key={i}>{x}</li>)}</ul>
                        ) : <p className="text-slate-700 leading-relaxed">{aide.pour_qui}</p>}
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Ce que ça aide */}
                {aide.ce_que_ca_aide && (
                  <section aria-labelledby="heading-ce-que">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-ce-que" className="text-lg font-bold text-slate-900 mb-3">Ce que ça peut aider</h2>
                        <p className="text-slate-700 leading-relaxed">{aide.ce_que_ca_aide}</p>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Documents nécessaires */}
                {asList(aide.documents_necessaires).length > 0 && (
                  <section aria-labelledby="heading-documents">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-documents" className="text-lg font-bold text-slate-900 mb-3">
                          <FileText className="inline h-5 w-5 mr-2 text-slate-500" aria-hidden="true" />
                          Documents à préparer
                        </h2>
                        <ul className="space-y-2">
                          {asList(aide.documents_necessaires).map((doc, idx) => (
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
                {aide.etapes?.length > 0 && (
                  <section aria-labelledby="heading-etapes">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-etapes" className="text-lg font-bold text-slate-900 mb-4">Étapes de la demande</h2>
                        <div className="space-y-4">
                          {aide.etapes.map((/** @type {{ description: string | number | boolean | null | undefined, numero: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ etape, /** @type {string} */ idx) => (
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
                {(aide.ou_demander || aide.lien_demande) && (
                  <section aria-labelledby="heading-ou-demander">
                    <Card>
                      <CardContent className="p-6">
                        <h2 id="heading-ou-demander" className="text-lg font-bold text-slate-900 mb-3">Où faire la demande ?</h2>
                        {aide.ou_demander && <p className="text-slate-700 mb-4">{aide.ou_demander}</p>}
                        {aide.lien_demande && (
                          <Button asChild onClick={() => track('click_request_aide', { slug: aide.slug, location: 'body' })}>
                            <a href={aide.lien_demande} target="_blank" rel="noopener noreferrer">
                              Faire ma demande
                              <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
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
                        <h2 id="heading-sources" className="text-lg font-bold text-slate-900 mb-3">Sources</h2>
                        <ul className="space-y-2">
                          <li>
                            <a href={aide.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                              Consulter la source officielle
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                            {aide.source_name && (
                              <span className="text-xs text-slate-500 ml-2">({aide.source_name})</span>
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
          <aside className="space-y-6" aria-label="Actions et informations complémentaires">
            <ProvenanceFreshness provenance={provenance} />

            {/* Actions */}
            <Card>
              <CardContent className="p-6 space-y-3">
                {aide.lien_demande && (
                  <Button className="w-full" asChild onClick={() => track('click_request_aide', { slug: aide.slug, location: 'sidebar' })}>
                    <a href={aide.lien_demande} target="_blank" rel="noopener noreferrer">
                      Faire ma demande
                      <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                )}
                {pdfDownloadUrl && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      track('download_aide_pdf', { slug: aide.slug });
                      window.open(pdfDownloadUrl, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                    Télécharger en PDF
                  </Button>
                )}
                <FavoriteButton entityType="aide" entityId={aide.id} label={aide.titre} />
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
                    Structures qui peuvent vous aider
                  </h3>
                  <div className="space-y-3">
                    {filteredStructures.map((/** @type {Record<string, string | number>} */ struct) => {
                      const bookingPath = struct.slug
                        ? buildPublicRdvPath(struct, {
                            nextPath: canonicalPath,
                            aideSlug: aide.slug,
                            origin: 'aide',
                          })
                        : null;

                      return (
                        <div
                          key={struct.id}
                          className="p-3 rounded-lg bg-slate-50 border border-slate-100"
                        >
                          <Link
                            to={struct.slug ? `/structures/${struct.slug}` : `/structures/view?id=${struct.id}`}
                            className="block hover:text-blue-700 transition-colors"
                          >
                            <p className="font-medium text-slate-900">{struct.nom}</p>
                            <p className="text-sm text-slate-600">{struct.ville}</p>
                          </Link>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {bookingPath && (
                              <Link
                                to={bookingPath}
                                data-testid={`aide-booking-${struct.id}`}
                                className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                              >
                                Prendre rendez-vous
                              </Link>
                            )}
                            <Link
                              to={struct.slug ? `/structures/${struct.slug}` : `/structures/view?id=${struct.id}`}
                              className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                            >
                              Voir la structure
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Link to="/structures">
                    <Button variant="link" className="mt-4 p-0">
                      Voir toutes les structures
                      <ChevronRight className="ml-1 h-4 w-4" />
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
