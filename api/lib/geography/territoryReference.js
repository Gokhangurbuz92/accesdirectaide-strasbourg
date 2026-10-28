/**
 * PKG-11 / D12 · P07 — load the committed official reference (data/geography/insee-2026.v1.json, produced by scripts/geo-reference-build.mjs from the INSEE
 * files, values unchanged) through the COG connector and the INSEE EPCI connector. Idempotent (a second load creates nothing), never deletes, no network.
 * `departements` limits the communes to some départements (tests, partial installs); every région and département is kept so that hierarchies stay
 * complete, and an EPCI is loaded only when ALL its member communes are (a partial EPCI would be a false fact).
 */
import { COGConnector, INSEEEPCIConnector } from './COGIngestion.js';

const complete = (/** @type {{ state: string } | null} */ run) => run?.state === 'COMPLETE';

/**
 * @param {{ cogVersion: string, regions: string[][], departements: string[][], communes: string[][], arrondissementsMunicipaux: string[][], epcis: string[][] }} reference
 * @param {{ departements?: string[] | null }} [options]
 */
export function referenceItems(reference, { departements = null } = {}) {
  const keep = departements ? new Set(departements) : null;
  /** @type {Map<string, string[]>} */
  const allMembers = new Map();
  for (const [code, , , epci] of reference.communes) if (epci) allMembers.set(epci, [...(allMembers.get(epci) || []), code]);
  const communes = reference.communes.filter(([, dep]) => !keep || keep.has(dep));
  const kept = new Set(communes.map(([code]) => code));
  const epcis = [];
  const skippedEpcis = [];
  for (const [code, nom, nature] of reference.epcis) {
    const membres = allMembers.get(code) || [];
    if (membres.length > 0 && membres.every((m) => kept.has(m))) epcis.push({ code, nom, nature, membres });
    else if (membres.some((m) => kept.has(m))) skippedEpcis.push(code);
  }
  return {
    cogVersion: reference.cogVersion,
    regions: reference.regions.map(([code, nom]) => ({ code, nom })),
    departments: reference.departements.map(([code, codeRegion, nom]) => ({ code, codeRegion, nom })),
    communes: communes.map(([code, codeDepartement, nom]) => ({ code, codeDepartement, nom })),
    arrondissements: reference.arrondissementsMunicipaux.filter(([, commune]) => kept.has(commune)).map(([code, codeCommune, nom]) => ({ code, codeCommune, nom })),
    epcis,
    skippedEpcis,
  };
}

/**
 * @param {Parameters<typeof referenceItems>[0]} reference
 * @param {{ db: any, schemas: any, departements?: string[] | null }} options
 */
export async function loadTerritoryReference(reference, { db, schemas, departements = null }) {
  const data = referenceItems(reference, { departements });
  const cog = new COGConnector(db, schemas);
  cog.setData({ regions: data.regions, departments: data.departments, communes: data.communes, arrondissements: data.arrondissements, replacements: [], cogVersion: data.cogVersion });
  const cogRun = await cog.execute();
  let epciRun = null;
  if (complete(cogRun) && data.epcis.length > 0) {
    const epci = new INSEEEPCIConnector(db, schemas);
    epci.setData({ epcis: data.epcis, cogVersion: data.cogVersion });
    epciRun = await epci.execute();
  }
  return {
    ok: complete(cogRun) && (data.epcis.length === 0 || complete(epciRun)),
    cog: cogRun,
    epci: epciRun,
    expected: { regions: data.regions.length, departements: data.departments.length, communes: data.communes.length, arrondissements: data.arrondissements.length, epcis: data.epcis.length },
    skippedEpcis: data.skippedEpcis,
  };
}

export default { referenceItems, loadTerritoryReference };
