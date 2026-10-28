import { Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';
import { User, Briefcase, UserPlus } from 'lucide-react';

/**
 * Page de sélection de connexion
 * 
 * UX unifiée : Particulier / Professionnel
 * Sécurité : le bouton "Administration" est supprimé de la vue publique.
 * L'admin accède directement via /admin/login.
 */
export default function Login() {
    const [searchParams] = useSearchParams();
    const next = normalizeNextPath(searchParams.get('next'), '');
    const mode = String(searchParams.get('mode') || '').trim().toLowerCase();
    const citizenLoginPath = appendNext('/auth/login', next);
    const proLoginPath = appendNext('/pro/login', next);
    const signupPath = appendNext('/auth/signup', next);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <SEO
                title="Connexion"
                description="AccesDirectAide — Connectez-vous à votre espace personnel ou professionnel"
                path="/login"
                noindex={true}
            />
            <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
                <h1 className="text-3xl font-bold text-center text-gray-900 mb-2">Connexion</h1>
                <p className="text-center text-gray-500 mb-8">
                    Choisissez votre espace pour continuer
                </p>

                {mode === 'pro' && (
                    <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 mb-6">
                        Une connexion est requise pour accéder au parcours rendez-vous.
                    </div>
                )}

                <div className="space-y-4">
                    <Link to={citizenLoginPath} className="group block">
                        <div className="flex items-center p-4 border-2 border-transparent bg-gray-50 rounded-xl hover:border-indigo-500 hover:bg-white transition-all duration-200 shadow-sm">
                            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-lg group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                <User className="w-6 h-6" />
                            </div>
                            <div className="ml-4 text-left">
                                <h3 className="font-semibold text-lg text-gray-900">Particulier</h3>
                                <p className="text-sm text-gray-500">Gérer mes aides et mes rendez-vous</p>
                            </div>
                        </div>
                    </Link>

                    <Link to={proLoginPath} className="group block">
                        <div className="flex items-center p-4 border-2 border-transparent bg-gray-50 rounded-xl hover:border-emerald-500 hover:bg-white transition-all duration-200 shadow-sm">
                            <div className="p-3 bg-emerald-100 text-emerald-600 rounded-lg group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                <Briefcase className="w-6 h-6" />
                            </div>
                            <div className="ml-4 text-left">
                                <h3 className="font-semibold text-lg text-gray-900">Professionnel</h3>
                                <p className="text-sm text-gray-500">Accéder à mon espace structure</p>
                            </div>
                        </div>
                    </Link>
                </div>

                <div className="mt-8 text-center text-sm text-gray-500">
                    Pas encore de compte ?{' '}
                    <Link to={signupPath} className="text-indigo-600 font-semibold hover:underline">
                        Créer un compte
                    </Link>
                </div>

                {/* Accès admin discret — invisible pour le grand public */}
                <div className="mt-12 flex justify-center">
                    <Link to="/admin/login" className="text-xs text-gray-300 hover:text-gray-400 transition-colors">
                        Accès restreint
                    </Link>
                </div>
            </div>
        </div>
    );
}
