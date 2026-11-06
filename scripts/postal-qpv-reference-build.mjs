#!/usr/bin/env node
/**
 * R46 / P07 — build the postal-code and QPV references of the product from the OFFICIAL open files, deterministically and without editing any value.
 *   node scripts/postal-qpv-reference-build.mjs <La Poste hexasmal CSV> <ANCT listeqp2024 CSV> [--check]
 * Inputs (downloaded once into the LAB, never at run time):
 *   La Poste « Base officielle des codes postaux » — dataset https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux, file
 *     https://data.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw (ISO-8859-1, « ; »), licence Licence Ouverte v2.0 (data.gouv.fr: lov2).
 *   ANCT « Quartiers prioritaires de la politique de la ville (QPV) » — dataset https://www.data.gouv.fr/datasets/quartiers-prioritaires-de-la-politique-de-la-ville-qpv,
 *     file « Liste des quartiers prioritaires de la politique de la ville 2024 (format CSV) » listeqp2024-cog2025.csv, licence Licence Ouverte v1.0 (fr-lo).
 * Outputs: data/reference/postal-codes.v1.json (postal code → current INSEE commune codes) and data/reference/qpv-2024.v1.json (QPV 2024 → communes).
 * Every commune code is checked against the committed INSEE COG 2026 reference (data/geography/insee-2026.v1.json): a code that is not a current commune
 * (or municipal arrondissement) is NOT kept and is listed under `unmatched` with its count — never silently re-mapped. --check verifies that the committed
 * files are exactly what the inputs produce. No QPV perimeter (geometry) is imported: an address is never placed in a QPV by this product.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { isMainModule } from './lib/is-main.mjs';

export const POSTAL_PATH = 'data/reference/postal-codes.v1.json';
export const QPV_PATH = 'data/reference/qpv-2024.v1.json';
const INSEE_PATH = 'data/geography/insee-2026.v1.json';
const RETRIEVED_AT = '2026-11-05';

export const POSTAL_SOURCE = {
  producer: 'La Poste',
  title: 'Base officielle des codes postaux',
  page: 'https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux',
  url: 'https://data.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw',
  licence: 'Licence Ouverte / Open Licence v2.0 (Etalab)',
  licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  publishedAt: '2026-10-08',
  retrievedAt: RETRIEVED_AT,
};
export const QPV_SOURCE = {
  producer: 'Agence nationale de la cohésion des territoires (ANCT)',
  title: 'Liste des quartiers prioritaires de la politique de la ville 2024 (géographie communale 2025)',
  page: 'https://www.data.gouv.fr/datasets/quartiers-prioritaires-de-la-politique-de-la-ville-qpv',
  url: 'https://static.data.gouv.fr/resources/quartiers-prioritaires-de-la-politique-de-la-ville-qpv/20260721-095036/listeqp2024-cog2025.csv',
  licence: 'Licence Ouverte / Open Licence v1.0 (Etalab)',
  licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  legalBasis: 'Décret n° 2023-1314 du 28 décembre 2023 (France hexagonale, en vigueur au 1er janvier 2024 ; corrections au JO du 14 juillet 2024) ; décret n° 2024-1212 du 27 décembre 2024 modifié (outre-mer, au 1er janvier 2025)',
  legalBasisUrl: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048707389',
  officialAddressLookup: 'https://sig.ville.gouv.fr',
  publishedAt: '2026-07-21',
  retrievedAt: RETRIEVED_AT,
};
// a reference read from an official file is re-checked at least every 90 days (P07 freshness); the page says when it was read
const REVIEW_DAYS = 90;

const sha256 = (/** @type {Buffer} */ buf) => crypto.createHash('sha256').update(buf).digest('hex');
const addDays = (/** @type {string} */ iso, /** @type {number} */ days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** « ; »-separated reader with quoted fields (doubled quotes), CRLF or LF. @param {string} text */
export function parseSemicolon(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** the current INSEE codes (communes and municipal arrondissements) with their official names */
function inseeIndex() {
  const ref = JSON.parse(fs.readFileSync(INSEE_PATH, 'utf8'));
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const [code, , nom] of ref.communes) names.set(code, nom);
  for (const [code, , nom] of ref.arrondissementsMunicipaux) names.set(code, nom);
  return { names, cogVersion: ref.cogVersion };
}

/** @param {string} postalFile @param {string} qpvFile */
export function buildReferences(postalFile, qpvFile) {
  const { names, cogVersion } = inseeIndex();
  const problems = [];

  // --- La Poste: ISO-8859-1, header « #Code_commune_INSEE;Nom_de_la_commune;Code_postal;Libellé_d_acheminement;Ligne_5 »
  const postalBuf = fs.readFileSync(postalFile);
  const postalRows = parseSemicolon(postalBuf.toString('latin1'));
  const head = postalRows[0].map((h) => h.replace(/^#/, ''));
  const iInsee = head.indexOf('Code_commune_INSEE'); const iCp = head.indexOf('Code_postal'); const iNom = head.indexOf('Nom_de_la_commune');
  if (iInsee < 0 || iCp < 0 || iNom < 0) throw new Error(`postal file: unexpected header ${head.join(';')}`);
  /** @type {Map<string, Set<string>>} */
  const byCp = new Map();
  /** @type {Map<string, [string, string, string]>} */
  const unmatched = new Map();
  let rows = 0;
  for (const r of postalRows.slice(1)) {
    const insee = (r[iInsee] || '').trim(); const cp = (r[iCp] || '').trim();
    if (!/^\d{5}$/.test(cp) || !/^[0-9][0-9AB][0-9]{3}$/.test(insee)) { problems.push(`postal row ${rows + 2}: malformed ${insee};${cp}`); continue; }
    rows++;
    if (!names.has(insee)) { unmatched.set(`${insee}|${cp}`, [insee, (r[iNom] || '').trim(), cp]); continue; }
    if (!byCp.has(cp)) byCp.set(cp, new Set());
    /** @type {Set<string>} */ (byCp.get(cp)).add(insee);
  }
  if (rows < 30000) problems.push(`postal file: only ${rows} rows (expected the national file)`);
  const postalCodes = Object.fromEntries([...byCp.keys()].sort().map((cp) => [cp, [.../** @type {Set<string>} */ (byCp.get(cp))].sort()]));

  // --- ANCT: UTF-8, « ; », header code_qp;lib_qp;insee_reg;lib_reg;insee_dep;lib_dep;insee_com;lib_com;siren_epci;lib_epci ; insee_com is written ="67043;67447"
  const qpvBuf = fs.readFileSync(qpvFile);
  const qpvRows = parseSemicolon(qpvBuf.toString('utf8').replace(/^﻿/, ''));
  const qh = qpvRows[0];
  const col = (/** @type {string} */ k) => { const i = qh.indexOf(k); if (i < 0) throw new Error(`QPV file: column ${k} missing`); return i; };
  const [cCode, cLib, cDep, cCom, cEpci] = ['code_qp', 'lib_qp', 'insee_dep', 'insee_com', 'siren_epci'].map(col);
  const qpv = [];
  const qpvUnmatched = [];
  for (const r of qpvRows.slice(1)) {
    const code = (r[cCode] || '').trim();
    if (!/^Q[NP][0-9A-Z]{5,6}$/.test(code)) { problems.push(`QPV row: malformed code ${code}`); continue; }
    const communes = (r[cCom] || '').replace(/^=/, '').replace(/"/g, '').split(';').map((x) => x.trim()).filter(Boolean);
    const kept = communes.filter((c) => names.has(c));
    for (const c of communes) if (!names.has(c)) qpvUnmatched.push([code, c]);
    qpv.push([code, (r[cLib] || '').trim(), (r[cDep] || '').trim().padStart(2, '0'), kept, (r[cEpci] || '').trim() || null]);
  }
  qpv.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (qpv.length < 1500) problems.push(`QPV file: only ${qpv.length} quartiers (expected the 2024 national list)`);
  if (problems.length) throw new Error(`refusing to write:\n${problems.slice(0, 20).join('\n')}`);

  const postal = {
    schema: 'accesdirectaide.postal-codes.v1',
    status: 'OFFICIAL_SOURCE_AS_PUBLISHED',
    note: 'Codes postaux de La Poste repris sans modification, rapprochés des codes Insee des communes au 1er janvier ' + cogVersion + '. Un code postal peut couvrir plusieurs communes : la personne choisit toujours sa commune.',
    source: { ...POSTAL_SOURCE, sha256: sha256(postalBuf) },
    freshness: { readAt: RETRIEVED_AT, reviewBefore: addDays(RETRIEVED_AT, REVIEW_DAYS) },
    matchedAgainst: { reference: INSEE_PATH, cogVersion },
    counts: { rows, postalCodes: Object.keys(postalCodes).length, unmatchedRows: unmatched.size },
    unmatched: [...unmatched.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2])),
    postalCodes,
  };
  const qpvRef = {
    schema: 'accesdirectaide.qpv.v1',
    status: 'OFFICIAL_SOURCE_AS_PUBLISHED',
    note: 'Liste officielle des quartiers prioritaires de la politique de la ville 2024 (ANCT), sans les périmètres : elle dit quelles communes comptent un quartier prioritaire, jamais si une adresse s\'y trouve.',
    source: { ...QPV_SOURCE, sha256: sha256(qpvBuf) },
    freshness: { readAt: RETRIEVED_AT, reviewBefore: addDays(RETRIEVED_AT, REVIEW_DAYS) },
    matchedAgainst: { reference: INSEE_PATH, cogVersion },
    columns: ['code', 'libelle', 'departement', 'communes', 'epci'],
    counts: { quartiers: qpv.length, unmatchedCommunes: qpvUnmatched.length },
    unmatched: qpvUnmatched,
    qpv,
  };
  return { postal, qpv: qpvRef };
}

const serialize = (/** @type {object} */ obj) => `${JSON.stringify(obj)}\n`;

if (isMainModule(import.meta.url)) {
  const [postalFile, qpvFile, flag] = process.argv.slice(2);
  if (!postalFile || !qpvFile) { console.error('usage: node scripts/postal-qpv-reference-build.mjs <hexasmal.csv> <listeqp2024.csv> [--check]'); process.exit(2); }
  const out = buildReferences(postalFile, qpvFile);
  if (flag === '--check') {
    const same = fs.readFileSync(POSTAL_PATH, 'utf8') === serialize(out.postal) && fs.readFileSync(QPV_PATH, 'utf8') === serialize(out.qpv);
    console.log(same ? 'postal/QPV references: identical to the inputs' : 'postal/QPV references: DIFFER from the inputs');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(POSTAL_PATH, serialize(out.postal));
  fs.writeFileSync(QPV_PATH, serialize(out.qpv));
  console.log(JSON.stringify({ postal: out.postal.counts, qpv: out.qpv.counts }));
}
