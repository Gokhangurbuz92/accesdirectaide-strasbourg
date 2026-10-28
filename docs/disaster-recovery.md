# Disaster Recovery & PITR Playbook

## 1. RPO and RTO Targets
- **Recovery Point Objective (RPO)**: USER DECISION REQUIRED (Measured provider capability is up to 5 minutes via Neon PITR, but actual business target is pending).
- **Recovery Time Objective (RTO)**: USER DECISION REQUIRED (Measured provider capability is ~15 minutes to branch, but actual business target is pending).

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
