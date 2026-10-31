import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, ExternalLink, ShieldCheck } from 'lucide-react';
import { formatProvenanceDate, getFreshnessBadge, getProvenance } from '@/lib/provenance';

const BADGE_CLASSNAME = {
  up_to_date: 'bg-emerald-100 text-emerald-800',
  to_review: 'bg-amber-100 text-amber-800',
  at_risk: 'bg-rose-100 text-rose-800',
  not_verified: 'bg-slate-100 text-slate-700',
};

/**
 * @param {{ provenance?: any }} props
 */
export default function ProvenanceFreshness({ provenance }) {
  const normalized = getProvenance({ provenance });
  const freshness = getFreshnessBadge(normalized.verifiedAt);
  const verifiedAt = formatProvenanceDate(normalized.verifiedAt);
  const fetchedAt = formatProvenanceDate(normalized.fetchedAt);

  return (
    <Card className="border-slate-200 bg-slate-50" data-testid="provenance-freshness">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Provenance et fraîcheur
          </h2>
          {freshness.label && (
            <Badge
              className={BADGE_CLASSNAME[freshness.state] || BADGE_CLASSNAME.not_verified}
              data-testid="freshness-badge"
            >
              {freshness.label}
            </Badge>
          )}
        </div>

        {provenance && provenance.contentStatus === 'LAB_UNVERIFIED' ? (
          <p data-testid="content-status-lab" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Contenu de démonstration : cette fiche n’a pas été vérifiée et ne doit pas être utilisée comme information officielle.
          </p>
        ) : null}

        <dl className="space-y-3 text-sm">
          {verifiedAt && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-medium text-slate-700">Dernière vérification</dt>
              <dd className="text-slate-900">{verifiedAt}</dd>
            </div>
          )}

          {fetchedAt && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-medium text-slate-700 flex items-center gap-1">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                Dernière collecte
              </dt>
              <dd className="text-slate-900">{fetchedAt}</dd>
            </div>
          )}

          {normalized.sourceUrl && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-medium text-slate-700">Source</dt>
              <dd className="text-right text-slate-900">
                <a
                  href={normalized.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                  aria-label={`Voir la source officielle ${normalized.sourceHost ? `(${normalized.sourceHost})` : ''}`}
                >
                  {normalized.sourceHost || 'Voir la source'}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </dd>
            </div>
          )}
        </dl>

        <p className="text-xs text-slate-600">
          Ces informations sont affichées à titre indicatif.
        </p>
      </CardContent>
    </Card>
  );
}
