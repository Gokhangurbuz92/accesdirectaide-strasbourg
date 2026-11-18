# D16 evaluation instrument and Q15 acceptance checklist — TEMPLATES (FA-D11, 18/11/2026)

> **Nothing on this page is a result.** Every example row is `LAB_SYNTHETIC` and invented to show how to fill the template. No real person was
> served, no non-recours was avoided, no premises were accepted. Real entries come only from verified outcomes (pilot protocol
> `docs/pilot/PROTOCOLE_PILOTE.md`, consent first) and from a signed premises document.

## 1. D16 — evaluation instrument (does search / orientation lead people to the right rights and services?)

D16 in the register is the retrieval index (embeddings + hybrid search). Its **engineering** quality is already measured by the catalogue query set
(`data/search-eval/retrieval-eval.v2.catalogue.json`, `scripts/search-eval-live.mjs`, labels `PROPOSED_BY_ENGINEERING`, human judgments empty). The
instrument below adds the **outcome** layer, with each indicator's evidence level fixed in advance.

| Id | Indicator | Definition (numerator / denominator) | Source | Evidence level allowed |
|---|---|---|---|---|
| E1 | Retrieval precision@5 | relevant results in top 5 / 5, averaged over the query set | catalogue query set + **human** relevance labels | ENGINEERING until a human labels; HUMAN_JUDGED after |
| E2 | Zero-result rate | searches with 0 results / searches | product counters (counts only) | MEASURED_PRODUCT |
| E3 | Task success | participants who reach the right fiche or service for a scripted need / participants | pilot session observation | PILOT_OBSERVED (consented) |
| E4 | Time to first relevant result | seconds, median | pilot session observation | PILOT_OBSERVED |
| E5 | Declared next step | participants who say they will apply / contact a service / participants | end-of-session question | PILOT_DECLARED (not an outcome) |
| E6 | Verified take-up | participants with a confirmed application or appointment at follow-up / participants followed | follow-up with consent | REAL_OUTCOME (only this level may support an impact claim) |
| E7 | Non-recours avoided | E6 cases the person says would not have happened otherwise | follow-up interview | REAL_OUTCOME, small-n, never extrapolated |

Rules: a level never upgrades itself (E5 is not E6); n < 10 is reported as a count, never a percentage; no individual record leaves the evidence log;
results are reported with the date, the protocol version and the SHA in production at the time.

**Synthetic example — LAB_SYNTHETIC, invented values, NOT a measurement:**

| Run | Level | Query / task | Result |
|---|---|---|---|
| SYN-01 | ENGINEERING | « demande logement social » | precision@5 = 0.6 (synthetic) |
| SYN-02 | PILOT_OBSERVED (simulated persona, no participant) | « je ne peux plus payer mon loyer » → FSL fiche | reached in 2 steps, 41 s (synthetic) |
| SYN-03 | REAL_OUTCOME | — | **not available**: requires a real consented follow-up |

## 2. Q15 — professional local premises: real-world acceptance checklist

Requirements from `docs/product/R31_PRODUCT_DEFINITIONS.md` § Q15. Each line needs a real document or a dated visit; « LAB » is not a valid answer.

| # | Criterion | Evidence required | Checked by | Status |
|---|---|---|---|---|
| Q15-1 | Step-free access, accessible toilet, signage (public reception) | landlord's public accessibility register (registre public d'accessibilité) | owner, on site | ☐ |
| Q15-2 | Closed room for one-to-one meetings, no line of sight from waiting area | photo of the room without people + dated visit note | owner | ☐ |
| Q15-3 | Internet, power, lockable cabinet for paper consent forms | contract / keys handed over | owner | ☐ |
| Q15-4 | Reachable by tram or bus in Strasbourg | CTS network map reference (stop name only) | owner | ☐ |
| Q15-5 | Written right to use the place (lease, occupation or hosting agreement) | signed document kept by the owner, outside the repository | owner | ☐ |
| Q15-6 | Insurance covering public reception (added by FA-D11, not in R31 — owner to confirm) | certificate | owner | ☐ |
| Q15-7 | Data protection on site (no screen visible from the waiting area, paper forms locked) (added by FA-D11 — owner to confirm) | dated visit note | owner | ☐ |

Q15 is accepted only when Q15-1 … Q15-7 are ticked with real evidence and the owner signs and dates the list. Until then Q15 stays
`EXTERNAL_DEPENDENCY_BLOCKED` (register).

**Synthetic example — LAB_SYNTHETIC, NOT an acceptance:** « Q15-4: stop "Exemple-Arrêt" (invented) — status ☐ (a synthetic line cannot tick a box) ».
