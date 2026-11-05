import 'dotenv/config';

/**
 * R45 / ENG-LR-9 — this operator script used to run its OWN purge: DELETE from AuditLog / SyncRun / CronRun and an UPDATE that masked CitizenUser rows
 * whose `updatedAt` was old — outside every safeguard of the policy-driven purge (no approved policy, no per-step approval, no legal hold, no restriction,
 * no open-request check, no evidence row, and an ACTIVE account could be anonymised: `updatedAt` is not activity). It now delegates to the one purge
 * engine, api/_handlers/cron/gdpr-purge.js runGdprPurge, with its execution gate unchanged (GDPR_PURGE_ENABLED + approved policy version with the A7
 * choice + GDPR_PURGE_POLICY_VERSION + GDPR_PURGE_APPROVED_STEPS + each step's approval in the policy). Without all of them it is a dry run: counts only.
 * The RETENTION_AUDIT_MONTHS / RETENTION_SYNC_MONTHS / RETENTION_USER_YEARS variables are no longer read.
 *
 *   DATABASE_URL=… node --import tsx scripts/cron-purge.js [--dry-run]
 */
async function main() {
  const { runGdprPurge } = await import('../api/_handlers/cron/gdpr-purge.js');
  const { status, body } = await runGdprPurge({ dryRunRequested: process.argv.includes('--dry-run') });
  const steps = (body.steps || []).map((l) => ({ id: l.id, decision: l.decision, count: l.count, ...(l.countsByOption ? { countsByOption: l.countsByOption } : {}) }));
  console.log(JSON.stringify({ status, mode: body.mode, reason: body.reason ?? null, policy: body.policy?.version, steps }));
  process.exit(status === 200 ? 0 : 1);
}

main().catch(() => { console.error('cron-purge : erreur inattendue (aucune donnée affichée).'); process.exit(1); });
