// @ts-nocheck
import { rememberPendingInvite, pendingInvitePath } from '@/lib/pendingInvite';
import { SkeletonList } from '@/components/ui/skeleton';
// @ts-nocheck
import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link, Outlet } from 'react-router-dom';
import { LayoutDashboard, Building2, Users, FileText, LogOut, CalendarDays, Clock3, MessageCircle, Shield, BarChart3, Settings, Menu, X, Globe, ListChecks, HeartHandshake, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';
import useMainHeadingText from '@/hooks/useMainHeadingText';
import NotificationCenter from '@/components/NotificationCenter';
import { useProUnreadMessages } from '@/lib/use-pro-unread-messages';
import OnboardingTour from '@/components/OnboardingTour';
import ProBreadcrumb from '@/components/ProBreadcrumb';
import { getCsrfHeaders } from '@/lib/csrf';
import ServiceUnavailable from '@/components/ServiceUnavailable';
import { useProLabels } from '@/lib/proLabelsI18n';
import ProSessionExpiry from '@/components/pro/ProSessionExpiry';
import { useT } from '@/i18n';
import { moduleOfScreen, moduleOpen } from '@/lib/proModules';
import { NotYetOpenNotice, NotYetOpenBadge } from '@/components/pro/NotYetOpen';
import { sectionTone } from '@/design/categoryTone';

export default function ProLayout() {
    const { t } = useT('pro');
    const { proRole } = useProLabels();
    const navigate = useNavigate();
    const location = useLocation();
    const heading = useMainHeadingText(location.pathname);   // FA-D4 (RGAA 8.6): each screen's own title, from its h1, unless the page sets one
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null);
    const [modules, setModules] = useState(null);   // G3: the console modules the server serves (/api/pro/me `modules`); null = unknown = all shown
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [unavailable, setUnavailable] = useState(false);   // Q10: the session could not be checked (outage)
    const [menuOpen, setMenuOpen] = useState(false);   // PKG-9 / M04: phone navigation (before: no navigation at all below md)
    const unreadMessages = useProUnreadMessages(Boolean(user), location.pathname);   // B02
    useEffect(() => { setMenuOpen(false); }, [location.pathname]);
    // UI modernisation: Escape closes the drawer and gives the focus back to the menu button
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { setMenuOpen(false); document.querySelector('[data-testid="pro-mobile-menu"]')?.focus(); } };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [menuOpen]);
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
        // R47: an answer that arrives after the page changed (the person signed in meanwhile and went to `next`) is ignored — it used to send them to the dashboard
        let current = true;
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
                if (!current) return;
                setUser(data.user);
                setModules(data.modules && typeof data.modules === 'object' ? data.modules : null);
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
                if (!current) return;
                // Q10: only a REFUSED session signs the person out; an outage (5xx, network) keeps the session and says so
                if (e && [401, 403, 404].includes(e.status)) {
                    localStorage.removeItem('pro_token');
                    // R21: the sign-in page says why (the session ended: logout elsewhere, password reset, membership removed, 8 h) and the page asked for is
                    // resumed after the sign-in, as for a signed-out deep link (before: a silent jump to the sign-in, the page lost)
                    const deep = !['/pro', '/pro/', '/pro/login', '/pro/register', '/pro/register-invite', '/pro/forgot-password', '/pro/reset-password'].includes(location.pathname);
                    // R47: on the sign-in page itself its own ?next= is kept (an expired token left in the browser dropped it: the person landed on the dashboard)
                    const keep = location.pathname === '/pro/login' ? location.search : '';
                    navigate(deep ? `${proLoginEntry}?next=${encodeURIComponent(location.pathname + location.search)}` : `${proLoginEntry}${keep}`, { replace: true, state: { sessionEnded: true } });
                } else {
                    setUnavailable(true);
                }
            })
            .finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [navigate, location.pathname, location.search, proLoginEntry]);

    // PKG-11 audit: the session is ended ON THE SERVER first (before: only the browser copy was removed and the token stayed valid for 8 h)
    const handleLogout = async () => {
        const token = localStorage.getItem('pro_token');
        if (token) {
            await fetch('/api/pro/auth/logout', { method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${token}`, ...getCsrfHeaders() } }).catch(() => undefined);
        }
        localStorage.removeItem('pro_token');
        // R46 / N09: a session opened through ProConnect also ends at the federation (RP-initiated logout; the server falls back to the sign-in page)
        let viaProConnect = false;
        try { viaProConnect = localStorage.getItem('pro_login_via') === 'proconnect'; localStorage.removeItem('pro_login_via'); } catch { viaProConnect = false; }
        if (viaProConnect) { window.location.assign('/api/pro/auth/proconnect/logout'); return; }
        navigate(proLoginEntry, { replace: true });
    };

    if (loading) {
        return <main id="main-content" aria-busy="true" className="p-6"><SkeletonList count={4} variant="card" /></main>;   // R41-K A6: a landmark while the session is checked
    }

    // If on public auth pages, just render Outlet
    if (['/pro/login', '/pro/register', '/pro/register-invite', '/pro/forgot-password', '/pro/reset-password'].includes(location.pathname)) {
        return <Outlet />;
    }
    if (unavailable) return <ServiceUnavailable area={t('pro:layout.area', 'L’espace professionnel')} />;

    return (
        <div className="min-h-screen bg-ada-canvas flex">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:start-4 focus:z-50 focus:bg-white focus:text-blue-700 focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
                {t('pro:layout.aller_contenu_principal', 'Aller au contenu principal')}
            </a>
            <SEO
                title={heading ? `${heading} — ${t('pro:layout.accesdirect_pro', 'AccesDirect Pro')}` : t('pro:layout.accesdirect_pro', 'AccesDirect Pro')}
                description={t('pro:layout.espace_professionnel', 'Espace professionnel.')}
                noindex={true}
            />
            {/* Onboarding Tour */}
            {showOnboarding && (
                <OnboardingTour onComplete={() => setShowOnboarding(false)} />
            )}
            {/* Sidebar */}
            {/* UI modernisation: a wider sidebar (labels on one line) that stays in view while the page scrolls; drawer below 1024 px */}
            <div className="w-72 shrink-0 bg-ada-surface border-e border-ada-line hidden lg:block">
            <aside className="flex flex-col sticky top-0 h-screen overflow-y-auto">{/* 24/11/2026: the whole sidebar scrolls (a short screen used to cut the menu under « Pilotage » above a fixed footer) */}
                <div className="px-5 py-5 border-b border-ada-line flex items-center justify-between gap-2">
                    <p className="font-bold text-lg text-ada-ink"><span className="ada-wordmark">{t('pro:layout.accesdirect_pro', 'AccesDirect Pro')}</span></p>{/* Q10: the brand is not the page heading — each page has its own h1 */}
                    {user && <NotificationCenter proId={user.id} />}
                </div>
                <nav className="flex-1 p-3 space-y-0.5" aria-label={t('pro:layout.navigation_espace_pro', 'Navigation de l\'espace pro')}>
                    <ProNavItems role={user?.role} unreadMessages={unreadMessages} modules={modules} />
                </nav>
                <div className="sticky bottom-0 border-t border-ada-line bg-ada-surface p-3">
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm text-ada-ink truncate">{user?.email}</p>
                            <p className="text-xs text-ada-ink-3">{proRole(user?.role)}</p>
                        </div>
                        <Button variant="outline" className="min-h-11 shrink-0 px-3" onClick={handleLogout}>
                            <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
                            {t('pro:layout.deconnexion', 'Déconnexion')}
                        </Button>
                    </div>
                </div>
            </aside>
            </div>

            {/* Main Content */}
            <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 outline-none">
                <ProSessionExpiry onExpired={() => { localStorage.removeItem('pro_token'); navigate(`${proLoginEntry}?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }} />
                <header className="bg-ada-surface border-b border-ada-line p-2 sticky top-0 z-50 lg:hidden flex justify-between items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setMenuOpen((o) => !o)}
                        aria-expanded={menuOpen}
                        aria-controls="pro-mobile-nav"
                        data-testid="pro-mobile-menu"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-ada-line text-ada-ink hover:bg-ada-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                        {menuOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
                        <span className="sr-only">{menuOpen ? t('pro:layout.close_menu', 'Fermer le menu') : t('pro:layout.open_menu', 'Ouvrir le menu')}</span>
                    </button>
                    <p className="font-bold text-lg"><span className="ada-wordmark">{t('pro:layout.accesdirect_pro', 'AccesDirect Pro')}</span></p>
                    <div className="flex items-center gap-1">
                        {user && <NotificationCenter />}
                        <button type="button" onClick={handleLogout} aria-label={t('pro:layout.deconnecter', 'Se déconnecter')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                            <LogOut className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </div>
                </header>
                {/* UI modernisation: on a phone or a tablet the menu is a drawer over the page (backdrop, Escape and a tap outside close it) */}
                {menuOpen && (
                    <div className="lg:hidden fixed inset-0 z-40" data-testid="pro-mobile-drawer">
                        <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 h-full w-full cursor-default bg-slate-950/40" onClick={() => setMenuOpen(false)} />
                        <nav id="pro-mobile-nav" aria-label={t('pro:layout.navigation_espace_pro', 'Navigation de l\'espace pro')} className="absolute inset-y-0 start-0 w-[min(20rem,86vw)] overflow-y-auto border-e border-ada-line bg-ada-surface p-3 pt-16 space-y-0.5 shadow-xl" data-testid="pro-mobile-nav">
                            <ProNavItems role={user?.role} unreadMessages={unreadMessages} modules={modules} />
                        </nav>
                    </div>
                )}
                <div className="ada-pro-page mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
                    <ProBreadcrumb />
                    {/* G3: a screen of a module the server does not serve says « pas encore ouvert » (not an outage) and is not loaded */}
                    {moduleOpen(modules, moduleOfScreen(location.pathname)) ? <Outlet context={{ user, modules }} /> : <NotYetOpenNotice />}
                </div>
            </main>
        </div>
    );
}

/**
 * The navigation entries, shared by the desktop sidebar and the phone drawer.
 * UI modernisation (24/11/2026): the ~20 entries are grouped in titled sections (Accueil, Accompagnement, Rendez-vous et échanges, Structure et équipe, Pilotage) — same order as before;
 * the entries of modules the server does not serve yet are gathered at the end under « Pas encore ouvert » (same order, still not links), so the
 * open work comes first and no label wraps over four lines next to its badge.
 */
function ProNavItems({ role, unreadMessages = null, modules = null }) {
    const { t } = useT('pro');
    // G3: an entry of a module the server does not serve is shown as text marked « pas encore ouvert » (no link); the agenda's sub-entries are left out
    const open = (/** @type {string} */ m) => moduleOpen(modules, m);
    const admin = role === 'STRUCTURE_ADMIN' || role === 'SUPERADMIN';
    /** @typedef {{ to: string, icon: any, label: string, section?: string, module?: string, badge?: any, badgeLabel?: string }} Entry */
    /** @type {{ id: string, title: string, items: (Entry | false | null)[] }[]} */
    const sections = [
        { id: 'home', title: t('pro:nav.section.home', 'Accueil'), items: [
            { to: '/pro/dashboard', section: 'dashboard', icon: LayoutDashboard, label: t('pro:layout.tableau_bord', 'Tableau de bord') },
            // Guide ADA Pro (24/11/2026): how each screen works, for every member
            { to: '/pro/guide', section: 'support', icon: LifeBuoy, label: t('pro:layout.guide', 'Guide ADA Pro') },
        ] },
        { id: 'support', title: t('pro:nav.section.support', 'Accompagnement'), items: [
            { module: 'cases', to: '/pro/dossiers', section: 'cases', icon: FileText, label: t('pro:layout.dossiers_suivis', 'Dossiers suivis') },
            // R18 (R31): working baskets of verified aides, démarches and lieux
            { module: 'selections', to: '/pro/selections', section: 'catalogue', icon: ListChecks, label: t('pro:layout.selections_orientation', 'Sélections d’orientation') },
            { module: 'referrals', to: '/pro/orientations', section: 'referrals', icon: Users, label: t('pro:layout.orientations', 'Orientations') },
            // G14-PS: the non-HDS social referral
            { module: 'socialReferrals', to: '/pro/orientations-sociales', section: 'orientations', icon: Users, label: t('socialref:pro.title', 'Orientations sociales') },
        ] },
        { id: 'rdv', title: t('pro:nav.section.rdv_messages', 'Rendez-vous et échanges'), items: [
            { module: 'agenda', to: '/pro/rdv/agenda', section: 'agenda', icon: CalendarDays, label: t('pro:layout.agenda_rdv', 'Agenda RDV') },
            open('agenda') && { to: '/pro/rdv/new', section: 'rdv', icon: FileText, label: t('pro:layout.nouveau_rdv', 'Nouveau RDV') },
            open('agenda') && { to: '/pro/rdv/services', section: 'services', icon: FileText, label: t('pro:layout.services_rdv', 'Services RDV') },
            open('agenda') && { to: '/pro/rdv/disponibilites', section: 'disponibilites', icon: Clock3, label: t('pro:layout.disponibilites', 'Disponibilités') },
            open('agenda') && { to: '/pro/rdv/absences', section: 'absences', icon: Clock3, label: t('pro:layout.absences', 'Absences') },
            // B02: the member's unread conversations (a number only when the database keeps read markers)
            { module: 'messages', to: '/pro/messages', section: 'messages', icon: MessageCircle, label: t('pro:layout.messages', 'Messages'), badge: unreadMessages, badgeLabel: unreadMessages ? t('pro:layout.messages_unread', 'Messages, non lus : {{count}}', { count: unreadMessages }) : undefined },
            // G14-AID: the helper code of the « mode accompagnant » — shown only when the server serves it (out of the AIPD until extended)
            modules?.assist === true && { to: '/pro/accompagnement', section: 'accompagnant', icon: HeartHandshake, label: t('pro:layout.accompagnement', 'Accompagner une personne') },
        ] },
        // owner usefulness pass (2026-10-25): the video room opens from each video appointment (its page); /pro/visio was a « bientôt disponible » page
        { id: 'org', title: t('pro:nav.section.org', 'Structure et équipe'), items: admin ? [
            { to: '/pro/structure', section: 'structure', icon: Building2, label: t('pro:layout.structure', 'Ma structure') },
            { to: '/pro/team', section: 'team', icon: Users, label: t('pro:layout.mon_equipe', 'Mon équipe') },
            // X05 (expansion): shown only when the server says the job board is served (never a « pas encore ouvert » entry for an expansion)
            modules?.employment === true && { to: '/pro/offres-emploi', section: 'services', icon: FileText, label: t('pro:layout.job_listings', 'Offres d’emploi') },
        ] : [] },
        { id: 'steer', title: t('pro:nav.section.steer', 'Pilotage'), items: [
            admin && { to: '/pro/reports', section: 'impact', icon: BarChart3, label: t('pro:layout.impact', 'Impact') },
            admin && { to: '/pro/audit', section: 'audit', icon: Shield, label: t('pro:layout.journal_audit', 'Journal d\'audit') },
            // R20: the territorial observatory (k-anonymous aggregates over verified organizations, ANONYMITY_REVIEW) was reachable only by its address
            { module: 'regional', to: '/pro/regional', section: 'regional', icon: Globe, label: t('pro:layout.observatoire_territorial', 'Observatoire territorial') },
            // Paramètres (notifications, MFA) was only in the phone menu: unreachable on a computer
            { to: '/pro/parametres', section: 'parametres', icon: Settings, label: t('pro:layout.parametres', 'Paramètres') },
        ] },
    ];
    /** @type {Entry[]} */
    const closed = [];
    const rendered = sections.map((sec) => {
        const items = /** @type {Entry[]} */ (sec.items.filter(Boolean)).filter((it) => {
            if (it.module && !open(it.module)) { closed.push(it); return false; }
            return true;
        });
        if (!items.length) return null;
        return (
            <div key={sec.id} className="pt-3 first:pt-0" role="group" aria-labelledby={`pro-nav-${sec.id}`}>
                <p id={`pro-nav-${sec.id}`} className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ada-ink-3">{sec.title}</p>
                {items.map((it) => <NavLink key={it.to} to={it.to} icon={it.icon} section={it.section} badge={it.badge} badgeLabel={it.badgeLabel}>{it.label}</NavLink>)}
            </div>
        );
    });
    return (
        <>
            {rendered}
            {closed.length ? (
                <div className="mt-3 border-t border-ada-line pt-3" role="group" aria-labelledby="pro-nav-closed-title">
                    <p id="pro-nav-closed-title" className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ada-ink-3">{t('pro:nav.section.closed', 'Pas encore ouvert')}</p>
                    {closed.map((it) => <ClosedNavItem key={it.to} icon={it.icon}>{it.label}</ClosedNavItem>)}
                </div>
            ) : null}
        </>
    );
}

/** G3: a closed module's entry — not a link, marked « pas encore ouvert » */
// @ts-ignore
function ClosedNavItem({ icon: Icon, children }) {
    return (
        <p className="flex min-h-11 items-start gap-3 px-3 py-2 rounded-lg text-sm font-medium text-ada-ink-3" data-testid="pro-nav-closed">
            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
                <span className="block">{children}</span>
                <NotYetOpenBadge />
            </span>
        </p>
    );
}

// @ts-ignore
function NavLink({ to, icon: Icon, section = undefined, children, badge = null, badgeLabel = undefined }) {
    const location = useLocation();
    const isActive = location.pathname.startsWith(to);
    const tone = sectionTone(section);   // colour system: each entry's icon in its section colour; the active entry on its light tint (aria-current says it too)
    return (
        <Link
            to={to}
            aria-current={isActive ? 'page' : undefined}
            aria-label={badge ? badgeLabel : undefined}
            className={`flex min-h-11 items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? `${tone.soft} ${tone.text} font-semibold` : 'text-ada-ink-2 hover:bg-ada-sunken hover:text-ada-ink'
                }`}
        >
            <Icon className={`h-5 w-5 shrink-0 ${tone.text}`} aria-hidden="true" />
            <span className="min-w-0">{children}</span>
            {badge ? <span data-testid="pro-nav-unread" aria-hidden="true" className="ms-auto inline-flex min-w-6 items-center justify-center rounded-full bg-blue-800 px-1.5 py-0.5 text-xs font-bold text-white">{badge > 99 ? '99+' : badge}</span> : null}
        </Link>
    );
}
