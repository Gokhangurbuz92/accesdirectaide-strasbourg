#!/usr/bin/env node
/**
 * PKG-11 / D12 · P07 — build the territory reference of the product from the OFFICIAL INSEE files, deterministically and without editing any value.
 *   node scripts/geo-reference-build.mjs <dir with the COG 2026 CSV files> <dir with the INSEE EPCI 2026 CSV sheets> [--check]
 * Inputs (downloaded once into the LAB, never at run time; provenance in OFFICIAL_DATA/PROVENANCE.json):
 *   COG au 1er janvier 2026 — https://www.insee.fr/fr/information/8740222 (v_region_2026.csv, v_departement_2026.csv, v_commune_2026.csv)
 *   Intercommunalité et Métropole au 01/01/2026 — https://www.insee.fr/fr/information/2510634 (EPCI.csv, Composition_communale.csv converted from the published workbook)
 * Outputs: data/geography/insee-2026.v1.json (régions, départements, communes with their EPCI, municipal arrondissements, EPCI) and
 *          data/geography/service-territory.v1.json (the Eurométropole de Strasbourg as listed by INSEE — PENDING a human validation).
 * Consistency checks refuse to write: every commune's département / région exists, every EPCI member is a current commune, every EPCI's published commune count
 * equals its members, the published total of communes is met. --check verifies that the committed files are exactly what the inputs produce.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REFERENCE_PATH = 'data/geography/insee-2026.v1.json';
export const SERVICE_TERRITORY_PATH = 'data/geography/service-territory.v1.json';
export const SERVICE_EPCI = '246700488';   // « Eurométropole de Strasbourg » in the INSEE list (nature METRO)
const NO_EPCI = 'ZZZZZZZZZ';               // INSEE code for a commune outside any EPCI

/** Minimal RFC 4180 reader (quoted fields, doubled quotes, CRLF). @param {string} text */
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Rows as objects from the line that starts with `firstColumn` (the INSEE workbook sheets carry a title block). */
function table(file, firstColumn) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const h = rows.findIndex((r) => r[0] === firstColumn);
  if (h < 0) throw new Error(`${path.basename(file)}: header ${firstColumn} not found`);
  const head = rows[h];
  return rows.slice(h + 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
}

