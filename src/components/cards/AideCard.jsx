// @ts-nocheck
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Brain
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import CategoryChip, { resolveCategory } from "@/components/ui/CategoryChip";
import { formatProvenanceDate, getFreshnessBadge, getProvenance } from '@/lib/provenance';
import { useFalc } from '@/contexts/FalcContext';
import AnimatedCard from '@/components/ui/AnimatedCard';

const FRESHNESS_BADGE_CLASS = {
  up_to_date: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  to_review: 'bg-amber-100 text-amber-800 border-amber-200',
  at_risk: 'bg-rose-100 text-rose-800 border-rose-200',
  not_verified: 'bg-slate-100 text-slate-700 border-slate-200',
};

export default function AideCard({ aide, compact = false, index = 0 }) {
  const { isFalcEnabled } = useFalc();
  const provenance = getProvenance(aide);
  const verifiedAt = formatProvenanceDate(provenance.verifiedAt);
  const sourceHost = provenance.sourceHost;
  const freshness = getFreshnessBadge(provenance.verifiedAt);
  // Replace "À vérifier" — show source or verified date, never "À vérifier"
  const verificationLabel = verifiedAt
    ? `Vérifié le ${verifiedAt}`
    : (sourceHost ? `Source : ${sourceHost}` : null);

  const categorySlug = (() => {
    const raw = aide?.categorie || aide?.theme || aide?.category?.slug || aide?.category_code;
    if (!raw) return null;
    const value = String(raw).trim();
    if (!value) return null;
    return /^[A-Z_]+$/.test(value) ? value.toLowerCase() : value;
  })();

  const getTerritoireLabel = () => {
    if (!aide.territoires?.length) return null;
    if (aide.territoires.includes('national')) return 'France entière';
    return aide.territoires.map(/** @type {string} */ (/** @type {string} */ t) => {
      if (t === '67') return 'Bas-Rhin';
      if (t === '68') return 'Haut-Rhin';
      return t;
    }).join(', ');
  };

  const targetUrl = aide.slug ? `/aides/${aide.slug}` : `/aide/view?id=${aide.id}`;

  return (
    <AnimatedCard index={index}>
      <Card className="group hover:shadow-lg transition-all duration-300 border-slate-200 hover:border-blue-300 bg-white relative" data-testid="aide-card">
        {/* Overlay Link for Clickable Card */}
        <Link
          to={targetUrl}
          data-testid={`aide-card-link-${aide.id}`}
          className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
          aria-label={`Voir l'aide ${aide.titre}`}
        >
          <span className="sr-only">Voir l&apos;aide {aide.titre}</span>
        </Link>

        <CardContent className={compact ? 'p-4' : 'p-6'}>
          <div className="flex flex-col gap-3">
            {/* En-tête avec badges */}
            <div className="flex flex-wrap gap-2 items-start justify-between relative z-0">
              <div className="flex flex-wrap gap-2">
                <CategoryChip slug={categorySlug} label={aide?.category?.label} />
                {aide.est_urgent && (
                  <Badge className="bg-red-100 text-red-800 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Urgence
                  </Badge>
                )}
              </div>
              <Badge
                variant="outline"
                className={FRESHNESS_BADGE_CLASS[freshness.state] || FRESHNESS_BADGE_CLASS.not_verified}
                data-testid="aide-freshness-badge"
              >
                {freshness.label}
              </Badge>
              {aide.sources?.some(s => s.type === 'officielle') && (
                <Badge variant="outline" className="text-green-700 border-green-300 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Source officielle
                </Badge>
              )}
            </div>

            {/* Titre */}
            <h3 className={`font-semibold text-slate-900 group-hover:text-blue-700 transition-colors ${compact ? 'text-base' : 'text-lg'}`} data-testid="aide-title">
              {aide.titre}
            </h3>

            {/* Description courte */}
            <p className="text-slate-600 text-sm line-clamp-4">
              {isFalcEnabled && aide.summary_falc ? aide.summary_falc : aide.cest_quoi}
            </p>

            {/* FALC badge */}
            {isFalcEnabled && aide.summary_falc && (
              <Badge className="bg-teal-100 text-teal-700 border-teal-200 flex items-center gap-1 w-fit">
                <Brain className="h-3 w-3" />
                Simplifié
              </Badge>
            )}

            {/* Métadonnées */}
            <div className="flex flex-wrap gap-4 text-sm text-slate-500 mt-1">
              {getTerritoireLabel() && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {getTerritoireLabel()}
                </span>
              )}
              {verificationLabel && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {verificationLabel}
                </span>
              )}
            </div>

            {/* Visual Link (Not interactive, just decoration) */}
            <div className="inline-flex items-center gap-2 text-blue-600 font-medium text-sm mt-2 group-hover:text-blue-800 transition-colors">
              Voir cette aide
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </CardContent>
      </Card>
    </AnimatedCard>
  );
}
