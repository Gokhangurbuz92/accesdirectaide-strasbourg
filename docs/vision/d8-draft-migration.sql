-- =====================================================================================================================================================
-- D8 DRAFT — Organisation / Établissement / Service / Droits-dispositifs / Routes d'orientation. NOT A MIGRATION. NOT APPLIED. NOT JOURNALED.
-- Kept OUTSIDE drizzle/ on purpose (owner decision D8, 17/11/2026: Production restructuring DEFERRED; LAB analysis and design YES).
-- Design and rules: docs/vision/D8_ORGANISATION_ETABLISSEMENT_SERVICE_DESIGN.md (§5 stage 1). A real migration would take the next free number after the
-- integrator's last one (0053+ at the time of writing) and be split per stage; it needs an explicit owner decision before any Production run.
--
-- STAGE 1 ONLY: additive. New tables, nullable columns, non-unique indexes and read views. No existing column, constraint, index or row is changed or
-- removed (the UNIQUE on "Structure".siret stays: dropping it is stage 4, a separate decision). Nothing is backfilled here (backfill = stage 2 scripts,
-- dry-run first, identifiers only, never a name or an address turned into an identity). Current code does not read any of these objects.
-- Syntax checked on a disposable LAB database (PostgreSQL, the 0000–0052 schema): UP then DOWN, leaving the schema as before (see the design note §8).
-- =====================================================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------------------------------------- UP
BEGIN;

