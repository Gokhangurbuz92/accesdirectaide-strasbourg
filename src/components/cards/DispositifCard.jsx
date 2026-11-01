// @ts-nocheck
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import AnimatedCard from '@/components/ui/AnimatedCard';
import { useT } from '@/i18n';
import useContentTranslation from '@/hooks/useContentTranslation';

export default function DispositifCard({ dispositif, index = 0 }) {
    const { t } = useT('dispositifs');
    // R32: the card's own record — its title in the interface language when a verified translation may be shown, else in French marked lang="fr".
    // A list asks only for the light fields (title): its other texts are shown as published, in French, marked as such.
    const tr = useContentTranslation('dispositif', dispositif);
    const targetUrl = dispositif.slug ? `/dispositifs/${dispositif.slug}` : `/dispositifs/view?id=${dispositif.id}`;
    const titre = tr.value('titre');
    const description = dispositif.description_falc;
    const montant = dispositif.montant;
    const liens = dispositif.liens;
    const viewLabel = t('dispositifs:card.view', 'Voir le dispositif {{title}}', { title: titre });

    return (
        <AnimatedCard index={index}>
            <div className="bg-white border rounded-lg p-6 shadow-sm hover:shadow-md transition relative group flex flex-col h-full">
                <Link
                    to={targetUrl}
                    className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
                    aria-label={viewLabel}
                >
                    <span className="sr-only">{viewLabel}</span>
                </Link>

                <h2 className="text-xl font-semibold mb-2 text-indigo-700 group-hover:text-indigo-900 transition-colors" {...tr.attrs('titre')}>
                    {titre}
                </h2>
                <p className="text-gray-600 mb-4 line-clamp-3 flex-grow" {...(description ? tr.attrs('description_falc') : {})}>
                    {description || t('dispositifs:card.no_description', 'Pas de description disponible.')}
                </p>

                {montant && (
                    <div className="mb-4 text-sm font-medium text-green-700 bg-green-50 p-2 rounded inline-block self-start" {...tr.attrs('montant')}>
                        💰 {montant}
                    </div>
                )}

                {/* Links inside card - keep them clickable with z-20 */}
                <div className="flex flex-wrap gap-2 mt-auto relative z-20">
                    {liens && Array.isArray(liens) && liens.map((l, /** @type {string | number} */ idx) => (
                        <a
                            key={idx}
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline text-sm hover:text-blue-800 flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                            {...(l.nom ? tr.attrs('liens') : {})}
                        >
                            {l.nom || t('dispositifs:card.more', 'En savoir plus')}
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    ))}
                </div>
            </div>
        </AnimatedCard>
    );
}
