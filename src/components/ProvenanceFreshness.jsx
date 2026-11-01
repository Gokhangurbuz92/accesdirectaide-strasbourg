import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, ExternalLink, ShieldCheck } from 'lucide-react';
import { getFreshnessBadge, getProvenance } from '@/lib/provenance';
import { formatDate, useT } from '@/i18n';

const BADGE_CLASSNAME = {
  up_to_date: 'bg-emerald-100 text-emerald-800',
  to_review: 'bg-amber-100 text-amber-800',
  at_risk: 'bg-rose-100 text-rose-800',
  not_verified: 'bg-slate-100 text-slate-700',
};

/** R32: the freshness badge of getFreshnessBadge (src/lib/provenance.js) in the interface language, by state */
const FRESHNESS = {
  up_to_date: (/** @type {(key: string, fallback: string) => string} */ t) => t('shared:provenance.upToDate', 'À jour'),
  to_review: (/** @type {(key: string, fallback: string) => string} */ t) => t('shared:provenance.toReview', 'À actualiser'),
  at_risk: (/** @type {(key: string, fallback: string) => string} */ t) => t('shared:provenance.atRisk', 'À risque'),
};

/** a date as dd/mm/yyyy in French (formatProvenanceDate), in the interface language otherwise; null when there is none */
const shortDay = (/** @type {unknown} */ value) => (value ? formatDate(/** @type {any} */ (value), { day: '2-digit', month: '2-digit', year: 'numeric' }) || null : null);

/**
 * @param {{ provenance?: any }} props
 */
export default function ProvenanceFreshness({ provenance }) {
  const { t } = useT('shared');
  const normalized = getProvenance({ provenance });
  const freshness = getFreshnessBadge(normalized.verifiedAt);
  const freshnessLabel = freshness.label ? (FRESHNESS[/** @type {keyof typeof FRESHNESS} */ (freshness.state)]?.(t) || freshness.label) : null;
  const verifiedAt = shortDay(normalized.verifiedAt);
  const fetchedAt = shortDay(normalized.fetchedAt);

  return (
    <Card className="border-slate-200 bg-slate-50" data-testid="provenance-freshness">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t('shared:provenance.title', 'Provenance et fraîcheur')}
          </h2>
          {freshnessLabel && (
            <Badge
              className={BADGE_CLASSNAME[freshness.state] || BADGE_CLASSNAME.not_verified}
              data-testid="freshness-badge"
            >
              {freshnessLabel}
            </Badge>
          )}
        </div>

        {provenance && provenance.contentStatus === 'LAB_UNVERIFIED' ? (
          <p data-testid="content-status-lab" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            {t('shared:provenance.demo', 'Contenu de démonstration : cette fiche n’a pas été vérifiée et ne doit pas être utilisée comme information officielle.')}
          </p>
        ) : null}

        <dl className="space-y-3 text-sm">
          {verifiedAt && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-medium text-slate-700">{t('shared:provenance.verified', 'Dernière vérification')}</dt>
              <dd className="text-slate-900">{verifiedAt}</dd>
            </div>
          )}

          {fetchedAt && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-medium text-slate-700 flex items-center gap-1">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                {t('shared:provenance.fetched', 'Dernière collecte')}
              </dt>
              <dd className="text-slate-900">{fetchedAt}</dd>
            </div>
          )}

          {normalized.sourceUrl && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-medium text-slate-700">{t('shared:provenance.source', 'Source')}</dt>
              <dd className="text-end text-slate-900">
                <a
                  href={normalized.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                  aria-label={normalized.sourceHost
                    ? t('shared:provenance.sourceLink', 'Voir la source officielle ({{host}})', { host: normalized.sourceHost })
                    : t('shared:provenance.sourceLinkPlain', 'Voir la source officielle')}
                >
                  {normalized.sourceHost || t('shared:provenance.open', 'Voir la source')}
                  <ExternalLink className="h-3 w-3 rtl-flip" aria-hidden="true" />
                </a>
              </dd>
            </div>
          )}
        </dl>

        <p className="text-xs text-slate-600">
          {t('shared:provenance.indicative', 'Ces informations sont affichées à titre indicatif.')}
        </p>
      </CardContent>
    </Card>
  );
}
