import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { accountsScope, isPublicBetaRestricted, openJobs, openSurfaces, proSelfRegistrationOpen } from '../_utils/public-beta.js';
import { publicOpenApiSpec } from '../lib/openapi-public.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @type {string | null}
 */
let cachedSpec = null;
/** G3: the public subset served during the beta, per beta configuration (the environment is fixed for a deployment) @type {Map<string, string>} */
const cachedPublic = new Map();

/**
 * Serves the OpenAPI specification as JSON.
 *
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!cachedSpec) {
      const specPath = resolve(__dirname, '../../docs/openapi.json');
      cachedSpec = readFileSync(specPath, 'utf-8');
    }

    // G3: during the restricted beta only the public subset is described (never the admin / cron / monitor / pro / institution routes)
    let body = cachedSpec;
    if (isPublicBetaRestricted()) {
      const key = [[...openSurfaces()].sort().join(','), accountsScope(), proSelfRegistrationOpen(), [...openJobs()].sort().join(',')].join('|');
      if (!cachedPublic.has(key)) cachedPublic.set(key, JSON.stringify(publicOpenApiSpec(JSON.parse(cachedSpec))));
      body = /** @type {string} */ (cachedPublic.get(key));
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }

    res.status(200).end(body);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to load OpenAPI specification',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
