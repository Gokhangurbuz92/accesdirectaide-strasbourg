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
   they were frozen; a later tightening applies to them only if their row is deleted and re-frozen. **FA-D9 (18/11/2026): closed in Production** — see
   « Red team FA-D9 » below (R4): in Production a closed quarter is published only once frozen; the window remains in the LAB (live by default).
2. **Marginal bounds — what the audit does not model**: dominance-masked cells can exceed the assumed bound (the attacker cannot know which cells they
   are); relations between measures (unmet ≤ sent, out of scope ≤ sent) and between quarters are not part of the interval computation; no full
   linear-programming audit (τ-ARGUS-style) across several blocks.
3. **Active members** (professional page) are a current count, not frozen; protected by the threshold and the collusion rule only. The current number of
   verified organizations shown there is the public directory count. **FA-D9: not published in Production** (frozen-only mode publishes no live
   count); in the LAB the residual remains.
4. **Row existence.** A need listed with « < 5 » says at least one referral of that need reached the block in the quarter.
5. **Platform administrators.** The preview is suppressed like every view, but administrators keep other administrative access; the preview is not the
   control that limits them.
6. **Scientific / institutional validation** of the indicators remains external (vision document, observatoire row).

## Red team FA-D9 (18/11/2026) — privacy risk model and attack battery

**What the thresholds are, and are not.** k = 5, « at least 3 organisations », the p % rule (c = 2, p = 20), complementary suppression, marginal
protection and the frozen quarterly grid are disclosure-control *heuristics*. They lower the risk that a published figure gives back a small count of
one organisation or of a few people. They are **not a proof of anonymity**: no formal guarantee (differential privacy or an equivalent) is claimed, the
parameters are engineering choices (not values taken from a source), and the CNIL's anonymisation criteria (individualisation, correlation, inference)
have not been assessed by a DPO or an external reviewer. The aggregates are treated as **pseudonymous-risk outputs** whose publication stays DEFERRED.

### Assets, actors, channels
- Assets: per-organisation referral and appointment counts (commercially and socially sensitive for a structure), the existence of a referral of a given
  need in a small area (can concern an identifiable person when the area is small), citizen account counts.
- Actors: a verified organisation (knows its own counts — the collusion model), a coalition of organisations, an institutional account (one territory),
  a platform administrator (preview — but has other administrative access anyway), an outsider with public knowledge (directory).
- Channels: institutional observatoire and CSV (closed: `institution.portal` capability), administrators' preview, professional regional observatoire
  (closed with the pro surface). Nothing is public. Raw rows never leave `liveBlocks`.

