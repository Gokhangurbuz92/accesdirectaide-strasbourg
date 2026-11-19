// @ts-check
/**
 * M1 (C07 / C08) — what "ParcoursItem"."planStep" (migration 0046) may contain, enforced HERE and nowhere else: the column has no CHECK, so every writer
 * goes through validatePlanStepInput() (what a person sends) or planStepFromPlan() (the account-free plan of a dossier the account owns), and every
 * reader through readPlanStep(), which keeps only what is still valid (an official link whose host left the allow-list is dropped, never shown).
 *
 * Stored shape (version 1), every key optional:
 *   { v: 1, need, actor: { kind, name? }, links: [{ url, label } | { to, label }], dependsOnItemId, nextActionKey, detail, closure }
 *   need            id of a subdomain of data/reference/social-domains.v1.json (the taxonomy of needs)
 *   actor           who acts next: 'citizen' | 'organisation' (with its name) | 'professional' (never a person's name)
 *   links           official https links (the allow-list of human verification, evidenceUrlAllowed) or internal routes of the site (from a plan only)
 *   dependsOnItemId another step of the SAME person (ownership and loops are checked by the service, with the database)
 *   nextActionKey   one of PLAN_NEXT_ACTIONS — a text key translated on screen, never free text
 *   detail          the plan's own explanation (from a plan only)
 *   closure         'ABANDONED' | 'OUTCOME_UNKNOWN', set by the status action only, meaningful while the status is CLOSED
 *   sensitive       G8: { at } — the person's explicit consent (art. 9.2.a) to keep THIS step although it reveals a sensitive fact
 *                   (api/lib/parcours-sensitivity.js); set by the server only, never accepted from the request (not in PLAN_STEP_INPUT_KEYS)
 * Nothing here states or decides a right: the content is the person's own organisation of their steps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_ACTOR_KINDS, PLAN_CLOSURES, PLAN_NEXT_ACTIONS, PLAN_STEP_VERSION } from '../../src/lib/parcoursPlan.js';
import { evidenceUrlAllowed } from '../_services/content-verification.js';

export const MAX_PLAN_STEP_BYTES = 8192;
export const MAX_PLAN_LINKS = 5;          // what a person may attach
export const MAX_STORED_PLAN_LINKS = 10;  // what a plan step may carry (src/lib/actionPlan.js)
/** the keys a person may send; `detail`, `closure` and `v` are the server's */
export const PLAN_STEP_INPUT_KEYS = Object.freeze(['need', 'actor', 'links', 'dependsOnItemId', 'nextActionKey']);

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const INTERNAL_ROUTE = /^\/(?!\/)[A-Za-z0-9/_.~%?=&-]{0,299}$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what a stored label must not contain
const CONTROL = /[\u0000-\u001f\u007f]/;
const plain = (/** @type {unknown} */ v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const text = (/** @type {unknown} */ v, /** @type {number} */ min, /** @type {number} */ max) => {
  if (typeof v !== 'string' || CONTROL.test(v)) return null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
};

/** @type {Map<string, string> | null} */ let NEEDS = null;
/** the taxonomy of needs: id → French label (the 86 subdomains of data/reference/social-domains.v1.json) @returns {Map<string, string>} */
export function planNeeds() {
  if (!NEEDS) {
    const ref = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/reference/social-domains.v1.json'), 'utf8'));
    NEEDS = new Map(ref.domains.flatMap((/** @type {any} */ d) => d.subdomains.map((/** @type {any} */ s) => [String(s.id), String(s.fr)])));
  }
  return NEEDS;
}

/** an official link: https, no credentials, on the allow-list used for official evidence @param {unknown} url @param {NodeJS.ProcessEnv} env */
function officialUrl(url, env) {
  if (typeof url !== 'string' || url.length > 500 || CONTROL.test(url) || /\s/.test(url)) return false;
  try { const u = new URL(url); if (u.username || u.password) return false; } catch { return false; }
  return evidenceUrlAllowed(url, env);
}

const refuse = (/** @type {string} */ field) => ({ ok: /** @type {const} */ (false), code: 'INVALID_PLAN_STEP', field });

/**
 * What a person sends for a step. Strict: a plain object, only the keys of PLAN_STEP_INPUT_KEYS, under the size cap; every value checked. A key set to
 * null asks to clear it. Ownership of `dependsOnItemId` and dependency loops need the database: the service checks them.
 * @param {unknown} input @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true, set: Record<string, any>, clear: string[] } | { ok: false, code: string, field: string }}
 */
export function validatePlanStepInput(input, env = process.env) {
  if (!plain(input)) return refuse('planStep');
  let size = 0; try { size = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch { return refuse('planStep'); }
  if (size > MAX_PLAN_STEP_BYTES) return refuse('size');
  const o = /** @type {Record<string, any>} */ (input);
  const keys = Object.keys(o);
  const unknown = keys.find((k) => !PLAN_STEP_INPUT_KEYS.includes(k));
  if (unknown !== undefined) return refuse('key');
  /** @type {Record<string, any>} */ const set = {}; const clear = keys.filter((k) => o[k] === null);
  const has = (/** @type {string} */ k) => o[k] !== undefined && o[k] !== null;

  if (has('need')) {
    if (typeof o.need !== 'string' || !planNeeds().has(o.need)) return refuse('need');
    set.need = o.need;
  }
  if (has('actor')) {
    const a = o.actor;
    if (!plain(a) || Object.keys(a).some((k) => k !== 'kind' && k !== 'name') || typeof a.kind !== 'string' || !PLAN_ACTOR_KINDS.includes(a.kind)) return refuse('actor');
    if (a.kind === 'organisation') {
      const name = text(a.name, 2, 120);
      if (!name) return refuse('actor');
      set.actor = { kind: a.kind, name };
    } else {
      if (a.name !== undefined) return refuse('actor');   // only an organisation is named: never a person
      set.actor = { kind: a.kind };
    }
  }
  if (has('links')) {
    if (!Array.isArray(o.links) || o.links.length > MAX_PLAN_LINKS) return refuse('links');
    const links = [];
    for (const l of o.links) {
      if (!plain(l) || Object.keys(l).some((k) => k !== 'url' && k !== 'label')) return refuse('links');
      const label = text(l.label, 1, 200);
      if (!label || !officialUrl(l.url, env)) return refuse('links');
      links.push({ url: l.url, label });
    }
    if (links.length) set.links = links; else clear.push('links');
  }
  if (has('dependsOnItemId')) {
    if (typeof o.dependsOnItemId !== 'string' || !ITEM_ID.test(o.dependsOnItemId)) return refuse('dependsOnItemId');
    set.dependsOnItemId = o.dependsOnItemId;
  }
  if (has('nextActionKey')) {
    if (typeof o.nextActionKey !== 'string' || !PLAN_NEXT_ACTIONS.includes(o.nextActionKey)) return refuse('nextActionKey');
    set.nextActionKey = o.nextActionKey;
  }
  return { ok: true, set, clear: [...new Set(clear)] };
}

/**
 * What is stored, read defensively: only the valid parts, null when nothing valid is left (NULL column, another version, anything unexpected).
 * @param {unknown} raw @param {NodeJS.ProcessEnv} [env]
 * @returns {{ need: string | null, actor: { kind: string, name: string | null } | null, links: ({ url: string, label: string } | { to: string, label: string })[], dependsOnItemId: string | null, nextActionKey: string | null, detail: string | null, closure: string | null, sensitive?: { at: string } } | null}
 */
export function readPlanStep(raw, env = process.env) {
  if (!plain(raw)) return null;
  const o = /** @type {Record<string, any>} */ (raw);
  if (o.v !== PLAN_STEP_VERSION) return null;
  const need = typeof o.need === 'string' && planNeeds().has(o.need) ? o.need : null;
  let actor = null;
  if (plain(o.actor) && PLAN_ACTOR_KINDS.includes(o.actor.kind)) {
    const name = o.actor.kind === 'organisation' ? text(o.actor.name, 1, 200) : null;
    if (o.actor.kind !== 'organisation' || name) actor = { kind: String(o.actor.kind), name };
  }
  const links = [];
  for (const l of Array.isArray(o.links) ? o.links.slice(0, MAX_STORED_PLAN_LINKS) : []) {
    const label = plain(l) ? text(l.label, 1, 200) : null;
    if (!label) continue;
    if (typeof l.to === 'string' && INTERNAL_ROUTE.test(l.to)) links.push({ to: l.to, label });
    else if (officialUrl(l.url, env)) links.push({ url: String(l.url), label });
  }
  const out = { need, actor, links,
    dependsOnItemId: typeof o.dependsOnItemId === 'string' && ITEM_ID.test(o.dependsOnItemId) ? o.dependsOnItemId : null,
    nextActionKey: PLAN_NEXT_ACTIONS.includes(o.nextActionKey) ? String(o.nextActionKey) : null,
    detail: text(o.detail, 1, 1000),
    closure: PLAN_CLOSURES.includes(o.closure) ? String(o.closure) : null };
  // G8: the consent to keep a sensitive step — a key of its own only when it is there (the former shape is unchanged for every other step)
  const sensitive = plain(o.sensitive) && typeof o.sensitive.at === 'string' && !Number.isNaN(Date.parse(o.sensitive.at)) ? { at: String(o.sensitive.at) } : null;
  if (sensitive) return { ...out, sensitive };
  return out.need || out.actor || out.links.length || out.dependsOnItemId || out.nextActionKey || out.detail || out.closure ? out : null;
}

const STEP_ACTORS = Object.freeze({ complete: ['citizen', 'complete_information'], verify: ['organisation', 'contact_organisation'], prepare: ['citizen', 'gather_documents'],
  accompany: ['professional', 'ask_professional'], share: ['citizen', 'share_dossier'], urgent: ['citizen', 'emergency_resources'] });

/**
 * The durable copy of a step of the account-free plan (src/lib/actionPlan.js), taken when the person imports it: who acts (the organisation the plan
 * names for a « faire vérifier » step), the plan's explanation, its internal links (routes of the site; the in-page anchors of the diagnostic form are
 * left out) and the next action. null when the step gives nothing to keep.
 * @param {{ kind?: string, who?: string, detail?: string, links?: { to?: string, label?: string }[] }} step @returns {Record<string, any> | null}
 */
export function planStepFromPlan(step) {
  if (!step || typeof step !== 'object') return null;
  /** @type {Record<string, any>} */ const out = { v: PLAN_STEP_VERSION };
  const map = STEP_ACTORS[/** @type {keyof typeof STEP_ACTORS} */ (String(step.kind))];
  if (map) {
    const who = map[0] === 'organisation' && typeof step.who === 'string' ? text(step.who.slice(0, 200), 1, 200) : null;
    if (map[0] !== 'organisation') out.actor = { kind: map[0] };
    else if (who) out.actor = { kind: 'organisation', name: who };
    out.nextActionKey = map[1];
  }
  const detail = typeof step.detail === 'string' ? text(step.detail.slice(0, 1000), 1, 1000) : null;
  if (detail) out.detail = detail;
  // a longer label is cut, as the plan's read-back always did
  const links = (Array.isArray(step.links) ? step.links : []).map((l) => (l && typeof l.to === 'string' && INTERNAL_ROUTE.test(l.to) && typeof l.label === 'string' ? { to: l.to, label: text(l.label.slice(0, 200), 1, 200) } : null))
    .filter((l) => l && l.label).slice(0, MAX_STORED_PLAN_LINKS);
  if (links.length) out.links = links;
  return Object.keys(out).length > 1 ? out : null;
}

/**
 * The stored value after a person's change: the keys they set replace the former ones, the keys they clear go, everything else (the plan's detail, the
 * closing reason) stays. null when nothing is left. `closure` (undefined = unchanged, null = removed) is the status action's.
 * @param {unknown} current @param {{ set?: Record<string, any>, clear?: string[] }} change @param {string | null} [closure] @returns {Record<string, any> | null}
 */
export function mergePlanStep(current, change = {}, closure = undefined) {
  /** @type {Record<string, any>} */ const out = plain(current) && /** @type {any} */ (current).v === PLAN_STEP_VERSION ? { .../** @type {any} */ (current) } : {};
  for (const k of change.clear || []) delete out[k];
  Object.assign(out, change.set || {});
  if (closure === null) delete out.closure; else if (closure !== undefined) out.closure = closure;
  delete out.v;
  return Object.keys(out).length ? { v: PLAN_STEP_VERSION, ...out } : null;
}

/** is the stored value within the size cap @param {unknown} value */
export const planStepFits = (value) => value == null || Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_PLAN_STEP_BYTES;
