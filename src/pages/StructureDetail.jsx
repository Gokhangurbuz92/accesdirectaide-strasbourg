// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import SEO from '@/components/SEO';
import NotFound from "./NotFound";
import Gone from "./Gone";
import { createPageUrl } from '@/utils';
import { client } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Globe,
  Clock,
  Accessibility,
  ChevronRight,
  ExternalLink,
  Calendar
} from 'lucide-react';
import { generateBreadcrumbSchema, generateStructureSchema } from '@/utils/schema';
import ProvenanceFreshness from '@/components/ProvenanceFreshness';
import FalcInvite from '@/components/FalcInvite';
import AutoVerificationNote from '@/components/AutoVerificationNote';
import ExternalServices from '@/components/ExternalServices';
import FalcToggle from '@/components/FalcToggle';
import FalcContent from '@/components/FalcContent';
import { getProvenance } from '@/lib/provenance';
import { buildPublicRdvPath } from '@/lib/rdvRouting';
import { departementLabel } from '@/lib/structureFields';
import FavoriteButton from '@/components/FavoriteButton';
import { useFalc } from '@/contexts/FalcContext';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';
import ContentTranslationNotice from '@/components/i18n/ContentTranslationNotice';

// R32: the French labels (a badge is shown only for these types); typeLabel() gives them in the interface language — the names of public bodies and the
// acronyms are not translated
const TYPE_LABELS = {
  association: 'Association',
  service_public: 'Service public',
  etablissement_sante: 'Établissement de santé',
  mairie: 'Mairie',
  caf: 'CAF',
  mdph: 'MDPH',
  france_travail: 'France Travail',
  cpam: 'CPAM',
  ccas: 'CCAS',
  ehpad: 'EHPAD',
  france_services: 'France Services',
  carsat: 'CARSAT',
  mission_locale: 'Mission Locale',
  pmi: 'PMI',
};

/** the verification date as the page has always shown it (« 30/10/2026 »), in the interface language */
const NUMERIC_DATE = { day: '2-digit', month: '2-digit', year: 'numeric' };

