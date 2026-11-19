# Migration 0055 — community stories (X01, expansion)

- **File**: `drizzle/0055_x01_community_stories.sql`; rollback `drizzle/rollback/0055_down.sql`; journal tag `0055_x01_community_stories` (`when` 1794970000000);
  snapshot `drizzle/meta/0055_snapshot.json` (`prevId` = 0054's). Order: **after 0054 (X02), itself after 0053 (X04)** — the branch `g6-x01-community` is
  stacked on X04 `2328a12` + X02 `ce85be2` because the migration guard requires a contiguous journal (`IDX_NOT_CONTIGUOUS`, `TAG_NOT_NUMBERED_BY_IDX`). If X02
  (or X04) is not integrated, renumber this one (file, journal idx/tag, rollback `when`, tests `r44-migrate-guard`, `r43-booking-units`, `c12-migration-0050-db`,
  `x04-migration-0053-db`, `x02-migration-0054-db`, `x01-migration-0055-db`).
- **Status**: LAB only. NOT applied in Production; it is released only when the owner runs it (`scripts/db-deploy-migrate.mjs --only 0055_x01_community_stories`
  after 0053 and 0054, verified backup first). The capability `community.stories` stays closed anyway (outside the AIPD, surface `stories` opened by nothing).
- **What it adds** (additive only, nothing backfilled, **nothing seeded**):
  - `CommunityMember` — the **pseudonymous principal** (R47 § 8): its own random id (never the account id), the account id (unique: one pseudonym per account),
    the chosen pseudonym (3–24 characters, no `@`, no space — CHECK; unique without regard to case — index on `lower(pseudonym)`), the time it was chosen.
    FK ON DELETE CASCADE to `CitizenUser`.
  - `CommunityStory` — member id, state (`pending`, `published`, `rejected`, `withdrawn`, `taken_down`), title and text (both present ONLY while pending or
    published — CHECK `CommunityStory_text_state_check`), language (6), consent wording version, moderation reason (closed list), moderator e-mail and time,
    times. Lengths (title 5–120, text 50–3000), published ⇒ publication time + moderator. FK ON DELETE CASCADE to `CommunityMember`.
  - `CommunityStoryReport` — story id, reporting account id, ONE reason (closed list), time. Unique (story, account). FKs ON DELETE CASCADE to `CommunityStory`
    and to `CitizenUser`.
  - The consent proof is a row of the existing ledger `ConsentLog` (purpose `COMMUNITY_STORY_PUBLICATION`), not a column here.
- **Code without the tables**: `api/_services/community-stories.js` asks the catalogue (`communitySchemaAvailable`): public list empty, writes and moderation
  answer 503 `STORIES_NOT_AVAILABLE`, the export sections are empty (not a failed read).
- **Rollback**: `0055_down.sql` drops the three tables (pseudonyms, stories and reports are lost — export first if needed; the consent rows stay in
  `ConsentLog`) and forgets the journal row. Independent of 0053 and 0054.
- **Tests**: `tests/integration/x01-migration-0055-db.test.js` (up → down → code without it → up), `tests/integration/x01-community-stories-db.test.js`.
