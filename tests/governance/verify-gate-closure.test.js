import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { strict as assert } from 'assert';
import { describe, it } from 'vitest';

function execGit(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

function runVerifier(dir, workHead, evidenceHead, receiptPath) {
  try {
    const res = execFileSync('node', [
      join(process.cwd(), 'scripts/verify-gate-closure.mjs'),
      '--work-head', workHead,
      '--evidence-head', evidenceHead,
      '--receipt', receiptPath
    ], { cwd: dir, encoding: 'utf-8' });
    return { ok: true, out: res };
  } catch (err) {
    return { ok: false, out: err.stderr || err.stdout || err.message };
  }
}

const receiptTemplate = `
WORK_HEAD: {WH}
NODE_VERSION: 22.23.2
CANONICAL_NODE_VERSION: 22.23.2
TARGETED_TEST_FILES: 1
TARGETED_TEST_PASSED: 1
TARGETED_TEST_FAILED: 0
TARGETED_TEST_SKIPPED: 0
UNIT_TEST_FILES: 1
UNIT_TEST_PASSED: 1
UNIT_TEST_FAILED: 0
UNIT_TEST_SKIPPED: 0
CI_TEST_FILES: 1
CI_TEST_PASSED: 1
CI_TEST_FAILED: 0
CI_TEST_SKIPPED: 0
LINT_RESULT: PASS
TYPECHECK_RESULT: PASS
BUILD_RESULT: PASS
NPM_AUDIT_CRITICAL: 0
NPM_AUDIT_HIGH: 0
NPM_AUDIT_MODERATE: 0
NPM_AUDIT_LOW: 0
GITLEAKS_FINDINGS: 0
ANALYZE_ID: 1
ANALYZE_HEAD: {WH}
ANALYZE_RESULT: PASS
ANALYZE_FILES_MUTATED: 0
ANALYZE_PRE_STATUS: CLEAN
ANALYZE_POST_STATUS: CLEAN
CONVERGE_ID: 1
CONVERGE_HEAD: {WH}
CONVERGE_RESULT: PASS
CONVERGE_FILES_MUTATED: 0
CONVERGE_PRE_STATUS: CLEAN
CONVERGE_POST_STATUS: CLEAN
ANALYZE_COMPLETED_AT: 2026-09-06T10:00:00Z
CONVERGE_STARTED_AT: 2026-09-06T10:01:00Z
CONVERGE_COMPLETED_AT: 2026-09-06T10:02:00Z
RUNNING_SUBAGENTS: 0
RUNNING_BACKGROUND_TASKS: 0
REMOTE_FREEZE: ACTIVE
`;

function createBaseRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'gov-test-'));
  execGit(repo, ['init']);
  execGit(repo, ['config', 'user.name', 'Test']);
  execGit(repo, ['config', 'user.email', 'test@test.com']);
  writeFileSync(join(repo, 'a.txt'), 'hello');
  execGit(repo, ['add', '.']);
  execGit(repo, ['commit', '-m', 'Init']);
  const wh = execGit(repo, ['rev-parse', 'HEAD']);
  return { repo, wh };
}

