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

/** the place on OpenStreetMap: its marker when the coordinates are known, otherwise a search of its address @param {any} st */
export function mapUrl(st) {
  const lat = Number(st?.latitude); const lon = Number(st?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent([st?.adresse, st?.code_postal, st?.ville].filter(Boolean).join(' '))}`;
}

export default function StructureDetail() {
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
          <h1 className="text-xl font-semibold mb-2">Impossible de charger cette structure</h1>
          <p className="text-sm mb-6">{loadStatus === 429 ? 'Trop de demandes en peu de temps : patientez une minute puis réessayez.' : 'Le service ne répond pas pour le moment. Vérifiez votre connexion et réessayez.'}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button type="button" variant="outline" onClick={() => refetch()}>Réessayer</Button>
            <Button variant="ghost" asChild><Link to="/structures">Retour à l’annuaire</Link></Button>
          </div>
        </div>
      </div>
    );
  }

  if (!structure) {
    return <NotFound />;
  }

  const breadcrumbs = [
    { name: 'Accueil', url: '/' },
    { name: 'Annuaire', url: '/structures' },
    { name: structure.nom, url: `/structures/${structure.slug}` }
  ];

  const schema = [
    generateBreadcrumbSchema(breadcrumbs),
    generateStructureSchema(structure)
  ].filter(Boolean);
  const provenance = getProvenance(structure);
  const rdvPath = buildPublicRdvPath(structure);

  // the contact details are shown in both reading modes (the easy-to-read version replaced them before, and a person reading it could not find how to reach the place)
  const contactCard = (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Coordonnées</h2>
        <div className="space-y-4">
          {structure.adresse && (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Adresse</p>
                <p className="text-slate-600">
                  {structure.adresse}<br />
                  {structure.code_postal} {structure.ville}
                </p>
                {/* R27: the visitor could not see where the place is — a map link (OpenStreetMap: no account, no tracking by AccesDirectAide) */}
                <a href={mapUrl(structure)} target="_blank" rel="noopener noreferrer" data-testid="structure-map-link"
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded">
                  Voir sur une carte<span className="sr-only"> (OpenStreetMap, nouvel onglet)</span>
                </a>
              </div>
            </div>
          )}

          {(structure.verification_auto?.phones?.length > 0 || structure.telephone) && (
            <div className="flex items-start gap-3">
              <Phone className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Téléphone</p>
                {/* a public office: every line the Annuaire de l'administration lists, with when it answers */}
                {structure.verification_auto?.phones?.length > 0 ? (
                  <ul className="space-y-1" data-testid="structure-phones">
                    {structure.verification_auto.phones.map((ph, i) => (
                      <li key={i}>
                        <a href={`tel:${String(ph.numero).replace(/\s/g, '')}`} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">{ph.numero}</a>
                        {ph.precision ? <span className="block text-sm text-slate-600">{ph.precision}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <a href={`tel:${structure.telephone}`} className="text-blue-600 hover:underline">{structure.telephone}</a>
                )}
                {structure.verification_auto?.accessiblePhone?.length > 0 && (
                  <a href={structure.verification_auto.accessiblePhone[0].url} target="_blank" rel="noopener noreferrer" data-testid="structure-accessible-phone"
                    className="mt-1 block text-sm text-blue-700 underline underline-offset-2 hover:text-blue-900">
                    Appel accessible aux personnes sourdes ou malentendantes{structure.verification_auto.accessiblePhone[0].precision ? ` (${structure.verification_auto.accessiblePhone[0].precision})` : ''}
                  </a>
                )}
              </div>
            </div>
          )}

          {structure.verification_auto?.contactForm && (
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Écrire</p>
                <a href={structure.verification_auto.contactForm} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2 hover:text-blue-900">Formulaire de contact officiel</a>
              </div>
            </div>
          )}

          {structure.email && (
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Email</p>
                <a
                  href={`mailto:${structure.email}`}
                  className="text-blue-600 hover:underline"
                >
                  {structure.email}
                </a>
              </div>
            </div>
          )}

          {structure.site_web && (
            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Site web</p>
                <a
                  href={structure.site_web}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline flex items-center gap-1"
                >
                  Visiter le site
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {structure.horaires && (
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Horaires</p>
                <p className="text-slate-600 whitespace-pre-line">
                  {structure.horaires}
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
        title={structure.nom}
        description={structure.description_courte || `Détails de ${structure.nom}`}
        path={`/structures/${structure.slug}`}
        schema={schema}
      />
      {/* Fil d'Ariane */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-slate-600">
            <Link to={createPageUrl('Home')} className="hover:text-blue-600">Accueil</Link>
            <ChevronRight className="h-4 w-4" />
            <Link to="/structures" className="hover:text-blue-600">Annuaire</Link>
            <ChevronRight className="h-4 w-4" />
            <span className="text-slate-900">{structure.nom}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Retour */}
        <Link
          to="/structures"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à l'annuaire
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
                      {TYPE_LABELS[structure.type_structure]}
                    </Badge>
                  )}
                  {structure.accessibilite_pmr && (
                    <Badge variant="outline" className="text-green-700 border-green-300">
                      <Accessibility className="h-3 w-3 mr-1" />
                      Accessible PMR
                    </Badge>
                  )}
                </div>

                <div className="mb-2"><FavoriteButton entityType="structure" entityId={structure.id} label={structure.nom} /></div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
                  {structure.nom}
                </h1>

                {structure.description_courte && (
                  <p className="text-slate-600 text-lg">
                    {structure.description_courte}
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
                    <FalcContent falcData={structure} entityType="structure" />
                  </CardContent>
                </Card>
                {/* the easy-to-read mode keeps how to reach the place: address, every official line, the accessible line, the contact form, the hours */}
                {contactCard}
                <ExternalServices data={structure.services_externes} easy />
              </>
            ) : (
              <>
                {!!(structure?.resume_falc || structure?.summary_falc || structure?.description_falc) && <FalcInvite />}

                {contactCard}

                {/* Services */}
                {structure.services?.length > 0 && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-4">Services proposés</h2>
                      <div className="flex flex-wrap gap-2">
                        {structure.services.map((/** @type {any} */ service, /** @type {any} */ idx) => (
                          <Badge key={idx} variant="secondary" className="bg-slate-100 text-slate-700">
                            {service}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* R11 / D05: the services other public platforms list, each attributed to its producer */}
                <ExternalServices data={structure.services_externes} />

                {/* Pro Services (Lot 4) */}
                {structure.is_pro_enabled && (
                  <Card className="border-indigo-100 bg-indigo-50/30">
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-indigo-900 mb-4 flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Prendre rendez-vous
                      </h2>
                      <p className="text-slate-700 mb-4">
                        Cette structure propose la prise de rendez-vous en ligne.
                      </p>
                      <Button className="w-full bg-indigo-600 hover:bg-indigo-700" asChild>
                        <Link to={rdvPath}>
                          Voir les créneaux disponibles
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Publics accueillis */}
                {structure.publics_accueillis?.length > 0 && (
                  <Card>
                    <CardContent className="p-6">
                      <h2 className="text-lg font-bold text-slate-900 mb-4">Publics accueillis</h2>
                      <div className="flex flex-wrap gap-2">
                        {structure.publics_accueillis.map((/** @type {any} */ public_, /** @type {any} */ idx) => (
                          <Badge key={idx} variant="outline" className="border-slate-300 text-slate-700">
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
                      <Calendar className="mr-2 h-4 w-4" />
                      Prendre rendez-vous
                    </Link>
                  </Button>
                ) : (
                  // owner usefulness pass (2026-10-25): this structure takes no booking online; the button led through sign-in to an error page
                  <p className="text-sm text-slate-700" data-testid="structure-no-online-booking">Pas de prise de rendez-vous en ligne pour cette structure : contactez-la directement.</p>
                )}

                {structure.telephone && (
                  <Button className="w-full" asChild>
                    <a href={`tel:${structure.telephone}`}>
                      <Phone className="mr-2 h-4 w-4" />
                      Appeler
                    </a>
                  </Button>
                )}
                {structure.site_web && (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={structure.site_web} target="_blank" rel="noopener noreferrer">
                      <Globe className="mr-2 h-4 w-4" />
                      Visiter le site
                    </a>
                  </Button>
                )}
                {structure.email && (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={`mailto:${structure.email}`}>
                      <Mail className="mr-2 h-4 w-4" />
                      Envoyer un email
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Informations */}
            <Card className="bg-slate-50">
              <CardContent className="p-6">
                <h3 className="font-semibold text-slate-900 mb-3">Informations</h3>
                <div className="space-y-2 text-sm text-slate-600">
                  {departementLabel(structure) && (
                    <p>
                      <span className="font-medium">Département :</span>{' '}
                      {departementLabel(structure)}
                    </p>
                  )}
                  {/* PKG-11 audit: a date is a verification only when the server says the content is VERIFIED */}
                  {structure.provenance?.contentStatus === 'VERIFIED' && structure.provenance?.verifiedAt && (
                    <p className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      Vérifié le {new Date(structure.provenance.verifiedAt).toLocaleDateString('fr-FR')}
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
