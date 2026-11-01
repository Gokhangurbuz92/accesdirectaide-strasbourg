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
import { Trans } from 'react-i18next';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import CategoryChip from "@/components/ui/CategoryChip";
import { RecordProvenance, CardActionStrip } from '@/components/cards/RecordCardParts';
import { getProvenance } from '@/lib/provenance';
import { buildPublicRdvPath } from '@/lib/rdvRouting';
import { useFalc } from '@/contexts/FalcContext';
import AnimatedCard from '@/components/ui/AnimatedCard';
import i18n, { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

// R32: the French labels; typeLabel() gives them in the interface language (the names of public bodies and the acronyms are not translated)
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

/** the verification date as the card has always shown it (« 30/10/2026 »), in the interface language */
const NUMERIC_DATE = { day: '2-digit', month: '2-digit', year: 'numeric' };

export default function StructureCard({ structure, compact = false, index = 0 }) {
  const { t } = useT('structures');
  // names, addresses, phone numbers and opening hours are never translated: tr.attrs() marks them as French
  const tr = useContentTranslation('structure', structure);
  const { isFalcEnabled } = useFalc();
  const provenance = getProvenance(structure);
  const verifiedAt = formatDate(provenance.verifiedAt, NUMERIC_DATE) || null;
  const sourceHost = provenance.sourceHost;
  const targetUrl = structure.slug ? `/structures/${structure.slug}` : `/structures/view?id=${structure.id}`;
  const isPmrAccessible = Boolean(structure.accessibilite_pmr || structure.accessibility_info?.pmr);
  const name = tr.value('nom');

  /** @param {string} type */
  const typeLabel = (type) => {
    switch (type) {
      case 'association': return t('structures:types.association', 'Association');
      case 'service_public': return t('structures:types.service_public', 'Service public');
      case 'etablissement_sante': return t('structures:types.etablissement_sante', 'Établissement de santé');
      case 'mairie': return t('structures:types.mairie', 'Mairie');
      case 'autre': return t('structures:types.autre', 'Autre');
      default: return TYPE_LABELS[type] || type;   // CAF, MDPH, France Travail, CPAM (and an unknown type as the record gives it)
    }
  };
  // the summary: the easy-to-read one in FALC mode, otherwise the short description
  const summaryField = isFalcEnabled && structure.summary_falc ? 'summary_falc' : 'description_courte';

  return (
    <AnimatedCard index={index}>
      <Card className="group hover:shadow-lg transition-all duration-300 border-slate-200 hover:border-blue-300 bg-white relative flex h-full flex-col overflow-hidden" data-testid="structure-card">
        {/* Overlay Link */}
        <Link
          to={targetUrl}
          className="absolute inset-0 z-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-xl"
          aria-label={t('structures:card.open', 'Voir la fiche de {{name}}', { name })}
        >
          <span className="sr-only">{t('structures:card.open', 'Voir la fiche de {{name}}', { name })}</span>
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
                  {typeLabel(structure.type_structure)}
                </Badge>
                {structure.coverage === 'OFFICIAL' && (
                  <Badge variant="outline" className="text-green-700 border-green-300">
                    {t('structures:card.coverage.official', 'Source officielle')}
                  </Badge>
                )}
                {structure.coverage === 'LOCAL_OPEN_DATA' && (
                  <Badge variant="outline" className="text-blue-700 border-blue-300">
                    {t('structures:card.coverage.local_open_data', 'Open data local')}
                  </Badge>
                )}
                {structure.coverage === 'SUGGESTED_NEEDS_REVIEW' && (
                  <Badge variant="outline" className="text-orange-700 border-orange-300">
                    {t('structures:card.coverage.contribution', 'Contribution')}
                  </Badge>
                )}
                {structure.is_pro_enabled && (
                  <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {t('structures:card.online_booking', 'RDV en ligne')}
                  </Badge>
                )}
              </div>
              {isPmrAccessible && (
                <Badge variant="outline" className="text-blue-700 border-blue-300 flex items-center gap-1">
                  <Accessibility className="h-3 w-3" />
                  {t('structures:pmr', 'Accessible PMR')}
                </Badge>
              )}
            </div>

            {/* Nom */}
            <h3 className={`font-semibold text-slate-900 group-hover:text-blue-700 transition-colors ${compact ? 'text-base' : 'text-lg'}`} data-testid="structure-title" {...tr.attrs('nom')}>
              {name}
            </h3>

            {/* Description */}
            {(structure.description_courte || (isFalcEnabled && structure.summary_falc)) && (
              <p className="text-slate-600 text-sm line-clamp-4" {...tr.attrs(summaryField)}>
                {tr.value(summaryField)}
              </p>
            )}
            {/* PKG-11 / E04: why this structure is in the results when it is a service it declares (its own words, not a promise) */}
            {Array.isArray(structure.whyShown?.services) && structure.whyShown.services.length > 0 && (
              <p className="text-sm text-slate-800" data-testid="structure-why-shown">
                <Trans
                  i18n={i18n}
                  i18nKey="structures:card.why_shown"
                  defaults="Correspond à votre recherche : indique proposer <0/>."
                  components={[<span key="services" {...tr.attrs('services')}>{structure.whyShown.services.map((x) => `« ${x} »`).join(', ')}</span>]}
                />
              </p>
            )}
            {/* FALC badge */}
            {isFalcEnabled && structure.summary_falc && (
              <Badge className="bg-teal-100 text-teal-700 border-teal-200 flex items-center gap-1 w-fit">
                <Brain className="h-3 w-3" />
                {t('structures:card.falc_badge', 'Simplifié')}
              </Badge>
            )}

            {/* Infos de contact */}
            <div className="space-y-2 text-sm text-slate-600 relative z-20 pointer-events-none [&_a]:pointer-events-auto">   {/* R27: a click on the address or the hours opens the card (it did nothing); the phone link stays a phone link */}
              {/* Note: Links inside here like telephone/email must be z-20 to be clickable. */}
              {structure.adresse && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  <span {...tr.attrs('adresse')}>
                    {tr.value('adresse')}, {tr.value('code_postal')} {tr.value('ville')}
                  </span>
                </div>
              )}
              {structure.telephone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                  {/* Ensure telephone link is clickable */}
                  <a
                    href={`tel:${structure.telephone}`}
                    className="ada-target text-blue-600 hover:underline relative z-20"
                    onClick={(e) => e.stopPropagation()}
                    {...tr.attrs('telephone')}
                  >
                    {tr.value('telephone')}
                  </a>
                </div>
              )}
              {structure.horaires && (
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                  <span {...tr.attrs('horaires')}>{tr.value('horaires')}</span>
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
                    <Calendar className="h-4 w-4 me-1" />
                    {t('structures:card.book', 'Prendre RDV')}
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
                  <a href={structure.site_web} target="_blank" rel="noopener noreferrer" className="ada-target" onClick={(e) => e.stopPropagation()}>
                    <Globe className="h-4 w-4 me-1" />
                    {t('structures:card.website', 'Site web')}
                  </a>
                </Button>
              )}
            </div>
          </div>
          <CardActionStrip label={t('structures:card.view', 'Voir le lieu')} />
        </CardContent>
      </Card>
    </AnimatedCard>
  );
}
