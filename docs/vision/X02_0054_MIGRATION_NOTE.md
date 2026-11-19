# Migration 0054 — testimonials (X02, expansion)

- **File**: `drizzle/0054_x02_testimonials.sql`; rollback `drizzle/rollback/0054_down.sql`; journal tag `0054_x02_testimonials` (`when` 1794960000000);
  snapshot `drizzle/meta/0054_snapshot.json` (`prevId` = 0053's). Order: **after 0053 (X04)** — the branch `g5-x02-testimonials` is stacked on
  `g4-x04-academy-events` (2328a12) because the migration guard requires a contiguous journal (`IDX_NOT_CONTIGUOUS`, `TAG_NOT_NUMBERED_BY_IDX`). If X04 is
  not integrated, renumber this one 0053 (file, journal idx/tag, rollback `when`, tests `r44-migrate-guard`, `r43-booking-units`, `c12-migration-0050-db`,
  `x04-migration-0053-db`).
- **Status**: LAB only. NOT applied in Production; it is released only when the owner runs it (`scripts/db-deploy-migrate.mjs --only 0054_x02_testimonials`
  after 0053, verified backup first). The capability `community.testimonials` stays closed anyway (outside the AIPD, surface `testimonials` opened by nothing).
- **What it adds** (additive only, nothing backfilled, **nothing seeded**):
  - `Testimonial` — account id, state (`pending`, `published`, `rejected`, `withdrawn`, `taken_down`), the chosen first name / pseudonym and the text (both
    present ONLY while pending or published — CHECK `Testimonial_text_state_check`), language (6), consent wording version, moderation reason (closed
    list), moderator e-mail and time, times. Lengths (text 30–1500, name 2–40), published ⇒ publication time + moderator. Partial unique index: one pending
    or published testimonial per account. FK ON DELETE CASCADE to `CitizenUser`.
  - `TestimonialReport` — testimonial id, reporting account id, ONE reason (closed list), time. Unique (testimonial, account). FKs ON DELETE CASCADE to
    `Testimonial` and to `CitizenUser`.
  - The consent proof is a row of the existing ledger `ConsentLog` (purpose `TESTIMONIAL_PUBLICATION`), not a column here.
- **Code without the tables**: `api/_services/testimonials.js` asks the catalogue (`testimonialsSchemaAvailable`): public list empty, writes and moderation
  answer 503 `TESTIMONIALS_NOT_AVAILABLE`, the export sections are empty (not a failed read).
- **Rollback**: `0054_down.sql` drops both tables (testimonials and reports are lost — export first if needed; the consent rows stay in `ConsentLog`) and
  forgets the journal row. Independent of 0053.
- **Tests**: `tests/integration/x02-migration-0054-db.test.js` (up → down → code without it → up), `tests/integration/x02-testimonials-db.test.js`.
