# Disaster Recovery & PITR Playbook

## 1. RPO and RTO Targets
- **Recovery Point Objective (RPO)**: **24 hours** (owner decision D7, 17/11/2026; an objective, not a guarantee). Neon's history is 6 hours on the Free plan.
- **Recovery Time Objective (RTO)**: **1 business day** (owner decision D7, 17/11/2026). Never timed on Production.
- Yearly Neon restore drill, and how the K3 backups and the erasure tombstones meet these objectives: `docs/ops/RPO_RTO.md`.

## 2. Point-in-Time Recovery (PITR) Procedure (Neon)
If a catastrophic data loss or corruption event occurs on the `production` database:

1. **Identify Corruption Time**: Determine the exact UTC timestamp before the corruption occurred.
2. **Create Recovery Branch**:
   - Navigate to Neon Console -> Branches.
   - Click "New Branch".
   - Select the `production` branch as the parent.
   - Choose "Time" and enter the pre-corruption timestamp.
   - Name it `production-recovery-YYYYMMDD`.
3. **Verify Data**:
   - Connect to `production-recovery-YYYYMMDD` using a local SQL client.
   - Run verification queries (e.g., `SELECT count(*) FROM "CitizenUser";`).
4. **Promote to Production**:
   - Update Vercel Environment Variables: Change `DATABASE_URL` to the new branch's connection string.
   - Trigger a Vercel redeployment (to clear edge caches and restart connection pools).
   - Once stable, rename branches in Neon if desired for long-term consistency.

## 3. Vercel / App Fallback Strategy
If Vercel's primary routing or compute fails:
- The site will rely on statically generated pages where possible.
- If Neon is down but Vercel is up, API routes will return 503, and the frontend must gracefully degrade.

## 4. Periodic Verification
- **Execution required**: ENVIRONMENT ACTION REQUIRED to execute a real PITR simulation and measure the actual timing.

## 5. Independent cloud backups (V2 C7)
Besides the provider's PITR, an independent encrypted and signed copy of the Production database is stored daily in object storage and restored into a
disposable database by a separate verifier job (`ops/cloud-backup/README.md`). A Production backup was restored and verified this way on 12/11/2026
(evidence kept outside the repository); this covers the independent copy, **not** the provider PITR drill of § 4, which is still to be executed.
Restore procedure: `docs/runbooks.md` § 9. Release rollback: `docs/runbooks.md` § 10.
