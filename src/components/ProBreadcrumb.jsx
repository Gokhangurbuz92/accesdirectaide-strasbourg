// @ts-nocheck
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { useT } from '@/i18n';

/** R40: the section names of the professional space, in the interface language (namespace `pro`) */
const routeLabels = (t) => ({
    pro: t('pro:breadcrumb.pro', 'Espace Pro'),
    dashboard: t('pro:breadcrumb.dashboard', 'Tableau de bord'),
    appointments: t('pro:breadcrumb.appointments', 'Rendez-vous'),
    messages: t('pro:breadcrumb.messages', 'Messages'),
    team: t('pro:breadcrumb.team', 'Équipe'),
    dossier: t('pro:breadcrumb.dossier', 'Dossiers'),
    availability: t('pro:breadcrumb.availability', 'Disponibilités'),
    services: t('pro:breadcrumb.services', 'Services'),
    reports: t('pro:breadcrumb.reports', 'Rapports'),
    settings: t('pro:breadcrumb.settings', 'Paramètres'),
    structure: t('pro:breadcrumb.structure', 'Structure'),
    mfa: t('pro:breadcrumb.mfa', 'Sécurité MFA'),
    audit: t('pro:breadcrumb.audit', "Journal d'audit"),
    visio: t('pro:breadcrumb.visio', 'Visioconférence'),
    // R31: the case, referral and selection screens fell back to the raw segment (« Selections » without its accent)
    dossiers: t('pro:breadcrumb.dossiers', 'Dossiers suivis'),
    orientations: t('pro:breadcrumb.orientations', 'Orientations'),
    selections: t('pro:breadcrumb.selections', 'Sélections d’orientation'),
    rdv: t('pro:breadcrumb.rdv', 'Rendez-vous'),
    regional: t('pro:breadcrumb.regional', 'Observatoire territorial'),
});

/**
 * ProBreadcrumb — Automatic breadcrumb from current route
 *
 * Renders:  Accueil > Espace Pro > Rendez-vous
 */
export default function ProBreadcrumb({ className = '' }) {
    const location = useLocation();
    const { t } = useT('pro');
    const ROUTE_LABELS = routeLabels(t);
    const segments = location.pathname
        .split('/')
        .filter(Boolean)
        .filter((s) => s !== 'app'); // skip /app prefix if present

    if (segments.length <= 1) return null; // Don't show on root

    const crumbs = segments.map((segment, index) => {
        const path = '/' + segments.slice(0, index + 1).join('/');
        // an identifier (uuid / long code) is the record itself, not a section name
        const label = ROUTE_LABELS[segment] || (/^[0-9a-f-]{16,}$/i.test(segment) ? t('pro:breadcrumb.detail', 'Détail') : segment.charAt(0).toUpperCase() + segment.slice(1));
        const isLast = index === segments.length - 1;

        return { path, label, isLast };
    });

    return (
        <nav
            className={`flex flex-wrap items-center gap-1 text-xs text-slate-700 mb-4 ${className}`}
            aria-label={t('pro:breadcrumb.label', "Fil d'Ariane")}
        >
            <Link
                to="/pro/dashboard"
                className="hover:text-indigo-700 transition-colors inline-flex min-h-6 min-w-6 items-center justify-center gap-1"
            >
                <Home size={14} aria-hidden="true" />
                <span className="sr-only">{t('pro:breadcrumb.home', 'Accueil')}</span>
            </Link>

            {crumbs.map((crumb) => (
                <span key={crumb.path} className="flex items-center gap-1">
                    <ChevronRight size={10} className="text-slate-500 rtl:-scale-x-100" aria-hidden="true" />
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
