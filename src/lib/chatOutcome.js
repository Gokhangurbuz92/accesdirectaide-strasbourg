// R46 / P17 — pure helpers of the assistant widget's public UI states (kept out of the component file for fast refresh)
/**
 * R46 / P17 (public UI states of the grounded assistant; the model side is not changed here):
 *  - a refusal is said by its kind: 429 « too many questions », 503 beta / capability « not open yet », otherwise the server's own French text;
 *  - an answer is marked GROUNDED (sources listed) or ABSTENTION (no verified source: no answer is made up), never left ambiguous;
 *  - a postal code the server cannot use (several communes may share it) is turned into the communes of the official La Poste reference
 *    (GET /api/territory/postal): the person picks one, the name is then sent as the territory — never the first candidate.
 * @param {number} status @param {any} data @param {(k: string, d: string) => string} t
 */
export function chatFailure(status, data, t) {
  // G14-AI: the provider's free daily allocation is used (server counter or Cloudflare's own refusal)
  if (status === 503 && data?.error === 'daily_limit_reached') return { text: t('shared:chat.daily_limit', "L'assistant a atteint sa limite du jour, réessayez demain."), kind: 'daily_limit' };
  if (status === 429) return { text: t('shared:chat.rate_limited', 'Trop de questions en peu de temps. Attendez une minute, puis réessayez.'), kind: 'rate_limited' };
  if (status === 503 && (data?.error === 'PUBLIC_BETA_RESTRICTED' || data?.error === 'CAPABILITY_NOT_OPEN' || data?.code === 'CAPABILITY_NOT_OPEN')) {
    return { text: t('shared:chat.closed', "La Boussole Sociale n'est pas encore ouverte. Vous pouvez chercher une aide, une démarche ou une structure avec la recherche du site."), kind: 'closed' };
  }
  return data?.message ? { text: data.message, fr: true, kind: 'server' } : { text: t('shared:chat.error', 'Une erreur est survenue.'), kind: 'error' };
}

/** the assistant message shown for a 200 answer @param {any} data */
export function assistantMessage(data) {
  // G14-AI: each cited fiche is linked (the platform's fiche page when known, else the official source); the official source stays a second link
  const links = (data?.citations || []).map((/** @type {any} */ citation) => ({
    title: citation.title || citation.sourceId || 'Source officielle',
    url: typeof citation.ficheUrl === 'string' && citation.ficheUrl.startsWith('/') ? citation.ficheUrl : citation.sourceUrl,
    sourceUrl: typeof citation.ficheUrl === 'string' && citation.ficheUrl.startsWith('/') && /^https:\/\//.test(String(citation.sourceUrl || '')) ? citation.sourceUrl : null,
    type: citation.entityType || 'source',
  })).filter((/** @type {{ url: unknown }} */ link) => link.url);
  const emergencyNumbers = Array.isArray(data?.emergencyNumbers)
    ? data.emergencyNumbers.filter((/** @type {any} */ e) => /^\d{2,4}$/.test(String(e?.number || ''))).map((/** @type {any} */ e) => ({ number: String(e.number), label: String(e.label || '') }))
    : [];
  const grounded = data?.abstention !== true && data?.grounded !== false && links.length > 0;
  return {
    id: Date.now() + Math.random(), role: 'assistant', content: data?.answer, links, suggestions: [], logId: null,
    outcome: data?.meta?.reason === 'emergency_redirect' ? 'emergency' : data?.abstention === true ? 'abstention' : grounded ? 'grounded' : 'ungrounded', reason: data?.meta?.reason || null,
    emergencyNumbers,
  };
}

/** G14-AI: the build names the cloud provider (VITE_ASSISTANT_PROVIDER=workers_ai, mirror of AI_PROVIDER): the privacy line then says who processes the text @param {unknown} [value] */
export function assistantUsesCloud(value = undefined) {
  let v = value;
  if (v === undefined) { try { v = import.meta.env.VITE_ASSISTANT_PROVIDER; } catch { v = ''; } }
  return String(v ?? '').trim().toLowerCase() === 'workers_ai';
}

export default { chatFailure, assistantMessage, assistantUsesCloud };
