/**
 * Glossaire endpoint — GET /api/glossaire
 *
 * Query params:
 *   - q: text search (terme + definition)
 *   - categorie: filter by category
 *
 * Returns: { ok, count, items }
 */
import { GLOSSAIRE } from '../lib/glossaire.js';

export default function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q, categorie } = req.query || {};
  let results = [...GLOSSAIRE];

  if (q) {
    const search = String(q).toLowerCase();
    results = results.filter(
      (g) =>
        g.terme.toLowerCase().includes(search) ||
        g.definition.toLowerCase().includes(search),
    );
  }

  if (categorie) {
    results = results.filter((g) => g.categorie === String(categorie));
  }

  results.sort((a, b) => a.terme.localeCompare(b.terme, 'fr'));

  return res.status(200).json({
    ok: true,
    count: results.length,
    items: results,
  });
}
