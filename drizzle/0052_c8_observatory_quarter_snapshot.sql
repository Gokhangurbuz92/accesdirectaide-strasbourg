-- C8 (owner Paket 4) — frozen quarters of the cross-organization statistics. Number 0052: 0050 (ressources) and 0051 (P19) are on other branches; the
-- integrator orders them. A closed calendar quarter is published ONCE: its published cells are stored here by the freezing job (cron/observatory-freeze,
-- category A, closed in the beta until named) and every later read of that quarter returns them unchanged. Before, each read recomputed the quarter, so a
-- late answer, an organization losing its verification or a new organization moved published cells, and two reads differenced into that one change.
-- What a row holds: the quarter label, the rules applied (k, coalition, p %), and per EPCI block the commune codes and official names, the number of
-- verified organizations per shown commune and the PUBLISHED cells (masked = null). No organization id, no person, no raw count below the threshold.
-- Additive only: one new table, one CHECK, one trigger function and one trigger that refuses UPDATE (a frozen quarter is never rewritten; removing a row
-- is a deliberate operator action that returns the quarter to live computation). No existing table, column, constraint or row changes. Nothing is
-- backfilled by the migration. The code works on a database without this table (it asks the catalogue): the quarters are then computed live, as before.
CREATE TABLE "ObservatoryQuarterSnapshot" (
	"quarter" text PRIMARY KEY NOT NULL,
	"schemaVersion" text NOT NULL,
	"rules" jsonb NOT NULL,
	"blocks" jsonb NOT NULL,
	"frozenAt" timestamp (3) DEFAULT now() NOT NULL,
	"release" text,
	CONSTRAINT "ObservatoryQuarterSnapshot_quarter_format_check" CHECK ("ObservatoryQuarterSnapshot"."quarter" ~ '^[0-9]{4}-T[1-4]$')
);
--> statement-breakpoint
CREATE FUNCTION "observatory_quarter_snapshot_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ObservatoryQuarterSnapshot rows are frozen: UPDATE refused (delete the row to return the quarter to live computation)';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ObservatoryQuarterSnapshot_no_update" BEFORE UPDATE ON "ObservatoryQuarterSnapshot" FOR EACH ROW EXECUTE FUNCTION "observatory_quarter_snapshot_immutable"();
