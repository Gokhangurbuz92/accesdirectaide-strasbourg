import { Card, CardContent } from '@/components/ui/card';
import { ExternalLink, Calendar, Link as LinkIcon, Clock } from 'lucide-react';

/**
 * SourceTraceability Component
 * Displays source URL and traceability metadata for content items
 * 
 * @param {Object} props
 * @param {string} props.source_url - Full source URL
 * @param {string|Date} props.retrieved_at - When the content was first retrieved
 * @param {string|Date} props.last_checked_at - When the source was last checked
 * @param {string|Date} props.source_last_modified - When the source was last modified (if available)
 * @param {string|Date} props.fetched_at - Alternative field name for retrieved_at
 */
export default function SourceTraceability({ 
    source_url, 
    retrieved_at, 
    last_checked_at, 
    source_last_modified,
    fetched_at 
}) {
    // Use fetched_at as fallback for retrieved_at
    const retrievedDate = retrieved_at || fetched_at;

    // Don't render if no source URL
    if (!source_url) {
        return null;
    }

    const formatDate = (/** @type {string | number | Date} */ date) => {
        if (!date) return null;
        try {
            return new Date(date).toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return null;
        }
    };

    return (
        <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-6">
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-blue-900">
                    <LinkIcon className="h-5 w-5" />
                    Source et traçabilité
                </h2>
                <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                        <span className="font-medium text-blue-900 min-w-[140px]">Source :</span>
                        <a 
                            href={source_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 break-all"
                        >
                            {source_url}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                    </div>
                    
                    {retrievedDate && (
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-blue-700" />
                            <span className="font-medium text-blue-900">Récupéré le :</span>
                            <span className="text-blue-700">
                                {formatDate(retrievedDate)}
                            </span>
                        </div>
                    )}
                    
                    {last_checked_at && (
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-700" />
                            <span className="font-medium text-blue-900">Source consultée le :</span>
                            <span className="text-blue-700">
                                {formatDate(last_checked_at)}
                            </span>
                        </div>
                    )}
                    
                    {source_last_modified && (
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-blue-700" />
                            <span className="font-medium text-blue-900">Source modifiée le :</span>
                            <span className="text-blue-700">
                                {formatDate(source_last_modified)}
                            </span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
