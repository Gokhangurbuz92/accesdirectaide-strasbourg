#!/usr/bin/env node
/**
 * PKG-11 / D12 · P07 — load the official territory reference into the database named by DATABASE_URL (operator step; no network, never deletes, idempotent).
 *   npx tsx scripts/geo-load.mjs [--departements=67,68]
 * Prints one line « GEO_LOAD_RESULT {json} » with the connector results; exits 1 unless every step is COMPLETE.
 */
import fs from 'node:fs';
import { loadTerritoryReference } from '../api/lib/geography/territoryReference.js';
import { REFERENCE_PATH } from './geo-reference-build.mjs';

const arg = process.argv.find((a) => a.startsWith('--departements='));
const departements = arg ? arg.slice('--departements='.length).split(',').map((d) => d.trim()).filter(Boolean) : null;
const { db } = await import('../src/db/index.js');
const schemas = await import('../src/db/schema.js');
const reference = JSON.parse(fs.readFileSync(REFERENCE_PATH, 'utf8'));
const started = Date.now();
const result = await loadTerritoryReference(reference, { db, schemas, departements });
console.log('GEO_LOAD_RESULT ' + JSON.stringify({
  ok: result.ok, seconds: (Date.now() - started) / 1000, expected: result.expected,
  cog: { state: result.cog.state, stats: result.cog.stats }, epci: result.epci && { state: result.epci.state, stats: result.epci.stats }, skippedEpcis: result.skippedEpcis.length,
}));
process.exit(result.ok ? 0 : 1);
