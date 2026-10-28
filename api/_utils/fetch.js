// @ts-nocheck
import logger from './logger.js';
import dns from 'dns';
import { promisify } from 'util';

const resolveAsync = promisify(dns.lookup);

// SSRF / Trusted Destination Policy
/**
 * @param {string | URL} urlString
 */
export async function isSafeUrl(urlString) {
  try {
    const url = new URL(urlString);
    
    // Only allow HTTP/HTTPS
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    
    const hostname = url.hostname;
    
    // Block non-standard ports
    if (url.port && url.port !== '80' && url.port !== '443') return false;

    // Resolve IP to prevent DNS rebinding
    const lookup = await resolveAsync(hostname);
    const ip = lookup.address;

    // IPv6 loopback / any
    if (ip === '::1' || ip === '::' || ip.startsWith('fe80:')) return false;

    // Localhost / zero
    if (ip === '127.0.0.1' || ip === '0.0.0.0') return false;
    
    // 10.x.x.x
    if (ip.startsWith('10.')) return false;
    
    // 172.16.x.x - 172.31.x.x
    if (ip.startsWith('172.')) {
      const secondOctet = parseInt(ip.split('.')[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) return false;
    }
    
    // 192.168.x.x
    if (ip.startsWith('192.168.')) return false;
    
    // 169.254.x.x (AWS metadata)
    if (ip.startsWith('169.254.')) return false;

    return true;
  } catch (e) {
    return false;
  }
}

export class FetchError extends Error {
  /**
   * @param {string | undefined} message
   * @param {number} status
   */
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'FetchError';
  }
}

/**
 * Enhanced fetch with SSRF protection, timeout, basic retry, and safe redirect following.
 */
export async function safeFetch(initialUrl, options = {}) {
  const {
    timeoutMs = 10000,
    maxRetries = 2,
    maxRedirects = 5,
    ...fetchOptions
  } = options;

  let currentUrl = initialUrl;
  let redirects = 0;
  
  while (redirects <= maxRedirects) {
    if (!(await isSafeUrl(currentUrl))) {
      throw new FetchError(`Blocked by SSRF policy: Unsafe destination ${currentUrl}`, 403);
    }

    let attempt = 0;
    let response;
    
    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        response = await fetch(currentUrl, {
          ...fetchOptions,
          redirect: 'manual', // Intercept redirects for SSRF check
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status >= 500 && attempt <= maxRetries) {
          logger.warn(`[safeFetch] Server error ${response.status} on ${currentUrl}, retrying...`);
          await new Promise(r => setTimeout(r, attempt * 1000));
          continue;
        }
        
        break; // Success or non-500 response
      } catch (error) {
        clearTimeout(timeoutId);
        
        // @ts-ignore
        const isTimeout = /** @type {Error} */ (error).name === 'AbortError' || error.message.includes('timeout');
        
        if (attempt <= maxRetries) {
          // @ts-ignore
          logger.warn(`[safeFetch] Error on ${currentUrl}: ${error.message}. Retrying...`);
          await new Promise(r => setTimeout(r, attempt * 1000));
          continue;
        }
        
        // @ts-ignore
        throw new FetchError(isTimeout ? `Request timeout after ${timeoutMs}ms` : error.message, 504);
      }
    }

    // Handle Redirects safely
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      redirects++;
      if (redirects > maxRedirects) {
        throw new FetchError('Too many redirects', 508);
      }
      currentUrl = new URL(response.headers.get('location'), currentUrl).toString();
      // Continue outer loop to validate new currentUrl
      continue;
    }

    return response;
  }
}
