export const AUDIENCE = {
  CITIZEN: 'CITIZEN',
  PUBLIC: 'PUBLIC',
  PROFESSIONAL: 'PROFESSIONAL',
  ADMIN: 'ADMIN',
};

export const PROVIDER = {
  GEMINI: 'GEMINI',
  OLLAMA: 'OLLAMA',
};

export const LOCALITY = {
  LOCAL_LOOPBACK: 'LOCAL_LOOPBACK',
  TRUSTED_INTERNAL_CONTROLLED: 'TRUSTED_INTERNAL_CONTROLLED',
  EXTERNAL: 'EXTERNAL',
  UNKNOWN: 'UNKNOWN',
};

/**
 * G3: the only way to reach LOCALITY.TRUSTED_INTERNAL_CONTROLLED. AI_TRUSTED_INTERNAL_HOSTS = comma-separated exact `host` or `host:port` entries (empty by
 * default = no trusted host, fail-closed). An entry with a wildcard, a scheme, a path, userinfo or a leading/trailing dot is ignored, never widened.
 * The policy still requires ALLOW_TRUSTED_INTERNAL_OLLAMA=true on top of this classification.
 * @returns {Set<string>}
 */
function trustedInternalHosts() {
  const out = new Set();
  for (const raw of String(process.env.AI_TRUSTED_INTERNAL_HOSTS || '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (!entry || !/^[a-z0-9.-]+(:[0-9]{1,5})?$/.test(entry) || entry.startsWith('.') || entry.includes('..') || /\.(:|$)/.test(entry)) continue;
    try {
      const u = new URL(`https://${entry}`);
      out.add(u.host);   // normalises an explicit :443 to the bare host, as URL does for the endpoint below
    } catch { /* not a host: ignored */ }
  }
  return out;
}

export class AIProviderPolicy {
  /**
   * Classify provider locality based on endpoint URL.
   */
  /** @param {string | null | undefined} endpoint */
  static classifyLocality(endpoint) {
    if (!endpoint) return LOCALITY.UNKNOWN;
    try {
      const url = new URL(endpoint);
      const host = url.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return LOCALITY.LOCAL_LOOPBACK;
      }
      if (url.protocol === 'https:' && !url.username && !url.password && trustedInternalHosts().has(url.host.toLowerCase())) {
        return LOCALITY.TRUSTED_INTERNAL_CONTROLLED;
      }
      return LOCALITY.EXTERNAL;
    } catch {
      return LOCALITY.UNKNOWN;
    }
  }

  /**
   * Evaluates if a given AI provider is permitted for the given context.
   * @param {{
   *   provider: string,
   *   audience: string,
   *   locality?: string
   * }} context 
   * @returns {{ allowed: boolean, reason?: string }}
   */
  static evaluate(context) {
    const { provider, audience, locality = LOCALITY.UNKNOWN } = context;

    if (!provider || !audience) {
      return { allowed: false, reason: 'MISSING_POLICY_CONTEXT' };
    }

    if (provider === PROVIDER.GEMINI) {
      if (audience === AUDIENCE.CITIZEN || audience === AUDIENCE.PUBLIC) {
        return { allowed: false, reason: 'AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE' };
      }
      if (audience === AUDIENCE.PROFESSIONAL || audience === AUDIENCE.ADMIN) {
        return { allowed: false, reason: 'BLOCKED_PENDING_PROVIDER_REVIEW' };
      }
      return { allowed: false, reason: 'UNAUTHORIZED_AUDIENCE_FOR_PROVIDER' };
    }

    if (provider === PROVIDER.OLLAMA) {
      if (locality === LOCALITY.LOCAL_LOOPBACK) {
        return { allowed: true };
      }
      if (locality === LOCALITY.TRUSTED_INTERNAL_CONTROLLED) {
        // Enforce explicit configuration, not just relying on the locality string
        if (process.env.ALLOW_TRUSTED_INTERNAL_OLLAMA === 'true') {
           return { allowed: true };
        }
        return { allowed: false, reason: 'TRUSTED_INTERNAL_CONTROLLED_REQUIRES_EXPLICIT_CONFIG' };
      }
      if (locality === LOCALITY.EXTERNAL) {
        return { allowed: false, reason: 'EXTERNAL_OLLAMA_DENIED_BY_DEFAULT' };
      }
      return { allowed: false, reason: 'UNKNOWN_LOCALITY_DENIED' };
    }

    // Default DENY for unknown providers
    return { allowed: false, reason: 'UNKNOWN_PROVIDER_DENIED' };
  }
}
