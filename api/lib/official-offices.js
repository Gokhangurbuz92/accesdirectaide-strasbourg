import fs from 'node:fs';
import path from 'node:path';

/**
 * R34 / D16 — where the administration itself says to go. Each Service-Public sheet names the kinds of local office that handle it (OuSAdresser /
 * PivotLocal, codes of the Annuaire de l'administration: caf, cpam, mairie, cidf, mjd…). PIVOT_TYPES translates those codes into the catalogue's place types;
 * data/reference/guide-offices.v1.json (scripts/guide-offices.mjs, from the DILA archive) holds them per published guide, so the search can offer the
 * offices an official sheet points to — with no text of its own.
 */
/** Annuaire de l'administration « type_service_local » → Structure.type_structure (only kinds the catalogue can hold) */
export const PIVOT_TYPES = {
  mairie: ['Mairie'], caf: ["Caf (Caisse d'allocations familiales)"], cpam: ["CPAM (caisse primaire d'assurance maladie)"], msa: [],
  cidf: ['CIDFF (droits des femmes et des familles)'], mjd: ['Maison de justice et du droit', 'Point-justice (accès au droit)'],
  permanence_juridique: ['Point-justice (accès au droit)'], aav: ["Bureau d'aide aux victimes"], cg: ['Maison des solidarités (Espace Solidarités)'],
  maison_handicapees: ['MDPH (maison des personnes handicapées)'], ofii: ["OFII (Office français de l'immigration et de l'intégration)"],
  prefecture: ['Préfecture', 'Sous-préfecture'], france_services: ['Espace France Services'], sip: ['Service des impôts des particuliers'],
};

let cache = null;
/** the offices per guide sheet ID, read once (an unreadable file means none: the search simply does not add official offices) @returns {Record<string, { pivots: string[], types: string[] }>} */
export function guideOffices(file = path.join(process.cwd(), 'data/reference/guide-offices.v1.json')) {
  if (!cache) { try { cache = JSON.parse(fs.readFileSync(file, 'utf8')).sheets || {}; } catch { cache = {}; } }
  return cache;
}
