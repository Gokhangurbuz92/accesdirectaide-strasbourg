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
