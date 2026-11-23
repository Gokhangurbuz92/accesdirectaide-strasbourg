-- G14-OBS (owner approval 23/11/2026, « Observatoire du non-recours ») — anonymous DEMAND SIGNALS of the public site, counted per day and rolled up once per
-- closed calendar quarter. Number 0062: 0060 is g14-ai, 0061 is reserved for g14-ps; the integrator orders them. Additive only: two new tables, their
-- CHECK constraints, one trigger function and one trigger that refuses UPDATE of a frozen quarter. No existing table, column, constraint or row changes;
-- nothing is backfilled. The code works without these tables: nothing is counted and the public page says the signals are not collected.
--
-- What a daily row holds (and nothing else): the UTC day, a signal kind from a closed list, a code from that kind's closed list (a subdomain of
-- data/reference/social-domains.v1.json, a Rights Graph situation, a Mon Parcours step type, a social-referral reason, an aid category), an INSEE commune
-- code of the Eurométropole or « HORS » or '' (only for searches, never for a sensitive subdomain), and a count. No user id, no IP address, no session, no
-- time of day, no free text: the CHECK constraints refuse any other shape. The daily rows of a quarter are DELETED by the freezing job once that quarter's
-- published grid is stored in "DemandSignalQuarter" (cells below 5 are stored masked, never as a raw count).
CREATE TABLE "DemandSignalDaily" (
	"day" date NOT NULL,
	"signal" text NOT NULL,
	"code" text NOT NULL,
	"commune" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "DemandSignalDaily_pkey" PRIMARY KEY ("day", "signal", "code", "commune"),
	CONSTRAINT "DemandSignalDaily_signal_check" CHECK ("DemandSignalDaily"."signal" IN ('search_need', 'search_category', 'situation', 'parcours_added', 'parcours_closed', 'social_referral')),
	CONSTRAINT "DemandSignalDaily_code_check" CHECK ("DemandSignalDaily"."code" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "DemandSignalDaily_commune_check" CHECK ("DemandSignalDaily"."commune" ~ '^(67[0-9]{3}|HORS)?$' AND ("DemandSignalDaily"."commune" = '' OR "DemandSignalDaily"."signal" = 'search_need')),
	CONSTRAINT "DemandSignalDaily_count_check" CHECK ("DemandSignalDaily"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "DemandSignalQuarter" (
	"quarter" text PRIMARY KEY NOT NULL,
	"schemaVersion" text NOT NULL,
	"rules" jsonb NOT NULL,
	"published" jsonb NOT NULL,
	"frozenAt" timestamp (3) DEFAULT now() NOT NULL,
	"release" text,
	CONSTRAINT "DemandSignalQuarter_quarter_format_check" CHECK ("DemandSignalQuarter"."quarter" ~ '^[0-9]{4}-T[1-4]$')
);
--> statement-breakpoint
CREATE FUNCTION "demand_signal_quarter_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DemandSignalQuarter rows are frozen: UPDATE refused';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "DemandSignalQuarter_no_update" BEFORE UPDATE ON "DemandSignalQuarter" FOR EACH ROW EXECUTE FUNCTION "demand_signal_quarter_immutable"();
