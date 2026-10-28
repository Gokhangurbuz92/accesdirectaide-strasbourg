import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
let workHead, evidenceHead, receiptPath;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--work-head') workHead = args[++i];
  if (args[i] === '--evidence-head') evidenceHead = args[++i];
  if (args[i] === '--receipt') receiptPath = args[++i];
}

if (!workHead || !evidenceHead || !receiptPath) {
  console.error("Missing arguments");
  process.exit(1);
}

function execGit(argsList) {
  try {
    return execFileSync('git', argsList, { encoding: 'utf-8' }).trim();
  } catch (e) {
    return null;
  }
}

// 8. Canonical Receipt Directory
if (!/^specs\/005-commercial-intelligence-foundation\/walkthroughs\/receipts\/CLOSURE_GATE_.*\.md$/.test(receiptPath)) {
  console.error("Receipt path outside canonical directory or invalid name");
  process.exit(1);
}

// 9. Verify Current HEAD
const currentHead = execGit(['rev-parse', 'HEAD']);
if (currentHead !== evidenceHead) {
  console.error("Current HEAD does not match EVIDENCE_HEAD");
  process.exit(1);
}

// Ensure both heads exist
const wh = execGit(['rev-parse', '--verify', `${workHead}^{commit}`]);
const eh = execGit(['rev-parse', '--verify', `${evidenceHead}^{commit}`]);
if (!wh || !eh) {
  console.error("HEADs do not exist");
  process.exit(1);
}

// 10. Verify Exactly One Evidence Commit
const commitCount = execGit(['rev-list', '--count', `${workHead}..${evidenceHead}`]);
if (commitCount !== '1') {
  console.error("There is not exactly one commit between WORK_HEAD and EVIDENCE_HEAD");
  process.exit(1);
}

// 11. Verify Direct Parent
const evidenceParent = execGit(['rev-parse', `${evidenceHead}^`]);
if (evidenceParent !== workHead) {
  console.error("EVIDENCE_HEAD direct parent is not WORK_HEAD");
  process.exit(1);
}

// 12. Verify Evidence Diff
const nameStatus = execGit(['diff', '--name-status', `${workHead}..${evidenceHead}`]);
const diffLines = nameStatus.split('\n').map(line => line.trim()).filter(Boolean);
if (diffLines.length !== 1) {
  console.error("Evidence diff contains more than one change");
  process.exit(1);
}
const [statusLetter, ...fileParts] = diffLines[0].split(/\s+/);
const diffFile = fileParts.join(' ');
if (statusLetter !== 'A' || diffFile !== receiptPath) {
  console.error("Evidence diff does not exactly add the receipt");
  process.exit(1);
}

// 7. Harden Machine Closure Verifier - use git show for receipt
const receiptContent = execGit(['show', `${evidenceHead}:${receiptPath}`]);
if (!receiptContent) {
  console.error("Could not read receipt content from EVIDENCE_HEAD via git show");
  process.exit(1);
}

// 13. Verifier Required Receipt Fields
const requiredFields = [
  'WORK_HEAD', 'NODE_VERSION', 'CANONICAL_NODE_VERSION',
  'TARGETED_TEST_FILES', 'TARGETED_TEST_PASSED', 'TARGETED_TEST_FAILED', 'TARGETED_TEST_SKIPPED',
  'UNIT_TEST_FILES', 'UNIT_TEST_PASSED', 'UNIT_TEST_FAILED', 'UNIT_TEST_SKIPPED',
  'CI_TEST_FILES', 'CI_TEST_PASSED', 'CI_TEST_FAILED', 'CI_TEST_SKIPPED',
  'LINT_RESULT', 'TYPECHECK_RESULT', 'BUILD_RESULT',
  'NPM_AUDIT_CRITICAL', 'NPM_AUDIT_HIGH', 'NPM_AUDIT_MODERATE', 'NPM_AUDIT_LOW',
  'GITLEAKS_FINDINGS',
  'ANALYZE_ID', 'ANALYZE_HEAD', 'ANALYZE_RESULT', 'ANALYZE_FILES_MUTATED', 'ANALYZE_PRE_STATUS', 'ANALYZE_POST_STATUS',
  'CONVERGE_ID', 'CONVERGE_HEAD', 'CONVERGE_RESULT', 'CONVERGE_FILES_MUTATED', 'CONVERGE_PRE_STATUS', 'CONVERGE_POST_STATUS',
  'ANALYZE_COMPLETED_AT', 'CONVERGE_STARTED_AT', 'CONVERGE_COMPLETED_AT',
  'RUNNING_SUBAGENTS', 'RUNNING_BACKGROUND_TASKS', 'REMOTE_FREEZE'
];

const parsed = {};
const lines = receiptContent.split('\n');
for (const line of lines) {
  const match = line.match(/^([A-Z_0-9]+):\s*(.*)$/);
  if (match) {
    parsed[match[1]] = match[2].trim();
  }
}

for (const field of requiredFields) {
  if (parsed[field] === undefined) {
    console.error(`Missing required field: ${field}`);
    process.exit(1);
  }
}