const sha256 = (/** @type {string} */ file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** @param {string} cogDir @param {string} epciDir */
export function buildReference(cogDir, epciDir) {
  const f = {
    region: path.join(cogDir, 'v_region_2026.csv'), departement: path.join(cogDir, 'v_departement_2026.csv'), commune: path.join(cogDir, 'v_commune_2026.csv'),
    epci: path.join(epciDir, 'EPCI.csv'), composition: path.join(epciDir, 'Composition_communale.csv'),
  };
  const regions = table(f.region, 'REG').map((r) => [r.REG, r.LIBELLE]);
  const departements = table(f.departement, 'DEP').map((d) => [d.DEP, d.REG, d.LIBELLE]);
  const cog = table(f.commune, 'TYPECOM');
  const regionCodes = new Set(regions.map((r) => r[0])); const depCodes = new Map(departements.map((d) => [d[0], d[1]]));
  const problems = [];
  for (const [dep, reg] of depCodes) if (!regionCodes.has(reg)) problems.push(`département ${dep}: unknown région ${reg}`);

  const composition = table(f.composition, 'CODGEO').filter((c) => c.CODGEO);
  const epciOf = new Map(composition.map((c) => [c.CODGEO, c.EPCI]));
  const epciRows = table(f.epci, 'EPCI').filter((e) => e.EPCI);
  const communes = []; const arrondissements = [];
  for (const c of cog) {
    if (c.TYPECOM === 'COM') {
      if (!depCodes.has(c.DEP)) problems.push(`commune ${c.COM}: unknown département ${c.DEP}`);
      else if (depCodes.get(c.DEP) !== c.REG) problems.push(`commune ${c.COM}: région ${c.REG} differs from its département's`);
      const e = epciOf.get(c.COM);
      if (e === undefined) problems.push(`commune ${c.COM}: absent from the EPCI composition`);
      communes.push([c.COM, c.DEP, c.LIBELLE, e && e !== NO_EPCI ? e : '']);
    } else if (c.TYPECOM === 'ARM') arrondissements.push([c.COM, c.COMPARENT, c.LIBELLE]);
  }
  const communeCodes = new Set(communes.map((c) => c[0]));
  for (const c of composition) if (!communeCodes.has(c.CODGEO)) problems.push(`EPCI composition: ${c.CODGEO} is not a current commune`);
  for (const a of arrondissements) if (!communeCodes.has(a[1])) problems.push(`arrondissement ${a[0]}: unknown parent ${a[1]}`);
  const members = new Map();
  for (const c of communes) if (c[3]) members.set(c[3], (members.get(c[3]) || 0) + 1);
  const epcis = epciRows.filter((e) => e.EPCI !== NO_EPCI).map((e) => {
    if (Number(e.NB_COM) !== (members.get(e.EPCI) || 0)) problems.push(`EPCI ${e.EPCI}: published ${e.NB_COM} communes, ${members.get(e.EPCI) || 0} members`);
    return [e.EPCI, e.LIBEPCI, e.NATURE_EPCI];
  });
  for (const code of members.keys()) if (!epcis.some((e) => e[0] === code)) problems.push(`EPCI ${code}: members but not listed`);
  if (problems.length) throw new Error(`territory reference refused (${problems.length}):\n` + problems.slice(0, 20).join('\n'));

  const byCode = (/** @type {any[]} */ a, /** @type {any[]} */ b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  regions.sort(byCode); departements.sort(byCode); communes.sort(byCode); arrondissements.sort(byCode); epcis.sort(byCode);
  const reference = {
    schema: 'accesdirectaide.territory-reference.v1',
    cogVersion: '2026',
    validFrom: '2026-01-01',
    status: 'OFFICIAL_SOURCE_AS_PUBLISHED',
    note: "Données de l'Insee reprises sans modification (Code officiel géographique au 1er janvier 2026 ; intercommunalités au 1er janvier 2026). Aucun code postal : l'Insee ne les publie pas.",
    sources: [
      { producer: 'Insee', title: 'Code officiel géographique au 1er janvier 2026', page: 'https://www.insee.fr/fr/information/8740222', url: 'https://www.insee.fr/fr/statistiques/fichier/8740222/cog_ensemble_2026_csv.zip',
        files: { 'v_region_2026.csv': sha256(f.region), 'v_departement_2026.csv': sha256(f.departement), 'v_commune_2026.csv': sha256(f.commune) } },
      { producer: 'Insee', title: 'Intercommunalité et Métropole au 01/01/2026 (mise en ligne le 19/03/2026)', page: 'https://www.insee.fr/fr/information/2510634', url: 'https://www.insee.fr/fr/statistiques/fichier/2510634/epci_au_01-01-2026.zip',
        files: { 'EPCI.csv': sha256(f.epci), 'Composition_communale.csv': sha256(f.composition) }, conversion: 'sheets of EPCI_au_01-01-2026.xlsx written as CSV cell by cell' },
    ],
    counts: { regions: regions.length, departements: departements.length, communes: communes.length, arrondissementsMunicipaux: arrondissements.length, epcis: epcis.length },
    columns: { regions: ['code', 'libelle'], departements: ['code', 'region', 'libelle'], communes: ['code', 'departement', 'libelle', 'epci'], arrondissementsMunicipaux: ['code', 'commune', 'libelle'], epcis: ['code', 'libelle', 'nature'] },
    regions, departements, communes, arrondissementsMunicipaux: arrondissements, epcis,
  };
  const service = epcis.find((e) => e[0] === SERVICE_EPCI);
  if (!service) throw new Error('service EPCI not in the INSEE list');
  const serviceCommunes = communes.filter((c) => c[3] === SERVICE_EPCI).map((c) => [c[0], c[2]]);
  const serviceTerritory = {
    schema: 'accesdirectaide.service-territory.v1',
    epci: SERVICE_EPCI, libelle: service[1], nature: service[2],
    derivedFrom: { reference: REFERENCE_PATH, cogVersion: '2026', file: 'Composition_communale.csv', sha256: sha256(f.composition) },
    communes: serviceCommunes,
    validation: { status: 'PENDING_HUMAN_VALIDATION', by: null, at: null, note: "Liste établie à partir de la composition publiée par l'Insee ; elle doit être confirmée par une personne avant toute mention « vérifié »." },
  };
  return { reference, serviceTerritory };
}

const serialize = (/** @type {unknown} */ o) => JSON.stringify(o) + '\n';

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cogDir, epciDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!cogDir || !epciDir) { console.error('usage: geo-reference-build.mjs <cogCsvDir> <epciCsvDir> [--check]'); process.exit(2); }
  const { reference, serviceTerritory } = buildReference(cogDir, epciDir);
  const outs = [[REFERENCE_PATH, serialize(reference)], [SERVICE_TERRITORY_PATH, serialize(serviceTerritory)]];
  if (process.argv.includes('--check')) {
    const drift = outs.filter(([p, s]) => !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== s).map(([p]) => p);
    if (drift.length) { console.error('OUT OF SYNC: ' + drift.join(', ')); process.exit(1); }
    console.log('in sync', reference.counts);
  } else {
    for (const [p, s] of outs) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
    console.log('written', reference.counts, serviceTerritory.communes.length, 'service communes');
  }
}
