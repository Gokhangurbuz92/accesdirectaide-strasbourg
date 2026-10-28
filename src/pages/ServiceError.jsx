import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';
import brand from '@/lib/brand-config';
import {
    ArrowLeft,
    Home,
    LifeBuoy,
    Search,
    Wrench,
} from 'lucide-react';

/**
 * ServiceError — Institutional error page (404 / 500)
 *
 * Design follows French gov standards.
 * Provides back/home actions, security badge, help link.
 */
export default function ServiceError({ code = 404 }) {
    const is404 = code === 404;

    return (
        <div className="min-h-screen bg-white flex flex-col" data-testid={is404 ? 'page-not-found' : 'page-error'}>
            <SEO
                title={`${code} — ${brand.name}`}
                description={is404 ? 'Page introuvable' : 'Erreur serveur'}
                noindex
            />

            {/* Gov banner */}
            {brand.features.showGouvBanner && (
                <div
                    className="py-1.5 px-4 flex justify-between items-center text-[10px] font-semibold tracking-wider uppercase"
                    style={{
                        backgroundColor: brand.banner.bgColor,
                        color: brand.banner.textColor,
                    }}
                >
                    <span>{brand.banner.text}</span>
                    <span className="opacity-70 hidden sm:inline">
                        Liberté, Égalité, Fraternité
                    </span>
                </div>
            )}

            <section className="flex-1 flex flex-col items-center justify-center p-6 text-center" aria-labelledby="service-error-title">
                {/* Icon */}
                <div
                    className={`w-24 h-24 rounded-2xl flex items-center justify-center mb-6 shadow-xl transition-transform hover:scale-105 ${is404
                        ? 'bg-indigo-600 text-white'
                        : 'bg-red-500 text-white'
                        }`}
                >
                    {is404 ? <Search size={36} /> : <Wrench size={36} />}
                </div>

                <h1 className="text-6xl font-bold text-slate-900 mb-2">{code}</h1>

                <h2 id="service-error-title" className="text-xl font-bold text-slate-800 uppercase mb-4">
                    {is404 ? 'Page introuvable' : 'Erreur technique temporaire'}
                </h2>

                <p className="max-w-sm text-sm text-slate-600 mb-8 leading-relaxed">
                    {is404
                        ? "L\u2019adresse saisie est peut-être incorrecte ou la page a été déplacée."
                        : "Une erreur technique empêche d\u2019afficher cette page. Réessayez dans quelques instants."}
                </p>

                {/* Actions */}
                <div className="flex gap-3">
                    <Button variant="outline" onClick={() => window.history.back()}>
                        <ArrowLeft className="mr-1.5 h-4 w-4" />
                        Retour
                    </Button>
                    <Button asChild>
                        <Link to="/">
                            <Home className="mr-1.5 h-4 w-4" />
                            Accueil
                        </Link>
                    </Button>
                </div>

                {/* Security + Help */}
                <div className="mt-14 flex flex-wrap justify-center items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs">
                    <Link
                        to="/contact"
                        className="flex items-center gap-1.5 text-indigo-600 font-bold uppercase hover:underline"
                    >
                        <LifeBuoy size={12} />
                        Centre d&apos;aide
                    </Link>
                </div>
            </section>
        </div>
    );
}
