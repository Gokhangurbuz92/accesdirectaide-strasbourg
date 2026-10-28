// @ts-nocheck
import { Link } from 'react-router-dom';
import { ExternalLink, CheckCircle } from 'lucide-react';

const TYPE_LABELS = {
    aide: 'Aide',
    demarche: 'Démarche',
    structure: 'Structure',
};

const TYPE_COLORS = {
    aide: 'bg-blue-50 text-blue-700',
    demarche: 'bg-emerald-50 text-emerald-700',
    structure: 'bg-amber-50 text-amber-700',
};

/**
 * @param {string} text
 */
function truncate(text, max = 120) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

export default function RecommendationCard({ item }) {
    const { type, slug, title, excerpt, url, sourceLabel, verifiedAt } = item;

    if (!title || !url) return null;

    return (
        <Link
            to={url}
            className="group block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            aria-label={`${TYPE_LABELS[type] || type} : ${title}`}
        >
            <div className="mb-2 flex items-start justify-between gap-2">
                <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[type] || 'bg-slate-100 text-slate-700'}`}>
                    {TYPE_LABELS[type] || type}
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-blue-500" aria-hidden="true" />
            </div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                {title}
            </h3>
            {excerpt && (
                <p className="mb-2 text-xs leading-relaxed text-slate-600">{truncate(excerpt)}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-400">
                {sourceLabel && <span>{sourceLabel}</span>}
                {verifiedAt && (
                    <span className="inline-flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                        Vérifié
                    </span>
                )}
            </div>
        </Link>
    );
}
