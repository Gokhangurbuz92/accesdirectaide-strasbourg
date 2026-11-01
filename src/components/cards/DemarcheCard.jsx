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
import { RecordProvenance, CardActionStrip } from '@/components/cards/RecordCardParts';
import { getFreshnessBadge, getProvenance } from '@/lib/provenance';
import { useFalc } from '@/contexts/FalcContext';
import AnimatedCard from '@/components/ui/AnimatedCard';
import { formatDate, useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

const FRESHNESS_BADGE_CLASS = {
  up_to_date: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  to_review: 'bg-amber-100 text-amber-800 border-amber-200',
  at_risk: 'bg-rose-100 text-rose-800 border-rose-200',
  not_verified: 'bg-slate-100 text-slate-700 border-slate-200',
};

/** the verification date as the card has always shown it (« 30/10/2026 »), in the interface language */
const NUMERIC_DATE = { day: '2-digit', month: '2-digit', year: 'numeric' };

export default function DemarcheCard({ demarche, index = 0 }) {
  const { t } = useT('demarches');
  const tr = useContentTranslation('demarche', demarche);
  const { isFalcEnabled } = useFalc();
  const provenance = getProvenance(demarche);
  const verifiedAt = formatDate(provenance.verifiedAt, NUMERIC_DATE) || null;
  const sourceHost = provenance.sourceHost;
  const freshness = getFreshnessBadge(provenance.verifiedAt);
  // the badge of lib/provenance, in the interface language (no badge text when nothing was verified)
  const freshnessLabel = freshness.state === 'up_to_date' ? t('demarches:card.freshness.up_to_date', 'À jour')
    : freshness.state === 'to_review' ? t('demarches:card.freshness.to_review', 'À actualiser')
      : freshness.state === 'at_risk' ? t('demarches:card.freshness.at_risk', 'À risque')
        : freshness.label;
  // No "À vérifier" — show source or verified date only
  const verificationLabel = verifiedAt
    ? t('demarches:verified_on', 'Vérifié le {{date}}', { date: verifiedAt })
    : (sourceHost ? t('demarches:card.source', 'Source : {{host}}', { host: sourceHost }) : null);
  const targetUrl = demarche.slug ? `/demarches/${demarche.slug}` : `/demarches/view?id=${demarche.id}`;
  const title = tr.value('titre');
  // the summary: the easy-to-read one in FALC mode, otherwise the short description (the easy-to-read one when there is none)
  const summaryField = isFalcEnabled && tr.value('summary_falc') ? 'summary_falc' : (tr.value('description_courte') ? 'description_courte' : 'summary_falc');

  return (
    <AnimatedCard index={index}>
      <Card className="hover:shadow-md transition-all border-slate-200 overflow-hidden group relative bg-white flex h-full flex-col" data-testid="demarche-card">
        <Link
          to={targetUrl}
          className="absolute inset-0 z-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-xl"
          aria-label={t('demarches:card.open', 'Voir la démarche {{title}}', { title })}
        >
          <span className="sr-only">{t('demarches:card.open', 'Voir la démarche {{title}}', { title })}</span>
        </Link>

        <CardContent className="flex h-full flex-col p-0">
          <div className="flex-1 p-6">
            <div className="flex justify-between items-start mb-4">
              <CategoryChip slug={demarche.categorie} label={demarche.category?.label} />
              <div className="ms-auto flex flex-col items-end gap-2">   {/* R31: stays right when the record has no category */}
                <Badge
                  variant="outline"
                  className={FRESHNESS_BADGE_CLASS[freshness.state] || FRESHNESS_BADGE_CLASS.not_verified}
                  data-testid="demarche-freshness-badge"
                >
                  {freshnessLabel}
                </Badge>
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-700 transition-colors mb-2" data-testid="demarche-title" {...tr.attrs('titre')}>
              {title}
            </h3>
            <p className="text-slate-600 text-sm line-clamp-4 mb-4" {...tr.attrs(summaryField)}>
              {tr.value(summaryField)}
            </p>
            {/* FALC badge */}
            {isFalcEnabled && demarche.summary_falc && (
              <div className="mb-4">
                <Badge className="bg-teal-100 text-teal-700 border-teal-200 flex items-center gap-1 w-fit">
                  <Brain className="h-3 w-3" />
                  {t('demarches:card.falc_badge', 'Simplifié')}
                </Badge>
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              {demarche.delai && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> <span {...tr.attrs('delai')}>{tr.value('delai')}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> {t('demarches:card.step_by_step', 'Guide pas à pas')}
              </span>
            </div>
            <div className="mt-3"><RecordProvenance verifiedAt={verifiedAt} sourceHost={sourceHost} sourceUrl={provenance.sourceUrl} stale={freshness?.state === 'to_review'} /></div>
          </div>
          <CardActionStrip label={t('demarches:card.view', 'Voir la démarche')} />
        </CardContent>
      </Card>
    </AnimatedCard>
  );
}
