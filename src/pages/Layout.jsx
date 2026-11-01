// @ts-nocheck

import React, { useState, lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { navActive } from '@/lib/navActive';
import Logo from '@/components/Brand/Logo';
import { createPageUrl } from '@/utils';
import {
  Menu,
  X,
  Home,
  HandHeart,
  FileText,
  MapPin,
  Wrench,
  Activity,
  ListChecks,
  Info,
  Calendar,
  ChevronDown,
  Newspaper,
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { AuthHeaderActions, AuthMobileActions } from '@/components/auth/AuthHeaderActions';
import DarkModeToggle from '@/components/ui/DarkModeToggle';
import { adminClient as client } from '@/api/client';
import PropTypes from 'prop-types';
import brand from '@/lib/brand-config';
import { frontendEnv } from '@/config/env';
import { openLinks } from '@/lib/publicBeta';
import '@/styles/layout-accessibility.css';
import LanguageSelector from '@/components/i18n/LanguageSelector';
import LanguageSuggestion from '@/components/i18n/LanguageSuggestion';
import ReadAloud from '@/components/a11y/ReadAloud';   // the accessibility modes (an inline style element before Q04: CSP style-src)
import { Trans } from 'react-i18next';
import i18n, { useLanguage, useT } from '@/i18n';

// Lazy-load non-critical components to reduce first-paint bundle
const AccessibilityPanel = lazy(() => import('@/components/ui/AccessibilityPanel'));
const HideScreenButton = lazy(() => import('@/components/ui/HideScreenButton'));
const ChatAssistant = lazy(() => import('@/components/chat/ChatAssistant'));

const NAV_ITEMS = [
  { label: 'Accueil', page: 'Home', icon: Home },
  {
    label: 'Aides',
    page: 'Aides',
    icon: HandHeart,
    submenu: [
      { label: 'Toutes les aides', page: 'Aides' },
      { label: 'Logement', page: 'Aides', params: 'category=logement' },
      { label: 'Santé', page: 'Aides', params: 'category=sante' },
      { label: 'Handicap', page: 'Aides', params: 'category=handicap' },
      { label: 'Emploi', page: 'Aides', params: 'category=emploi' },
      { label: 'Famille', page: 'Aides', params: 'category=famille' },
    ]
  },
  { label: 'Démarches', page: 'Demarches', icon: FileText },
  { label: 'Annuaire', page: 'Annuaire', icon: MapPin },
  // R26: « Outils » (official simulators, real content) in the menu. R29: « Actualités » is back now that verified official news is published
  { label: 'Outils', page: 'Tools', icon: Wrench },
  { label: 'Actualités', page: 'Actualites', icon: Newspaper },
  { label: 'Rendez-vous', page: 'AdminAppointments', icon: Calendar, adminOnly: true },
  { label: 'Structures', page: 'AdminStructures', icon: MapPin, adminOnly: true },
  { label: 'Démarches', page: 'AdminDemarches', icon: FileText, adminOnly: true },
  { label: 'Observabilité', page: 'AdminObservability', icon: Activity, adminOnly: true },
  { label: 'Review Queue', page: 'AdminReviewQueue', icon: ListChecks, adminOnly: true },
  { label: 'Admin', page: 'AdminSync', icon: Info, adminOnly: true },
];

const FOOTER_RESSOURCES = [
  { label: 'Trouver par besoin', href: '/besoins' },
  { label: 'Bonnes pratiques', href: '/bonnes-pratiques' },
  { label: 'Outils', href: '/outils' },
  { label: 'Dispositifs', href: '/dispositifs' },
  { label: 'Actualités', href: '/actualites' },
];

const FOOTER_ABOUT = [
  { label: 'À propos', href: '/a-propos' },   // PKG-11 audit pass 2: createPageUrl('APropos') gave /apropos, a 404 on every page
  { label: 'Sources & méthode', page: 'SourcesMethode' },
  { label: 'Territoire couvert', href: '/territoire' },
  { label: 'Contact', page: 'Contact' },
  { label: 'Partenaires', href: '/partenaires' },
  { label: 'Impact', href: '/impact' },
  { label: 'Signaler une erreur', href: '/contact?sujet=signalement_erreur' },
];

const FOOTER_LEGAL = [
  { label: 'Accessibilité', page: 'Accessibilite' },
  { label: 'Mentions légales', page: 'MentionsLegales' },
  { label: 'Politique de confidentialité', page: 'Confidentialite' },
  { label: 'Cookies', page: 'Cookies' },
  { label: 'Sécurité & RGPD', href: '/securite-et-rgpd' },
];

/** @param {{ href?: string, page?: string }} link */
const footerPath = (link) => link.href || createPageUrl(link.page);

/**
 * R32: the labels of the menus and of the footer in the interface language. The lists above keep their French label (other checks read them);
 * each label has one explicit call here so that scripts/i18n-check.mjs sees its key. A label missing here is shown in French.
 */
const LABELS = {
  'Accueil': (t) => t('layout:nav.home', 'Accueil'),
  'Aides': (t) => t('layout:nav.aides', 'Aides'),
  'Toutes les aides': (t) => t('layout:nav.aides.all', 'Toutes les aides'),
  'Logement': (t) => t('layout:nav.aides.logement', 'Logement'),
  'Santé': (t) => t('layout:nav.aides.sante', 'Santé'),
  'Handicap': (t) => t('layout:nav.aides.handicap', 'Handicap'),
  'Emploi': (t) => t('layout:nav.aides.emploi', 'Emploi'),
  'Famille': (t) => t('layout:nav.aides.famille', 'Famille'),
  'Démarches': (t) => t('layout:nav.demarches', 'Démarches'),
  'Annuaire': (t) => t('layout:nav.annuaire', 'Annuaire'),
  'Outils': (t) => t('layout:nav.outils', 'Outils'),
  'Actualités': (t) => t('layout:nav.actualites', 'Actualités'),
  'Rendez-vous': (t) => t('layout:nav.admin.appointments', 'Rendez-vous'),
  'Structures': (t) => t('layout:nav.admin.structures', 'Structures'),
  'Observabilité': (t) => t('layout:nav.admin.observability', 'Observabilité'),
  'Review Queue': (t) => t('layout:nav.admin.review', 'Review Queue'),
  'Admin': (t) => t('layout:nav.admin.admin', 'Admin'),
  'Trouver par besoin': (t) => t('layout:footer.needs', 'Trouver par besoin'),
  'Bonnes pratiques': (t) => t('layout:footer.guides', 'Bonnes pratiques'),
  'Dispositifs': (t) => t('layout:footer.dispositifs', 'Dispositifs'),
  'À propos': (t) => t('layout:footer.about', 'À propos'),
  'Sources & méthode': (t) => t('layout:footer.sources', 'Sources & méthode'),
  'Territoire couvert': (t) => t('layout:footer.territory', 'Territoire couvert'),
  'Contact': (t) => t('layout:footer.contact', 'Contact'),
  'Partenaires': (t) => t('layout:footer.partners', 'Partenaires'),
  'Impact': (t) => t('layout:footer.impact', 'Impact'),
  'Signaler une erreur': (t) => t('layout:footer.report', 'Signaler une erreur'),
  'Accessibilité': (t) => t('layout:footer.accessibility', 'Accessibilité'),
  'Mentions légales': (t) => t('layout:footer.legalNotice', 'Mentions légales'),
  'Politique de confidentialité': (t) => t('layout:footer.privacy', 'Politique de confidentialité'),
  'Cookies': (t) => t('layout:footer.cookies', 'Cookies'),
  'Sécurité & RGPD': (t) => t('layout:footer.security', 'Sécurité & RGPD'),
};

/** @param {(key: string, fallback: string) => string} t @param {{ label: string }} item */
const labelOf = (t, item) => (LABELS[item.label] ? LABELS[item.label](t) : item.label);

// @ts-ignore
export default function Layout({ children }) {   // R26: the active menu entry comes from the address (navActive), no longer from currentPageName
  const { t } = useT('layout');
  const { isSource } = useLanguage();
  const label = (item) => labelOf(t, item);
  const { pathname } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = React.useRef(null);
  // Q01: Escape closes the phone menu and gives the focus back to its button; a new page closes it
  React.useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setMobileMenuOpen(false); menuButtonRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);
  React.useEffect(() => { setMobileMenuOpen(false); }, [pathname]);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  React.useEffect(() => {
    // Audit: Check for admin role. Since exact API is unknown, checking common patterns.
    // Assuming client.auth.user gives current user info.
    const checkAdmin = async () => {
      try {
        const user = client.auth?.user || (await client.auth?.getUser?.());
        // Basic check: if user exists and has admin role or specific email
        // Adjust this logic based on actual User entity structure
        if (user && (user.role === 'admin' || user.is_admin === true)) {
          setIsAdmin(true);
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Error checking admin status:', error);
      }
    };
    checkAdmin();
  }, []);

  const filteredNavItems = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:start-4 focus:z-50 focus:bg-white focus:text-brand-primary focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
      >
        {t('layout:skip', 'Aller au contenu principal')}
      </a>

      {/* Header */}
      <LanguageSuggestion />
      <header role="banner" className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo */}
            <div className="flex items-center flex-shrink-0">
              {/* Mobile: Logo + Short Name */}
              <Link
                to={createPageUrl('Home')}
                className="sm:hidden inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors hover:bg-slate-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                aria-label={t('layout:header.home', 'Aller à l’accueil')}
              >
                <img src="/favicon.svg" alt={t('layout:header.logo', 'Logo AccesDirectAide')} className="h-8 w-8" width="32" height="32" />

              </Link>
              {/* Desktop: Logo + Name */}
              <Link
                to={createPageUrl('Home')}
                className="hidden sm:inline-flex items-center gap-2.5 rounded-full px-2.5 py-1.5 transition-colors hover:bg-slate-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                aria-label={t('layout:header.home', "Aller à l'accueil")}
              >
                <img src="/favicon.svg" alt={t('layout:header.logo', 'Logo AccesDirectAide')} className="h-9 w-9" width="36" height="36" />
                <span className="text-sm font-bold" style={{ background: 'linear-gradient(135deg, #002D5A 0%, #1e40af 50%, #4F46E5 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AccesDirectAide</span>
              </Link>
            </div>

            {/* Navigation desktop */}
            {/* PKG-11 / P01: the full menu needs ~1200 px; below 1280 px the menu button is used (it used to overflow the page from 1024 to 1279 px) */}
            <nav className="hidden xl:flex items-center gap-1" aria-label={t('layout:nav.main', 'Navigation principale')}>
              {filteredNavItems.map((item) => (
                <div key={item.page} className="relative group">
                  {item.submenu ? (
                    <>
                      <Link
                        to={createPageUrl(item.page)}
                        className={`flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 rounded-lg relative
                          ${navActive(pathname, item.page)
                            ? 'text-brand-primary after:absolute after:bottom-0 after:start-3 after:end-3 after:h-0.5 after:bg-brand-primary'
                            : 'text-text-body hover:text-brand-primary hover:bg-brand-highlight/10'
                          }`}
                        aria-haspopup="menu"
                        aria-controls={`nav-${item.page.toLowerCase()}-menu`}
                        aria-current={navActive(pathname, item.page) ? 'page' : undefined}
                      >
                        {label(item)}
                        <ChevronDown className="h-4 w-4" />
                      </Link>
                      <div
                        id={`nav-${item.page.toLowerCase()}-menu`}
                        className="absolute start-0 top-full pt-2 hidden group-hover:block group-focus-within:block"
                        role="menu"
                        aria-label={t('layout:nav.submenu', 'Sous-menu {{label}}', { label: label(item) })}
                      >
                        <div className="bg-white rounded-xl shadow-lg border border-slate-200 py-2 min-w-[180px]">
                          {item.submenu.map((sub, idx) => (
                            <Link
                              key={idx}
                              to={createPageUrl(sub.page) + (sub.params ? `?${sub.params}` : '')}
                              className="block px-4 py-2 text-sm text-text-body hover:bg-brand-highlight/10 hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-inset"
                              role="menuitem"
                            >
                              {label(sub)}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <Link
                      to={createPageUrl(item.page)}
                      className={`flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 rounded-lg relative
                        ${navActive(pathname, item.page)
                          ? 'text-brand-primary after:absolute after:bottom-0 after:start-3 after:end-3 after:h-0.5 after:bg-brand-primary'
                          : 'text-text-body hover:text-brand-primary hover:bg-brand-highlight/10'
                        }`}
                      aria-current={navActive(pathname, item.page) ? 'page' : undefined}
                    >
                      {label(item)}
                    </Link>
                  )}
                </div>
              ))}
            </nav>

            {/* Auth links — desktop */}
            <div className="hidden items-center gap-2 xl:flex">
              {/* public beta: no account can be created or opened, so the menu does not offer it (the screens are closed server-side) */}
              {!frontendEnv.flags.publicBeta && <AuthHeaderActions />}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <LanguageSelector compact className="hidden sm:flex" />
              <DarkModeToggle />
              <Suspense fallback={null}>
                <AccessibilityPanel />
              </Suspense>

              {/* Menu mobile */}
              <Button
                variant="ghost"
                size="icon"
                // R26: the crowded phone header squeezed this button and its icon to 4 px wide; it can no longer shrink (44 px touch target)
                className="xl:hidden h-11 w-11 min-w-11 shrink-0 border border-slate-200"
                ref={menuButtonRef}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? t('layout:menu.close', 'Fermer le menu') : t('layout:menu.open', 'Ouvrir le menu')}
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
              >
                {mobileMenuOpen ? <X className="h-6 w-6 shrink-0" aria-hidden="true" /> : <Menu className="h-6 w-6 shrink-0" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Menu mobile */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="xl:hidden border-t border-border bg-surface">
            <nav className="max-w-7xl mx-auto px-4 py-4 space-y-1" aria-label={t('layout:nav.mobile', 'Navigation mobile')}>
              <LanguageSelector id="language-select-mobile" className="sm:hidden pb-3 mb-2 border-b border-slate-200" />
              {filteredNavItems.map((item) => (
                <div key={item.page}>
                  {item.submenu ? (
                    <>
                      <button
                        onClick={() => setOpenSubmenu(openSubmenu === item.page ? null : item.page)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-text-body hover:bg-brand-highlight/10 hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-inset"
                        aria-expanded={openSubmenu === item.page}
                        aria-controls={`mobile-submenu-${item.page}`}
                      >
                        <span className="flex items-center gap-3">
                          <item.icon className="h-5 w-5" />
                          {label(item)}
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${openSubmenu === item.page ? 'rotate-180' : ''}`} />
                      </button>
                      <div
                        id={`mobile-submenu-${item.page}`}
                        className={`ps-12 space-y-1 ${openSubmenu === item.page ? '' : 'hidden'}`}
                      >
                        {item.submenu.map((sub, idx) => (
                          <Link
                            key={idx}
                            to={createPageUrl(sub.page) + (sub.params ? `?${sub.params}` : '')}
                            className="block px-4 py-2 text-sm text-text-muted hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-inset"
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            {label(sub)}
                          </Link>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Link
                      to={createPageUrl(item.page)}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-body hover:bg-brand-highlight/10 hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-inset"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <item.icon className="h-5 w-5" />
                      {label(item)}
                    </Link>
                  )}
                </div>
              ))}

              {/* Auth links — mobile */}
              <hr className="my-2 border-border" />
              {!frontendEnv.flags.publicBeta && <AuthMobileActions onNavigate={() => setMobileMenuOpen(false)} />}
            </nav>
          </div>
        )}
      </header>

      {/* Main content */}
      <main id="main-content" className="flex-grow" tabIndex={-1}>
        <ReadAloud />
        {children}
      </main>

      {/* Footer */}
      <footer
        role="contentinfo"
        className="relative overflow-hidden text-white"
        style={{ background: 'linear-gradient(180deg, #020617 0%, #002D5A 50%, #1e3a8a 100%)' }}
      >
        {/* Subtle decorative orb */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className="absolute -bottom-32 end-1/4 w-[400px] h-[400px] rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }}
          />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {/* Logo et description */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                  <img src="/favicon.svg" alt={t('layout:footer.logo', 'Logo')} className="h-6 w-6" width="24" height="24" />
                </div>
                <span className="text-xl font-bold text-white">AccesDirectAide</span>
              </div>
              <p className="text-white/70 text-sm mb-3">
                {t('layout:footer.tagline', "Un service gratuit pour vous aider à trouver les aides, les démarches et les structures d'accompagnement près de chez vous.")}
              </p>
              <p className="text-white/50 text-xs">
                <Trans i18n={i18n} i18nKey="layout:footer.verified" defaults="Chaque fiche cite sa source. Elle n&apos;est présentée comme vérifiée qu&apos;après un contrôle automatique daté auprès de sa source officielle." />
              </p>
            </div>

            {/* Ressources */}
            <div>
              <h3 className="font-semibold mb-4 text-white">{t('layout:footer.resources', 'Ressources')}</h3>
              <ul className="space-y-2">
                {openLinks(FOOTER_RESSOURCES, frontendEnv.flags.publicBeta, footerPath).map((link, idx) => (
                  <li key={link.label + idx}>
                    <Link
                      to={link.href || createPageUrl(link.page)}
                      className="text-white/70 hover:text-white text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary rounded"
                    >
                      {label(link)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* À propos */}
            <div>
              <h3 className="font-semibold mb-4 text-white">{t('layout:footer.about', 'À propos')}</h3>
              <ul className="space-y-2">
                {openLinks(FOOTER_ABOUT, frontendEnv.flags.publicBeta, footerPath).map((link, idx) => (
                  <li key={link.label + idx}>
                    <Link
                      to={link.href || createPageUrl(link.page)}
                      className="text-white/70 hover:text-white text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary rounded"
                    >
                      {label(link)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Légal */}
            <div>
              <h3 className="font-semibold mb-4 text-white">{t('layout:footer.legal', 'Informations légales')}</h3>
              <ul className="space-y-2">
                {openLinks(FOOTER_LEGAL, frontendEnv.flags.publicBeta, footerPath).map((link, idx) => (
                  <li key={link.label + idx}>
                    <Link
                      to={link.href || createPageUrl(link.page)}
                      className="text-white/70 hover:text-white text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary rounded"
                    >
                      {label(link)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-white/15 mt-8 pt-8 text-center text-sm text-white/80">
            {/* R32: in French the statement stays the one of brand-config; the translations were made from that same statement */}
            <p data-testid="footer-project-statement">© {new Date().getFullYear()} {isSource ? brand.legal.projectStatement : t('layout:footer.project', 'AccesDirectAide — projet associatif à but non lucratif, en cours de constitution sous le régime du droit local d’Alsace-Moselle.')}</p>
            {/* PKG-11 / P28: the catalogue has national aides and Strasbourg / Eurométropole information, nothing specific to the Haut-Rhin */}
            <p className="mt-2 text-white/80">
              <Trans
                i18n={i18n}
                i18nKey="layout:footer.coverage"
                defaults="Territoire couvert : <0>Eurométropole de Strasbourg</0> pour les informations locales, et aides nationales."
                components={[<Link key="territoire" to="/territoire" className="underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" />]}
              />
            </p>
          </div>
        </div>
      </footer>

      {/* Chat Assistant — lazy-loaded (not needed for first paint) */}
      {/* public beta: the assistant is closed server-side, so its button is not shown */}
      {!frontendEnv.flags.publicBeta && (
        <Suspense fallback={null}>
          <ChatAssistant />
        </Suspense>
      )}

      {/* Privacy Screen — Bouton "Cacher mon écran" */}
      <Suspense fallback={null}>
        <HideScreenButton />
      </Suspense>

    </div>
  );
}

Layout.propTypes = {
  children: PropTypes.node,
  currentPageName: PropTypes.string,
};
