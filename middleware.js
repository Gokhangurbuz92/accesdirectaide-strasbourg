import { next } from '@vercel/edge';
import { PUBLIC_BETA_MESSAGE } from './api/_utils/public-beta.js';

/**
 * Launch-readiness item 56 — MAINTENANCE_MODE=1 (Vercel environment variable): every PAGE answers 503 with this plain page (Retry-After, never cached), so
 * nobody fills a form that cannot be saved. The API, the health checks and the static files are not matched (config.matcher). The emergency numbers stay
 * reachable whatever happens to the site.
 */
export const MAINTENANCE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Maintenance — AccesDirectAide</title><style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#0f172a}h1{font-size:1.5rem}li{margin:.25rem 0}</style></head>
<body><main><h1>Le site est en maintenance</h1><p>AccesDirectAide est momentanément indisponible. Revenez dans quelques heures. Vos données ne sont pas perdues.</p>
<h2>En cas d’urgence</h2><ul><li><strong>15</strong> : SAMU (urgence médicale)</li><li><strong>17</strong> : police · <strong>18</strong> : pompiers · <strong>112</strong> : numéro d’urgence européen</li>
<li><strong>114</strong> : par SMS, pour les personnes sourdes ou malentendantes</li><li><strong>115</strong> : hébergement d’urgence</li><li><strong>119</strong> : enfance en danger</li>
<li><strong>3919</strong> : violences faites aux femmes</li></ul></main></body></html>`;

export function maintenanceResponse() {
  return new Response(MAINTENANCE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3600', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

/**
 * Public beta (owner directive 29/10/2026): every file under api/ is deployed as its own function, so the thin wrappers under api/cron and api/monitor (and
 * any api/lib module) would answer directly, outside api/index.js and its restricted-beta allowlist. The matcher sends those paths here first:
 * api/lib and api/routes are never HTTP endpoints (404); api/cron and api/monitor are refused while the beta is restricted (503), as api/index.js does.
 * @param {URL} url
 */
export function directFunctionResponse(url) {
  const p = url.pathname;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (/^\/api\/(lib\/|routes(\.js)?$)/.test(p)) return json(404, { error: 'Not Found' });
  const beta = ['1', 'true'].includes(String(process.env.ADA_PUBLIC_BETA_RESTRICTED || '').trim().toLowerCase());
  if (beta && /^\/api\/(cron|monitor)\//.test(p)) return json(503, { error: 'PUBLIC_BETA_RESTRICTED', message: PUBLIC_BETA_MESSAGE });
  return null;
}

export default function middleware(request) {
  const direct = new URL(request.url).pathname.startsWith('/api/') ? directFunctionResponse(new URL(request.url)) : null;
  if (direct) return direct;
  if (new URL(request.url).pathname.startsWith('/api/')) return next();
  if (['1', 'true'].includes(String(process.env.MAINTENANCE_MODE || ''))) return maintenanceResponse();
  const host = request.headers.get('host') || '';
  const domain = host.split(':')[0];
  const url = new URL(request.url);

  // Define Canonical Domains
  const isCanonical = domain === 'accesdirectaide.fr' || domain === 'www.accesdirectaide.fr';
  const isProductionEnv = process.env.VERCEL_ENV === 'production';

  // P0.6: Enforce Canonical in Production
  // If we are in the Production Environment, but accessing via a non-canonical domain (e.g. .vercel.app),
  // we must redirect to the canonical domain to avoid duplicate content penalties.
  if (isProductionEnv && !isCanonical) {
    url.hostname = 'www.accesdirectaide.fr';
    url.port = ''; // Clear port if any
    url.protocol = 'https'; // Force HTTPS
    return Response.redirect(url.toString(), 301);
  }

  // Prevent Indexing on Non-Production Domains (Previews, Staging, Localhost)
  // If we are NOT in the strict production environment, we discourage indexing.
  if (!isProductionEnv) {
    return next({
      headers: {
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  return next();
}

export const config = {
  matcher: [
    '/((?!api/|assets/|favicon.ico|robots.txt|sitemap.xml).*)',
    // the direct api/ functions (see directFunctionResponse); the rest of /api goes straight to api/index.js
    '/api/lib/:path*', '/api/routes', '/api/routes.js', '/api/cron/:path*', '/api/monitor/:path*',
  ],
};
