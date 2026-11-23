export const AUDIENCE = {
  CITIZEN: 'CITIZEN',
  PUBLIC: 'PUBLIC',
  PROFESSIONAL: 'PROFESSIONAL',
  ADMIN: 'ADMIN',
};

export const PROVIDER = {
  GEMINI: 'GEMINI',
  OLLAMA: 'OLLAMA',
  // G14-AI (owner decision 23/11/2026, « Cloudflare Workers AI ücretsiz planı … 0 € maliyet »): Cloudflare Workers AI REST, citizen assistant only
  WORKERS_AI: 'WORKERS_AI',
};

/**
 * G14-AI — the ONLY switch set that lets a citizen / public request reach Cloudflare Workers AI (fail-closed, exact values):
 *   AI_PROVIDER=workers_ai, AI_WORKERS_PRODUCTION_APPROVED=true (owner approval recorded: processor Cloudflare, Inc., AIPD line, notice),
 *   CF_WORKERS_AI_ACCOUNT_ID (32 hex) and CF_WORKERS_AI_TOKEN present. Anything else = refused. Never for PROFESSIONAL / ADMIN (the pro dossier synthesis
 *   stays tied to the HDS dossier and closed). Gemini rules are unchanged.
 * @param {Record<string, string | undefined>} [envVars] @returns {{ enabled: boolean, reason: string | null }}
 */
export function workersAiState(envVars = process.env) {
  const get = (/** @type {string} */ k) => String(envVars[k] ?? '').trim();
  if (get('AI_PROVIDER').toLowerCase() !== 'workers_ai') return { enabled: false, reason: 'WORKERS_AI_NOT_SELECTED' };
  if (get('AI_WORKERS_PRODUCTION_APPROVED') !== 'true') return { enabled: false, reason: 'WORKERS_AI_NOT_APPROVED' };
  if (!/^[0-9a-f]{32}$/i.test(get('CF_WORKERS_AI_ACCOUNT_ID'))) return { enabled: false, reason: 'WORKERS_AI_ACCOUNT_ID_MISSING' };
  if (get('CF_WORKERS_AI_TOKEN').length < 20) return { enabled: false, reason: 'WORKERS_AI_TOKEN_MISSING' };
  return { enabled: true, reason: null };
}

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
   *   locality?: string,
   *   env?: Record<string, string | undefined>
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

    if (provider === PROVIDER.WORKERS_AI) {
      if (audience !== AUDIENCE.CITIZEN && audience !== AUDIENCE.PUBLIC) return { allowed: false, reason: 'WORKERS_AI_CITIZEN_ASSISTANT_ONLY' };
      const state = workersAiState(context.env || process.env);
      return state.enabled ? { allowed: true } : { allowed: false, reason: state.reason || 'WORKERS_AI_NOT_ENABLED' };
    }

    // Default DENY for unknown providers
    return { allowed: false, reason: 'UNKNOWN_PROVIDER_DENIED' };
  }
}
