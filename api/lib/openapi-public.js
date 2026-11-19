import { isAllowedInPublicBeta } from '../_utils/public-beta.js';

/**
 * G3 (19/11/2026) — the PUBLIC subset of docs/openapi.json, for the restricted public beta. An operation is kept only when
 *   - the beta gate (api/_utils/public-beta.js) serves it in this environment (a path parameter is tested as a plain segment),
 *   - its path is not in a private space (admin, cron, monitor, pro, institution, login-pro-guard), whatever surface is open,
 *   - it declares no security requirement (an anonymous visitor can call it).
 * Only the schemas (transitively), tags and security schemes still referenced are kept; x-webhooks (partner callbacks) is dropped. Pure: the input is not changed.
 */
const PRIVATE = /^(admin|cron|monitor|pro|institution|login-pro-guard)(\/|$)/;
const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/** @param {unknown} node @param {Set<string>} out */
function collectRefs(node, out) {
  if (Array.isArray(node)) { for (const x of node) collectRefs(x, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { if (k === '$ref' && typeof v === 'string') out.add(v); else collectRefs(v, out); }
  }
  return out;
}

/**
 * @param {any} spec the full OpenAPI document
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {any}
 */
export function publicOpenApiSpec(spec, envVars = process.env) {
  const full = JSON.parse(JSON.stringify(spec));
  /** @type {Record<string, any>} */
  const paths = {};
  for (const [p, item] of Object.entries(full.paths || {})) {
    const route = p.replace(/^\/+|\/+$/g, '');
    if (PRIVATE.test(route)) continue;
    const probe = route.replace(/\{[^}]+\}/g, 'x');
    /** @type {Record<string, any>} */
    const kept = {};
    for (const [m, op] of Object.entries(/** @type {Record<string, any>} */ (item))) {
      if (!METHODS.has(m)) continue;
      if (Array.isArray(op?.security) && op.security.length > 0) continue;
      if (!isAllowedInPublicBeta(m.toUpperCase(), probe, envVars)) continue;
      kept[m] = op;
    }
    if (Object.keys(kept).length) {
      if (/** @type {any} */ (item).parameters) kept.parameters = /** @type {any} */ (item).parameters;
      paths[p] = kept;
    }
  }

  // schemas: what the kept operations reference, transitively
  const schemas = full.components?.schemas || {};
  const used = collectRefs(paths, new Set());
  /** @type {string[]} */
  const queue = [...used];
  while (queue.length) {
    const ref = /** @type {string} */ (queue.pop());
    const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
    if (!m || !schemas[m[1]]) continue;
    for (const r of collectRefs(schemas[m[1]], new Set())) if (!used.has(r)) { used.add(r); queue.push(r); }
  }
  /** @type {Record<string, any>} */
  const components = {};
  for (const [kind, entries] of Object.entries(full.components || {})) {
    if (kind === 'securitySchemes') continue;   // no kept operation needs one
    /** @type {Record<string, any>} */
    const keep = {};
    for (const [name, value] of Object.entries(/** @type {Record<string, any>} */ (entries))) if (used.has(`#/components/${kind}/${name}`)) keep[name] = value;
    if (Object.keys(keep).length) components[kind] = keep;
  }

  const tagNames = new Set(Object.values(paths).flatMap((item) => Object.entries(item).filter(([m]) => METHODS.has(m)).flatMap(([, op]) => op.tags || [])));
  delete full['x-webhooks'];   // partner callbacks: not public
  delete full.security;
  return {
    ...full,
    info: { ...full.info, description: `${full.info?.description ? `${full.info.description}\n\n` : ''}Sous-ensemble public de la bêta : seules les routes ouvertes à un visiteur anonyme sont décrites.` },
    tags: (full.tags || []).filter((/** @type {{ name: string }} */ t) => tagNames.has(t.name)),
    paths,
    components,
  };
}
