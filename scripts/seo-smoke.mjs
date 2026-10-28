#!/usr/bin/env node

import { fetch } from 'undici';

/**
 * @param {string} raw
 * @returns {string}
 */
function trimTrailingSlash(raw) {
  return String(raw || '').replace(/\/+$/, '');
}

/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function getEnvOrDefault(name, fallback) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim()) return trimTrailingSlash(value.trim());
  return trimTrailingSlash(fallback);
}

/**
 * @param {string} message
 */
function pass(message) {
  console.log(`✅ ${message}`);
}

/**
 * @param {string} message
 */
function warn(message) {
  console.warn(`⚠️ ${message}`);
}

/**
 * @param {string[]} failures
 * @param {string} message
 */
function fail(failures, message) {
  failures.push(message);
  console.error(`❌ ${message}`);
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} url
 * @returns {string}
 */
function createAbsoluteRootPrefix(url) {
  const normalized = trimTrailingSlash(url);
  return `${normalized}/`;
}

/**
 * @param {string} prodUrl
 * @param {string[]} failures
 */
async function runBrowserChecks(prodUrl, failures) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    fail(failures, 'Playwright indisponible pour les checks runtime SEO (installer les navigateurs Playwright).');
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const rootPrefix = createAbsoluteRootPrefix(prodUrl);

    // Home OG defaults
    await page.goto(`${prodUrl}/`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const homeMeta = await page.evaluate(() => {
      const bySelector = (selector, attribute) => {
        const node = document.querySelector(selector);
        return node ? node.getAttribute(attribute) : null;
      };

      return {
        ogImage: bySelector('meta[property="og:image"]', 'content'),
        ogImageAlt: bySelector('meta[property="og:image:alt"]', 'content'),
        twitterImage: bySelector('meta[name="twitter:image"]', 'content'),
        twitterCard: bySelector('meta[name="twitter:card"]', 'content'),
      };
    });

    if (!homeMeta.ogImage || !homeMeta.ogImage.startsWith(rootPrefix)) {
      fail(failures, `Home og:image invalide (attendu absolu sur ${rootPrefix})`);
    } else if (!homeMeta.twitterImage || homeMeta.twitterImage !== homeMeta.ogImage) {
      fail(failures, 'Home twitter:image absent ou incoherent avec og:image');
    } else if (!homeMeta.ogImageAlt) {
      fail(failures, 'Home og:image:alt manquant');
    } else if (String(homeMeta.twitterCard || '').toLowerCase() !== 'summary_large_image') {
      fail(failures, 'Home twitter:card doit etre summary_large_image');
    } else {
      pass('Home OG/Twitter defaults OK');
    }

    // Unknown route => noindex
    await page.goto(`${prodUrl}/route-qui-nexiste-pas-123`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const unknownMeta = await page.evaluate(() => ({
      title: document.title || '',
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') || '',
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
      heading: document.querySelector('h1')?.textContent || '',
    }));

    if (!/noindex/i.test(unknownMeta.robots)) {
      fail(failures, 'Route inconnue: meta robots noindex non detecte');
    } else if (!unknownMeta.canonical.startsWith(rootPrefix)) {
      fail(failures, 'Route inconnue: canonical manquant ou non absolu');
    } else if (!/introuvable/i.test(`${unknownMeta.title} ${unknownMeta.heading}`)) {
      fail(failures, "Route inconnue: titre/heading 'introuvable' non detecte");
    } else {
      pass('Route inconnue: noindex/canonical/titre OK');
    }

    // Missing aide slug => noindex
    await page.goto(`${prodUrl}/aides/slug-inexistant-123`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const aideMissingMeta = await page.evaluate(() => ({
      title: document.title || '',
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') || '',
      heading: document.querySelector('h1')?.textContent || '',
    }));

    if (!/noindex/i.test(aideMissingMeta.robots)) {
      fail(failures, 'Aide inexistante: meta robots noindex non detecte');
    } else if (!/introuvable/i.test(`${aideMissingMeta.title} ${aideMissingMeta.heading}`)) {
      fail(failures, "Aide inexistante: titre/heading 'introuvable' non detecte");
    } else {
      pass('Aide inexistante: noindex + titre OK');
    }
  } catch {
    fail(failures, 'Checks runtime SEO (Playwright) impossibles');
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  const prodUrl = getEnvOrDefault('PROD_URL', 'https://www.accesdirectaide.fr');
  const apexUrl = getEnvOrDefault('APEX_URL', 'https://accesdirectaide.fr');

  /** @type {string[]} */
  const failures = [];

  console.log(`[seo-smoke] PROD_URL=${prodUrl}`);
  console.log(`[seo-smoke] APEX_URL=${apexUrl}`);

  // 1) Canonical apex -> www redirect
  try {
    const response = await fetch(`${apexUrl}/`, { method: 'GET', redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const expectedPrefix = `${prodUrl}/`;
    const statusOk = [301, 302, 307, 308].includes(response.status);
    const locationOk = location.startsWith(expectedPrefix);

    if (!statusOk || !locationOk) {
      fail(
        failures,
        `Redirect apex->www invalide (status=${response.status}, location prefix attendu=${expectedPrefix})`,
      );
    } else {
      pass(`Redirect apex->www OK (HTTP=${response.status})`);
    }
  } catch {
    fail(failures, 'Redirect apex->www: requête impossible');
  }

  // 2) robots.txt policy
  try {
    const response = await fetch(`${prodUrl}/robots.txt`, { method: 'GET' });
    const body = await response.text();

    if (response.status !== 200) {
      fail(failures, `robots.txt invalide (HTTP=${response.status})`);
    } else {
      const required = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /api/',
        'Sitemap: https://www.accesdirectaide.fr/sitemap.xml',
      ];
      const missing = required.filter((entry) => !body.includes(entry));
      if (missing.length > 0) {
        fail(failures, `robots.txt incomplet (directives manquantes: ${missing.join(', ')})`);
      } else {
        pass('robots.txt policy OK');
      }
    }
  } catch {
    fail(failures, 'robots.txt: requête impossible');
  }

  // 3) sitemap.xml contract
  try {
    const response = await fetch(`${prodUrl}/sitemap.xml`, { method: 'GET' });
    const contentType = normalizeWhitespace(response.headers.get('content-type') || '');
    const body = await response.text();

    if (response.status !== 200 && response.status !== 503) {
      fail(failures, `sitemap.xml status inattendu (HTTP=${response.status})`);
    } else if (!contentType.toLowerCase().includes('xml')) {
      fail(failures, `sitemap.xml content-type inattendu (${contentType || 'absent'})`);
    } else if (response.status === 503) {
      warn('sitemap.xml retourne 503 (DB indisponible) — à corriger côté infra avant indexation.');
    } else {
      const locMatches = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] || '');
      if (locMatches.length === 0) {
        fail(failures, 'sitemap.xml ne contient aucune balise <loc>.');
      } else {
        const badLoc = locMatches.find((loc) => !loc.startsWith(`${prodUrl}/`));
        if (badLoc) {
          fail(failures, `sitemap.xml contient une URL hors origin canonique (${badLoc})`);
        } else {
          pass(`sitemap.xml OK (${locMatches.length} URLs, origin=${prodUrl})`);
        }
      }
    }
  } catch {
    fail(failures, 'sitemap.xml: requête impossible');
  }

  // 4) noindex headers on technical endpoints
  const noIndexChecks = [
    `${prodUrl}/api/health`,
    `${prodUrl}/api/monitor/cron/actualites`,
  ];
  for (const url of noIndexChecks) {
    try {
      const response = await fetch(url, { method: 'GET' });
      const header = normalizeWhitespace(response.headers.get('x-robots-tag') || '').toLowerCase();
      if (header !== 'noindex, nofollow') {
        fail(failures, `${url} header x-robots-tag invalide (${header || 'absent'})`);
      } else {
        pass(`${url} x-robots-tag OK`);
      }
    } catch {
      fail(failures, `${url}: requête impossible`);
    }
  }

  // 5) Admin meta robots (best effort)
  try {
    const response = await fetch(`${prodUrl}/admin`, { method: 'GET' });
    const body = await response.text();
    const hasNoIndexMeta =
      /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(body) ||
      /<meta[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/i.test(body);

    if (response.status >= 200 && response.status < 400 && hasNoIndexMeta) {
      pass('/admin meta robots noindex détecté');
    } else {
      warn('/admin meta robots noindex non détecté en fetch brut (best-effort SPA check).');
    }
  } catch {
    warn('/admin meta robots: check best-effort non exécutable.');
  }

  // 6) Runtime checks via browser (OG defaults + error noindex)
  await runBrowserChecks(prodUrl, failures);

  if (failures.length > 0) {
    console.error(`[seo-smoke] FAILED (${failures.length} vérification(s) critique(s))`);
    process.exit(1);
  }

  console.log('[seo-smoke] OK');
}

main().catch(() => {
  console.error('[seo-smoke] FAILED (unexpected error)');
  process.exit(1);
});
