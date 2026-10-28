/**
 * DTA S2A (A6) — territorial applicability as DATA.
 * Each right that is territory-bound carries its declared scope here instead of a regex inside an engine.  The values come from the PROJECT catalogue (data/aides-alsace.csv:
 * `territoires`, `departements`) and are declared UNVERIFIED: the WS2 launch data is not verified (launchReady:false) and the list of communes of the Eurométropole is NOT verified,
 * so a postal code only tells us "inside the declared département" or "outside", never "inside the Eurométropole".  Used by the local engine AND by the assessment contract.
 */
/** @type {Readonly<Record<string, { territory_scope: string, departmentPrefixes: readonly string[], source: string, status: string, communeList: string }>>} */
export const TERRITORY_SCOPES = Object.freeze({
  'faj-strasbourg': Object.freeze({
    territory_scope: 'Eurométropole de Strasbourg',
    departmentPrefixes: Object.freeze(['67']),
    source: 'data/aides-alsace.csv (territoires, departements) — catalogue du projet',
    status: 'UNVERIFIED',
    communeList: 'NOT_VERIFIED',
  }),
});

/**
 * @param {string} code right code
 * @param {unknown} territory postal code (5 digits) or département code (2 digits) as typed by the citizen
 * @returns {'NO_SCOPE'|'UNKNOWN'|'DECLARED_AREA'|'OUTSIDE'}
 */
export function territoryStatus(code, territory) {
  const scope = TERRITORY_SCOPES[code];
  if (!scope) return 'NO_SCOPE';
  const t = String(territory ?? '').trim();
  if (!/^\d{5}$/.test(t) && !/^\d{2}$/.test(t)) return 'UNKNOWN';
  return scope.departmentPrefixes.some((/** @type {string} */ p) => t.startsWith(p)) ? 'DECLARED_AREA' : 'OUTSIDE';
}
