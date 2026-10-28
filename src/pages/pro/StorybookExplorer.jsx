import { useOutletContext, Link } from 'react-router-dom';
import { BookOpen, Construction, ArrowLeft } from 'lucide-react';
import SEO from '@/components/SEO';

/**
 * StorybookExplorer — Placeholder "Bientôt disponible"
 * 
 * Aucun fichier .stories.* n'existe dans le projet.
 * Cette page informe les utilisateurs clairement.
 */
export default function StorybookExplorer() {
    useOutletContext(); // Keep ProLayout context active

    return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <SEO
                title="Storybook — Bientôt disponible"
                description="Explorateur de composants UI en cours de développement."
                path="/pro/storybook"
                noindex={true}
            />
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <BookOpen className="w-8 h-8 text-blue-600" />
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    Storybook
                </h1>

                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium mb-4">
                    <Construction className="w-4 h-4" />
                    Bientôt disponible
                </div>

                <p className="text-slate-600 mb-6">
                    Cette fonctionnalité est en cours de développement.
                    Elle permettra d'explorer et de tester les composants UI
                    de la plateforme de manière interactive.
                </p>

                <Link
                    to="/pro/dashboard"
                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Retour au tableau de bord
                </Link>
            </div>
        </div>
    );
}