// No placeholders
const placeholders = ['TBD', 'TODO', 'Previously Committed', 'This receipt', 'pending', 'unknown SHA', '<...>'];
for (const ph of placeholders) {
  if (receiptContent.includes(ph)) {
    console.error(`Receipt contains placeholder: ${ph}`);
    process.exit(1);
  }
}

// Sequential Timestamp Check
const analyzeTime = Date.parse(parsed['ANALYZE_COMPLETED_AT']);
const convergeTime = Date.parse(parsed['CONVERGE_STARTED_AT']);
if (isNaN(analyzeTime) || isNaN(convergeTime) || convergeTime <= analyzeTime) {
  console.error("CONVERGE_STARTED_AT is not greater than ANALYZE_COMPLETED_AT");
  process.exit(1);
}

// Strict field enforcement
if (parsed['WORK_HEAD'] !== workHead) {
  console.error("WORK_HEAD does not match expected");
  process.exit(1);
}
if (parsed['NODE_VERSION'] !== parsed['CANONICAL_NODE_VERSION']) {
  console.error("NODE_VERSION != CANONICAL_NODE_VERSION");
  process.exit(1);
}
if (parsed['ANALYZE_HEAD'] !== workHead) {
  console.error("ANALYZE_HEAD does not match WORK_HEAD");
  process.exit(1);
}
if (parsed['CONVERGE_HEAD'] !== workHead) {
  console.error("CONVERGE_HEAD does not match WORK_HEAD");
  process.exit(1);
}
if (parsed['ANALYZE_RESULT'] !== 'PASS') {
  console.error("ANALYZE_RESULT != PASS");
  process.exit(1);
}
if (parsed['CONVERGE_RESULT'] !== 'PASS') {
  console.error("CONVERGE_RESULT != PASS");
  process.exit(1);
}
if (parsed['LINT_RESULT'] !== 'PASS') {
  console.error("LINT_RESULT != PASS");
  process.exit(1);
}
if (parsed['TYPECHECK_RESULT'] !== 'PASS') {
  console.error("TYPECHECK_RESULT != PASS");
  process.exit(1);
}
if (parsed['BUILD_RESULT'] !== 'PASS') {
  console.error("BUILD_RESULT != PASS");
  process.exit(1);
}
if (parsed['ANALYZE_FILES_MUTATED'] !== '0') {
  console.error("ANALYZE_FILES_MUTATED != 0");
  process.exit(1);
}
if (parsed['CONVERGE_FILES_MUTATED'] !== '0') {
  console.error("CONVERGE_FILES_MUTATED != 0");
  process.exit(1);
}
if (parsed['ANALYZE_PRE_STATUS'] !== 'CLEAN') {
  console.error("ANALYZE_PRE_STATUS != CLEAN");
  process.exit(1);
}
if (parsed['ANALYZE_POST_STATUS'] !== 'CLEAN') {
  console.error("ANALYZE_POST_STATUS != CLEAN");
  process.exit(1);
}
if (parsed['CONVERGE_PRE_STATUS'] !== 'CLEAN') {
  console.error("CONVERGE_PRE_STATUS != CLEAN");
  process.exit(1);
}
if (parsed['CONVERGE_POST_STATUS'] !== 'CLEAN') {
  console.error("CONVERGE_POST_STATUS != CLEAN");
  process.exit(1);
}
if (parsed['TARGETED_TEST_FAILED'] !== '0') {
  console.error("TARGETED_TEST_FAILED != 0");
  process.exit(1);
}
if (parsed['UNIT_TEST_FAILED'] !== '0') {
  console.error("UNIT_TEST_FAILED != 0");
  process.exit(1);
}
if (parsed['CI_TEST_FAILED'] !== '0') {
  console.error("CI_TEST_FAILED != 0");
  process.exit(1);
}
if (parsed['NPM_AUDIT_CRITICAL'] !== '0') {
  console.error("NPM_AUDIT_CRITICAL != 0");
  process.exit(1);
}
if (parsed['NPM_AUDIT_HIGH'] !== '0') {
  console.error("NPM_AUDIT_HIGH != 0");
  process.exit(1);
}
if (parsed['NPM_AUDIT_MODERATE'] !== '0') {
  console.error("NPM_AUDIT_MODERATE != 0");
  process.exit(1);
}
if (parsed['NPM_AUDIT_LOW'] !== '0') {
  console.error("NPM_AUDIT_LOW != 0");
  process.exit(1);
}
if (parsed['GITLEAKS_FINDINGS'] !== '0') {
  console.error("GITLEAKS_FINDINGS != 0");
  process.exit(1);
}
if (parsed['RUNNING_SUBAGENTS'] !== '0') {
  console.error("RUNNING_SUBAGENTS != 0");
  process.exit(1);
}
if (parsed['RUNNING_BACKGROUND_TASKS'] !== '0') {
  console.error("RUNNING_BACKGROUND_TASKS != 0");
  process.exit(1);
}
if (parsed['REMOTE_FREEZE'] !== 'ACTIVE') {
  console.error("REMOTE_FREEZE != ACTIVE");
  process.exit(1);
}

// Final working tree check
const stat = execGit(['status', '--porcelain']);
if (stat && stat.length > 0) {
  console.error("FAIL: WORKING_TREE_NOT_CLEAN");
  process.exit(1);
}

console.log("PASS");
