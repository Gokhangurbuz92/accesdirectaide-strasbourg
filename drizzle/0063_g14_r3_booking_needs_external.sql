-- G14 release 3 (owner approval 24/11/2026, « cover everyone and everything » in find-and-book). ADDITIVE and idempotent: two new tables, their CHECKs,
-- indexes and foreign keys. No existing table, column, constraint or row changes; nothing is backfilled or seeded. Journaled as idx 63 (« when »
-- 1795050000000; snapshot drizzle/meta/0063_snapshot.json, generated from src/db/schema.ts so drizzle-kit generate stays a no-op).
--
--   "ProRdvServiceSubdomain"   the needs a bookable service answers: subdomains of data/reference/social-domains.v1.json (20 domains × 86 subdomains)
--                              with their domain (the code refuses any id outside that closed list). Only writer: api/_handlers/pro/services.js.
--   "StructureExternalBooking" « appointments on our own system »: the https page where a place takes appointments itself — NOT an AccesDirectAide
--                              booking. PENDING until an administrator APPROVES it; shown publicly only when APPROVED and ADA_EXTERNAL_BOOKING is open.
--                              A changed URL goes back to PENDING. Only writer: api/_services/external-booking.js. No personal data: a URL of the place,
--                              the needs it serves, who submitted / reviewed it (a professional id or an administrator e-mail), dates.
--
-- The code works WITHOUT this migration (Production until the owner runs it): the service editor saves no needs, the need filter matches nothing,
-- the external-booking routes answer 503 EXTERNAL_BOOKING_NOT_AVAILABLE and no badge is shown. Rollback: drizzle/rollback/0063_down.sql.
CREATE TABLE IF NOT EXISTS "ProRdvServiceSubdomain" (
	"serviceId" text NOT NULL,
	"subdomain" text NOT NULL,
	"domain" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "ProRdvServiceSubdomain_pkey" PRIMARY KEY("serviceId","subdomain"),
	CONSTRAINT "ProRdvServiceSubdomain_subdomain_check" CHECK ("ProRdvServiceSubdomain"."subdomain" ~ '^[a-z0-9-]{1,64}$'),
	CONSTRAINT "ProRdvServiceSubdomain_domain_check" CHECK ("ProRdvServiceSubdomain"."domain" ~ '^[a-z0-9-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "StructureExternalBooking" (
	"structureId" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"platform" text DEFAULT 'other' NOT NULL,
	"subdomains" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"source" text NOT NULL,
	"sourceRef" text,
	"submittedBy" text,
	"submittedAt" timestamp (3) DEFAULT now() NOT NULL,
	"reviewedBy" text,
	"reviewedAt" timestamp (3),
	"reviewNote" text,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "StructureExternalBooking_url_check" CHECK ("StructureExternalBooking"."url" ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$' AND length("StructureExternalBooking"."url") <= 2048),
	CONSTRAINT "StructureExternalBooking_platform_check" CHECK ("StructureExternalBooking"."platform" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "StructureExternalBooking_status_check" CHECK ("StructureExternalBooking"."status" IN ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "StructureExternalBooking_source_check" CHECK ("StructureExternalBooking"."source" IN ('PRO', 'ADMIN', 'IMPORT')),
	CONSTRAINT "StructureExternalBooking_review_check" CHECK ("StructureExternalBooking"."status" = 'PENDING' OR ("StructureExternalBooking"."reviewedBy" IS NOT NULL AND "StructureExternalBooking"."reviewedAt" IS NOT NULL)),
	CONSTRAINT "StructureExternalBooking_subdomains_check" CHECK (cardinality("StructureExternalBooking"."subdomains") <= 10)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ProRdvServiceSubdomain" ADD CONSTRAINT "ProRdvServiceSubdomain_service_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."ProRdvService"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "StructureExternalBooking" ADD CONSTRAINT "StructureExternalBooking_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProRdvServiceSubdomain_subdomain_idx" ON "ProRdvServiceSubdomain" USING btree ("subdomain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProRdvServiceSubdomain_domain_idx" ON "ProRdvServiceSubdomain" USING btree ("domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "StructureExternalBooking_status_idx" ON "StructureExternalBooking" USING btree ("status");
