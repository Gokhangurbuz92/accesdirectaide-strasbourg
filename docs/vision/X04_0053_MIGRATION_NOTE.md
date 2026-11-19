# Migration 0053 — academy and events (X04, expansion)

- **File**: `drizzle/0053_x04_academy_events.sql`; rollback `drizzle/rollback/0053_down.sql`; journal tag `0053_x04_academy_events` (`when` 1794950000000);
  snapshot `drizzle/meta/0053_snapshot.json` (`prevId` = 0052's). Order: after 0052 (C8). Other expansion branches may also have claimed 0053: the
  integrator renumbers / reorders (journal contiguous, `when` increasing; tests `r44-migrate-guard`, `r43-booking-units`, `c12-migration-0050-db` name it).
- **Status**: LAB only. NOT applied in Production; it is released only when the owner runs it (`scripts/db-deploy-migrate.mjs --only 0053_x04_academy_events`
  after 0046–0052, verified backup first). The capability `community.events` stays closed anyway (outside the AIPD, surface `events` opened by nothing).
- **What it adds** (additive only, nothing backfilled):
  - `AcademyItem` — an academy page (`LESSON`) or a public event (`EVENT`): plain-text content, optional checked translations (jsonb), organizer name,
    dates, public venue, capacity (1–5000), accessibility features (closed list) and note, editorial states and actors (administrator e-mails, never shown
    publicly). CHECKs: kind, status, capacity, end after start, published ⇒ slug + publishedAt + approver, published event ⇒ dates + capacity + venue.
    No personal data of citizens.
  - `EventRegistration` — account id, event id, `REGISTERED` / `CANCELLED`, timestamps, at most ONE accessibility need from a closed list with the time
    it was chosen (CHECK: need and its time together; no need on a cancelled registration). Unique (event, account). Foreign keys ON DELETE CASCADE to
    `AcademyItem` and to `CitizenUser`: account deletion, DSR erasure and purge step 6c delete the registrations.
- **Code without the tables**: `api/_services/academy-events.js` asks the catalogue (`academySchemaAvailable`): public lists empty, writes answer
  503 `ACADEMY_NOT_AVAILABLE`, the export section is empty (not a failed read), the notification centre has no event item.
- **Rollback**: `0053_down.sql` drops both tables (content and registrations are lost — export first if needed) and forgets the journal row.
- **Tests**: `tests/integration/x04-migration-0053-db.test.js` (up → down → code without it → up), `tests/integration/x04-academy-events-db.test.js`.
