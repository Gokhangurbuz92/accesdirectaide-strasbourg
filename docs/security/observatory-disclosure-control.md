# Observatory disclosure control (C8) — what is protected, what remains

Scope: every cross-organization statistic — institutional observatoire and CSV (scoped, G1 = b), the administrators' preview (`GET /api/admin/institutions?view=observatoire`),
the professional regional observatoire (`/api/pro/regional-stats`). Owner Paket 4, C8: engineering fix in the LAB; **publication deferred** (the institution
surface stays closed in Production). Code: `api/_services/territorial-stats.js` (« ONE suppressed base »), `api/_services/org-stats.js` (`regionalStats`).

## Rules (unchanged thresholds, visibility never widened)
- k = 5: every count below 5 is published as « < 5 »; at least 3 located verified organizations for a commune to be shown.
- Complementary suppression inside each column, and between the table by need and the table by commune (`publishTables`, `alignColumns`).
- Complete calendar quarters only, no free period or filter. No organization, professional or person named.

## What C8 changed
Before, two populations coexisted: the preview and the professional table placed an organization by the **name** in its address; the scoped views by
its **INSEE commune** (name and postal code). An organization « Sélestat, 68000 » counted in the preview's and the professional table's Sélestat and in no
scoped view, so preview − scoped (and professional − CSV) gave that single organization's figure. Now **one base** serves every view:
located organizations → shown communes → EPCI blocks → each block published once per quarter (referrals and appointments) → each view is a restriction
of those block tables; totals and trends are sums of published cells. The preview is the restriction to every block, with the same masks.
Tests: `tests/integration/c8-observatory-single-base-db.test.js` (the attacks D1–D3 succeed on the previous code: preview − EPCI = 3, professional − CSV
= 2; they fail after), `tests/integration/g1-territory-scope-db.test.js` (nested territories), `tests/integration/vis-observatoire-differencing-db.test.js`.

Rounding of totals was considered and not added: no published total is a true total (each is a sum of published cells), so there is nothing a rounded
total would protect; rounding cells would change the published grid and is an owner decision. Thresholds: k = 5, 3 organizations to show a commune,
the collusion rule below — none of them was loosened.

## Closed by the C8 follow-up (owner: « solvable C8 engineering must not be left open »)
1. **Contributor collusion (dominance)** — p % rule with coalitions (Hundepool et al., « Statistical Disclosure Control », Wiley 2012, magnitude-table
   sensitivity rules; τ-ARGUS manual; section numbers not re-checked): with contributions x1 ≥ x2 ≥ … of a cell T, the cell is masked when
   T − (x1 + … + x(c+1)) < p/100 · x1. Defaults c = 2 colluding organizations, p = 20 (engineering choices, not sourced values); configuration can only
   tighten them (`OBS_DOMINANCE_COALITION` 2..5, `OBS_DOMINANCE_P_PERCENT` 20..100). Applied to every referral cell (by need and by commune), appointment
   cell, « people with an appointment » cell and active-member cell. Consequence: a cell from three organizations or fewer is never published.
   Attack test: `tests/integration/c8-dominance-freeze-db.test.js` K (Villé 7 + 3 + 2 = 12 was published; two colluders obtained the 7).
   D8 (17/11/2026): a contributor is an ORGANISATION, not a record — the SIREN of the record's SIRET, else the record an active SAME_ENTITY decision of
   the duplicate register keeps, else the record itself (`contributorKey`, api/lib/structure-model.js); the « at least 3 organizations » per commune counts
   contributors too. Records without identifier stay their own contributor (never looser than before). Quarters already frozen are unchanged; the CSV
   column `organisations_verifiees` still counts records. Attack test: `tests/integration/d8-observatory-entity-db.test.js`.
2. **Re-reading a closed quarter** — migration 0052 (`ObservatoryQuarterSnapshot`) and the daily job `/api/cron/observatory-freeze` (category A, closed
   in the beta until named): a closed quarter's published blocks are stored once and read back unchanged; UPDATE is refused by a trigger.
   Attack test: same file, F (a late answer and a lost verification moved the live cells; frozen, nothing moves). Without 0052, or before the job has run
   for a quarter, the quarter is computed live as before (see residual 1 below).
3. **Bounds from the two marginal tables** — reduced: `protectMarginals` computes the attacker's exact interval of every masked cell (one equation, box
   constraints: a masked cell ≤ max(4, smallest published cell of its column), a listed need ≥ 1) and masks more cells, the other table first, until
   no masked cell is narrowed below what « masked » says (0..4 for a commune, 1..4 for a listed need). Attack test: `tests/unit/c8-marginal-bounds.test.js`
   (needs 4, 4, 5 / communes 0, 0, 13 pinned each need to 3..5; a sweep of small blocks).

## Residual risks (not removed)
1. **Window before freezing.** A closed quarter is frozen at the job's first run after it closes (daily). Until then — and on a database without 0052,
   and for any quarter whose row an operator deletes — it is computed live and the re-read difference exists. Frozen quarters keep the rules in force when
   they were frozen; a later tightening applies to them only if their row is deleted and re-frozen.
2. **Marginal bounds — what the audit does not model**: dominance-masked cells can exceed the assumed bound (the attacker cannot know which cells they
   are); relations between measures (unmet ≤ sent, out of scope ≤ sent) and between quarters are not part of the interval computation; no full
   linear-programming audit (τ-ARGUS-style) across several blocks.
3. **Active members** (professional page) are a current count, not frozen; protected by the threshold and the collusion rule only. The current number of
   verified organizations shown there is the public directory count.
4. **Row existence.** A need listed with « < 5 » says at least one referral of that need reached the block in the quarter.
5. **Platform administrators.** The preview is suppressed like every view, but administrators keep other administrative access; the preview is not the
   control that limits them.
6. **Scientific / institutional validation** of the indicators remains external (vision document, observatoire row).
