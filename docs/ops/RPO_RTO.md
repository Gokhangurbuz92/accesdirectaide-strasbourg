# Recovery objectives (RPO / RTO) — owner decision D7, 17/11/2026

Owner decision (Paket 5, D7 « EVET », 17/11/2026): **RPO 24 hours**, **RTO 1 business day**, **one Neon restore drill a year**. The owner's text adds:
these are **objectives, not guarantees**, and they are validated **with evidence**. Nothing on this page has been measured on Production unless it says so.

| Objective | Value | Meaning |
|---|---|---|
| RPO (recovery point) | 24 h | at most one day of data may be lost after a disaster that destroys the Production database |
| RTO (recovery time) | 1 business day | the service is back (on a restored database, erasures replayed) within one business day of the decision to restore |
| Drill | once a year | a real restore with Neon's own restore feature, timed and recorded (§ 4) |

## 1. How the RPO is met

Two independent recovery points exist:

1. **Neon's own history** (restore to a point in time / branch). Free plan: **6 hours** of history (stated in the privacy notice, source
   https://neon.com/docs/introduction/plans as read for legal v5). It covers incidents noticed within 6 hours (bad migration, wrong mass update) with a
   loss of minutes. It does **not** cover a lost Neon project or an incident noticed later.
2. **K3 independent backups** (`ops/cloud-backup/README.md`): a Scaleway Serverless Job dumps Production **twice a day** (cron `17 2,14 * * *` UTC in
   `CONTROL/v2/c7/provision/ada-c7-provision.mjs`), encrypts (ADAB2) and signs every object, stores it in the R2 EU bucket `ada-db-backups` (35 days,
   Bucket Lock 30 days). Nominal age of the newest backup: ≤ 12 h, so the 24 h RPO holds even when **one** run fails.
   - Gap to close (owner step, not done here): the producer's freshness alert `BACKUP_MAX_AGE_HOURS` is **36 h** in the job definition and the
     Healthchecks check has a 12 h period + 3 h grace. A missed run is therefore announced after ~15 h by Healthchecks (inside the RPO), but the
     job's own freshness verdict only after 36 h. Setting `BACKUP_MAX_AGE_HOURS=24` in the producer job aligns that verdict with the RPO.

**Erasures (data protection side of the RPO).** A restore must not bring back a person erased after the restored backup. Each backup carries the
erasure ledger (erasures before it); the erasures after it are in the **erasure tombstones**, kept 40 days outside the database (longer than the
35-day backups):
- copy 1: Upstash (`ada:erasure-tombstones:v1`, Frankfurt) — `api/_services/erasure-tombstones.js`;
- copy 2 (D5 b, 17/11/2026, **off until its variables are set**): one AES-256-GCM-encrypted object per record in a dedicated R2 EU bucket —
  `api/_services/erasure-tombstone-copy.js`, variables `TOMBSTONE_COPY_*`, set by `CONTROL/v2/k3_tombstone_key_setup.sh`.
An erasure is refused only when both copies fail; the restore replays the union and refuses when the two copies disagree without explanation
(`scripts/db-erasure-replay.mjs`, § 3).

## 2. How the RTO is met (procedure, ~half a day of work if nothing else fails — NOT timed on Production)

1. Decide: Neon history (incident < 6 h old) or K3 backup (anything else). Freeze writes: close the citizen surfaces (Vercel variable) and redeploy.
2. Neon history: `docs/disaster-recovery.md` § 2 (new branch at a time before the incident). K3 backup: `ops/cloud-backup/README.md` § 6 (new empty
   Neon database, newest signed dump + ledger, restore, `db-deploy-migrate.mjs --check`).
3. Erasure replay — **always**, whichever source (a Neon branch from before the incident also brings back the people erased since):
   `db-erasure-replay.mjs --ledger … --since-backup … --confirm-target … --kv` with the `TOMBSTONE_COPY_*` variables set (reads both copies), dry run,
   then `--execute`. For a Neon branch, `--since` = the branch's point in time and the newest ledger.
4. Retention purge re-run on the restored database (step 6c re-erases never-confirmed accounts from the data itself).
5. Point Vercel at the restored database, redeploy, `/api/health`, smoke tests; reopen surfaces.
6. Record the incident (GDPR art. 33 assessment within 72 h if personal data were lost or exposed).

Owner-only steps (Neon console, Vercel variables, Cloudflare download) fit within one business day only if the owner is reachable that day: the RTO
assumes it.

## 3. Tombstones — what the restore trusts (D5 b)

