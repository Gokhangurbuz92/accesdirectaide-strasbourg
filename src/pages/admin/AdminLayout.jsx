// @ts-nocheck
import { useEffect, useState } from 'react';
import { useLocation, Link, Outlet, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { apiClient } from '@/api/client';
import {
    LayoutDashboard, FileText, Building2, FileStack, Database,
    Inbox,
    CheckCircle, ListChecks,
    Bot, ToggleRight, MessagesSquare, Globe,
    RefreshCw, HeartPulse, Activity, Play, Shield,
    LogOut, ChevronDown, ChevronRight, Menu, X, Settings
} from 'lucide-react';
import { hasPermission, SIDEBAR_PERMISSIONS } from '@/lib/rbac';
import ServiceUnavailable from '@/components/ServiceUnavailable';


/**
 * AdminLayout — Sidebar navigation layout for all admin pages.
 * 
 * Features:
 * - Server-side auth validation via /api/auth/me (same as AdminGuard)
 * - Collapsible sidebar sections organized by category
 * - noindex/nofollow meta on all admin pages
 * - Responsive: drawer on mobile, fixed sidebar on desktop
 * @param {{ role: string; authType?: string; is_admin: boolean; isAdmin: boolean; roles: string | string[]; permissions: string | string[]; }} user
 */
function isAdminUser(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    // PKG-5 / A16: a named super-administrator (administrator session only; a professional token claiming SUPERADMIN never qualifies)
    if (user.role === 'superadmin' && user.authType === 'admin_jwt') return true;
    if (user.is_admin === true) return true;
    if (user.isAdmin === true) return true;
    if (Array.isArray(user.roles) && user.roles.includes('admin')) return true;
    if (Array.isArray(user.permissions) && user.permissions.includes('admin')) return true;
    return false;
}

// owner LAB audit (2026-10-25): the menu is organised around the work to do — what waits for a person first, then the catalogue, the people's data
// and the platform; the technical pages are grouped at the end. The former « Sync avancé » group (two pages of the Base44 platform) is gone.
const SIDEBAR_SECTIONS = [
    {
        label: 'À traiter',
        icon: LayoutDashboard,
        items: [
            { label: 'À traiter', to: '/admin/dashboard', icon: LayoutDashboard },
            { label: 'Veille automatique', to: '/admin/veille', icon: RefreshCw },
        ]
    },
    {
        // the automatic verification decides (owner decision 2026-10-25): these screens remain for a person who wants to look, never a required step
        label: 'Contrôles manuels (facultatifs)',
        icon: CheckCircle,
        items: [
            { label: 'Fiches du lancement (WS2)', to: '/admin/ws2', icon: ListChecks },
            { label: 'Organisations', to: '/admin/organizations', icon: Building2 },
            { label: 'Registre des doublons', to: '/admin/doublons', icon: Building2 },
            { label: 'Propositions de fiches', to: '/admin/structure-proposals', icon: Building2 },
            { label: 'Textes faciles à lire (FALC)', to: '/admin/falc', icon: FileText },
            { label: 'Signalements et suggestions', to: '/admin/signalements', icon: ListChecks },
            { label: 'File qualité des données', to: '/admin/review-queue', icon: ListChecks },
            { label: 'Contrôle humain de l’IA', to: '/admin/ai-oversight', icon: FileText },
        ]
    },
    {
        label: 'Catalogue',
        icon: FileText,
        items: [
            { label: 'Aides', to: '/admin/aides', icon: FileText },
            { label: 'Démarches', to: '/admin/demarches', icon: FileStack },
            { label: 'Structures', to: '/admin/structures', icon: Building2 },
            { label: 'Dispositifs', to: '/admin/dispositifs', icon: FileStack },
            { label: 'Guides', to: '/admin/guides', icon: FileText },
            { label: 'Actualités à relire', to: '/admin/inbox', icon: Inbox },
            { label: 'Sources officielles acceptées', to: '/admin/sources', icon: Database },
            { label: 'Versions des fiches', to: '/admin/versions', icon: FileText },
            { label: 'Qualité des données', to: '/admin/data-quality', icon: ListChecks },
        ]
    },
    {
        label: 'Personnes et données',
        icon: Shield,
        items: [
            { label: 'Protection des données', to: '/admin/privacy', icon: Shield },
            { label: 'Demandes d’aide', to: '/admin/support', icon: Inbox },
        ]
    },
    {
        label: 'Plateforme',
        icon: Globe,
        items: [
            { label: 'Opérations et journal d’audit', to: '/admin/operations', icon: Shield },
            { label: 'Partenaires institutionnels', to: '/admin/institutions', icon: Globe },
        ]
    },
    {
        label: 'IA et fonctionnalités',
        icon: Bot,
        items: [
            { label: 'Fonctionnalités', to: '/admin/features', icon: ToggleRight },
            { label: 'Métriques IA', to: '/admin/ai-metrics', icon: Activity },
            { label: 'Conversations de l’assistant', to: '/admin/conversations', icon: MessagesSquare },
            { label: 'Orchestrateur de collecte', to: '/admin/orchestrator', icon: Bot },
            { label: 'Tableau national', to: '/admin/national', icon: Globe },
        ]
    },
    {
        label: 'Technique',
        icon: Activity,
        items: [
            { label: 'Synchronisations', to: '/admin/sync', icon: RefreshCw },
            { label: 'État technique', to: '/admin/health', icon: HeartPulse },
            { label: 'Observabilité', to: '/admin/observability', icon: Activity },
            { label: 'Exécutions', to: '/admin/runs', icon: Play },
            { label: 'Journaux techniques', to: '/admin/logs', icon: ListChecks },
            { label: 'Mur des améliorations', to: '/admin/audit', icon: Shield },   // negative assistant feedback — the audit JOURNAL is in « Opérations et journal d’audit »
        ]
    },
];

// @ts-ignore
function SidebarSection({ section, isActive }) {
    const [open, setOpen] = useState(isActive);
    const SectionIcon = section.icon;

    // Auto-open section when it contains the active page
    useEffect(() => {
        if (isActive) setOpen(true);
    }, [isActive]);

    // Dashboard section = single link, not collapsible
    if (section.items.length === 1) {
        const item = section.items[0];
        return <NavItem item={item} />;
    }

    return (
        <div className="mb-1">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-700 hover:text-slate-700 transition-colors"
            >
                <SectionIcon className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{section.label}</span>
                {open
                    ? <ChevronDown className="h-3 w-3" />
                    : <ChevronRight className="h-3 w-3" />
                }
            </button>
            {open && (
                <div className="ml-2 space-y-0.5">
                    {section.items.map(item => (
                        <NavItem key={item.to} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}

function NavItem({ item }) {
    const location = useLocation();
    const isActive = location.pathname === item.to ||
        (item.to !== '/admin/dashboard' && location.pathname.startsWith(item.to + '/'));
    const Icon = item.icon;

    return (
        <Link
            to={item.to}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
        >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span>{item.label}</span>
        </Link>
    );
}

const PageLoader = () => (
    <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600" />
    </div>
);

export default function AdminLayout() {
    const location = useLocation();
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null);
    const [allowed, setAllowed] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const userData = await apiClient.auth.getUser();
                if (cancelled) return;

                if (isAdminUser(userData)) {
                    setUser(userData);
                    setAllowed(true);
                }
            } catch {
                if (!cancelled) setUnavailable(true);   // Q10: the session could not be checked (outage) — not a sign-out
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, []);

    // If on login page, just render it (no sidebar)
    if (location.pathname === '/admin/login') {
        return <Outlet />;
    }

    if (loading) return <PageLoader />;
    if (unavailable) return <ServiceUnavailable area="L’administration" />;
    if (!allowed) return <Navigate to="/admin/login" replace />;

    // the server ends the session (ADM-10: every session of this administrator); dropping the local token alone left a copied token valid for 8 hours
    const handleLogout = () => apiClient.auth.logout();

    const sidebarContent = (
        <>
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                <Link to="/admin/dashboard" className="font-bold text-lg text-blue-800">
                    Admin ADA
                </Link>
                <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="md:hidden p-1 rounded hover:bg-slate-100"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                {SIDEBAR_SECTIONS
                    .filter(section => {
                        const requiredPerm = SIDEBAR_PERMISSIONS[section.label];
                        if (!requiredPerm) return true; // No restriction
                        return hasPermission(user?.role, requiredPerm);
                    })
                    .map(section => (
                    <SidebarSection
                        key={section.label}
                        section={section}
                        isActive={section.items.some(item =>
                            location.pathname === item.to ||
                            location.pathname.startsWith(item.to + '/')
                        )}
                    />
                ))}
            </nav>

            {/* Paramètres link */}
            <div className="px-3 pb-2">
                <NavItem item={{ label: 'Paramètres', to: '/admin/parametres', icon: Settings }} />
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200">
                <div className="mb-3">
                    <p className="font-medium text-sm text-slate-900">{user?.email || 'Admin'}</p>
                    <p className="text-xs text-slate-700 flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                        {/* the label states the server role exactly: a plain administrator is not shown as a super-administrator */}
                        {user?.role === 'superadmin' || user?.role === 'super_admin' ? 'Super-administrateur' :
                         user?.role === 'admin' ? 'Administrateur' :
                         user?.role === 'editor' ? 'Éditeur' :
                         user?.role === 'moderator' ? 'Modérateur' :
                         user?.role === 'viewer' ? 'Auditeur' :
                         user?.role || 'admin'}
                    </p>
                </div>
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-slate-600 border border-slate-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors"
                >
                    <LogOut className="h-4 w-4" />
                    Déconnexion
                </button>
            </div>
        </>
    );

    return (
        <div className="min-h-screen bg-slate-100 flex">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:text-blue-700 focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
                Aller au contenu principal
            </a>
            <Helmet>
                <meta name="robots" content="noindex, nofollow" />
            </Helmet>

            {/* Desktop Sidebar */}
            <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col flex-shrink-0 sticky top-0 h-screen overflow-hidden">
                {sidebarContent}
            </aside>

            {/* Mobile Drawer Overlay */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-50 md:hidden">
                    <div
                        className="absolute inset-0 bg-black/50"
                        role="button"
                        tabIndex={0}
                        aria-label="Fermer le menu"
                        onClick={() => setMobileMenuOpen(false)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setMobileMenuOpen(false); }}
                    />
                    <aside className="relative w-72 h-full bg-white flex flex-col shadow-xl">
                        {sidebarContent}
                    </aside>
                </div>
            )}

            {/* Main Content Area */}
            <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto outline-none">
                {/* Mobile Header */}
                <header className="bg-white border-b border-slate-200 p-4 sticky top-0 z-40 md:hidden flex items-center justify-between">
                    {/* PKG-9 / M04: both icon buttons had no accessible name and a 32 px target */}
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(true)}
                        aria-label="Ouvrir le menu d'administration"
                        aria-expanded={mobileMenuOpen}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                        <Menu className="h-6 w-6" aria-hidden="true" />
                    </button>
                    <p className="font-bold text-lg text-blue-800">Admin ADA</p>
                    <button
                        type="button"
                        onClick={handleLogout}
                        aria-label="Se déconnecter"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-slate-100 text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                        <LogOut className="h-5 w-5" aria-hidden="true" />
                    </button>
                </header>

                {/* Page Content */}
                <div className="p-4 md:p-6 lg:p-8">
                    <Outlet context={{ user }} />
                </div>
            </main>
        </div>
    );
}
