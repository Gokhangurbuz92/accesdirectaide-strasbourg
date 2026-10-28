/**
 * R20 — the territory named on an institutional account is an OFFICIAL territory of the committed INSEE reference (data/geography/insee-2026.v1.json, values as
 * published): a région, a département, an EPCI or a commune, given by its code or its official name (accents, case and hyphens do not matter). It used to be
 * free text (« Bas-Rhin », « bas rhin 67 », « mon secteur » were all accepted). The answer is the official label only: it assigns NO coverage and filters nothing
 * (which communes an institution may observe stays an owner decision, OWNER_ACTIONS R18.3), and the observatory keeps its aggregation and masking rules.
 */
import fs from 'node:fs';
import path from 'node:path';

/** @type {any} */
let cache = null;
/** @param {unknown} s */
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** @param {string} root */
function index(root) {
  if (cache) return cache;
  const ref = JSON.parse(fs.readFileSync(path.join(root, 'data', 'geography', 'insee-2026.v1.json'), 'utf8'));
  const byCode = new Map(); const byName = new Map();
  /** @param {string} kind @param {string} code @param {string} nom @param {string} [label] */
  const add = (kind, code, nom, label) => {
    const t = { kind, code, label: label || nom };
    byCode.set(`${kind}:${code}`, t);
    const k = fold(nom); byName.set(k, [...(byName.get(k) || []), t]);
  };
  for (const [code, nom] of ref.regions) add('region', code, nom);
  for (const [code, , nom] of ref.departements) add('departement', code, nom);
  for (const [code, nom] of ref.epcis) add('epci', code, nom);
  for (const [code, dep, nom] of ref.communes) add('commune', code, nom, `${nom} (${code})`);
  cache = { byCode, byName, version: ref.cogVersion };
  return cache;
}

/**
 * @param {unknown} input @param {{ root?: string }} [opts]
 * @returns {{ ok: true, label: string, kind: string, code: string } | { ok: false, reason: 'UNKNOWN' | 'AMBIGUOUS', candidates?: string[] }}
 */
export function officialTerritory(input, { root = process.cwd() } = {}) {
  const raw = String(input || '').trim();
  const { byCode, byName } = index(root);
  const code = raw.toUpperCase();
  // codes: département (2 or 3 characters, 2A / 2B), commune (5), EPCI SIREN (9); a région code is only accepted through its name (its 2 digits are a département's)
  const byCodeHit = /^\d{9}$/.test(code) ? byCode.get(`epci:${code}`) : /^(\d{5}|2[AB]\d{3})$/.test(code) ? byCode.get(`commune:${code}`) : /^(\d{2,3}|2[AB])$/.test(code) ? byCode.get(`departement:${code}`) : null;
  if (byCodeHit) return { ok: true, label: byCodeHit.label, kind: byCodeHit.kind, code: byCodeHit.code };
  const hits = byName.get(fold(raw)) || [];
  // a name shared by several territories (a commune name found in several départements, a commune and its EPCI) is not guessed: the code is asked for
  const preferred = hits.filter((/** @type {any} */ t) => t.kind !== 'commune');
  const pick = preferred.length === 1 ? preferred : hits.length === 1 ? hits : [];
  if (pick.length === 1) return { ok: true, label: pick[0].label, kind: pick[0].kind, code: pick[0].code };
  if (hits.length > 1) return { ok: false, reason: 'AMBIGUOUS', candidates: hits.slice(0, 5).map((/** @type {any} */ t) => t.label) };
  return { ok: false, reason: 'UNKNOWN' };
}
