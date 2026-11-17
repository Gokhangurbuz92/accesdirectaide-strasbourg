# Migration 0052 — frozen observatory quarters (C8)

- **File**: `drizzle/0052_c8_observatory_quarter_snapshot.sql`; rollback `drizzle/rollback/0052_down.sql`; journal tag
  `0052_c8_observatory_quarter_snapshot` (`when` 1794940000000); snapshot `drizzle/meta/0052_snapshot.json`.
- **Number and order**: 0052, after 0050 (C12 ressources, `0050_rs_resource_publication`) and 0051 (P19, `0051_p19_dispositif_content_type`) — journal
  contiguous 0049 → 0050 → 0051 → 0052 (`idx` 52, `when` 1794940000000 > 0051's); the 0052 snapshot's `prevId` is 0051's and it holds the 0050 / 0051
  objects. In Production: `--only` in journal order, 0052 needs 0050 and 0051 first (the plan refuses otherwise: `EARLIER_MIGRATION_PENDING`).
- **What it adds**: table `ObservatoryQuarterSnapshot` (quarter label PK with a format CHECK, rules, blocks, frozenAt, release), function
  `observatory_quarter_snapshot_immutable()` and trigger `ObservatoryQuarterSnapshot_no_update` (UPDATE refused). Additive only; nothing backfilled.
- **Data held**: published cells only — per EPCI block the commune codes and official names, verified organizations per shown commune, the referral
  tables by need and by commune, appointment and « people with an appointment » cells, all as published (masked = null). No organization id, no person.
- **Code without the table** (database behind the code): `api/_services/territorial-stats.js` asks the catalogue (`snapshotAvailable`); without the
  table every quarter is computed live exactly as before, and the freezing job ends « skipped » (`SCHEMA_MISSING`).
- **Writer**: `freezeClosedQuarters` (cron `/api/cron/observatory-freeze`, daily 06:17 UTC in `vercel.json`, category A: closed in the restricted beta
  until named in `ADA_BETA_OPEN_JOBS`). It freezes each of the four closed quarters of the window that is not frozen yet; `INSERT … ON CONFLICT DO
  NOTHING`, so a second run changes nothing.
- **Rollback**: `0052_down.sql` drops the table and the function and forgets the journal row. Quarters are then live again (the re-read difference
  returns). Production: only by the owner's migration procedure (`--only <tag>`, verified backup first), never automatically.
- **Tightening later**: a quarter frozen under looser rules keeps its cells; deleting its row (operator, deliberate) returns it to live computation
  under the current rules, and the next job run freezes it again.
