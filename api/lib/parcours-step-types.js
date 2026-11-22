// @ts-check
/**
 * G14 (22/11/2026) — the « limited » Mon Parcours: a CLOSED, reviewed list of generic administrative step types (positive list) replaces the free step
 * title and the free organisation name. Source of truth: data/reference/parcours-step-types.v1.json (documented in docs/product/MON_PARCOURS_LIMITE_FR.md).
 *
 * What the server accepts (api/lib/parcours-limited.js checks the request shape, api/_services/mon-espace.js `addStepType` stores):
 *   - a step = one `code` of the list; its stored title is the list's French label (never the person's text);
 *   - an organisation = optionally the id of a PUBLISHED Structure whose `type_structure` is one of the list's structure kinds AND one of the kinds the step
 *     type allows (a CSAPA, a hospital, a CADA, a CHRS… can never be attached: their kinds are not listed) — never a name typed by the person;
 *   - a deadline source = one of the official fiches of the step type (never a free URL, which could itself point at a sensitive page).
 * No code, label or kind of the list names or lets one infer health, disability, addiction, sex life (RGPD art. 9), an offence (art. 10) or a situation
 * of reinforced protection (right of residence, violence, child protection, legal protection, extreme precariousness, emergency housing): see `excluded`
 * in the JSON file. The list is checked again at load time with the G8 sensitive-words guard (api/lib/parcours-sensitivity.js) — defence in depth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyParcoursStep, normaliseText } from './parcours-sensitivity.js';

export const PARCOURS_STEP_TYPES_FILE = 'data/reference/parcours-step-types.v1.json';
export const STEP_TYPE_CODE_RE = /^[A-Z][A-Z0-9_]{2,59}$/;
/** the prefix of the step type in "ParcoursItem"."itemCodes" (it never matches a catalogue record code « aide:… », « structure:… ») */
export const STEP_TYPE_PREFIX = 'steptype:';

/**
 * @typedef {{ id: string, title: string, url: string, modified: string }} StepSource
 * @typedef {{ code: string, domain: string, label: string, sources: StepSource[], structureKinds: string[] }} StepType
 * @typedef {{ version: string, status: string, domains: Record<string, string>, structureKinds: Record<string, { label: string, typeStructure: string[] }>, types: StepType[] }} StepCatalogue
 */

/** @param {any} raw @returns {StepCatalogue} — throws on any malformed or sensitive entry (fail-closed: Mon Parcours then refuses every addition) */
export function validateStepCatalogue(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.types) || !raw.structureKinds || !raw.domains) throw new Error('parcours step types: malformed file');
  const codes = new Set();
  for (const t of raw.types) {
    if (!t || !STEP_TYPE_CODE_RE.test(String(t.code)) || codes.has(t.code)) throw new Error(`parcours step types: bad or duplicate code ${t && t.code}`);
    codes.add(t.code);
    if (!Object.prototype.hasOwnProperty.call(raw.domains, t.domain)) throw new Error(`parcours step types: unknown domain for ${t.code}`);
    if (typeof t.label !== 'string' || t.label.length < 5 || t.label.length > 120) throw new Error(`parcours step types: bad label for ${t.code}`);
    if (!Array.isArray(t.sources) || t.sources.length < 1) throw new Error(`parcours step types: ${t.code} has no official source`);
    for (const s of t.sources) {
      if (!s || !/^https:\/\/www\.service-public\.gouv\.fr\/particuliers\/vosdroits\/[FN]\d{1,6}$/.test(String(s.url)) || !String(s.url).endsWith(`/${s.id}`)) throw new Error(`parcours step types: bad source for ${t.code}`);
    }
    if (!Array.isArray(t.structureKinds) || t.structureKinds.some((/** @type {string} */ k) => !Object.prototype.hasOwnProperty.call(raw.structureKinds, k))) throw new Error(`parcours step types: unknown structure kind for ${t.code}`);
    // defence in depth: neither the code nor the label may trip the sensitive-words guard
    if (classifyParcoursStep({ texts: [t.label, t.code.replace(/_/g, ' ')] }).sensitive) throw new Error(`parcours step types: ${t.code} reveals a sensitive category`);
  }
  for (const [k, v] of Object.entries(raw.structureKinds)) {
    if (!v || !Array.isArray(v.typeStructure) || !v.typeStructure.length) throw new Error(`parcours step types: structure kind ${k} without type`);
    if (v.typeStructure.some((/** @type {string} */ s) => classifyParcoursStep({ texts: [s] }).sensitive)) throw new Error(`parcours step types: structure kind ${k} is sensitive`);
  }
  return raw;
}

