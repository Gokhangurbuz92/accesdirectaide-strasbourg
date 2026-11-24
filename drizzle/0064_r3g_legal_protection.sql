-- G14-R3G (owner 24/11/2026, release-3 package) — « représentant légal d'un majeur protégé »: the link between the account of a protected adult and the
-- account of their representative under a court measure (tutelle, curatelle simple / renforcée / aménagée, habilitation familiale générale / spéciale,
-- mandat spécial of a sauvegarde de justice), held by a relative or by a mandataire judiciaire à la protection des majeurs (MJPM).
--
-- Integrated in release 3 (g14-r3, 24/11/2026): journal idx 64, « when » 1795060000000 (> 0063's 1795050000000), after g14-r3d's 0063 — scripts/db-migrate-guard.mjs
-- refuses a journal gap and drizzle's migrator compares « when » with the newest applied row only. Rollback: drizzle/rollback/0064_down.sql; snapshot
-- drizzle/meta/0064_snapshot.json; the table is declared in src/db/schema.ts. The code still reads it behind a presence check
-- (api/_services/legal-protection.js legalProtectionInstalled): on a database without 0064 the feature answers LEGAL_PROTECTION_NOT_INSTALLED.
--
-- Additive only: one new table, its CHECK constraints, foreign keys and indexes. No existing table, column, constraint or row changes; nothing is backfilled.
--
-- What a row holds (and nothing else): the two accounts; who the representative is (FAMILLE | MJPM, the MJPM form of CASF L471-2, an optional ADA Pro
-- structure and SIRET); the FACTS extracted from the court decision by the administrator who examined it (measure, mode, scope personne / biens, court,
-- decision date, end date) — never the decision itself, never its text, never a medical certificate: the court case number is kept only as a keyed HMAC
-- (duplicate detection); the platform areas the verified decision covers; the state and the verification record (when, by which administrator, how,
-- a short note); the end (when, by whom, why).
CREATE TABLE "LegalProtectionMandate" (
	"id" text PRIMARY KEY NOT NULL,
	"protectedUserId" text NOT NULL,
	"representativeUserId" text NOT NULL,
	"representativeKind" text NOT NULL,
	"mjpmForm" text,
	"structureId" text,
	"siret" text,
	"measure" text NOT NULL,
	"mode" text NOT NULL,
	"scopePerson" boolean DEFAULT false NOT NULL,
	"scopeAssets" boolean DEFAULT false NOT NULL,
	"areas" text[] DEFAULT '{}'::text[] NOT NULL,
	"courtName" text NOT NULL,
	"decisionDate" date NOT NULL,
	"measureEndsOn" date,
	"validUntil" date,
	"decisionRefHmac" text,
	"status" text DEFAULT 'DECLARED' NOT NULL,
	"personContestedAt" timestamp (3),
	"verifiedAt" timestamp (3),
	"verifiedBy" text,
	"verificationMethod" text,
	"verificationNote" text,
	"endedAt" timestamp (3),
	"endedBy" text,
	"endReason" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "LegalProtectionMandate_not_self_check" CHECK ("protectedUserId" <> "representativeUserId"),
	CONSTRAINT "LegalProtectionMandate_kind_check" CHECK ("representativeKind" IN ('FAMILLE', 'MJPM')),
	-- CASF L471-2: the three categories on the préfet's list (service mandataire, mandataire individuel agréé, préposé d'établissement)
	CONSTRAINT "LegalProtectionMandate_mjpm_form_check" CHECK (("representativeKind" = 'MJPM') = ("mjpmForm" IS NOT NULL) AND ("mjpmForm" IS NULL OR "mjpmForm" IN ('SERVICE', 'INDIVIDUEL', 'PREPOSE'))),
	CONSTRAINT "LegalProtectionMandate_pro_fields_check" CHECK ("representativeKind" = 'MJPM' OR ("structureId" IS NULL AND "siret" IS NULL)),
	CONSTRAINT "LegalProtectionMandate_siret_check" CHECK ("siret" IS NULL OR "siret" ~ '^[0-9]{14}$'),
	CONSTRAINT "LegalProtectionMandate_measure_check" CHECK ("measure" IN ('TUTELLE', 'CURATELLE_SIMPLE', 'CURATELLE_RENFORCEE', 'CURATELLE_AMENAGEE',
		'HABILITATION_FAMILIALE_GENERALE', 'HABILITATION_FAMILIALE_SPECIALE', 'SAUVEGARDE_MANDAT_SPECIAL')),
	CONSTRAINT "LegalProtectionMandate_mode_check" CHECK ("mode" IN ('REPRESENTATION', 'ASSISTANCE')),
	-- Code civil art. 440 / 473 (tutelle: représentation), art. 440 / 467 (curatelle: assistance); habilitation familiale (art. 494-1) and mandat spécial
	-- (art. 437) can be either, as the decision says
	CONSTRAINT "LegalProtectionMandate_measure_mode_check" CHECK (("measure" <> 'TUTELLE' OR "mode" = 'REPRESENTATION') AND ("measure" NOT LIKE 'CURATELLE_%' OR "mode" = 'ASSISTANCE')),
	-- Code civil art. 494-1: only ascendants, descendants, brothers and sisters, spouse, PACS partner or concubin can be habilitated — never an MJPM
	CONSTRAINT "LegalProtectionMandate_habilitation_family_check" CHECK ("measure" NOT LIKE 'HABILITATION_FAMILIALE_%' OR "representativeKind" = 'FAMILLE'),
	CONSTRAINT "LegalProtectionMandate_scope_check" CHECK ("scopePerson" OR "scopeAssets"),
	CONSTRAINT "LegalProtectionMandate_areas_check" CHECK ("areas" <@ ARRAY['RDV', 'PARCOURS']::text[]),
	CONSTRAINT "LegalProtectionMandate_court_check" CHECK (char_length("courtName") BETWEEN 3 AND 120),
	CONSTRAINT "LegalProtectionMandate_dates_check" CHECK (("measureEndsOn" IS NULL OR "measureEndsOn" > "decisionDate") AND ("validUntil" IS NULL OR "validUntil" > "decisionDate")),
	-- a measure with a term must have its end date (only the habilitation familiale spéciale ends with the acts it covers: art. 494-6 / 494-11 4°)
	CONSTRAINT "LegalProtectionMandate_term_check" CHECK ("measure" = 'HABILITATION_FAMILIALE_SPECIALE' OR "measureEndsOn" IS NOT NULL),
	CONSTRAINT "LegalProtectionMandate_status_check" CHECK ("status" IN ('DECLARED', 'VERIFIED', 'SUSPENDED', 'REJECTED', 'ENDED')),
	-- VERIFIED (and SUSPENDED, a verified link the person contested) always carries its verification record and its platform end date
	CONSTRAINT "LegalProtectionMandate_verified_check" CHECK ("status" NOT IN ('VERIFIED', 'SUSPENDED') OR ("verifiedAt" IS NOT NULL AND "verifiedBy" IS NOT NULL AND "verificationMethod" IS NOT NULL AND "validUntil" IS NOT NULL AND cardinality("areas") >= 1)),
	CONSTRAINT "LegalProtectionMandate_method_check" CHECK ("verificationMethod" IS NULL OR "verificationMethod" IN ('ORIGINAL_SHOWN', 'CERTIFIED_COPY_EXAMINED', 'COURT_CONFIRMATION')),
	CONSTRAINT "LegalProtectionMandate_note_check" CHECK ("verificationNote" IS NULL OR (char_length("verificationNote") BETWEEN 10 AND 500 AND "verificationNote" !~ '[<>]')),
	CONSTRAINT "LegalProtectionMandate_ended_check" CHECK (("status" IN ('REJECTED', 'ENDED')) = ("endedAt" IS NOT NULL) AND ("endedAt" IS NULL OR ("endedBy" IS NOT NULL AND "endReason" IS NOT NULL))),
	CONSTRAINT "LegalProtectionMandate_ended_by_check" CHECK ("endedBy" IS NULL OR "endedBy" IN ('REPRESENTATIVE', 'ADMIN')),
	CONSTRAINT "LegalProtectionMandate_end_reason_check" CHECK ("endReason" IS NULL OR "endReason" IN ('RENOUNCED', 'NOT_VERIFIED', 'MAINLEVEE', 'MEASURE_CHANGED', 'CONTEST_UPHELD', 'DECEASED', 'OTHER')),
	CONSTRAINT "LegalProtectionMandate_hmac_check" CHECK ("decisionRefHmac" IS NULL OR "decisionRefHmac" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "LegalProtectionMandate" ADD CONSTRAINT "LegalProtectionMandate_protected_fkey" FOREIGN KEY ("protectedUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "LegalProtectionMandate" ADD CONSTRAINT "LegalProtectionMandate_representative_fkey" FOREIGN KEY ("representativeUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "LegalProtectionMandate" ADD CONSTRAINT "LegalProtectionMandate_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "LegalProtectionMandate_protected_idx" ON "LegalProtectionMandate" USING btree ("protectedUserId");--> statement-breakpoint
CREATE INDEX "LegalProtectionMandate_representative_idx" ON "LegalProtectionMandate" USING btree ("representativeUserId");--> statement-breakpoint
CREATE INDEX "LegalProtectionMandate_status_idx" ON "LegalProtectionMandate" USING btree ("status");--> statement-breakpoint
-- one live link per (protected person, representative): a renewal or a change of measure is a new declaration once the old one has ended
CREATE UNIQUE INDEX "LegalProtectionMandate_live_key" ON "LegalProtectionMandate" USING btree ("protectedUserId", "representativeUserId") WHERE "status" IN ('DECLARED', 'VERIFIED', 'SUSPENDED');
