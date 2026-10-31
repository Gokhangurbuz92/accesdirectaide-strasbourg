// @ts-nocheck
import { Link } from 'react-router-dom';
import {
  MapPin,
  Phone,
  Globe,
  Clock,
  Calendar,
  Accessibility,
  ArrowRight,
  Brain
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import CategoryChip from "@/components/ui/CategoryChip";
import { RecordProvenance, CardActionStrip } from '@/components/cards/RecordCardParts';
import { formatProvenanceDate, getProvenance } from '@/lib/provenance';
import { buildPublicRdvPath } from '@/lib/rdvRouting';
import { useFalc } from '@/contexts/FalcContext';
import AnimatedCard from '@/components/ui/AnimatedCard';

const TYPE_LABELS = {
  association: 'Association',
  service_public: 'Service public',
  etablissement_sante: 'Établissement de santé',
  mairie: 'Mairie',
  caf: 'CAF',
  mdph: 'MDPH',
  france_travail: 'France Travail',
  cpam: 'CPAM',
  autre: 'Autre',
};

const TYPE_COLORS = {
  association: 'bg-green-100 text-green-800',
  service_public: 'bg-blue-100 text-blue-800',
  etablissement_sante: 'bg-red-100 text-red-800',
  mairie: 'bg-purple-100 text-purple-800',
  caf: 'bg-orange-100 text-orange-800',
  mdph: 'bg-indigo-100 text-indigo-800',
  france_travail: 'bg-cyan-100 text-cyan-800',
  cpam: 'bg-teal-100 text-teal-800',
};

export default function StructureCard({ structure, compact = false, index = 0 }) {
  const { isFalcEnabled } = useFalc();
  const provenance = getProvenance(structure);
  const verifiedAt = formatProvenanceDate(provenance.verifiedAt);
  const sourceHost = provenance.sourceHost;
  const targetUrl = structure.slug ? `/structures/${structure.slug}` : `/structures/view?id=${structure.id}`;
  const isPmrAccessible = Boolean(structure.accessibilite_pmr || structure.accessibility_info?.pmr);

  return (
    <AnimatedCard index={index}>
      <Card className="group hover:shadow-lg transition-all duration-300 border-slate-200 hover:border-blue-300 bg-white relative flex h-full flex-col overflow-hidden" data-testid="structure-card">
        {/* Overlay Link */}
        <Link
          to={targetUrl}
          className="absolute inset-0 z-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-xl"
          aria-label={`Voir la fiche de ${structure.nom}`}
        >
          <span className="sr-only">Voir la fiche de {structure.nom}</span>
        </Link>

        <CardContent className="flex h-full flex-col p-0">
          <div className={`flex flex-1 flex-col gap-3 ${compact ? 'p-4' : 'p-6'}`}>
            {/* En-tête */}
            <div className="flex flex-wrap gap-2 items-start justify-between">
              <div className="flex flex-wrap gap-2">
                {structure.categorie && (
                  <CategoryChip slug={structure.categorie} />
                )}
                <Badge className={TYPE_COLORS[structure.type_structure] || 'bg-slate-100 text-slate-800'}>
                  {TYPE_LABELS[structure.type_structure] || structure.type_structure}
                </Badge>
                {structure.coverage === 'OFFICIAL' && (
                  <Badge variant="outline" className="text-green-700 border-green-300">
                    Source officielle
                  </Badge>
                )}
                {structure.coverage === 'LOCAL_OPEN_DATA' && (
                  <Badge variant="outline" className="text-blue-700 border-blue-300">
                    Open data local
                  </Badge>
                )}
                {structure.coverage === 'SUGGESTED_NEEDS_REVIEW' && (
                  <Badge variant="outline" className="text-orange-700 border-orange-300">
                    Contribution
                  </Badge>
                )}
                {structure.is_pro_enabled && (
                  <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    RDV en ligne
                  </Badge>
                )}
              </div>
              {isPmrAccessible && (
                <Badge variant="outline" className="text-blue-700 border-blue-300 flex items-center gap-1">
                  <Accessibility className="h-3 w-3" />
                  Accessible PMR
                </Badge>
              )}
            </div>

            {/* Nom */}
            <h3 className={`font-semibold text-slate-900 group-hover:text-blue-700 transition-colors ${compact ? 'text-base' : 'text-lg'}`} data-testid="structure-title">
              {structure.nom}
            </h3>

            {/* Description */}
            {(structure.description_courte || (isFalcEnabled && structure.summary_falc)) && (
              <p className="text-slate-600 text-sm line-clamp-4">
                {isFalcEnabled && structure.summary_falc ? structure.summary_falc : structure.description_courte}
              </p>
            )}
            {/* PKG-11 / E04: why this structure is in the results when it is a service it declares (its own words, not a promise) */}
            {Array.isArray(structure.whyShown?.services) && structure.whyShown.services.length > 0 && (
              <p className="text-sm text-slate-800" data-testid="structure-why-shown">
                Correspond à votre recherche : indique proposer {structure.whyShown.services.map((x) => `« ${x} »`).join(', ')}.
              </p>
            )}
            {/* FALC badge */}
            {isFalcEnabled && structure.summary_falc && (
              <Badge className="bg-teal-100 text-teal-700 border-teal-200 flex items-center gap-1 w-fit">
                <Brain className="h-3 w-3" />
                Simplifié
              </Badge>
            )}

            {/* Infos de contact */}
            <div className="space-y-2 text-sm text-slate-600 relative z-20">
              {/* Note: Links inside here like telephone/email must be z-20 to be clickable. */}
              {structure.adresse && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  <span>
                    {structure.adresse}, {structure.code_postal} {structure.ville}
                  </span>
                </div>
              )}
              {structure.telephone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                  {/* Ensure telephone link is clickable */}
                  <a
                    href={`tel:${structure.telephone}`}
                    className="text-blue-600 hover:underline relative z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {structure.telephone}
                  </a>
                </div>
              )}
              {structure.horaires && (
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                  <span>{structure.horaires}</span>
                </div>
              )}
            </div>
            <div className="mt-1"><RecordProvenance verifiedAt={verifiedAt} sourceHost={sourceHost} sourceUrl={provenance?.sourceUrl} /></div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mt-2">
              {structure.is_pro_enabled && (
                <Button
                  size="sm"
                  asChild
                  className="relative z-20 bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Link to={buildPublicRdvPath(structure)} onClick={(e) => e.stopPropagation()}>
                    <Calendar className="h-4 w-4 mr-1" />
                    Prendre RDV
                  </Link>
                </Button>
              )}
              {structure.site_web && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="relative z-20"
                >
                  <a href={structure.site_web} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    <Globe className="h-4 w-4 mr-1" />
                    Site web
                  </a>
                </Button>
              )}
            </div>
          </div>
          <CardActionStrip label="Voir le lieu" />
        </CardContent>
      </Card>
    </AnimatedCard>
  );
}
