import { execFileSync } from 'child_process';
import fs from 'fs';

let failed = false;
let failedCmd = null;

function runSync(cmd, args) {
    console.log(`\n--- RUNNING: ${cmd} ${args.join(' ')} ---`);
    try {
        execFileSync(cmd, args, { stdio: 'inherit' });
        return true;
    } catch (e) {
        console.error(`FAILED: ${cmd} ${args.join(' ')}`);
        failed = true;
        if (!failedCmd) failedCmd = `${cmd} ${args.join(' ')}`;
        return false;
    }
}

const nvmrc = fs.readFileSync('.nvmrc', 'utf8').trim();
const nodeVersion = process.version;
if (!nodeVersion.replace('v', '').startsWith(nvmrc.replace('v', ''))) {
    console.error(`Node version mismatch. Expected ${nvmrc}, got ${nodeVersion}`);
    failed = true;
    failedCmd = 'node_version_check';
}

if (!failed) {
    runSync('node', ['tests/governance/verify-gate-closure.test.js']);
}

if (!failed) {
    const targetedFiles = [
        ...execFileSync('git', ['ls-files', '*gate2b3a*.test.js'], { encoding: 'utf8' }).trim().split('\n'),
        ...execFileSync('git', ['ls-files', '*phase8-embedding-strict.test.js'], { encoding: 'utf8' }).trim().split('\n')
    ].filter(Boolean);
    runSync('npx', ['vitest', 'run', ...targetedFiles]);
}

if (!failed) runSync('npm', ['run', 'test:unit']);
if (!failed) runSync('npm', ['run', 'test:ci']);
if (!failed) runSync('npm', ['run', 'lint']);
if (!failed) runSync('npm', ['run', 'typecheck']);
if (!failed) runSync('npm', ['run', 'build']);
if (!failed) runSync('npm', ['audit', '--omit=dev']);

let baselineCount = 0;
let newHistoryFindingsCount = 0;

if (!failed) {
    console.log(`\n--- RUNNING: gitleaks detect --source . --no-git ---`);
    try {
        execFileSync('gitleaks', ['detect', '--source', '.', '--no-git'], { stdio: 'inherit' });
    } catch (e) {
        console.error(`FAILED: gitleaks detect --source . --no-git`);
        failed = true;
        if (!failedCmd) failedCmd = `gitleaks_current_tree`;
    }
}

if (!failed) {
    console.log(`\n--- RUNNING: gitleaks detect --source . (history) ---`);
    try {
        execFileSync('gitleaks', ['detect', '--source', '.', '--report-format', 'json', '--report-path', '/tmp/live-gitleaks-history.json']);
    } catch(e) {
    }
    const baselineMd = fs.readFileSync('specs/005-commercial-intelligence-foundation/gate2b/GATE2B3A_GITLEAKS_HISTORY_BASELINE.md', 'utf8');
    const knownFingerprints = new Set([...baselineMd.matchAll(/^\| ([^ |]+) \|/gm)].map(m => m[1]));
    baselineCount = knownFingerprints.size;
    let historyData = [];
    try {
        historyData = JSON.parse(fs.readFileSync('/tmp/live-gitleaks-history.json', 'utf8'));
    } catch(e) {}
    
    let newFindings = 0;
    for (const f of historyData) {
        if (!knownFingerprints.has(f.Fingerprint)) {
            console.error('NEW HISTORY LEAK:', f.Fingerprint, f.File, f.Commit);
            newFindings++;
        }
    }
    newHistoryFindingsCount = newFindings;
    if (newFindings > 0) {
        console.error(`FAILED: ${newFindings} new historical findings vs baseline`);
        failed = true;
        if (!failedCmd) failedCmd = `gitleaks_history`;
    }
}

console.log('\n=============');
if (failed) {
    console.log('LIVE_GATE_VERIFICATION: FAIL');
    console.log(`FAILED_COMMAND: ${failedCmd}`);
    process.exit(1);
} else {
    console.log('LIVE_GATE_VERIFICATION: PASS');
    console.log('NODE: ' + nodeVersion);
    console.log('GOVERNANCE_TESTS: PASS');
    console.log('TARGETED_TESTS: PASS');
    console.log('UNIT: PASS');
    console.log('CI: PASS');
    console.log('LINT: PASS');
    console.log('TYPECHECK: PASS');
    console.log('BUILD: PASS');
    console.log('NPM_AUDIT: PASS');
    console.log('CURRENT_TREE_GITLEAKS_FINDINGS: 0');
    console.log(`HISTORICAL_BASELINE_FINDINGS: ${baselineCount}`);
    console.log(`NEW_HISTORY_FINDINGS: ${newHistoryFindingsCount}`);
}
