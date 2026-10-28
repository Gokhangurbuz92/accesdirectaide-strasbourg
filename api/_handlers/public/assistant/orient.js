// @ts-nocheck
import chatHandler from '../../assistant/chat.js';

/**
 * @param {string} body
 */
function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return typeof body === 'object' ? body : {};
}

function compatibilityLinks(/** @type {{ filter: string | number | boolean | null | undefined }} */ citations) {
  if (!Array.isArray(citations)) return [];
  return citations
    .filter((item) => item && typeof item.sourceUrl === 'string' && item.sourceUrl)
    .map((item) => ({
      title: item.title || item.sourceId || 'Source officielle',
      url: item.sourceUrl,
      type: item.entityType || 'source',
    }));
}

/**
* Legacy Boussole compatibility boundary.
* It delegates to the citizen local-only /api/assistant/chat handler in-process.
* No cloud provider, API key, raw-prompt persistence or alternate RAG path exists here.
* @param {{ method: string; requestId: any; body: string; }} req
* @param {{ status: (arg0: number) => { (): any; new (): any; json: { (arg0: { ok?: boolean; requestId?: any; error?: string; links?: never[] | { title: any; url: any; type: any; }[]; suggestions?: never[]; meta?: any; }): any; new (): any; }; }; }} res
*/
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, requestId: req.requestId, error: 'method_not_allowed' });
  }

  const body = parseBody(req.body);
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
    ? { ...body.context }
    : {};
  if (!context.territory && typeof body.territory === 'string' && body.territory.trim()) {
    context.territory = body.territory.trim();
  }
  if (!context.lang) context.lang = 'fr';

  const captured = { statusCode: 200, body: null };
  const proxyRes = {
    /**
     * @param {number} code
     */
    status(code) { captured.statusCode = code; return this; },
    /**
     * @param {null} payload
     */
    json(payload) { captured.body = payload; return this; },
    setHeader() { return this; },
    /**
     * @param {null} payload
     */
    end(payload) { captured.body = payload; return this; },
  };

  await chatHandler({
    ...req,
    body: { message: body.message, context },
  }, proxyRes);

  const localBody = captured.body && typeof captured.body === 'object' ? captured.body : {};
  if (captured.statusCode >= 400) {
    return res.status(captured.statusCode).json({
      ...localBody,
      links: [],
      suggestions: [],
    });
  }

  return res.status(captured.statusCode).json({
    ...localBody,
    links: compatibilityLinks(localBody.citations),
    suggestions: [],
    meta: {
      ...(localBody.meta || {}),
      mode: 'local_grounded_compat',
    },
  });
}
