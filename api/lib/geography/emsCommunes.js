/**
 * G14 — the closed list of the Eurométropole de Strasbourg communes (INSEE code, name) for the indicative calculation's commune question: the same official
 * reference as the directory's commune filter (data/geography/service-territory.v1.json, Insee COG 2026, derived by scripts/geo-reference-build.mjs).
 * A commune code outside this list is refused by POST /api/diagnostic (the browser offers nothing else; « Autre commune » sends no code at all).
 */
import fs from 'node:fs';
import path from 'node:path';

/** @type {Map<string, string> | null} */
let communes = null;
/** @returns {ReadonlyMap<string, string>} INSEE code → name ('' map when the reference cannot be read: then every code is refused) */
export function emsCommunes() {
  if (communes) return communes;
  try {
    const ref = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/geography/service-territory.v1.json'), 'utf8'));
    /** @type {unknown[]} */
    const rows = Array.isArray(ref.communes) ? ref.communes : [];
    communes = new Map(rows.filter((c) => Array.isArray(c) && /^\d{5}$/.test(String(c[0]))).map((c) => { const [code, name] = /** @type {unknown[]} */ (c); return [String(code), String(name)]; }));
  } catch {
    communes = new Map();
  }
  return communes;
}

/** @param {unknown} code @returns {boolean} */
export const isEmsCommune = (code) => typeof code === 'string' && emsCommunes().has(code);
