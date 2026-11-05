#!/usr/bin/env node
/**
 * R46 (D10) — verification of an OpenFisca engine as AccesDirectAide uses it (LAB; synthetic situations only, nothing of a person).
 *   OPENFISCA_URL=http://127.0.0.1:5011 OPENFISCA_FRANCE_VERSION=176.1.6 node scripts/openfisca-verify.mjs [--out report.json]
 *   (or scripts/openfisca-local.sh verify)
 * Steps: 1. the engine's own health (reachable, country package, the version it states vs the pinned one — api/lib/openfiscaEngine.js);
 *        2. for each synthetic situation: buildTestCase → POST /calculate → parseResults → qualifyEstimates (the same chain as POST /api/diagnostic);
 *        3. the output contract: never authoritative, every item one of the three qualified statuses, no amount without the inputs it needs, amounts in
 *           10 € steps, no raw engine value or « eligible » flag, every item states whether its rule passed the D11 expert gate (none does today).
 * Exit 0 only when every check holds. The public api.fr.openfisca.org endpoint is refused by the client module unless explicitly allowed (never in production).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITUATIONS = Object.freeze([
  { id: 'single-tenant-salaried', answers: { birthDate: '1990-04-12', statut: 'salarié', householdSize: 1, income: { salary: 1100 }, housing: { status: 'tenant', rent: 520, charges: 40 }, depcom: '67482' } },
  { id: 'single-jobseeker-no-commune', answers: { birthDate: '1992-03-10', statut: 'sans_emploi', income: { salary: 0, unemployment: 700 }, housing: { status: 'tenant', rent: 480 } } },
  { id: 'couple-two-children', answers: { birthDate: '1985-01-01', statut: 'indépendant', situation_familiale: 'couple', nombre_enfants: 2, income: { salary: 1600 }, housing: { status: 'tenant_furnished', rent: 850 } } },
  { id: 'retired-owner', answers: { birthDate: '1948-01-20', statut: 'retraité', income: {}, housing: { status: 'owner' } } },
]);
/** the report follows this line on stdout (the application logger may write before it) */
export const REPORT_MARK = '--- openfisca-verify report ---';
const STATUSES = new Set(['INSUFFICIENT_INFORMATION', 'INDICATIVE_ESTIMATE', 'NOT_INDICATED_UNDER_ASSUMPTIONS']);
const RULE = new Set(['EXPERT_VALIDATED', 'NOT_EXPERT_VALIDATED', 'NOT_IN_REGISTER']);

/** @returns {string[]} the contract violations of one qualified estimate (empty = conforms) */
export function contractViolations(estimates) {
  const v = [];
  if (estimates?.contract !== 'ADA_OPENFISCA_ESTIMATE_V1') v.push('contract');
  if (estimates?.authoritative !== false) v.push('authoritative');
  if (!Array.isArray(estimates?.assumptions) || !estimates.assumptions.length) v.push('assumptions');
  if (!estimates?.d11Gate || !Array.isArray(estimates.d11Gate.validatedRules)) v.push('d11Gate');
  for (const i of estimates?.items || []) {
    const at = `item ${i.code}`;
    if (!STATUSES.has(i.status)) v.push(`${at}: status`);
    if (!RULE.has(i.ruleValidation)) v.push(`${at}: ruleValidation`);
    if ('eligible' in i || 'amount' in i || 'value' in i) v.push(`${at}: raw engine value`);
    if (i.status === 'INDICATIVE_ESTIMATE' && !(Number.isInteger(i.monthlyOrderOfMagnitude) && i.monthlyOrderOfMagnitude > 0 && i.monthlyOrderOfMagnitude % 10 === 0)) v.push(`${at}: order of magnitude`);
    if (i.status !== 'INDICATIVE_ESTIMATE' && i.monthlyOrderOfMagnitude !== null) v.push(`${at}: amount without inputs`);
    if (i.status === 'INSUFFICIENT_INFORMATION' && !(i.missing || []).length) v.push(`${at}: missing inputs not named`);
  }
  return v;
}

export async function verify({ situations = SITUATIONS, validatedRules = [] } = {}) {
  const { engineHealth } = await import('../api/lib/openfiscaEngine.js');
  const { buildTestCase, parseResults, getCurrentPeriod } = await import('../api/lib/openfiscaMapping.js');
  const { qualifyEstimates } = await import('../api/lib/openfiscaEstimate.js');
  const health = await engineHealth();
  const report = { schema: 'ada.openfisca-verify.v1', at: new Date().toISOString(), health, situations: [], pass: false };
  if (!health.ok) return report;
  const client = await import('../api/lib/openfiscaClient.js');
  const period = getCurrentPeriod();
  for (const s of situations) {
    const row = { id: s.id, ok: false };
    try {
      const rights = parseResults(await client.calculate(buildTestCase(s.answers, period)), period);
      const estimates = qualifyEstimates(rights, s.answers, { period, engineVersion: health.version, validatedRules });
      row.violations = contractViolations(estimates);
      row.statuses = Object.fromEntries(estimates.items.map((i) => [i.code, i.status]));
      row.ok = row.violations.length === 0 && estimates.items.length > 0;
    } catch (e) { row.error = e?.code || 'ERROR'; }
    report.situations.push(row);
  }
  report.pass = report.situations.every((r) => r.ok);
  return report;
}

async function main() {
  const report = await verify();
  const i = process.argv.indexOf('--out'); if (i > 0 && process.argv[i + 1]) fs.writeFileSync(path.resolve(process.argv[i + 1]), `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`${REPORT_MARK}\n${JSON.stringify({ health: report.health, situations: report.situations.map(({ id, ok, error, violations }) => ({ id, ok, error, violations })), pass: report.pass }, null, 1)}\n`);
  process.exitCode = report.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('openfisca-verify: ERROR\n'); process.exitCode = 1; });
