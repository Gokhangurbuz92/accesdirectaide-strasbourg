// DTA S6 — ONE record-level WS2 closure register (49 records): per record, the technical findings (scripts/ws2-findings.mjs), what has been corrected technically (nothing: the launch data files are
// NOT modified by this module), what still needs official/human verification, the safe next action and the launch impact.  Read-only, offline.  It never changes launchReady and never
// treats a CSV self-declared flag as verification.  Nominative e-mail values are never reproduced.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './verify-ws2-data.mjs';
import { collectWs2Findings, spRef } from './ws2-findings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = { aides: 'data/aides-alsace.csv', demarches: 'data/demarches-alsace.csv', structures: 'data/structures-alsace.csv' };

const NEXT_ACTION = {
  FLAG_NOT_VERIFIED_CURRENT: 'A human validator checks the record against its official source; only then may the flag be set to true by that validator (never by script).',
  FLAG_NOT_LAUNCH_ELIGIBLE: 'Decision of the data owner after verification; the flag is not set here.',
  REQUIRED_FIELD_EMPTY: 'Editorial team writes the missing field from the official source (FALC review), or the record stays out of the launch set.',
  PROVENANCE_EMPTY: 'Add the official source reference and observation date; unknown provenance is never inferred.',
  NO_SERVICE_PUBLIC_SOURCE: 'Identify the competent official source (local authority / organism) and record URL + observation date; Service-Public has no matching record.',
  SOURCE_ABSENT_FROM_SNAPSHOT: 'Refresh the Service-Public snapshot read-only and re-run the comparison.',
  SOURCE_HASH_MISMATCH: 'The official text changed or the record is stale: human re-validation required.',
  POSSIBLE_DUPLICATE: 'A human confirms whether the records are the same establishment/service (different services at one address are legitimate); nothing is merged automatically.',
  TERRITORY_NATIONAL_REGIME_NARROWED: 'A human confirms the territorial scope with the official source: a nationally regulated benefit must not carry a local restriction. The territory is not corrected by script.',
  TERRITORY_DEPARTMENTS_OUTSIDE_SCOPE: 'A human confirms the exact list of départements covered by the scheme and corrects the data owner\'s record; the list is not rewritten by script.',
  NOMINATIVE_EMAIL: 'Privacy review: confirm the address is a functional/public contact or replace it with the organisation\'s generic contact (value deliberately not reproduced).',
};
const ALWAYS_HUMAN = {
  aides: ['official source verification of eligibility conditions and amounts', 'territorial applicability (national / Grand Est / CeA / Bas-Rhin / Eurométropole / Strasbourg)', 'FALC editorial review'],
  demarches: ['official source verification of steps, costs and delays', 'territorial applicability', 'FALC editorial review'],
  structures: ['verification of address, contact and opening hours with the structure or its official page', 'verified service area and audience (no such column exists in the data)', 'FALC editorial review'],
};

export async function buildRegister({ rootDir = ROOT } = {}) {
  const root = path.resolve(rootDir);
  const base = await collectWs2Findings({ rootDir: root });
  const records = [];
  for (const [dataset, file] of Object.entries(FILES)) {
    const rows = parseCsv(await readFile(path.join(root, file), 'utf8'));
    for (const r of rows) {
      const slug = String(r.slug ?? '').trim() || '(sans slug)';
      const findings = base.findings.filter((f) => f.dataset === dataset && f.slug === slug);
      const blocking = findings.some((f) => f.severity === 'BLOCKING');
      const ref = dataset === 'structures' ? { id: null, sha: null } : spRef(r.provenance);
      records.push({
        id: `${dataset}/${slug}`, dataset, slug, label: String(r.titre ?? r.nom ?? '').trim(),
        declaredTerritory: String(r.departements ?? r.departement ?? '').trim() || null,
        evidence: { selfDeclared: { verifiedCurrent: String(r.verifiedCurrent ?? ''), launchEligible: String(r.launchEligible ?? '') }, servicePublicId: ref.id, servicePublicHashRecorded: Boolean(ref.sha), note: 'self-declared flags are NOT verification' },
        defects: findings.map((f) => ({ code: f.code, severity: f.severity, detail: f.detail })),
        technicalCorrectionMade: null,
        humanVerificationRequired: [...ALWAYS_HUMAN[dataset], ...[...new Set(findings.map((f) => NEXT_ACTION[f.code]).filter(Boolean))]],
        launchImpact: blocking ? 'BLOCKING: record cannot enter the launch set as it is' : 'NOT_LAUNCH_READY: no technical blocker found, but official/human verification is still required (manifest launchReady stays false)',
      });
    }
  }
  const count = (fn) => records.filter(fn).length;
  return {
    generatedBy: 'scripts/ws2-closure-register.mjs (read-only; data files untouched)',
    launchReady: base.launchReady,
    summary: { records: records.length, withBlocking: count((x) => x.launchImpact.startsWith('BLOCKING')), withoutTechnicalBlocker: count((x) => !x.launchImpact.startsWith('BLOCKING')), findingsBySeverity: base.summary.bySeverity, byDataset: Object.fromEntries(Object.keys(FILES).map((k) => [k, count((x) => x.dataset === k)])) },
    records,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRegister().then((r) => { process.stdout.write(`${JSON.stringify(r, null, 1)}\n`); }).catch((e) => { process.stderr.write(`${e?.message || e}\n`); process.exitCode = 1; });
}
