import PropTypes from 'prop-types';
import { ArrowRight, Calendar, Globe } from 'lucide-react';

/**
 * R27 card harmonisation: the same provenance line and the same action strip on the aide, démarche and lieu cards (they used three wordings —
 * « VÉRIFIÉ LE » pill, « Vérifié le », « Vérifié: » — two source styles and three actions, one of them missing).
 */
export function RecordProvenance({ verifiedAt, sourceHost, sourceUrl = null, stale = false }) {
  if (!verifiedAt && !sourceHost) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" data-testid="record-provenance">
      {verifiedAt && (
        <span className={`flex items-center gap-1.5 ${stale ? 'text-amber-800' : ''}`}>
          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
          {stale ? `À actualiser (vérifié le ${verifiedAt})` : `Vérifié le ${verifiedAt}`}
        </span>
      )}
      {sourceHost && (
        <span className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          Source :{' '}
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="relative z-20 underline underline-offset-2 hover:text-slate-900">
              {sourceHost}<span className="sr-only"> (nouvel onglet)</span>
            </a>
          ) : sourceHost}
        </span>
      )}
    </div>
  );
}
RecordProvenance.propTypes = { verifiedAt: PropTypes.string, sourceHost: PropTypes.string, sourceUrl: PropTypes.string, stale: PropTypes.bool };

/** the bottom strip of a card: its action, written the same way on every kind of record (the whole card is the link) */
export function CardActionStrip({ label }) {
  return (
    <div className="mt-auto border-t border-slate-100 bg-slate-50 px-6 py-3" aria-hidden="true">
      <span className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 transition-colors group-hover:text-blue-900">
        {label}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </span>
    </div>
  );
}
CardActionStrip.propTypes = { label: PropTypes.string.isRequired };