-- Organisation: the legal or operating body. An identifier or nothing: SIREN (INSEE, 9 digits), RNA (W + 9 characters), FINESS EJ (9 characters).
-- A row without any identifier exists only when a person records it with evidence (identityBasis = 'HUMAN_EVIDENCE'); it is never derived from a name.
CREATE TABLE IF NOT EXISTS "Organisation" (
	"id" text PRIMARY KEY NOT NULL,
	"nom" text,                                   -- the registry's legal name; NULL until read from the registry (never copied from an establishment's name)
	"nomSource" text,                             -- the official page the name was read from
	"siren" text,
	"rna" text,
	"finessEj" text,
	"kind" text,                                  -- closed vocabulary decided later (collectivité, établissement public, association, entreprise...); NULL = unknown
	"identityBasis" text NOT NULL,                -- SIREN | RNA | FINESS_EJ | HUMAN_EVIDENCE
	"identityEvidenceUrl" text,                   -- required when identityBasis = 'HUMAN_EVIDENCE' (D-5 allow-list, checked by the code like the duplicate register)
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "Organisation_siren_format" CHECK ("siren" IS NULL OR "siren" ~ '^[0-9]{9}$'),
	CONSTRAINT "Organisation_rna_format" CHECK ("rna" IS NULL OR "rna" ~ '^W[0-9A-Z]{9}$'),
	CONSTRAINT "Organisation_finess_ej_format" CHECK ("finessEj" IS NULL OR "finessEj" ~ '^[0-9][0-9AB][0-9]{7}$'),
	CONSTRAINT "Organisation_identity_basis" CHECK ("identityBasis" IN ('SIREN', 'RNA', 'FINESS_EJ', 'HUMAN_EVIDENCE')),
	CONSTRAINT "Organisation_identity_present" CHECK (
		("identityBasis" = 'SIREN' AND "siren" IS NOT NULL) OR ("identityBasis" = 'RNA' AND "rna" IS NOT NULL)
		OR ("identityBasis" = 'FINESS_EJ' AND "finessEj" IS NOT NULL) OR ("identityBasis" = 'HUMAN_EVIDENCE' AND "identityEvidenceUrl" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "Organisation_siren_key" ON "Organisation" ("siren") WHERE "siren" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Organisation_rna_key" ON "Organisation" ("rna") WHERE "rna" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Organisation_finess_ej_key" ON "Organisation" ("finessEj") WHERE "finessEj" IS NOT NULL;

-- Établissement = the existing "Structure" row (same id: every reference of the 28 tables that name a structure keeps working).
-- Two nullable columns: the organisation it belongs to (and on what basis), and the kind of site from a closed vocabulary (NULL = not classified, PKG-1 N2).
ALTER TABLE "Structure" ADD COLUMN IF NOT EXISTS "organisationId" text;
ALTER TABLE "Structure" ADD COLUMN IF NOT EXISTS "organisationBasis" text;   -- SIREN | RNA | FINESS_EJ | DUPLICATE_DECISION | HUMAN_EVIDENCE
ALTER TABLE "Structure" ADD COLUMN IF NOT EXISTS "siteKind" text;            -- RECEPTION | HEADQUARTERS | PHONE_ONLY | ONLINE_ONLY | MOBILE; NULL = unknown
ALTER TABLE "Structure" ADD COLUMN IF NOT EXISTS "finessEj" text;            -- as read from the FINESS file (the CSV importer documents nofinessej and does not extract it; FINESS+ parses it and drops it)
DO $$ BEGIN
	ALTER TABLE "Structure" ADD CONSTRAINT "Structure_organisation_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "Structure" ADD CONSTRAINT "Structure_organisation_basis_check" CHECK ("organisationBasis" IS NULL OR "organisationBasis" IN ('SIREN', 'RNA', 'FINESS_EJ', 'DUPLICATE_DECISION', 'HUMAN_EVIDENCE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "Structure" ADD CONSTRAINT "Structure_site_kind_check" CHECK ("siteKind" IS NULL OR "siteKind" IN ('RECEPTION', 'HEADQUARTERS', 'PHONE_ONLY', 'ONLINE_ONLY', 'MOBILE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Structure_organisation_idx" ON "Structure" ("organisationId");
-- the SIRET of a place is NOT unique in ADA (one manager SIRET on many places; one SIRET for an EHPAD and its SSIAD): a plain index next to the existing UNIQUE
CREATE INDEX IF NOT EXISTS "Structure_siret_digits_idx" ON "Structure" ((regexp_replace(coalesce("siret", ''), '[^0-9]', '', 'g')));

-- Service: what is offered, at one establishment (or by an organisation without a site: a phone line), with its ORIGIN. Never merged across origins.
CREATE TABLE IF NOT EXISTS "Service" (
	"id" text PRIMARY KEY NOT NULL,
	"etablissementId" text,                       -- "Structure".id; NULL only for a service without a site (then organisationId is required)
	"organisationId" text,
	"origin" text NOT NULL,                       -- FINESS_ACTIVITY | DATA_INCLUSION | ADA_PRO | DIRECTORY_TEXT | HUMAN_REVIEWED
	"externalRef" text,                           -- FINESS activity id, data·inclusion service id...
	"label" text NOT NULL,
	"producer" text,                              -- the producer named by the source (data·inclusion); never presented as verified by the State
	"proRdvServiceId" text,                       -- the bookable service of the ADA Pro space, when it IS this service
	"accessModes" text[] DEFAULT '{}'::text[] NOT NULL,
	"sourceUrl" text,
	"retrievedAt" timestamp (3),
	"withdrawnAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "Service_origin_check" CHECK ("origin" IN ('FINESS_ACTIVITY', 'DATA_INCLUSION', 'ADA_PRO', 'DIRECTORY_TEXT', 'HUMAN_REVIEWED')),
	CONSTRAINT "Service_holder_check" CHECK ("etablissementId" IS NOT NULL OR "organisationId" IS NOT NULL),
	CONSTRAINT "Service_access_modes_check" CHECK ("accessModes" <@ ARRAY['IN_PERSON', 'APPOINTMENT', 'PHONE', 'VIDEO', 'ONLINE', 'HOME_VISIT']::text[]),
	CONSTRAINT "Service_etablissement_fkey" FOREIGN KEY ("etablissementId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "Service_organisation_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "Service_rdv_fkey" FOREIGN KEY ("proRdvServiceId") REFERENCES "ProRdvService"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Service_etablissement_idx" ON "Service" ("etablissementId");
CREATE UNIQUE INDEX IF NOT EXISTS "Service_origin_ref_key" ON "Service" ("etablissementId", "origin", "externalRef") WHERE "externalRef" IS NOT NULL AND "withdrawnAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Service_rdv_key" ON "Service" ("proRdvServiceId") WHERE "proRdvServiceId" IS NOT NULL;

-- Droits / dispositifs reached through a service (replaces, later, Dispositif.related_structure_ids and Aide.structures_links): a LINK, never an entitlement.
CREATE TABLE IF NOT EXISTS "ServiceRight" (
	"serviceId" text NOT NULL,
	"rightKind" text NOT NULL,                    -- AIDE | DEMARCHE | DISPOSITIF
	"rightId" text NOT NULL,
	"sourceUrl" text,                             -- the official page that says this service handles that right; NULL = an editorial link, labelled as such
	"recordedBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "ServiceRight_pkey" PRIMARY KEY ("serviceId", "rightKind", "rightId"),
	CONSTRAINT "ServiceRight_kind_check" CHECK ("rightKind" IN ('AIDE', 'DEMARCHE', 'DISPOSITIF')),
	CONSTRAINT "ServiceRight_service_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Route d'orientation professionnelle: a curated, sourced path « for this need, in this territory, orient to THIS service / establishment ». A referral may
-- follow a route; a referral without route keeps working (toStructureId = the receiving establishment, as today).
CREATE TABLE IF NOT EXISTS "OrientationRoute" (
	"id" text PRIMARY KEY NOT NULL,
	"needCode" text NOT NULL,                     -- the referral reason codes (api/_services/referrals.js REASONS)
	"toEtablissementId" text NOT NULL,
	"toServiceId" text,
	"territoryId" text,                           -- "Territory".id; NULL = the receiver's own service area
	"conditionsText" text,                        -- as written by the receiver or an official source; never an eligibility decision
	"sourceUrl" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,       -- DRAFT | ACTIVE | SUSPENDED | WITHDRAWN
	"recordedBy" text NOT NULL,
	"reviewedBy" text,
	"reviewedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "OrientationRoute_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN')),
	CONSTRAINT "OrientationRoute_active_reviewed" CHECK ("status" <> 'ACTIVE' OR ("reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL)),
	CONSTRAINT "OrientationRoute_etablissement_fkey" FOREIGN KEY ("toEtablissementId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "OrientationRoute_service_fkey" FOREIGN KEY ("toServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE,
	CONSTRAINT "OrientationRoute_territory_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OrientationRoute_need_idx" ON "OrientationRoute" ("needCode", "status");

-- Referral: which service (and which route) was meant. Both nullable; the receiving tenant stays toStructureId.
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "toServiceId" text;
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "routeId" text;
DO $$ BEGIN
	ALTER TABLE "Referral" ADD CONSTRAINT "Referral_service_fkey" FOREIGN KEY ("toServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "Referral" ADD CONSTRAINT "Referral_route_fkey" FOREIGN KEY ("routeId") REFERENCES "OrientationRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Professional scope beyond the home establishment: an EXPLICIT, audited extension (default = today: the member's own "Structure" only). A citizen's grant
-- stays per establishment ("SharedDossierGrant"."structureId"): an organisation-wide scope never widens what a person authorised.
CREATE TABLE IF NOT EXISTS "ProUserEstablishmentScope" (
	"proUserId" text NOT NULL,
	"etablissementId" text NOT NULL,
	"grantedBy" text NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"revokedAt" timestamp (3),
	CONSTRAINT "ProUserEstablishmentScope_pkey" PRIMARY KEY ("proUserId", "etablissementId"),
	CONSTRAINT "ProUserEstablishmentScope_user_fkey" FOREIGN KEY ("proUserId") REFERENCES "ProUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT "ProUserEstablishmentScope_etab_fkey" FOREIGN KEY ("etablissementId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Read views (stage 1: computed from what exists; the same rules as api/lib/structure-model.js). Current code reads none of them.
CREATE OR REPLACE VIEW "v_d8_etablissement_organisation" AS
SELECT s.id AS "etablissementId", k."primaryId" AS "keptId",
	CASE WHEN length(e.digits) = 14 THEN left(e.digits, 9) END AS siren,
	nullif(upper(regexp_replace(coalesce(s.rna_id, ''), '[^0-9A-Za-z]', '', 'g')), '') AS rna,
	CASE WHEN length(e.digits) = 14 THEN 'SIREN' WHEN k."primaryId" IS NOT NULL THEN 'DUPLICATE_DECISION'
		WHEN nullif(s.rna_id, '') IS NOT NULL THEN 'RNA' ELSE 'RECORD' END AS basis
FROM "Structure" s
LEFT JOIN LATERAL (SELECT dd."primaryId" FROM "StructureDuplicateDecision" dd WHERE dd."supersededAt" IS NULL AND dd.decision = 'SAME_ENTITY'
	AND (dd."structureA" = s.id OR dd."structureB" = s.id) AND dd."primaryId" <> s.id ORDER BY dd."decidedAt" DESC LIMIT 1) k ON TRUE
LEFT JOIN "Structure" kp ON kp.id = k."primaryId"
CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(CASE WHEN k."primaryId" IS NOT NULL THEN kp.siret ELSE s.siret END, ''), '[^0-9]', '', 'g') AS digits) e;

CREATE OR REPLACE VIEW "v_d8_service" AS
SELECT s.id AS "etablissementId", CASE WHEN s.numero_finess IS NOT NULL THEN 'FINESS_ACTIVITY' ELSE 'DIRECTORY_TEXT' END AS origin, x.label, NULL::text AS producer, NULL::text AS "proRdvServiceId"
	FROM "Structure" s CROSS JOIN LATERAL unnest(s.services) AS x(label) WHERE btrim(x.label) <> ''
UNION ALL
SELECT s.id, 'DATA_INCLUSION', coalesce(e->>'name', e->>'nom'), e->>'producerLabel', NULL
	FROM "Structure" s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.services_externes->'services') = 'array' THEN s.services_externes->'services' ELSE '[]'::jsonb END) AS e
UNION ALL
SELECT r."structureId", 'ADA_PRO', r.name, NULL, r.id FROM "ProRdvService" r WHERE r."isActive";

COMMIT;

-- -------------------------------------------------------------------------------------------------------------------------------------------- DOWN
-- Stage-1 rollback. Safe while nothing but the stage-2 backfill wrote into these objects (they hold copies of identifiers, re-derivable from the
-- records and the official files). Run as one transaction; the existing schema is left exactly as before.
-- BEGIN;
-- DROP VIEW IF EXISTS "v_d8_service";
-- DROP VIEW IF EXISTS "v_d8_etablissement_organisation";
-- DROP TABLE IF EXISTS "ProUserEstablishmentScope";
-- ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_route_fkey";
-- ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_service_fkey";
-- ALTER TABLE "Referral" DROP COLUMN IF EXISTS "routeId";
-- ALTER TABLE "Referral" DROP COLUMN IF EXISTS "toServiceId";
-- DROP TABLE IF EXISTS "OrientationRoute";
-- DROP TABLE IF EXISTS "ServiceRight";
-- DROP TABLE IF EXISTS "Service";
-- DROP INDEX IF EXISTS "Structure_siret_digits_idx";
-- DROP INDEX IF EXISTS "Structure_organisation_idx";
-- ALTER TABLE "Structure" DROP CONSTRAINT IF EXISTS "Structure_site_kind_check";
-- ALTER TABLE "Structure" DROP CONSTRAINT IF EXISTS "Structure_organisation_basis_check";
-- ALTER TABLE "Structure" DROP CONSTRAINT IF EXISTS "Structure_organisation_fkey";
-- ALTER TABLE "Structure" DROP COLUMN IF EXISTS "finessEj";
-- ALTER TABLE "Structure" DROP COLUMN IF EXISTS "siteKind";
-- ALTER TABLE "Structure" DROP COLUMN IF EXISTS "organisationBasis";
-- ALTER TABLE "Structure" DROP COLUMN IF EXISTS "organisationId";
-- DROP TABLE IF EXISTS "Organisation";
-- COMMIT;
