
import SEO from '@/components/SEO';
import { ClipboardCheck, Edit, Eye, Check } from 'lucide-react';

export default function Method() {
    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            <SEO
                title="Notre Méthode"
                description="Comment l'information est collectée, simplifiée et vérifiée automatiquement sur ses sources officielles."
                path="/notre-methode"
            />

            <h1 className="text-3xl font-bold mb-6 text-blue-900">Notre Méthode</h1>

            <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100 mb-8" data-testid="method-steps">
                <p className="text-lg text-gray-700 mb-6">
                    Pour que vous ayez confiance, nous expliquons comment chaque page est fabriquée.
                    Rien n'est publié sans avoir été vérifié sur sa source officielle. Cette vérification est automatique : c'est le système
                    AccesDirectAide qui relit la source, pas une personne et pas l'administration.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                    <div className="p-4 bg-gray-50 rounded">
                        <Edit className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                        <div className="font-bold">1. Collecte</div>
                        <div className="text-sm">On lit les sources officielles (Service-Public, annuaires publics).</div>
                    </div>
                    <div className="p-4 bg-yellow-50 rounded">
                        <Eye className="w-8 h-8 mx-auto mb-2 text-yellow-600" />
                        <div className="font-bold">2. Simplification</div>
                        <div className="text-sm">Un modèle installé sur nos machines écrit la version facile à lire ; elle est contrôlée phrase par phrase avec la source.</div>
                    </div>
                    <div className="p-4 bg-blue-50 rounded">
                        <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-blue-600" />
                        <div className="font-bold">3. Vérification</div>
                        <div className="text-sm">La vérification automatique compare la fiche à sa source officielle ; une fiche qu'elle ne confirme pas reste en attente.</div>
                    </div>
                    <div className="p-4 bg-green-50 rounded">
                        <Check className="w-8 h-8 mx-auto mb-2 text-green-600" />
                        <div className="font-bold">4. Publication</div>
                        <div className="text-sm">En ligne, avec sa source et la date de la vérification. Elle est revérifiée régulièrement.</div>
                    </div>
                </div>
            </div>

            <div className="prose prose-lg max-w-none text-gray-700 bg-white p-8 rounded-lg shadow-sm border border-gray-100">
                <h2 className="text-2xl font-bold mb-4">Statuts de nos contenus</h2>
                <ul className="space-y-4" data-testid="method-statuses">
                    <li className="flex items-start gap-3">
                        <span className="bg-gray-200 px-2 py-1 rounded text-xs font-bold uppercase mt-1">Brouillon</span>
                        <span>L'article est en cours d'écriture. Personne ne le voit.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <span className="bg-yellow-200 px-2 py-1 rounded text-xs font-bold uppercase mt-1">En Revue</span>
                        <span>La fiche attend sa vérification : sa source ne l'a pas encore confirmée, ou elle a changé. Elle n'est pas publiée.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <span className="bg-green-200 px-2 py-1 rounded text-xs font-bold uppercase mt-1">Publié</span>
                        <span>La vérification automatique l'a confirmée avec sa source : vous pouvez la lire sur le site, avec la date de cette vérification. Les actualités reprises d'un site officiel sont publiées avec leur source.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <span className="bg-red-200 px-2 py-1 rounded text-xs font-bold uppercase mt-1">Refusé</span>
                        <span>La source ne confirme pas l'information, ou elle a disparu : la fiche est retirée du site, avec la raison.</span>
                    </li>
                </ul>

                <h2 className="text-2xl font-bold mt-8 mb-4">Signaler une erreur</h2>
                <p>
                    Tout le monde peut se tromper. Si vous voyez une faute,{' '}
                    <a href="/contact?sujet=signalement_erreur" className="underline font-medium" data-testid="method-report-error">signalez-la avec le formulaire de contact</a> :
                    chaque signalement est lu, et la fiche est vérifiée à nouveau sur sa source.
                </p>

            </div>
        </div>
    );
}
