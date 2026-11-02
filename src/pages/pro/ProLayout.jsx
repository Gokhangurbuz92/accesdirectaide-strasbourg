// @ts-nocheck
import { rememberPendingInvite, pendingInvitePath } from '@/lib/pendingInvite';
import { SkeletonList } from '@/components/ui/skeleton';
// @ts-nocheck
import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link, Outlet } from 'react-router-dom';
import { LayoutDashboard, Building2, Users, FileText, LogOut, CalendarDays, Clock3, MessageCircle, Shield, BarChart3, Settings, Menu, X, Globe, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';
import NotificationCenter from '@/components/NotificationCenter';
import OnboardingTour from '@/components/OnboardingTour';
import ProBreadcrumb from '@/components/ProBreadcrumb';
import { getCsrfHeaders } from '@/lib/csrf';
import ServiceUnavailable from '@/components/ServiceUnavailable';
import { proRole } from '@/lib/proLabels.js';
import ProSessionExpiry from '@/components/pro/ProSessionExpiry';

export default function ProLayout() {
    const navigate = useNavigate();
    const location = useLocation();
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [unavailable, setUnavailable] = useState(false);   // Q10: the session could not be checked (outage)
    const [menuOpen, setMenuOpen] = useState(false);   // PKG-9 / M04: phone navigation (before: no navigation at all below md)
    useEffect(() => { setMenuOpen(false); }, [location.pathname]);
    const proLoginEntry = '/pro/login';

    useEffect(() => {
        const token = localStorage.getItem('pro_token');
        if (!token) {
            if (location.pathname !== '/pro/login' && location.pathname !== '/pro/register' && location.pathname !== '/pro/register-invite' && location.pathname !== '/pro/forgot-password' && location.pathname !== '/pro/reset-password') {
                rememberPendingInvite(window.location);     // the fragment (organization invitation) would be lost by the redirect
                // R7: a deep link (/pro/audit, /pro/dossier/…) is resumed after the sign-in, like ProGuard does (this effect runs first)
                const deep = !['/pro', '/pro/'].includes(location.pathname);
                navigate(deep ? `${proLoginEntry}?next=${encodeURIComponent(location.pathname + location.search)}` : proLoginEntry, { replace: true });
            } else {
                setLoading(false);
            }
            return;
        }

        // Verify token validity via /api/pro/me
        fetch('/api/pro/me', {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => {
                if (res.ok) return res.json();
                // R7: 404 = the account is no longer a member of an organization (disabled or moved): a refused session, not an outage
                const err = new Error([401, 403, 404].includes(res.status) ? 'Unauthorized' : 'Unavailable'); /** @type {any} */ (err).status = res.status;
                throw err;
            })
            .then(data => {
                setUser(data.user);
                // R34: where ADA Pro requires the second factor (production), a password-only session can only set it up — every other route refuses it
                if (data.session?.mfaRequired && !data.session.mfa && location.pathname !== '/pro/mfa-settings') {
                    navigate('/pro/mfa-settings', { replace: true, state: { mfaRequired: true } });
                    return;
                }
                // Show onboarding on first login
                if (!localStorage.getItem('ada_onboarding_done')) {
                    setShowOnboarding(true);
                }
                const resume = pendingInvitePath();                                  // logged in with an invitation waiting: go back to it
                if (resume && resume !== location.pathname) {
                    navigate(resume, { replace: true });
                // owner usefulness pass: a signed-in professional may still ask for and use a password reset link (« Paramètres › Mot de passe » leads here;
                // the redirect sent them back to the dashboard and a reset link opened while signed in did nothing)
                } else if (['/pro/login', '/pro/register'].includes(location.pathname)) {
                    navigate('/pro/dashboard');
                }
            })
            .catch((e) => {
                // Q10: only a REFUSED session signs the person out; an outage (5xx, network) keeps the session and says so
                if (e && [401, 403, 404].includes(e.status)) {
                    localStorage.removeItem('pro_token');
                    // R21: the sign-in page says why (the session ended: logout elsewhere, password reset, membership removed, 8 h) and the page asked for is
                    // resumed after the sign-in, as for a signed-out deep link (before: a silent jump to the sign-in, the page lost)
                    const deep = !['/pro', '/pro/', '/pro/login', '/pro/register', '/pro/register-invite', '/pro/forgot-password', '/pro/reset-password'].includes(location.pathname);
                    navigate(deep ? `${proLoginEntry}?next=${encodeURIComponent(location.pathname + location.search)}` : proLoginEntry, { replace: true, state: { sessionEnded: true } });
                } else {
                    setUnavailable(true);
                }
            })
            .finally(() => setLoading(false));
    }, [navigate, location.pathname, location.search, proLoginEntry]);

    // PKG-11 audit: the session is ended ON THE SERVER first (before: only the browser copy was removed and the token stayed valid for 8 h)
    const handleLogout = async () => {
        const token = localStorage.getItem('pro_token');
        if (token) {
            await fetch('/api/pro/auth/logout', { method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${token}`, ...getCsrfHeaders() } }).catch(() => undefined);
        }
        localStorage.removeItem('pro_token');
        navigate(proLoginEntry, { replace: true });
    };

    if (loading) {
        return <div className="p-6"><SkeletonList count={4} variant="card" /></div>;
    }

    // If on public auth pages, just render Outlet
    if (['/pro/login', '/pro/register', '/pro/register-invite', '/pro/forgot-password', '/pro/reset-password'].includes(location.pathname)) {
        return <Outlet />;
    }
    if (unavailable) return <ServiceUnavailable area="L’espace professionnel" />;

    return (
        <div className="min-h-screen bg-slate-100 flex">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:text-blue-700 focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
                Aller au contenu principal
            </a>
            <SEO
                title="AccesDirect Pro"
                description="Espace professionnel."
                noindex={true}
            />
            {/* Onboarding Tour */}
            {showOnboarding && (
                <OnboardingTour onComplete={() => setShowOnboarding(false)} />
            )}
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col">
                <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                    <p className="font-bold text-xl text-blue-800">AccesDirect Pro</p>{/* Q10: the brand is not the page heading — each page has its own h1 */}
                    {user && <NotificationCenter proId={user.id} />}
                </div>
                <nav className="flex-1 p-4 space-y-1" aria-label="Navigation de l'espace pro">
                    <ProNavItems role={user?.role} />
                </nav>
                <div className="p-4 border-t border-slate-200">
                    <div className="mb-4">
                        <p className="font-medium text-sm text-slate-900">{user?.email}</p>
                        <p className="text-xs text-slate-700">{proRole(user?.role)}</p>
                    </div>
                    <Button variant="outline" className="w-full justify-start" onClick={handleLogout}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Déconnexion
                    </Button>
                </div>
            </aside>

            {/* Main Content */}
            <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto outline-none">
                <ProSessionExpiry onExpired={() => { localStorage.removeItem('pro_token'); navigate(`${proLoginEntry}?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }} />
                <header className="bg-white border-b border-slate-200 p-2 sticky top-0 z-30 md:hidden flex justify-between items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setMenuOpen((o) => !o)}
                        aria-expanded={menuOpen}
                        aria-controls="pro-mobile-nav"
                        data-testid="pro-mobile-menu"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                        {menuOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
                        <span className="sr-only">{menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
                    </button>
                    <p className="font-bold text-lg text-blue-800">AccesDirect Pro</p>
                    <div className="flex items-center gap-1">
                        {user && <NotificationCenter />}
                        <button type="button" onClick={handleLogout} aria-label="Se déconnecter" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                            <LogOut className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </div>
                </header>
                {menuOpen && (
                    <nav id="pro-mobile-nav" aria-label="Navigation de l'espace pro" className="md:hidden border-b border-slate-200 bg-white p-3 space-y-1" data-testid="pro-mobile-nav">
                        <ProNavItems role={user?.role} />
                    </nav>
                )}
                <div className="p-4 md:p-8">
                    <ProBreadcrumb />
                    <Outlet context={{ user }} />
                </div>
            </main>
        </div>
    );
}

/** The navigation entries, shared by the desktop sidebar and the phone menu. */
function ProNavItems({ role }) {
    return (
        <>
            <NavLink to="/pro/dashboard" icon={LayoutDashboard}>Tableau de bord</NavLink>
            <NavLink to="/pro/dossiers" icon={FileText}>Dossiers suivis</NavLink>
            {/* R18 (R31): working baskets of verified aides, démarches and lieux */}
            <NavLink to="/pro/selections" icon={ListChecks}>Sélections d’orientation</NavLink>
            <NavLink to="/pro/orientations" icon={Users}>Orientations</NavLink>
            <NavLink to="/pro/rdv/agenda" icon={CalendarDays}>Agenda RDV</NavLink>
            <NavLink to="/pro/rdv/new" icon={FileText}>Nouveau RDV</NavLink>
            <NavLink to="/pro/rdv/services" icon={FileText}>Services RDV</NavLink>
            <NavLink to="/pro/rdv/disponibilites" icon={Clock3}>Disponibilités</NavLink>
            <NavLink to="/pro/rdv/absences" icon={Clock3}>Absences</NavLink>
            <NavLink to="/pro/messages" icon={MessageCircle}>Messages</NavLink>
            {/* R20: the territorial observatory (k-anonymous aggregates over verified organizations, ANONYMITY_REVIEW) was reachable only by its address */}
            <NavLink to="/pro/regional" icon={Globe}>Observatoire territorial</NavLink>
            {/* owner usefulness pass (2026-10-25): the video room opens from each video appointment (its page); /pro/visio was a « bientôt disponible » page */}
            {role === 'STRUCTURE_ADMIN' || role === 'SUPERADMIN' ? (
                <>
                    <NavLink to="/pro/team" icon={Users}>Mon équipe</NavLink>
                    <NavLink to="/pro/audit" icon={Shield}>Journal d&apos;audit</NavLink>
                    <NavLink to="/pro/reports" icon={BarChart3}>Impact</NavLink>
                    <NavLink to="/pro/structure" icon={Building2}>Ma structure</NavLink>
                </>
            ) : null}
            {/* Paramètres (notifications, MFA) was only in the phone menu: unreachable on a computer */}
            <NavLink to="/pro/parametres" icon={Settings}>Paramètres</NavLink>
        </>
    );
}

// @ts-ignore
function NavLink({ to, icon: Icon, children }) {
    const location = useLocation();
    const isActive = location.pathname.startsWith(to);
    return (
        <Link
            to={to}
            aria-current={isActive ? 'page' : undefined}
            className={`flex min-h-11 items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`}
        >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {children}
        </Link>
    );
}