describe('Gate Closure Verification', () => {
  const rcPath = 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts/CLOSURE_GATE_2B3A_FINAL.md';

  function runTestCase(name, checkFn) {
    it(name, () => {
      checkFn();
    });
  }

  // 1. valid closure -> PASS
  runTestCase("1. valid closure", () => {
    const { repo, wh } = createBaseRepo();
    mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts'), { recursive: true });
    const content = receiptTemplate.replace(/{WH}/g, wh);
    writeFileSync(join(repo, rcPath), content);
    execGit(repo, ['add', rcPath]);
    execGit(repo, ['commit', '-m', 'Evidence']);
    const eh = execGit(repo, ['rev-parse', 'HEAD']);
    const res = runVerifier(repo, wh, eh, rcPath);
    assert(res.ok, "Valid closure should pass");
  });

  // 2. receipt already exists in WORK_HEAD -> FAIL
  runTestCase("2. receipt already exists in WORK_HEAD", () => {
    const { repo } = createBaseRepo();
    mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts'), { recursive: true });
    writeFileSync(join(repo, rcPath), receiptTemplate.replace(/{WH}/g, 'FAKE'));
    execGit(repo, ['add', rcPath]);
    execGit(repo, ['commit', '-m', 'Init']);
    const wh = execGit(repo, ['rev-parse', 'HEAD']);
    execGit(repo, ['commit', '--allow-empty', '-m', 'Evidence']);
    const eh = execGit(repo, ['rev-parse', 'HEAD']);
    const res = runVerifier(repo, wh, eh, rcPath);
    assert(!res.ok && (res.out.includes("Evidence diff contains") || res.out.includes("Evidence diff does not exactly add")));
  });

  // 3. two commits between WORK and EVIDENCE -> FAIL
  runTestCase("3. two commits between WORK and EVIDENCE", () => {
    const { repo, wh } = createBaseRepo();
    mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts'), { recursive: true });
    writeFileSync(join(repo, 'b.txt'), 'hello');
    execGit(repo, ['add', 'b.txt']);
    execGit(repo, ['commit', '-m', 'Intermediate']);
    writeFileSync(join(repo, rcPath), receiptTemplate.replace(/{WH}/g, wh));
    execGit(repo, ['add', rcPath]);
    execGit(repo, ['commit', '-m', 'Evidence']);
    const eh = execGit(repo, ['rev-parse', 'HEAD']);
    const res = runVerifier(repo, wh, eh, rcPath);
    assert(!res.ok && res.out.includes("not exactly one commit"));
  });

  // 4. extra evidence file -> FAIL
  runTestCase("4. extra evidence file", () => {
    const { repo, wh } = createBaseRepo();
    mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts'), { recursive: true });
    writeFileSync(join(repo, rcPath), receiptTemplate.replace(/{WH}/g, wh));
    writeFileSync(join(repo, 'c.txt'), 'extra');
    execGit(repo, ['add', rcPath, 'c.txt']);
    execGit(repo, ['commit', '-m', 'Evidence']);
    const eh = execGit(repo, ['rev-parse', 'HEAD']);
    const res = runVerifier(repo, wh, eh, rcPath);
    assert(!res.ok && res.out.includes("more than one change"));
  });

  // 5. receipt outside canonical receipts directory -> FAIL
  runTestCase("5. receipt outside canonical receipts directory", () => {
    const { repo, wh } = createBaseRepo();
    const badPath = 'specs/005-commercial-intelligence-foundation/gate2b/CLOSURE_GATE_2B3A.md';
    mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/gate2b'), { recursive: true });
    writeFileSync(join(repo, badPath), receiptTemplate.replace(/{WH}/g, wh));
    execGit(repo, ['add', badPath]);
    execGit(repo, ['commit', '-m', 'Evidence']);
    const eh = execGit(repo, ['rev-parse', 'HEAD']);
    const res = runVerifier(repo, wh, eh, badPath);
    assert(!res.ok && res.out.includes("outside canonical directory"));
  });

  // Helper for mutation tests
  const runMutationTest = (name, mutationFn, expectedError) => {
    runTestCase(name, () => {
      const { repo, wh } = createBaseRepo();
      mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts'), { recursive: true });
      const content = mutationFn(receiptTemplate.replace(/{WH}/g, wh), wh);
      writeFileSync(join(repo, rcPath), content);
      execGit(repo, ['add', rcPath]);
      execGit(repo, ['commit', '-m', 'Evidence']);
      const eh = execGit(repo, ['rev-parse', 'HEAD']);
      const res = runVerifier(repo, wh, eh, rcPath);
      assert(!res.ok && (expectedError ? res.out.includes(expectedError) : true), `Expected ${expectedError}, got ${res.out}`);
    });
  };

  // 6-22 Mutation tests
  runMutationTest("6. ANALYZE_HEAD != WORK_HEAD", t => t.replace(/ANALYZE_HEAD: .*/, "ANALYZE_HEAD: FAKE"), "ANALYZE_HEAD does not match WORK_HEAD");
  runMutationTest("7. CONVERGE_HEAD != WORK_HEAD", t => t.replace(/CONVERGE_HEAD: .*/, "CONVERGE_HEAD: FAKE"), "CONVERGE_HEAD does not match WORK_HEAD");
  runMutationTest("8. ANALYZE_FILES_MUTATED != 0", t => t.replace(/ANALYZE_FILES_MUTATED: 0/, "ANALYZE_FILES_MUTATED: 1"), "ANALYZE_FILES_MUTATED != 0");
  runMutationTest("9. CONVERGE_FILES_MUTATED != 0", t => t.replace(/CONVERGE_FILES_MUTATED: 0/, "CONVERGE_FILES_MUTATED: 1"), "CONVERGE_FILES_MUTATED != 0");
  runMutationTest("10. Converge starts before/equal Analyze", t => t.replace(/CONVERGE_STARTED_AT: .*/, "CONVERGE_STARTED_AT: 2026-09-06T09:00:00Z"), "CONVERGE_STARTED_AT is not greater than ANALYZE_COMPLETED_AT");
  runMutationTest("11. mandatory placeholder", t => t + "nTODO: fix this", "contains placeholder: TODO");
  runMutationTest("12. ANALYZE_RESULT = FAIL", t => t.replace(/ANALYZE_RESULT: PASS/, "ANALYZE_RESULT: FAIL"), "ANALYZE_RESULT != PASS");
  runMutationTest("13. CONVERGE_RESULT = FAIL", t => t.replace(/CONVERGE_RESULT: PASS/, "CONVERGE_RESULT: FAIL"), "CONVERGE_RESULT != PASS");
  runMutationTest("14. TARGETED_TEST_FAILED > 0", t => t.replace(/TARGETED_TEST_FAILED: 0/, "TARGETED_TEST_FAILED: 1"), "TARGETED_TEST_FAILED != 0");
  runMutationTest("15. UNIT_TEST_FAILED > 0", t => t.replace(/UNIT_TEST_FAILED: 0/, "UNIT_TEST_FAILED: 1"), "UNIT_TEST_FAILED != 0");
  runMutationTest("16. CI_TEST_FAILED > 0", t => t.replace(/CI_TEST_FAILED: 0/, "CI_TEST_FAILED: 1"), "CI_TEST_FAILED != 0");
  runMutationTest("17. LINT_RESULT = FAIL", t => t.replace(/LINT_RESULT: PASS/, "LINT_RESULT: FAIL"), "LINT_RESULT != PASS");
  runMutationTest("18. TYPECHECK_RESULT = FAIL", t => t.replace(/TYPECHECK_RESULT: PASS/, "TYPECHECK_RESULT: FAIL"), "TYPECHECK_RESULT != PASS");
  runMutationTest("19. BUILD_RESULT = FAIL", t => t.replace(/BUILD_RESULT: PASS/, "BUILD_RESULT: FAIL"), "BUILD_RESULT != PASS");
  runMutationTest("20. npm audit severity > 0", t => t.replace(/NPM_AUDIT_HIGH: 0/, "NPM_AUDIT_HIGH: 1"), "NPM_AUDIT_HIGH != 0");
  runMutationTest("21. GITLEAKS_FINDINGS > 0", t => t.replace(/GITLEAKS_FINDINGS: 0/, "GITLEAKS_FINDINGS: 1"), "GITLEAKS_FINDINGS != 0");
  runMutationTest("22. NODE_VERSION != CANONICAL_NODE_VERSION", t => t.replace(/NODE_VERSION: 22.23.2/, "NODE_VERSION: 18.0.0"), "NODE_VERSION != CANONICAL_NODE_VERSION");

  // 23. current HEAD != EVIDENCE_HEAD -> FAIL
  runTestCase("23. current HEAD != EVIDENCE_HEAD", () => {
    const { repo, wh } = createBaseRepo();
    mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts'), { recursive: true });
    writeFileSync(join(repo, rcPath), receiptTemplate.replace(/{WH}/g, wh));
    execGit(repo, ['add', rcPath]);
    execGit(repo, ['commit', '-m', 'Evidence']);
    const eh = execGit(repo, ['rev-parse', 'HEAD']);
    // make it different
    writeFileSync(join(repo, 'a.txt'), 'changed');
    execGit(repo, ['commit', '-am', 'After evidence']);
    const res = runVerifier(repo, wh, eh, rcPath);
    assert(!res.ok && res.out.includes("Current HEAD does not match"));
  });

  // 24. dirty working tree -> FAIL
  runTestCase("24. dirty working tree", () => {
    const { repo, wh } = createBaseRepo();
    mkdirSync(join(repo, 'specs/005-commercial-intelligence-foundation/walkthroughs/receipts'), { recursive: true });
    writeFileSync(join(repo, rcPath), receiptTemplate.replace(/{WH}/g, wh));
    execGit(repo, ['add', rcPath]);
    execGit(repo, ['commit', '-m', 'Evidence']);
    const eh = execGit(repo, ['rev-parse', 'HEAD']);
    writeFileSync(join(repo, 'a.txt'), 'dirty');
    const res = runVerifier(repo, wh, eh, rcPath);
    assert(!res.ok && res.out.includes("WORKING_TREE_NOT_CLEAN"));
  });
});
