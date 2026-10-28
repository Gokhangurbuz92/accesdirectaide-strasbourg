CREATE TYPE "public"."ChangeClassification" AS ENUM('RAW_CONTENT_CHANGED', 'NORMALIZED_FACT_CHANGED', 'METADATA_ONLY_CHANGED');--> statement-breakpoint
CREATE TYPE "public"."ConflictResolutionStatus" AS ENUM('PENDING', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."DiffState" AS ENUM('NEW', 'UPDATED', 'UNCHANGED', 'REMOVED', 'CONFLICTING');--> statement-breakpoint
CREATE TYPE "public"."FreshnessAction" AS ENUM('FLAG_STALE', 'AUTO_REFRESH', 'DISABLE');--> statement-breakpoint
CREATE TYPE "public"."SourceCapability" AS ENUM('LEGAL', 'REGULATORY', 'BENEFIT_RULE', 'BENEFIT_PARAMETER', 'PROCEDURAL', 'DIRECTORY', 'STATISTICAL', 'REFERENCE', 'OPEN_DATA_CATALOG', 'LOCAL_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."SourceStatus" AS ENUM('ACTIVE', 'DISABLED', 'PAUSED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."SourceType" AS ENUM('REST_API', 'GRAPHQL', 'HTML_SCRAPER', 'RSS_ATOM', 'CSV', 'XML', 'JSON_FILE', 'CURATED');--> statement-breakpoint
CREATE TABLE "ConflictRecord" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"source_a_id" text,
	"source_b_id" text,
	"conflict_data" jsonb,
	"resolution_status" "ConflictResolutionStatus" DEFAULT 'PENDING' NOT NULL,
	"resolved_by" text,
	"resolution_rationale" text,
	"review_queue_item_id" text,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FreshnessPolicy" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"category_pattern" text,
	"entity_type" text,
	"ttl_days" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"action_on_expire" "FreshnessAction" DEFAULT 'FLAG_STALE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SourceDiff" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"previous_hash" text,
	"current_hash" text,
	"diff_state" "DiffState" NOT NULL,
	"change_classification" "ChangeClassification",
	"detected_at" timestamp (3) DEFAULT now() NOT NULL,
	"processed_at" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "SourceRegistryEntry" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "SourceType" NOT NULL,
	"endpoint" text,
	"cron_schedule" text,
	"auth_config" jsonb,
	"rate_limits" jsonb,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"producer_authority" text,
	"distribution_platform" text,
	"trusted_domains" text[] DEFAULT '{}' NOT NULL,
	"connector_class" text,
	"territory" text,
	"organisation" text,
	"licence_url" text,
	"licence_name" text,
	"reuse_conditions" text,
	"update_frequency" text,
	"status" "SourceStatus" DEFAULT 'ACTIVE' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp (3),
	"last_success_at" timestamp (3),
	"disabled_at" timestamp (3),
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "SourceRegistryEntry_source_id_unique" UNIQUE("source_id")
);
