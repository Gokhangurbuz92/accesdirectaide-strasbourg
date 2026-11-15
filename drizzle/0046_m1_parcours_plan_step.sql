-- M1 (register C07 / C08, Mon Parcours): the durable « who does what next » of a tracked step. One nullable jsonb column on "ParcoursItem": the need
-- (taxonomy id), who acts (the person, a named organisation, a professional), the links, the step it depends on, the next action key and, for a step the
-- person closed, why (abandoned / outcome unknown). Validated by the server only (api/lib/parcours-plan-step.js); NULL = a step without it, which is every
-- existing row. Additive only: no default, no index, no CHECK, no backfill — PostgreSQL adds a nullable column without a default as a catalogue change, no
-- row is rewritten. Idempotent (IF NOT EXISTS). Applicable on Production 0042 + 0045 on its own (it touches nothing of 0043 / 0044). The code works on a
-- database without this column (api/_utils/schema-features.js: the plan-step parts are left out).
ALTER TABLE "ParcoursItem" ADD COLUMN IF NOT EXISTS "planStep" jsonb;
