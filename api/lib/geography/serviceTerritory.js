/**
 * PKG-11 / P07 · P28 — the territory the local catalogue serves: the Eurométropole de Strasbourg, EPCI 246700488 in the INSEE list (nature METRO).
 * Its member communes come from the official reference (data/geography/service-territory.v1.json, derived by scripts/geo-reference-build.mjs) and are
 * read from the Territory tables at run time; that list still awaits a human validation (validation.status), so nothing calls it « vérifiée ».
 */
export const SERVICE_EPCI = '246700488';
export const SERVICE_LABEL = 'Eurométropole de Strasbourg';
