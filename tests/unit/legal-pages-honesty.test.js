/**
 * Legal pages honesty — source-level guard against the false claims removed on 2026-10-21
 * (STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/05_CORRECTIONS_PAGES_APPLICATION.md, P0 rows).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL, formatLegalDate } from '../../src/config/legal-documents.js';

const read = (f) => readFileSync(f, 'utf-8');

const LEGAL_PAGES = ['src/pages/MentionsLegales.jsx', 'src/pages/Confidentialite.jsx', 'src/pages/Cookies.jsx', 'src/pages/CGU.jsx'];
const PUBLIC_SURFACES = [
  ...LEGAL_PAGES,
  'src/components/CookieBanner.jsx', 'src/pages/Contact.jsx', 'src/pages/Security.jsx',
  'src/pages/pro/SharedDossier.jsx', 'src/pages/pro/RegionalDashboard.jsx',
];

const FALSE_CLAIMS = [
  /Zero-Knowledge/i, /zéro connaissance/i, /instantan/i, /Nous lisons 0 donnée/i, /exploitons 0 donnée/i, /bug bounty/i,
  /Aucun cookie de traçage/i, /aucun traceur/i, /Aucun cookie .{0,30}d'analyse/i, /plateforme publique/i, /Pôle Emploi/i,
  /Privacy-First/i, /certifiée/i, /zéro bandeau/i, /pas de bandeau/i, /dpo@/i, /Délégué à la Protection des Données \(DPO\)\.?<?/,
  /agit en tant que/i, /contrôle absolu/i, /garantie par charte/i, /souveraineté/i, /Isolation 100/i,
  /(?<!pas un )(?<!pas de )chiffr\w*\s+de\s+bout\s+en\s+bout/i, /garantit l'anonymat/i, /blobs\s+opaques/i, /technologie sécurisée Microsoft Outlook/i,
  /\bada_session\b/, /\bcsrf_token\b/, /ada\.falc/, /gmail/i, /OpenFisca/, /générés dynamiquement/i,
];

describe('legal pages make no false privacy / security claim', () => {
  it.each(PUBLIC_SURFACES)('%s', (f) => {
    const src = read(f);
    for (const rx of FALSE_CLAIMS) expect(src, `${f} ${rx}`).not.toMatch(rx);
  });

  it('docs/rgpd.md no longer claims consent-gated analytics, a ConsentLog banner or a personal DPO address', () => {
    const doc = read('docs/rgpd.md');
    expect(doc).not.toMatch(/Cookies analytics \| Consentement/);
    expect(doc).not.toMatch(/Consentement enregistré dans `ConsentLog`/);
    expect(doc).not.toMatch(/gmail/i);
  });
});

describe('legal pages use a fixed, versioned date', () => {
  it.each(LEGAL_PAGES)('%s imports LEGAL_DOCS_VERSION and never shows new Date() as the update date', (f) => {
    const src = read(f);
    expect(src).toMatch(/import\s*\{[^}]*\bLEGAL_DOCS_VERSION\b[^}]*\}\s*from\s*'@\/config\/legal-documents'/);
    expect(src).toMatch(/LEGAL_DOCS_LABEL/);
    expect(src).not.toMatch(/new Date\(\)/);
    expect(src).not.toMatch(/suppressHydrationWarning/);
  });

  it('the label is the fixed draft date', () => {
    expect(LEGAL_DOCS_VERSION.date).toBe('2026-10-25');
    expect(formatLegalDate('2026-10-21')).toBe('21 octobre 2026');
    expect(LEGAL_DOCS_LABEL).toBe('Version projet du 25 octobre 2026 — relecture juridique en cours');
  });
});

describe('the pages describe the real trackers honestly', () => {
  it('h1 texts expected by e2e/legal-pages.spec.js are kept', () => {
    // R26: the level-1 heading is drawn by the shared page header (src/components/layout/PageHeader.jsx renders `title` in its <h1>)
    expect(read('src/components/layout/PageHeader.jsx')).toMatch(/<h1 [^>]*>\{title\}<\/h1>/);
    expect(read('src/pages/MentionsLegales.jsx')).toMatch(/<PageHeader [^>]*title=\{<>Mentions légales<\/>\}/);
    expect(read('src/pages/Confidentialite.jsx')).toMatch(/<PageHeader [^>]*title=\{<>Politique de confidentialité<\/>\}/);
    expect(read('src/pages/Cookies.jsx')).toMatch(/<PageHeader [^>]*title=\{<>Cookies<\/>\}/);
  });

  it('cookies and privacy pages name Vercel Analytics, Speed Insights and Sentry, with Replay disabled by default', () => {
    for (const f of ['src/pages/Cookies.jsx', 'src/pages/Confidentialite.jsx']) {
      const src = read(f);
      expect(src, f).toMatch(/Vercel Web Analytics/);
      expect(src, f).toMatch(/Speed Insights/);
      expect(src, f).toMatch(/Sentry/);
      expect(src, f).toMatch(/Session Replay\)? est désactivé par défaut/);
    }
    const cookies = read('src/pages/Cookies.jsx');
    for (const name of ['ada_user_session', '__csrf', 'ada_cookie_consent', 'falc-mode']) expect(cookies).toContain(name);
  });

  it('the cookie banner is an honest information banner: nothing to accept (« Fermer », LEGAL_FR § 4.2), a link to /cookies, the answer kept 6 months', () => {
    const src = read('src/components/CookieBanner.jsx');
    expect(src).toMatch(/>\s*Fermer\s*</);
    expect(src).not.toMatch(/>\s*Accepter\s*</);   // launch-readiness item 64: « Accepter » looked like a consent that is not one
    expect(read('src/lib/cookieBanner.js')).toMatch(/183 \* 24 \* 60 \* 60 \* 1000/);
    expect(src).toMatch(/href="\/cookies"/);
    expect(src).toMatch(/mesurons aussi l&apos;audience/);
  });

  it('placeholders are shown instead of an invented contact / DPO', () => {
    expect(read('src/config/legal-documents.js')).toContain('[À COMPLÉTER : adresse de contact protection des données]');
    for (const f of ['src/pages/Confidentialite.jsx', 'src/pages/Contact.jsx', 'src/pages/Security.jsx']) expect(read(f), f).toMatch(/LEGAL_PLACEHOLDERS\.dataProtectionContact/);
  });
});

describe('privacy code fixes', () => {
  it('the free-text search query is never sent to analytics', () => {
    const src = read('src/pages/Aides.jsx');
    expect(src).not.toMatch(/track\(\s*'search_aides'\s*,\s*\{\s*query/);
    expect(src).not.toMatch(/track\([^)]*cleanQuery\s*[,}]/);
  });

  it('Sentry Session Replay is off unless VITE_SENTRY_REPLAY === "true"', () => {
    const src = read('src/observability/initSentry.js');
    expect(src).toMatch(/VITE_SENTRY_REPLAY === 'true'/);
    expect(src).toMatch(/replaysSessionSampleRate: replayEnabled \? [\d.]+ : 0/);
    expect(src).toMatch(/replaysOnErrorSampleRate: replayEnabled \? [\d.]+ : 0/);
    expect(src).toMatch(/if \(replayEnabled\) integrations\.push\(Sentry\.replayIntegration/);
    expect(src).not.toMatch(/Zero-Knowledge/i);
  });
});
