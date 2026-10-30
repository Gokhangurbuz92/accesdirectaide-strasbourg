import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { bannerAnswered } from '@/lib/cookieBanner';
import { frontendEnv } from '@/config/env';

const STORAGE_KEY = 'ada_cookie_consent';

/**
 * CookieBanner — RGPD Cookie Consent
 *
 * Information banner (LEGAL_FR 03_COOKIES_TRACEURS.md § 4.2, option A): the site uses necessary cookies/storage
 * (session, CSRF, display settings), Vercel Web Analytics + Speed Insights (audience/performance, for the publisher only)
 * and Sentry error reporting (Session Replay disabled by default, see src/observability/initSentry.js).
 * Nothing here requires consent, so the button only records that the information was seen (localStorage
 * `ada_cookie_consent`); it does not gate any loading. If a consent-requiring tracker is ever enabled (e.g. Replay),
 * this banner must become a real choice (accept / refuse / customise, same level) — option B of that document.
 * PKG-4 (WCAG 2.2 SC 2.4.11 focus not obscured): while the banner is shown, the page reserves its height at the bottom (body padding + scroll-padding), so the last
 * button of a long page and any focused control can be scrolled clear of it; at high zoom / small screens the banner scrolls inside itself (max 50% of the viewport).
 * The banner is a non-modal region (it was announced as a dialog without being one). Nothing is accepted on the person's behalf.
 * Launch-readiness item 64 (LEGAL_FR § 4.2, option A — the model in force until the owner's decision 21): there is NOTHING to accept, so the button is
 * « Fermer » (it used to say « Accepter », which looked like a consent that is not one) and it only records that the information was seen, for 6 months.
 * PKG-11 (same SC, found by DTA-B54): body padding does not move FIXED controls — the assistant button sat entirely under the banner; the height is also
 * published as --cookie-banner-offset so fixed bottom controls stay above it.
 */
export default function CookieBanner() {
    const [visible, setVisible] = useState(false);
    const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

    // set before the first paint (layout effect): a fixed bottom control is never drawn under the banner, not even for a frame (WCAG 2.2 SC 2.4.11)
    useLayoutEffect(() => {
        if (!visible || !ref.current || typeof document === 'undefined') return undefined;
        const root = document.documentElement; const body = document.body;
        const previous = { padding: body.style.paddingBottom, scroll: root.style.scrollPaddingBottom };
        const apply = () => { const h = Math.ceil(ref.current?.getBoundingClientRect().height || 0); body.style.paddingBottom = `${h}px`; root.style.scrollPaddingBottom = `${h + 8}px`; root.style.setProperty('--cookie-banner-offset', `${h}px`); };
        apply();
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
        ro?.observe(ref.current); window.addEventListener('resize', apply);
        return () => { ro?.disconnect(); window.removeEventListener('resize', apply); body.style.paddingBottom = previous.padding; root.style.scrollPaddingBottom = previous.scroll; root.style.removeProperty('--cookie-banner-offset'); };
    }, [visible]);

    useEffect(() => {
        try {
            if (!bannerAnswered(localStorage.getItem(STORAGE_KEY))) setVisible(true);
        } catch {
            // localStorage not available (SSR/private browsing)
        }
    }, []);

    const close = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ seen: true, date: new Date().toISOString() }));   // information seen — not a consent
        } catch { /* ignore */ }
        setVisible(false);
    };

    if (!visible) return null;

    return (
        <div
            id="cookie-banner"
            ref={ref}
            role="region"
            aria-label="Information sur les cookies"
            style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 9999,
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(12px)',
                color: '#e2e8f0',
                padding: '16px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                flexWrap: 'wrap',
                fontSize: '14px',
                lineHeight: '1.5',
                borderTop: '1px solid rgba(148, 163, 184, 0.2)',
                boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.15)',
                maxHeight: '50vh',
                overflowY: 'auto',
            }}
        >
            <p style={{ margin: 0, maxWidth: '600px', textAlign: 'center' }}>
                {frontendEnv.flags.publicBeta ? (
                    <>
                        AccesDirectAide utilise uniquement des cookies et des stockages nécessaires : sécuriser les formulaires
                        et garder vos réglages d&apos;affichage. Pendant la bêta publique, nous ne mesurons pas l&apos;audience.{' '}
                    </>
                ) : (
                    <>
                        AccesDirectAide utilise uniquement des cookies et des stockages nécessaires : rester connecté,
                        sécuriser les formulaires, garder vos réglages d&apos;affichage. Nous mesurons aussi l&apos;audience,
                        pour notre seul usage, et enregistrons les erreurs techniques. Vous pouvez vous y opposer.{' '}
                    </>
                )}
                <a
                    href="/cookies"
                    style={{ color: '#93c5fd', textDecoration: 'underline' }}
                >
                    En savoir plus et s&apos;opposer
                </a>
            </p>
            <button
                onClick={close}
                id="cookie-close-btn"
                style={{
                    background: '#1d4ed8',
                    color: 'white',
                    border: 'none',
                    padding: '8px 24px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px',
                    transition: 'background 0.2s',
                    whiteSpace: 'nowrap',
                }}
                onMouseOver={(e) => { /** @type {HTMLElement} */ (e.target).style.background = '#1e40af'; }}
                onFocus={(e) => { /** @type {HTMLElement} */ (e.target).style.background = '#1e40af'; }}
                onMouseOut={(e) => { /** @type {HTMLElement} */ (e.target).style.background = '#1d4ed8'; }}
                onBlur={(e) => { /** @type {HTMLElement} */ (e.target).style.background = '#1d4ed8'; }}
            >
                Fermer
            </button>
        </div>
    );
}
