CREATE TYPE "public"."ApplicabilityEntityType" AS ENUM('BENEFIT', 'PROCEDURE');--> statement-breakpoint
CREATE TYPE "public"."ServiceAreaType" AS ENUM('LOCAL', 'MULTI_TERRITORY', 'REGIONAL', 'DEPARTMENTAL', 'NATIONAL', 'REMOTE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."TerritoryRelationType" AS ENUM('PART_OF', 'MEMBER_OF', 'CONTAINS', 'OVERLAPS', 'REPLACED_BY');--> statement-breakpoint
CREATE TYPE "public"."TerritoryStatus" AS ENUM('CURRENT', 'HISTORICAL');--> statement-breakpoint
CREATE TYPE "public"."TerritoryType" AS ENUM('COUNTRY', 'REGION', 'DEPARTEMENT', 'EPCI', 'COMMUNE', 'COMMUNE_ASSOCIEE', 'COMMUNE_DELEGUEE', 'MUNICIPAL_ARRONDISSEMENT', 'ADMINISTRATIVE_ARRONDISSEMENT', 'SPECIAL_STATUS_COLLECTIVITY', 'QPV');--> statement-breakpoint
CREATE TABLE "Applicability" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" "ApplicabilityEntityType" NOT NULL,
	"entity_id" text NOT NULL,
	"territory_id" text NOT NULL,
	"is_exclusion" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp (3),
	"valid_to" timestamp (3),
	"source_id" text,
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StructureServiceArea" (
	"id" text PRIMARY KEY NOT NULL,
	"structure_id" text NOT NULL,
	"service_type" "ServiceAreaType" NOT NULL,
	"territory_id" text,
	"valid_from" timestamp (3),
	"valid_to" timestamp (3),
	"source_id" text,
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Territory" (
	"id" text PRIMARY KEY NOT NULL,
	"authority" text NOT NULL,
	"type" "TerritoryType" NOT NULL,
	"official_code" text NOT NULL,
	"status" "TerritoryStatus" DEFAULT 'CURRENT' NOT NULL,
	"valid_from" timestamp (3),
	"valid_to" timestamp (3),
	"source_id" text,
	"source_version" text,
	"metadata" jsonb,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TerritoryLabelHistory" (
	"id" text PRIMARY KEY NOT NULL,
	"territory_id" text NOT NULL,
	"name" text NOT NULL,
	"valid_from" timestamp (3),
	"valid_to" timestamp (3),
	"source_id" text,
	"source_version" text,
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TerritoryRelation" (
	"id" text PRIMARY KEY NOT NULL,
	"source_territory_id" text NOT NULL,
	"target_territory_id" text NOT NULL,
	"type" "TerritoryRelationType" NOT NULL,
	"valid_from" timestamp (3),
	"valid_to" timestamp (3),
	"source_ref_id" text,
	"source_version" text,
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "applicability_entity_idx" ON "Applicability" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "applicability_territory_idx" ON "Applicability" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "applicability_lookup_idx" ON "Applicability" USING btree ("entity_type","entity_id","territory_id");--> statement-breakpoint
CREATE INDEX "service_area_structure_idx" ON "StructureServiceArea" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "service_area_territory_idx" ON "StructureServiceArea" USING btree ("territory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "territory_canonical_idx" ON "Territory" USING btree ("authority","type","official_code");--> statement-breakpoint
CREATE INDEX "territory_type_idx" ON "Territory" USING btree ("type");--> statement-breakpoint
CREATE INDEX "territory_status_idx" ON "Territory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "territory_official_code_idx" ON "Territory" USING btree ("official_code");--> statement-breakpoint
CREATE INDEX "label_history_territory_idx" ON "TerritoryLabelHistory" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "relation_source_idx" ON "TerritoryRelation" USING btree ("source_territory_id");--> statement-breakpoint
CREATE INDEX "relation_target_idx" ON "TerritoryRelation" USING btree ("target_territory_id");--> statement-breakpoint
CREATE INDEX "relation_type_idx" ON "TerritoryRelation" USING btree ("type");--> statement-breakpoint
CREATE INDEX "relation_pair_idx" ON "TerritoryRelation" USING btree ("source_territory_id","target_territory_id","type");