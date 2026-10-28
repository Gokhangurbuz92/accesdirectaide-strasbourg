import { isAllowedSource, ALLOWED_DOMAINS, createSourceEnvelope } from '../services/official-sources.js';

export class ResourceCurator {
  constructor() {
    // No Gemini client needed
  }

  async curate(/** @type {string | number | boolean | null | undefined} */ category, /** @type {string | number | boolean | null | undefined} */ type) {
    // Deterministic curation — return allowed domains for category
    return {
      sources: ALLOWED_DOMAINS.map(domain => ({
        domain,
        verified: true,
        url: `https://${domain}`
      })),
      category,
      type
    };
  }

  /**
   * @param {string} url
   */
  isAllowedSource(url) {
    return isAllowedSource(url);
  }
}

export { ALLOWED_DOMAINS };