| Situation at restore time | Replay `--execute` |
|---|---|
| both copies read, every record in the window (backup time → now, < 39 days) present in both, or its absence explained by the other copy's note (`copy: 'failed'` in Upstash, `kv: 'failed'` in the bucket) | runs on the union |
| Upstash list lost (marker without record), trimmed, or **completely lost** (records only in the bucket) | **refused** — `KV:…` problems |
| bucket stale, emptied, a record missing that Upstash says was written (`copy: 'written'`) | **refused** — `COPY:TOMBSTONE_RECORDS_MISSING` |
| an object that does not authenticate (modified, swapped, forged without the key) | **refused** — `COPY:TOMBSTONE_COPY_TAMPERED` |
| bucket unreadable, or not given although Upstash records show the copy was on | **refused** — `COPY:NOT_READ` |
| operator's decision after checking the alert history (`kv.data_lost`, `tombstone_copy.*`) that one copy alone is complete | `--accept-single-copy kv` or `copy`: only that copy's own problems count; recorded in the output |

Without the copy variables and with no sign the copy was ever on, the replay behaves exactly as before D5 b.

## 4. Drills and evidence

| Drill | When | Evidence | Status 17/11/2026 |
|---|---|---|---|
| K3 restore of the newest backup into a disposable database (verifier job) | monthly (3rd, automatic) | evidence bucket `ada-restore-evidence` + Healthchecks | in service; one Production backup verified 12/11/2026 (evidence outside the repository) |
| Neon restore (point in time → branch), timed end to end through § 2 steps 1–5 on a **branch**, never on Production | **yearly** (owner decision D7) | a dated record: start/end times, branch name, row counts, `/api/health` against the branch from a preview deployment | **not yet executed** |
| Tombstone second copy — genuine recovery test (below) | once after activation, then with the yearly drill | replay dry-run output (counts only) | **not yet executed** — the copy is NOT operationally complete before it |

### Genuine recovery test of the tombstone copy (owner / ops, after `k3_tombstone_key_setup.sh` and a redeploy)

1. Health check: the next hourly run shows `checks.tombstoneCopy.ok = true` (`/api/cron/health-alert` summary in the logs or admin alerts).
2. Make one real erasure of a **test account** created for this purpose (the normal DSR flow). The bucket now holds 2 objects under
   `erasure-tombstones/t/` and `erasure-tombstones/last.json` (Cloudflare dashboard → bucket → objects: names only, contents are ciphertext).
3. On the owner's computer, with the restore key material (never on a shared machine): restore the newest K3 backup **taken before step 2** into a
   disposable Neon database (`ops/cloud-backup/README.md` § 6, or the verifier with `--keep-restored`), then
   `db-erasure-replay.mjs --ledger <newest ledger> --since-backup <that dump> --confirm-target <host>/<db> --kv` with `KV_REST_API_*` (read) and the
   five `TOMBSTONE_COPY_*` values (the copy key from the keychain item `ada-c7 / tombstone-copy-key`) → dry run must show `tombstoneSource: "kv+copy"`,
   `tombstonesAdded: 1`, `tombstoneProblems: []`, `presentAgain: 1`.
4. Same command with `--copy --accept-single-copy copy` instead of `--kv` (simulates a complete Upstash loss) → same counts.
5. `--execute` on the disposable database, then check the test account is gone there; drop the disposable database.
6. Record the outputs (counts only) with the date. Until then the copy is **configured, not proven**.

## 5. Costs of the second copy (Cloudflare R2, page https://developers.cloudflare.com/r2/pricing/ read 17/11/2026, « Last updated Oct 30, 2026 »)

Free tier per month, Standard storage: 10 GB-month, 1 million Class A operations, 10 million Class B operations; egress free; DeleteObject free.
Class A includes PutObject **and ListObjects**; Class B includes GetObject and HeadObject. Beyond: 0.015 $/GB-month, 4.50 $/million Class A,
0.36 $/million Class B; usage is rounded up to the next billing unit. The free tier is shared with the backup and evidence buckets of the same account.
Expected use of the copy: 2 PUT per erasure record (record + marker; 3 phases at most per erasure) + 1 ListObjects per hourly health check (~744/month)
+ deletions (free) — far below 1 million Class A; storage in kilobytes. **Expected cost 0 $ inside the free tier — an estimate, not a cap:** R2 has no
spending cap, and the R2 plan must already be purchased (it is: K2/K3). Cloudflare's token page (https://developers.cloudflare.com/r2/api/tokens/, read
17/11/2026) names « read, write, and list » for Object Read & Write and does not mention deletion; `ops/cloud-backup/README.md` § 1 states the
permission can delete, but the backup probe never observed a deletion (its bucket lock refuses it first). For this copy, deletion is **checked** by
`scripts/tombstone-copy-probe.mjs` (run by the setup script before anything is stored) and, in service, a refused deletion raises
`tombstone_copy.retention`. If R2 refused deletion, the 40-day retention would rest on the bucket lifecycle rule alone.
