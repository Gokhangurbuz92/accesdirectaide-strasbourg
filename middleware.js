import { next } from '@vercel/edge';

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

export default function middleware(request) {
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
  ],
};
