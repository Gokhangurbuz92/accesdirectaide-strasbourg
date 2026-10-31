// @ts-nocheck
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const ROUTE_LABELS = {
    pro: 'Espace Pro',
    dashboard: 'Tableau de bord',
    appointments: 'Rendez-vous',
    messages: 'Messages',
    team: 'Équipe',
    dossier: 'Dossiers',
    availability: 'Disponibilités',
    services: 'Services',
    reports: 'Rapports',
    settings: 'Paramètres',
    structure: 'Structure',
    mfa: 'Sécurité MFA',
    audit: 'Journal d\'audit',
    visio: 'Visioconférence',
    // R31: the case, referral and selection screens fell back to the raw segment (« Selections » without its accent)
    dossiers: 'Dossiers suivis',
    orientations: 'Orientations',
    selections: 'Sélections d’orientation',
    rdv: 'Rendez-vous',
    regional: 'Observatoire territorial',
};

/**
 * ProBreadcrumb — Automatic breadcrumb from current route
 *
 * Renders:  Accueil > Espace Pro > Rendez-vous
 */
export default function ProBreadcrumb({ className = '' }) {
    const location = useLocation();
    const segments = location.pathname
        .split('/')
        .filter(Boolean)
        .filter((s) => s !== 'app'); // skip /app prefix if present

    if (segments.length <= 1) return null; // Don't show on root

    const crumbs = segments.map((segment, index) => {
        const path = '/' + segments.slice(0, index + 1).join('/');
        // an identifier (uuid / long code) is the record itself, not a section name
        const label = ROUTE_LABELS[segment] || (/^[0-9a-f-]{16,}$/i.test(segment) ? 'Détail' : segment.charAt(0).toUpperCase() + segment.slice(1));
        const isLast = index === segments.length - 1;

        return { path, label, isLast };
    });

    return (
        <nav
            className={`flex flex-wrap items-center gap-1 text-xs text-slate-700 mb-4 ${className}`}
            aria-label="Fil d'Ariane"
        >
            <Link
                to="/pro/dashboard"
                className="hover:text-indigo-700 transition-colors inline-flex min-h-6 min-w-6 items-center justify-center gap-1"
            >
                <Home size={14} aria-hidden="true" />
                <span className="sr-only">Accueil</span>
            </Link>

            {crumbs.map((crumb) => (
                <span key={crumb.path} className="flex items-center gap-1">
                    <ChevronRight size={10} className="text-slate-500" aria-hidden="true" />
                    {crumb.isLast ? (
                        <span className="font-medium text-slate-700" aria-current="page">
                            {crumb.label}
                        </span>
                    ) : (
                        <Link
                            to={crumb.path}
                            className="hover:text-indigo-700 transition-colors inline-flex min-h-6 items-center"
                        >
                            {crumb.label}
                        </Link>
                    )}
                </span>
            ))}
        </nav>
    );
}