/** the place on OpenStreetMap: its marker when the coordinates are known, otherwise a search of its address @param {any} st */
export function mapUrl(st) {
  const lat = Number(st?.latitude); const lon = Number(st?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent([st?.adresse, st?.code_postal, st?.ville].filter(Boolean).join(' '))}`;
}

export default function StructureDetail() {
  const { t } = useT('structures');
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const structureId = searchParams.get('id');

  // FALC mode — use global context
  const { isFalcEnabled: isFalcMode } = useFalc();

  const { data: queryData, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ['structure', slug || structureId],
    queryFn: () => client.entities.Structure.filter(slug ? { slug } : { id: structureId }),
    // API now returns single object for id/slug queries
    enabled: !!slug || !!structureId,
    // R12 (P06): an absent / withdrawn structure is final; a server error, a rate limit or a network failure is retried once, then shown as such
    retry: (count, e) => ![404, 410].includes(/** @type {any} */ (e)?.status) && count < 1,
  });
  const loadStatus = /** @type {any} */ (loadError)?.status;

  const structure = Array.isArray(queryData)
    ? queryData[0]
    : (queryData?.items ? queryData?.items[0] : queryData);

  // R32: names, addresses, phone numbers, e-mails, websites and opening hours are never translated — tr.attrs() marks them as French; the descriptions
  // follow the content translation
  const tr = useContentTranslation('structure', structure);

  // Canonical Redirect: If accessed via ID but slug exists, redirect to slug URL
  useEffect(() => {
    if (structure && !slug && structure.slug) {
      navigate(`/structures/${structure.slug}`, { replace: true });
    }
  }, [structure, slug, navigate]);

  if (isLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  // R12 (P06): « introuvable » only when the server says so — before, a 500, a 429 or a lost connection also told the person the structure did not exist
  if (loadError && loadStatus === 410) return <Gone />;
  if (loadError && loadStatus !== 404) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center px-4">
        <div role="alert" data-testid="structure-detail-error" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-900 max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">{t('structures:detail.error.title', 'Impossible de charger cette structure')}</h1>
          <p className="text-sm mb-6">{loadStatus === 429 ? t('structures:detail.error.rate_limited', 'Trop de demandes en peu de temps : patientez une minute puis réessayez.') : t('structures:detail.error.unavailable', 'Le service ne répond pas pour le moment. Vérifiez votre connexion et réessayez.')}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button type="button" variant="outline" onClick={() => refetch()}>{t('structures:error.retry', 'Réessayer')}</Button>
            <Button variant="ghost" asChild><Link to="/structures">{t('structures:detail.error.back', 'Retour à l’annuaire')}</Link></Button>
          </div>
        </div>
      </div>
    );
  }

  if (!structure) {
    return <NotFound />;
  }

  const name = tr.value('nom');

  /** the type badge in the interface language @param {string} type */
  const typeLabel = (type) => {
    switch (type) {
      case 'association': return t('structures:types.association', 'Association');
      case 'service_public': return t('structures:types.service_public', 'Service public');
      case 'etablissement_sante': return t('structures:types.etablissement_sante', 'Établissement de santé');
      case 'mairie': return t('structures:types.mairie', 'Mairie');
      default: return TYPE_LABELS[type];   // CAF, MDPH, France Travail, CPAM, CCAS, EHPAD, France Services, CARSAT, Mission Locale, PMI
    }
  };

  const breadcrumbs = [
    { name: t('structures:breadcrumb.home', 'Accueil'), url: '/' },
    { name: t('structures:breadcrumb.directory', 'Annuaire'), url: '/structures' },
    { name, url: `/structures/${structure.slug}` }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateStructureSchema(structure)
  ].filter(Boolean);
  const provenance = getProvenance(structure);
  const rdvPath = buildPublicRdvPath(structure);
  const services = tr.value('services');
  const publics = tr.value('publics_accueillis');
  // the easy-to-read view reads the same record, its descriptions through the content translation
  const falcView = { ...structure, resume_falc: tr.value('resume_falc'), summary_falc: tr.value('summary_falc'), description_falc: tr.value('description_falc'), description_courte: tr.value('description_courte'), services };

  // the contact details are shown in both reading modes (the easy-to-read version replaced them before, and a person reading it could not find how to reach the place)
  const contactCard = (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">{t('structures:detail.contact', 'Coordonnées')}</h2>
        <div className="space-y-4">
          {structure.adresse && (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">{t('structures:detail.address', 'Adresse')}</p>
                <p className="text-slate-600" {...tr.attrs('adresse')}>
                  {tr.value('adresse')}<br />
                  {tr.value('code_postal')} {tr.value('ville')}
                </p>
                {/* R27: the visitor could not see where the place is — a map link (OpenStreetMap: no account, no tracking by AccesDirectAide) */}
                <a href={mapUrl(structure)} target="_blank" rel="noopener noreferrer" data-testid="structure-map-link"
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded">
                  {t('structures:detail.map_link', 'Voir sur une carte')}<span className="sr-only"> {t('structures:detail.map_link_hint', '(OpenStreetMap, nouvel onglet)')}</span>
                </a>
              </div>
            </div>
          )}

          {(structure.verification_auto?.phones?.length > 0 || structure.telephone) && (
            <div className="flex items-start gap-3">
              <Phone className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">{t('structures:detail.phone', 'Téléphone')}</p>
                {/* a public office: every line the Annuaire de l'administration lists, with when it answers */}
                {structure.verification_auto?.phones?.length > 0 ? (
                  <ul className="space-y-1" data-testid="structure-phones" {...tr.attrs('verification_auto')}>
                    {structure.verification_auto.phones.map((ph, i) => (
                      <li key={i}>
                        <a href={`tel:${String(ph.numero).replace(/\s/g, '')}`} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">{ph.numero}</a>
                        {ph.precision ? <span className="block text-sm text-slate-600">{ph.precision}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <a href={`tel:${structure.telephone}`} className="text-blue-600 hover:underline" {...tr.attrs('telephone')}>{tr.value('telephone')}</a>
                )}
                {structure.verification_auto?.accessiblePhone?.length > 0 && (
                  <a href={structure.verification_auto.accessiblePhone[0].url} target="_blank" rel="noopener noreferrer" data-testid="structure-accessible-phone"
                    className="mt-1 block text-sm text-blue-700 underline underline-offset-2 hover:text-blue-900">
                    {t('structures:detail.accessible_call', 'Appel accessible aux personnes sourdes ou malentendantes')}{structure.verification_auto.accessiblePhone[0].precision ? <> (<span {...tr.attrs('verification_auto')}>{structure.verification_auto.accessiblePhone[0].precision}</span>)</> : ''}
                  </a>
                )}
              </div>
            </div>
          )}

          {structure.verification_auto?.contactForm && (
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">{t('structures:detail.write', 'Écrire')}</p>
                <a href={structure.verification_auto.contactForm} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2 hover:text-blue-900">{t('structures:detail.contact_form', 'Formulaire de contact officiel')}</a>
              </div>
            </div>
          )}

          {structure.email && (
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">{t('structures:detail.email', 'Email')}</p>
                <a
                  href={`mailto:${structure.email}`}
                  className="text-blue-600 hover:underline"
                  {...tr.attrs('email')}
                >
                  {tr.value('email')}
                </a>
              </div>
            </div>
          )}

          {structure.site_web && (
            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">{t('structures:detail.website', 'Site web')}</p>
                <a
                  href={structure.site_web}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline flex items-center gap-1"
                >
                  {t('structures:detail.visit_site', 'Visiter le site')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {structure.horaires && (
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">{t('structures:detail.hours', 'Horaires')}</p>
                <p className="text-slate-600 whitespace-pre-line" {...tr.attrs('horaires')}>
                  {tr.value('horaires')}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={name}
        description={tr.value('description_courte') || t('structures:detail.seo_description', 'Détails de {{name}}', { name })}
        path={`/structures/${structure.slug}`}
        schema={schema}
      />
      {/* Fil d'Ariane */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">{t('structures:breadcrumb.home', 'Accueil')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <Link to="/structures" className="hover:text-blue-600">{t('structures:breadcrumb.directory', 'Annuaire')}</Link>
            <ChevronRight className="h-4 w-4 rtl-flip" />
            <span className="min-w-0 text-slate-900 [overflow-wrap:anywhere]" {...tr.attrs('nom')}>{name}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Retour */}
        <Link
          to="/structures"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4 rtl-flip" />
          {t('structures:detail.back', "Retour à l'annuaire")}
        </Link>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Contenu principal */}
          <div className="lg:col-span-2 space-y-6">
            {/* En-tête */}
            <Card>
              <CardContent className="p-6 md:p-8">
                <div className="flex flex-wrap gap-2 mb-4">
                  {TYPE_LABELS[structure.type_structure] && (
                    <Badge className="bg-blue-100 text-blue-800">
                      {typeLabel(structure.type_structure)}
                    </Badge>
                  )}
                  {structure.accessibilite_pmr && (
                    <Badge variant="outline" className="text-green-700 border-green-300">
                      <Accessibility className="h-3 w-3 me-1" />
                      {t('structures:pmr', 'Accessible PMR')}
                    </Badge>
                  )}
                </div>

                <div className="mb-2"><FavoriteButton entityType="structure" entityId={structure.id} label={structure.nom} /></div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4" {...tr.attrs('nom')}>
                  {name}
                </h1>
                <ContentTranslationNotice translation={tr} className="mb-4" />

                {structure.description_courte && (
                  <p className="text-slate-600 text-lg" {...tr.attrs('description_courte')}>
                    {tr.value('description_courte')}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* automatic verification: when, against which official registers */}
            <div className="mb-4"><AutoVerificationNote record={structure} kind="structure" /></div>

            {/* FALC Toggle */}
            <div className="mb-4">
              <FalcToggle
                hasFalcContent={!!(structure?.resume_falc || structure?.summary_falc || structure?.description_falc)}
                review={{ at: structure?.falc_reviewed_at, origin: structure?.falc_origin, fields: structure?.falc_field_review, auto: structure?.verification_auto?.checkedAt || null }}
                onChange={() => { }}
              />
            </div>

            {isFalcMode ? (
              <>
                <Card>
                  <CardContent className="p-6">
                    <FalcContent falcData={falcView} entityType="structure" />
                  </CardContent>
                </Card>
                {/* the easy-to-read mode keeps how to reach the place: address, every official line, the accessible line, the contact form, the hours */}
                {contactCard}
                <ExternalServices data={tr.value('services_externes')} textAttrs={tr.attrs('services_externes')} easy />
              </>
            ) : (
              <>
                {!!(structure?.resume_falc || structure?.summary_falc || structure?.description_falc) && <FalcInvite />}

                {contactCard}

                {/* Services */}
                {structure.services?.length > 0 && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-4">{t('structures:detail.services', 'Services proposés')}</h2>
                      <div className="flex flex-wrap gap-2">
                        {(services || []).map((/** @type {any} */ service, /** @type {any} */ idx) => (
                          <Badge key={idx} variant="secondary" className="bg-slate-100 text-slate-700" {...tr.attrs('services')}>
                            {service}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* R11 / D05: the services other public platforms list, each attributed to its producer */}
                <ExternalServices data={tr.value('services_externes')} textAttrs={tr.attrs('services_externes')} />

                {/* Pro Services (Lot 4) */}
                {structure.is_pro_enabled && (
                  <Card className="border-indigo-100 bg-indigo-50/30">
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-indigo-900 mb-4 flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        {t('structures:detail.booking.title', 'Prendre rendez-vous')}
                      </h2>
                      <p className="text-slate-700 mb-4">
                        {t('structures:detail.booking.text', 'Cette structure propose la prise de rendez-vous en ligne.')}
                      </p>
                      <Button className="w-full bg-indigo-600 hover:bg-indigo-700" asChild>
                        <Link to={rdvPath}>
                          {t('structures:detail.booking.slots', 'Voir les créneaux disponibles')}
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Publics accueillis */}
                {structure.publics_accueillis?.length > 0 && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-4">{t('structures:detail.publics', 'Publics accueillis')}</h2>
                      <div className="flex flex-wrap gap-2">
                        {(publics || []).map((/** @type {any} */ public_, /** @type {any} */ idx) => (
                          <Badge key={idx} variant="outline" className="border-slate-300 text-slate-700" {...tr.attrs('publics_accueillis')}>
                            {public_}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <ProvenanceFreshness provenance={provenance} />

            {/* Actions rapides */}
            <Card>
              <CardContent className="p-6 space-y-3">
                {structure.is_pro_enabled ? (
                  <Button className="w-full bg-indigo-600 hover:bg-indigo-700" asChild>
                    <Link to={rdvPath}>
                      <Calendar className="me-2 h-4 w-4" />
                      {t('structures:detail.booking.title', 'Prendre rendez-vous')}
                    </Link>
                  </Button>
                ) : (
                  // owner usefulness pass (2026-10-25): this structure takes no booking online; the button led through sign-in to an error page
                  <p className="text-sm text-slate-700" data-testid="structure-no-online-booking">{t('structures:detail.no_online_booking', 'Pas de prise de rendez-vous en ligne pour cette structure : contactez-la directement.')}</p>
                )}

                {structure.telephone && (
                  <Button className="w-full" asChild>
                    <a href={`tel:${structure.telephone}`}>
                      <Phone className="me-2 h-4 w-4" />
                      {t('structures:detail.call', 'Appeler')}
                    </a>
                  </Button>
                )}
                {structure.site_web && (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={structure.site_web} target="_blank" rel="noopener noreferrer">
                      <Globe className="me-2 h-4 w-4" />
                      {t('structures:detail.visit_site', 'Visiter le site')}
                    </a>
                  </Button>
                )}
                {structure.email && (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={`mailto:${structure.email}`}>
                      <Mail className="me-2 h-4 w-4" />
                      {t('structures:detail.send_email', 'Envoyer un email')}
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Informations */}
            <Card className="bg-slate-50">
              <CardContent className="p-6">
                <h3 className="font-semibold text-slate-900 mb-3">{t('structures:detail.information', 'Informations')}</h3>
                <div className="space-y-2 text-sm text-slate-600">
                  {departementLabel(structure) && (
                    <p>
                      <span className="font-medium">{t('structures:detail.departement', 'Département :')}</span>{' '}
                      {departementLabel(structure)}
                    </p>
                  )}
                  {/* PKG-11 audit: a date is a verification only when the server says the content is VERIFIED */}
                  {structure.provenance?.contentStatus === 'VERIFIED' && structure.provenance?.verifiedAt && (
                    <p className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {t('structures:verified_on', 'Vérifié le {{date}}', { date: formatDate(structure.provenance.verifiedAt, NUMERIC_DATE) })}
                    </p>
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