### Metric definitions (what each figure IS)
`api/lib/observatory-metrics.js` is the single registry. PUBLISHED: `referral_sent` (key `sent`), `referral_declined_no_capacity` (key `unmet` — a
referral refused for lack of capacity, **not an unmet need**; CSV column renamed `orientations_refusees_capacite`, schema v3), `referral_declined_out_of_scope`
(`outOfScope`), `appointment_not_cancelled` (`rdv`/`appointments` — not honoured, not an aid obtained), `citizen_accounts_with_appointment`
(`people`/`peopleWithAppointment` — accounts, not persons; the sum of communes counts an account once per commune). DEFINED_NOT_PUBLISHED (a recorded
fact exists; publishing needs a disclosure review and the owner): `referral_accepted`, `referral_expired`, `appointment_honoured`, `support_closed_declared`.
NOT_COMPUTED (no recorded fact, or the fact is in a person's own space, which statistics never read): `need_expressed`, `aid_found`, `action_started`,
`service_rendered`, `non_take_up`, `page_view`. Non-take-up needs eligibility established and non-receipt established — the platform has neither.

### Attack battery (machine-executable)
`tests/integration/d9-observatory-redteam-db.test.js` (real PostgreSQL) and `tests/unit/d9-observatory-redteam.test.js`:
| # | Attack | Before FA-D9 | After |
|---|---|---|---|
| R1 | repeated reads of every view | byte-identical | unchanged |
| R2 | groups: preview / EPCI / département / commune view | same commune cell everywhere; no by-need table below a block | unchanged |
| R3 | time windows: month, year, free period | refused | unchanged |
| R4 | frozen vs live: two reads around one organisation losing its verification | **succeeded where quarters are live** (Production with the freezing job closed): 20 − 16 = 4, one organisation's exact count | Production publishes a closed quarter only once frozen (`publishFrozenOnly`); before, WITHHELD (`withheld: true`, CSV 409 `QUARTER_NOT_FROZEN`); active members not published |
| R5 | exact zeros | never published (« < 5 ») | unchanged |
| R6 | cohorts / unique characteristics | only need × commune × quarter | unchanged |
| R7 | metric names | « besoins non couverts » for a refused referral | renamed; every key names its metric (`metrics`) |
| H1 | two queries differing by one filter (need, dates, cohort, cache-buster…) | ignored (identical output) | refused before anything is read (`QUERY_PARAMETER_NOT_ACCEPTED`) |
| H2 | query rate | unlimited | 30 reads / hour / institutional account (`OBSERVATORY_READ`), refused before reading or journaling |
| H3 | preview / pro read request input | no | unchanged |
Already covered and not repeated: preview − CSV and pro − CSV (C8 D1–D3), collusion (C8 K, D8 F4), nested territories (G1), marginal bounds (C8),
masked-cell sums (visibility audit).

### Residual risks after FA-D9
1. **LAB is live by default** (tests need it): R4 succeeds in the LAB; `OBS_PUBLISH_FROZEN_ONLY=1` closes it there too.
2. **Row existence** (residual 4 above): a listed need says ≥ 1 referral of that need in the block and quarter. Listing all nine reasons always would hide
   it but forces complementary masking of commune cells (a zero row next to an unmasked commune table is exactly 0) — a published-grid change, owner decision.
3. **Snapshot deletion** by a database operator returns the quarter to WITHHELD; the next freeze recomputes it, and old − new isolates the changes in
   between. Requires database write access (operator), audited outside the application.
4. **Outside knowledge**: an organisation that also knows a person's situation from elsewhere, or several institutions pooling territories, are not modelled
   beyond the coalition of 2 organisations; no linear-programming audit across blocks and quarters.
5. **Rate limit backend**: in Production the limiter uses Upstash and fails closed on error; the in-memory fallback is per instance (LAB only).
6. **Small populations of the future**: the thresholds were chosen for Strasbourg / Eurométropole densities; a sparse territory can make most cells
   masked (utility) or, with a rare need, keep residual 2 meaningful.
7. **Validation**: no DPO, CNIL, statistician or institutional review of the method; publication stays DEFERRED until privacy review and owner authorisation.

## G14-OBS (23/11/2026) — anonymous demand signals and the public Observatoire

Scope: GET /api/public/observatoire (JSON, `?format=csv`), the page /observatoire, POST /api/public/signal (opt-in situation counter). Code:
`api/lib/demand-signals.js` (registry, publication rules, CSV), `api/_services/demand-signals.js` (only reader / writer), migration 0062, ADR 023.
All switches closed by default (`ADA_DEMAND_SIGNALS`, `ADA_OBSERVATOIRE`, `VITE_OBSERVATOIRE`, `VITE_DEMAND_SIGNALS`).

- **What is stored**: per UTC day, a closed-list code and a count; for searches only, an Eurométropole INSEE code or « HORS » — never for a sensitive
  subdomain (`SENSITIVE_NEEDS`). No identifier, IP, time of day or text (CHECK constraints). Daily rows are deleted once their quarter is frozen.
- **Same thresholds, nothing loosened**: k = 5 (zero included, every code listed), complementary suppression per column, the C8 marginal protection
  (`alignColumns` + `protectMarginals`) between the subdomain and the commune table of each domain, commune tables only from 20 searches in the domain,
  totals = sums of published cells, closed quarters only, frozen once (UPDATE refused). Appointment requests per domain: `primaryCell` with the
  organisations' contributions (p % rule, c = 2, p = 20).
- **Supply**: the public directory (D-5 strict), Eurométropole only; 0 exact, 1–4 banded, ≥ 5 exact.
- **Query surface**: only `format=json|csv`; any other parameter refused before reading (H1); 30 reads / minute / address; 1 h server cache.
- **Residual risks**: (1) heuristics, not a proof of anonymity; (2) a listed code at « masqué » says nothing (all codes are listed, zeros masked) but a
  published value ≥ 5 says « at least 5 events », not people; (3) counts can be inflated by automated searches within the search rate limit (signals,
  not measurements); (4) a quarter is frozen at the job's first run after it closes; until then nothing of it is published (no live window); (5) the
  supply classification is a keyword heuristic (place kind + declared services) and the directory is incomplete — the « leads » say so.
- Tests: `tests/unit/g14-obs-demand-signals.test.js` (suppression, marginal intervals, schema without personal data, handlers, gate),
  `tests/integration/g14-obs-demand-signals-db.test.js` (CHECK refusals, recording, freeze + deletion, no personal table read).
