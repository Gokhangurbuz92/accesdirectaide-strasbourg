import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @type {string | null}
 */
let cachedSpec = null;

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

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }

    res.status(200).end(cachedSpec);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to load OpenAPI specification',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
