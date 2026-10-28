// @ts-nocheck
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import AnimatedCard from '@/components/ui/AnimatedCard';

export default function DispositifCard({ dispositif, index = 0 }) {
    const targetUrl = dispositif.slug ? `/dispositifs/${dispositif.slug}` : `/dispositifs/view?id=${dispositif.id}`;

    return (
        <AnimatedCard index={index}>
            <div className="bg-white border rounded-lg p-6 shadow-sm hover:shadow-md transition relative group flex flex-col h-full">
                <Link
                    to={targetUrl}
                    className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
                    aria-label={`Voir le dispositif ${dispositif.titre}`}
                >
                    <span className="sr-only">Voir le dispositif {dispositif.titre}</span>
                </Link>

                <h2 className="text-xl font-semibold mb-2 text-indigo-700 group-hover:text-indigo-900 transition-colors">
                    {dispositif.titre}
                </h2>
                <p className="text-gray-600 mb-4 line-clamp-3 flex-grow">
                    {dispositif.description_falc || "Pas de description disponible."}
                </p>

                {dispositif.montant && (
                    <div className="mb-4 text-sm font-medium text-green-700 bg-green-50 p-2 rounded inline-block self-start">
                        💰 {dispositif.montant}
                    </div>
                )}

                {/* Links inside card - keep them clickable with z-20 */}
                <div className="flex flex-wrap gap-2 mt-auto relative z-20">
                    {dispositif.liens && Array.isArray(dispositif.liens) && dispositif.liens.map((l, /** @type {string | number} */ idx) => (
                        <a
                            key={idx}
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline text-sm hover:text-blue-800 flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {l.nom || "En savoir plus"}
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    ))}
                </div>
            </div>
        </AnimatedCard>
    );
}
