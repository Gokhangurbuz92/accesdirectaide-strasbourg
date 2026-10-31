
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';

export default function Mission() {
    return (
        <div className="min-h-screen bg-slate-50">
            <SEO
                title="Notre Mission"
                description="Pourquoi ce site existe : simplifier l'accès aux droits pour tous."
                path="/notre-mission"
            />

            <PageHeader width="reading" title="Notre mission" description="Pourquoi ce site existe : aider chacun à trouver ses droits et les bonnes personnes." />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            <div className="prose prose-lg max-w-none text-gray-700 bg-white p-8 rounded-lg shadow-sm border border-gray-100">
                <p className="text-xl font-medium text-gray-900 mb-6">
                    Ce site est fait pour <strong>aider tout le monde</strong> à trouver les bonnes aides et les bonnes personnes.
                </p>

                <h2 className="text-2xl font-bold text-gray-800 mt-8 mb-4">Pourquoi ce site existe ?</h2>
                <ul className="list-disc pl-6 space-y-2">
                    <li>Parce que les papiers administratifs sont compliqués.</li>
                    <li>Parce qu'on ne sait pas toujours qui aller voir.</li>
                    <li>Parce que tout le monde a le droit d'être aidé.</li>
                </ul>

                <h2 className="text-2xl font-bold text-gray-800 mt-8 mb-4">Pour qui ?</h2>
                <p>
                    <strong>Pour vous :</strong> Si vous cherchez une aide, un formulaire, ou un conseil.<br />
                    <strong>Pour les pros :</strong> Les travailleurs sociaux utilisent ce site pour mieux orienter.
                </p>

                <h2 className="text-2xl font-bold text-gray-800 mt-8 mb-4">Ce que le site ne fait pas</h2>
                <p>
                    Nous donnons de l'information fiable. Mais nous ne remplaçons pas la CAF, la Sécu, ou France Travail.
                    Nous vous aidons à les contacter.
                </p>

                <div className="bg-blue-50 p-6 rounded-lg mt-8 border-l-4 border-blue-600">
                    <h2 className="text-xl font-bold text-blue-900 mb-4">Notre Promesse en 5 points</h2>
                    <ol className="list-decimal pl-6 space-y-3 font-medium">
                        <li>Information gratuite pour toujours.</li>
                        <li>Langage simple (FALC) facile à lire.</li>
                        <li>Zéro publicité, zéro vente de vos données.</li>
                        <li>Fiches vérifiées avec leur source officielle avant publication.</li>
                        <li>Vos données servent seulement à vous aider, avec votre accord.</li>
                    </ol>
                </div>
            </div>
            </div>
        </div>
    );
}
