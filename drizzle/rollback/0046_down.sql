-- Rollback of 0046_m1_parcours_plan_step (M1), run on its own (Production 0042 + 0045 + 0046) or BEFORE 0045_down.sql.
-- Effect: every step loses its durable plan data (need, who acts, links, dependency, next action, closing reason « abandoned » / « outcome unknown »):
-- the steps themselves, their status (a step closed with a reason stays « Terminé »), deadlines, notes and history stay. Export first if needed
-- (`COPY (SELECT id, "userId", "planStep" FROM "ParcoursItem" WHERE "planStep" IS NOT NULL) TO STDOUT WITH CSV HEADER`). After it the code keeps working:
-- it leaves the plan-step parts out again, and the previous version of the code never reads the column.
ALTER TABLE "ParcoursItem" DROP COLUMN IF EXISTS "planStep";
-- forget the migration too (its journal row, by the journal's « when » of 0046), otherwise a later run believes 0046 is applied and silently skips it
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794742203358;
