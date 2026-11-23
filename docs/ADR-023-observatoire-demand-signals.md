# ADR 023: Observatoire — anonymous demand signals, not audience measurement

## Status
Proposed (G14-OBS, 23/11/2026) under the owner approval of 23/11/2026 (« Observatoire du non-recours »). Engineering complete in the LAB; every switch is
closed. Opening needs migration 0062 in Production, the notice / AIPD text of the G14-OBS report, and the owner's switch of the variables below.

## Context
- ADR 022 keeps audience measurement off (no visit, no page view, no tracker). Public bodies asked a different question: « which rights are searched for
  in Strasbourg and the Eurométropole, and where are services missing? ». Answering it needs a count of what is searched — not of who searches.
- The C8 observatory (institutions, referrals and appointments, frozen quarters, k = 5, p % rule) already defines the disclosure rules; the public
  indicators (G8) count public records only.
- The privacy notice says that the browser-only pages (/droits, /orientation) send none of the visitor's answers; Mon Parcours data is never read by
  statistics.

## Decision
1. **Counted at the moment of the event, never read back.** A closed-list code is counted when something happens (a search classified by the server's
   own reading, a Rights Graph situation chosen with the opt-in box ticked, a limited Mon Parcours step added or finished, a social referral sent).
   The personal spaces are never read by the statistics. Table `DemandSignalDaily` (0062): day, signal, code, commune, count — CHECK constraints refuse any
   other shape. No user id, IP, session, time of day or text.
2. **Commune only for searches, never for a sensitive subject.** The commune is the search's territory filter (an INSEE code of the Eurométropole, else
   « HORS »); it is dropped before counting for every subdomain listed in `SENSITIVE_NEEDS` (health, disability, addiction, residence, justice, legal
   protection, sexual life, violence).
3. **Daily → quarterly, then delete.** The daily job `observatory-freeze` (already scheduled) freezes each closed quarter once (`DemandSignalQuarter`,
   UPDATE refused) with the C8 rules, then deletes that quarter's daily counts. Only closed quarters are published.
4. **Suppression.** k = 5 (zero included); complementary suppression in every column; the C8 marginal-bound protection between the subdomain and the
   commune tables of a domain; a commune table only from 20 searches in the domain; every code always listed; totals = sums of published cells.
   Appointment requests are contributed by organisations: the C8 p % rule with coalitions applies.
5. **The Rights Graph counter is opt-in.** POST /api/public/signal is called only when the visitor ticks the box (unticked by default, kept in memory
   only). The id travels in the body, never in the address. Rate-limited (10 / minute).
6. **Not audience measurement.** No visit, page view, referrer, language or device is counted; ADR 022 stays in force.
7. **Switches** (closed by default, exact): `ADA_DEMAND_SIGNALS` (search, situation, parcours, referral), `ADA_OBSERVATOIRE` / `VITE_OBSERVATOIRE` (open),
   `VITE_DEMAND_SIGNALS` (situation).

## Consequences
- The public page /observatoire and GET /api/public/observatoire (JSON, CSV under Licence Ouverte 2.0) answer « searched vs published » per domain and
  commune, with leads (« no published place », « few places », « searches per place ») that are explicitly not unmet needs.
- New processing purpose: the privacy notice and the AIPD must announce it before opening (text in the G14-OBS report).
- Residual risks: the disclosure rules are heuristics, not a proof of anonymity (same statement as C8); a bot can inflate counts within the rate limits;
  a person who toggles a Mon Parcours step back and forth is counted at each first move to a final state; the supply classification (place kind +
  declared services) is a keyword heuristic.
- Tests: `tests/unit/g14-obs-demand-signals.test.js`, `tests/unit/g14-obs-ui.test.jsx`, `tests/integration/g14-obs-demand-signals-db.test.js`.
