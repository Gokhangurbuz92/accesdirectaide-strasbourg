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
total would protect; rounding cells would change the published grid and is an owner decision.

## Residual risks (not removed by C8)
1. **Re-reading the same quarter later (increment disclosure).** Cells of a past quarter are recomputed at each read. They change when an organization
   gains or loses verification, changes address, when a commune crosses the 3-organization threshold, or when a referral is answered after the quarter.
   Two reads of the same quarter, before and after, can isolate the change. Masked-to-masked changes stay invisible (tested), published-to-published do
   not. Remedy: freeze each quarter's block tables at first publication (a snapshot table — a new migration, 0050+, not done).
2. **Contributor collusion (dominance).** An organization knows its own counts. In a commune with exactly 3 organizations, two of them together subtract
   their own counts from a published cell and obtain the third one's. The « 3 organizations » rule does not prevent this; a dominance or p % rule, or a
   higher minimum, would. Owner decision.
3. **Linear relation inside a block.** The table by need and the table by commune count the same referrals: their published sums give the DIFFERENCE of the
   two masked sums. With at least two masked cells on each side (enforced) this yields bounds, not values, except in edge cases (for example every
   masked cell at its bound). A complete protection-interval audit (as in τ-ARGUS) is not implemented.
4. **Row existence.** A need listed with « < 5 » says at least one referral of that need reached the block in the quarter.
5. **Platform administrators.** The preview is suppressed like every view, but administrators keep other administrative access; the preview is not the
   control that limits them.
6. **Scientific / institutional validation** of the indicators remains external (vision document, observatoire row).
