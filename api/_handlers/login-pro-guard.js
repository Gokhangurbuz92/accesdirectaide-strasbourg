import { env } from '../_utils/env.js';

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default function handler(req, res) {
    // STRICT HTTP GUARD
    // If variable is not explicitly "true", we return 404 immediately.
    // This prevents the SPA loop and returns a semantic error to the browser/crawler.
    if (!env.flags.devLoginEnabled) {
        return res.status(404).send('Not Found');
    }

    // If enabled, we need to pass control back to the SPA.
    // Since we are inside a function rewrite, we can't easily "fall through" to index.html 
    // without a second rewrite or a redirect.
    // Best approach for Local/Dev (where this is enabled): Redirect to /login/pro?guarded=true 
    // OR actually serve the index.html content (complex).

    // STRATEGY: 
    // On Vercel, if we rewrite /login/pro -> api/guard, we consume the request.
    // If we want to show the page, we should arguably NOT rewrite it if enabled?
    // But Vercel rewrites are static.

    // Alternative: Redirect to a query param version that is NOT rewritten, 
    // BUT that would expose the URL again? No, we can just allow the user to see the page.

    // Simple Solution for DEV (enabled):
    // Redirect to /?login=pro or just return a redirect that the SPA handles?
    // Actually, if we are here, it means the user WANTS /login/pro.
    // We can't rewrite FROM a function TO a static file easily in Vercel Functions 
    // (unless we fetch and split it, which is slow).

    // REVISED STRATEGY for "Enabled" case:
    // We cannot easily serve the React App from this Node function.
    // However, since this is mostly for LOCAL debug or strict staging exception:
    // We will return a 307 Temporary Redirect to `/home` or a special allowed route?
    // Actually, the user requirement is: "si VITE_DEV_LOGIN_ENABLED !== 'true' => 404".
    // implied: if true => 200 (show page).

    // If implementing "Show Page" is hard via function, we admit the limitation:
    // "Enabled" might redirect to `/#/login/pro` (Hash router style? No, we use Browser Router).

    // WORKAROUND:
    // If enabled, print a small HTML that redirects via JS or refresh?
    // Or simply: Config vercel.json to only rewrite if a header is missing? (Not supported).

    // DECISION:
    // If enabled, we assume it's a dev/admin who knows what they are doing.
    // We redirect to `/login/pro/allowed` (a new path) OR slightly alter the logic.

    // Wait, if I change the rewrite in vercel.json to:
    // "source": "/login/pro", "destination": "/api/login-pro-guard"
    // Request comes here.
    // If I want to serve the app, I can't.

    // CORRECT APPROACH:
    // Use Vercel Middleware (Edge Middleware) would be better for this (rewrite vs next), 
    // but User asked for "function Vercel".

    // Let's rely on the fact that if enabled, we might be in Local dev where Vercel rewrites 
    // don't apply the same way (Vite dev server handles it). 
    // BUT `vercel.json` affects `vercel dev` and deployed.

    // Implementation:
    // If enabled: 307 Redirect to `/login/pro/entry` 
    // and we add a rewrite in vercel.json for `/login/pro/entry -> index.html`.
    // This allows the chain to work.

    // BUT simpler: User said "return 200 (ou redirect vers /home)".
    // Let's redirect to `/home` to be safe/simple if enabled, 
    // OR return a basic HTML "Login Enabled" link.

    return res.redirect(307, '/home?login_enabled=true');
}