/** @type {StepCatalogue | null} */ let cached = null;
/** the reviewed list (read once; a broken file throws — and the API then refuses every addition) @returns {StepCatalogue} */
export function stepCatalogue() {
  if (!cached) cached = validateStepCatalogue(JSON.parse(fs.readFileSync(path.join(process.cwd(), PARCOURS_STEP_TYPES_FILE), 'utf8')));
  return cached;
}

/** @param {unknown} code @returns {StepType | null} */
export function stepTypeOf(code) {
  if (typeof code !== 'string' || !STEP_TYPE_CODE_RE.test(code)) return null;
  return stepCatalogue().types.find((t) => t.code === code) || null;
}

/** the step type stored on an item (from its itemCodes), or null for a step of the former contract @param {{ itemCodes?: string[] | null }} row */
export function stepTypeOfItem(row) {
  const c = (row && Array.isArray(row.itemCodes) ? row.itemCodes : []).find((x) => typeof x === 'string' && x.startsWith(STEP_TYPE_PREFIX));
  return c ? stepTypeOf(c.slice(STEP_TYPE_PREFIX.length)) : null;
}

/** apostrophes and spaces normalised, so « Caf (Caisse d’allocations familiales) » and « Caf (Caisse d'allocations familiales) » are the same type */
const kindKey = (/** @type {unknown} */ s) => normaliseText(s);

/** the structure kind of a Structure row's type_structure, or null when its type is not on the list @param {unknown} typeStructure @returns {string | null} */
export function structureKindOf(typeStructure) {
  const k = kindKey(typeStructure);
  if (!k) return null;
  for (const [kind, v] of Object.entries(stepCatalogue().structureKinds)) if (v.typeStructure.some((s) => kindKey(s) === k)) return kind;
  return null;
}

/** every exact type_structure value a step type allows (for the structure search) @param {StepType} type */
export function allowedTypeStructures(type) {
  const kinds = stepCatalogue().structureKinds;
  return type.structureKinds.flatMap((k) => kinds[k].typeStructure);
}

/**
 * May this Structure be attached to a step of this type? Published (decided by the caller), its kind listed for the type, and neither its name nor its type
 * trips the sensitive-words guard (a « Mairie » named after… is still checked). @param {StepType} type @param {{ nom?: unknown, type_structure?: unknown }} s
 */
export function structureFitsStepType(type, s) {
  const kind = structureKindOf(s && s.type_structure);
  if (!kind || !type.structureKinds.includes(kind)) return false;
  return !classifyParcoursStep({ texts: [s.nom, s.type_structure] }).sensitive;
}

/** the official source a deadline cites: the one given when it is a source of the type, the type's first source when none is given, else null */
export function deadlineSourceOf(/** @type {StepType} */ type, /** @type {unknown} */ given) {
  if (given === undefined || given === null || given === '') return type.sources[0].url;
  return type.sources.some((s) => s.url === given) ? String(given) : null;
}

/** the public shape of the list (GET): codes, domains, French labels, sources, structure kinds — no personal data */
export function stepCatalogueView() {
  const c = stepCatalogue();
  return { version: c.version, domains: c.domains, types: c.types.map((t) => ({ code: t.code, domain: t.domain, label: t.label, sources: t.sources.map((s) => ({ id: s.id, url: s.url, title: s.title })), structureKinds: t.structureKinds })) };
}
