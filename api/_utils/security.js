import { randomUUID } from 'node:crypto';
import { env } from './env.js';

/** R27 / Q11: a random identifier of this function instance (process), so a test can see several instances answer and share one rate limit */
export const INSTANCE_ID = randomUUID().slice(0, 8);

/**
* @param {{ [x: string]: any; statusCode?: number; getHeader?: (name: string) => any; setHeader: any; set?: (name: string, value: any) => any; writeHead?: (statusCode: number, headers?: any) => any; end?: (...args: any[]) => any; status?: (code: number) => import("./http-types.js").ApiResponse; json?: (body: any) => any; send?: (body: any) => any; redirect?: (codeOrUrl: any, url?: any) => any; }} res
*/
export function applySecurityHeaders(res, /** @type {string | number | boolean | null | undefined} */ origin) {
  res.setHeader('x-ada-instance', INSTANCE_ID);   // R27 / Q11: which function instance answered (a random id per process, nothing else)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self' https://*.vercel-analytics.com https://*.ingest.de.sentry.io",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
  ].join('; '));
}

export function isSecureEnvironment() {
  return env.runtime.vercelEnv === 'production' || env.runtime.vercelEnv === 'preview' || env.runtime.nodeEnv === 'production';
}

export function getSecureCookieOptions() {
  const secure = isSecureEnvironment();
  const parts = [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
