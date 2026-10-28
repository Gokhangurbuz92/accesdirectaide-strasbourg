// @ts-nocheck
import { Link } from 'react-router-dom';
import {
  FileText,
  Clock,
  CheckCircle2,
  Calendar,
  ArrowRight,
  Brain
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import CategoryChip from "@/components/ui/CategoryChip";
import { formatProvenanceDate, getFreshnessBadge, getProvenance } from '@/lib/provenance';
import { useFalc } from '@/contexts/FalcContext';
import AnimatedCard from '@/components/ui/AnimatedCard';

const FRESHNESS_BADGE_CLASS = {
  up_to_date: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  to_review: 'bg-amber-100 text-amber-800 border-amber-200',
  at_risk: 'bg-rose-100 text-rose-800 border-rose-200',
  not_verified: 'bg-slate-100 text-slate-700 border-slate-200',
};

export default function DemarcheCard({ demarche, index = 0 }) {
  const { isFalcEnabled } = useFalc();
  const provenance = getProvenance(demarche);
  const verifiedAt = formatProvenanceDate(provenance.verifiedAt);
  const sourceHost = provenance.sourceHost;
  const freshness = getFreshnessBadge(provenance.verifiedAt);
  // No "À vérifier" — show source or verified date only
  const verificationLabel = verifiedAt
    ? `Vérifié le ${verifiedAt}`
    : (sourceHost ? `Source : ${sourceHost}` : null);
  const targetUrl = demarche.slug ? `/demarches/${demarche.slug}` : `/demarches/view?id=${demarche.id}`;

  return (
    <AnimatedCard index={index}>
      <Card className="hover:shadow-md transition-all border-slate-200 overflow-hidden group relative bg-white" data-testid="demarche-card">
        <Link
          to={targetUrl}
          className="absolute inset-0 z-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-xl"
          aria-label={`Voir la démarche ${demarche.titre}`}
        >
          <span className="sr-only">Voir la démarche {demarche.titre}</span>
        </Link>

        <CardContent className="p-0">
          <div className="p-6">
            <div className="flex justify-between items-start mb-4">
              <CategoryChip slug={demarche.categorie} label={demarche.category?.label} />
              <div className="flex flex-col items-end gap-2">
                <Badge
                  variant="outline"
                  className={FRESHNESS_BADGE_CLASS[freshness.state] || FRESHNESS_BADGE_CLASS.not_verified}
                  data-testid="demarche-freshness-badge"
                >
                  {freshness.label}
                </Badge>
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-700 transition-colors mb-2" data-testid="demarche-title">
              {demarche.titre}
            </h3>
            <p className="text-slate-600 text-sm line-clamp-4 mb-4">
              {isFalcEnabled && demarche.summary_falc ? demarche.summary_falc : (demarche.description_courte || demarche.summary_falc)}
            </p>
            {/* FALC badge */}
            {isFalcEnabled && demarche.summary_falc && (
              <div className="mb-4">
                <Badge className="bg-teal-100 text-teal-700 border-teal-200 flex items-center gap-1 w-fit">
                  <Brain className="h-3 w-3" />
                  Simplifié
                </Badge>
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              {demarche.delai && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> {demarche.delai}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Guide pas à pas
              </span>
            </div>
            {verificationLabel && (
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {verificationLabel}
                </span>
              </div>
            )}
          </div>
          <div className="bg-slate-50 px-6 py-3 border-t border-slate-100">
            <div
              className="inline-flex items-center gap-2 text-blue-600 font-bold text-sm group-hover:text-blue-800 transition-colors"
            >
              Démarrer la démarche
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </CardContent>
      </Card>
    </AnimatedCard>
  );
}
