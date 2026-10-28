CREATE TYPE "public"."AidCategoryCode" AS ENUM('LOGEMENT', 'SANTE', 'HANDICAP', 'EMPLOI', 'FAMILLE', 'ETUDES', 'MOBILITE', 'ENERGIE', 'ALIMENTATION', 'JUSTICE', 'NUMERIQUE', 'AUTRE');--> statement-breakpoint
CREATE TYPE "public"."AidStatus" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."ContentType" AS ENUM('AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE');--> statement-breakpoint
CREATE TYPE "public"."IngestJobStatus" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."RdvBookingMode" AS ENUM('IN_PERSON', 'VIDEO', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."ReportReason" AS ENUM('LIEN_MORT', 'HORAIRES_FAUX', 'INFO_FAUSSE', 'INFO_OBSOLETE', 'AUTRE');--> statement-breakpoint
CREATE TYPE "public"."ReportStatus" AS ENUM('NEW', 'IN_PROGRESS', 'FIXED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "Actualite" (
	"id" text PRIMARY KEY NOT NULL,
	"titre" text NOT NULL,
	"contenu" text,
	"date_publication" timestamp (3) DEFAULT now() NOT NULL,
	"image_url" text,
	"lien_url" text,
	"source" text,
	"updatedAt" timestamp (3) NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"updatedBy" text,
	"commentaire_statut" text,
	"published_at" timestamp (3),
	"canonical_url" text,
	"category" text DEFAULT 'actualite',
	"dedupe_hash" text,
	"fetched_at" timestamp (3),
	"guid" text,
	"key_points_falc" text[] NOT NULL,
	"slug" text,
	"source_id" text,
	"source_name" text,
	"summary_falc" text,
	"territoire" text DEFAULT 'FRANCE',
	"auto_publish" boolean DEFAULT false NOT NULL,
	"categorie" text DEFAULT 'general',
	"departements" text[] NOT NULL,
	"est_important" boolean DEFAULT false NOT NULL,
	"falc_status" text DEFAULT 'pending' NOT NULL,
	"ingest_batch" text,
	"quality_score" integer DEFAULT 0 NOT NULL,
	"raw_data_hash" text,
	"raw_payload_json" jsonb,
	"resume" text,
	"score_fiabilite" integer NOT NULL,
	"source_nom" text,
	"source_url" text,
	"tags" text[] NOT NULL,
	"type_actu" text DEFAULT 'info',
	"url" text,
	"source_document_id" text,
	CONSTRAINT "Actualite_canonical_url_unique" UNIQUE("canonical_url"),
	CONSTRAINT "Actualite_slug_unique" UNIQUE("slug"),
	CONSTRAINT "Actualite_raw_data_hash_unique" UNIQUE("raw_data_hash")
);
--> statement-breakpoint
CREATE TABLE "AdminUser" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"failedLoginAttempts" integer NOT NULL,
	"lastLogin" timestamp (3),
	"lockoutUntil" timestamp (3),
	"mfaSecret" text,
	"mfaIv" text,
	"mfaEnabled" boolean NOT NULL,
	CONSTRAINT "AdminUser_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "AidCategory" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "AidCategory_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "AidSituation" (
	"id" text PRIMARY KEY NOT NULL,
	"aidId" text NOT NULL,
	"situationId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AidSource" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"baseUrl" text,
	"license" text,
	"refreshPolicy" text,
	"lastRunAt" timestamp (3),
	"lastStatus" text
);
--> statement-breakpoint
CREATE TABLE "Aide" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text,
	"titre" text NOT NULL,
	"categorie" text,
	"est_urgent" boolean DEFAULT false NOT NULL,
	"territoires" text[] DEFAULT '{}' NOT NULL,
	"date_verification" timestamp (3),
	"delai_indicatif" text,
	"cest_quoi" text,
	"pour_qui" text,
	"ce_que_ca_aide" text,
	"documents_necessaires" text[] DEFAULT '{}' NOT NULL,
	"etapes" jsonb,
	"ou_demander" text,
	"lien_demande" text,
	"updatedAt" timestamp (3) NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"updatedBy" text,
	"quality_score" integer DEFAULT 0 NOT NULL,
	"commentaire_statut" text,
	"published_at" timestamp (3),
	"mots_cles" text[] DEFAULT '{}' NOT NULL,
	"summary_falc" text,
	"audiences" text[] DEFAULT '{}' NOT NULL,
	"conditions_falc" text,
	"departements" text[] DEFAULT '{}' NOT NULL,
	"montant_falc" text,
	"situations_vie" text[] DEFAULT '{}' NOT NULL,
	"structures_links" text[] DEFAULT '{}' NOT NULL,
	"categoryId" text,
	"providerName" text,
	"providerType" text,
	"sourceId" text,
	"source_name" text,
	"source_url" text,
	"title" text,
	"description" text,
	"content" text,
	"category_code" "AidCategoryCode" DEFAULT 'AUTRE' NOT NULL,
	"status_code" "AidStatus" DEFAULT 'DRAFT' NOT NULL,
	"eligibility" jsonb,
	"financials" jsonb,
	"citations" jsonb,
	"qa_score" integer DEFAULT 0 NOT NULL,
	"qa_report" jsonb,
	"source_org" text,
	"source_hash" text,
	"last_checked" timestamp (3),
	"geo_scope" text,
	"source_url_exact" text,
	"territory_scope" text,
	"region_codes" text[] DEFAULT '{}' NOT NULL,
	"department_codes" text[] DEFAULT '{}' NOT NULL,
	"insee_codes" text[] DEFAULT '{}' NOT NULL,
	"content_hash" text,
	"theme" text,
	"sub_theme" text,
	"apply_url" text,
	"source_last_modified" timestamp (3),
	"fetched_at" timestamp (3),
	"montant_max" text,
	"echelon_territorial" text,
	"code_insee_territoire" text,
	"lien_demarche" text,
	"source_donnee" text,
	"retrieved_at" timestamp (3),
	"last_checked_at" timestamp (3),
	"source_document_id" text,
	"externalId" text,
	CONSTRAINT "Aide_slug_unique" UNIQUE("slug"),
	CONSTRAINT "Aide_externalId_unique" UNIQUE("externalId")
);
--> statement-breakpoint
CREATE TABLE "_AideToLifeSituation" (
	"A" text NOT NULL,
	"B" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor" text,
	"target" text,
	"details" jsonb,
	"timestamp" timestamp (3) DEFAULT now() NOT NULL,
	"ip" text,
	"actor_id" text,
	"entity" text,
	"entity_id" text,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "AuthToken" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"usedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "AuthToken_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "CitizenUser" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"emailVerifiedAt" timestamp (3),
	"phone" text,
	"phoneVerifiedAt" timestamp (3),
	"notificationEmailEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "CitizenUser_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ConsentLog" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_version" text NOT NULL,
	"policy_hash" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ContentReport" (
	"id" text PRIMARY KEY NOT NULL,
	"contentType" "ContentType" NOT NULL,
	"contentId" text NOT NULL,
	"reason" "ReportReason" NOT NULL,
	"message" text,
	"pageUrl" text,
	"reporterEmail" text,
	"status" "ReportStatus" DEFAULT 'NEW' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ConversationLog" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"message" text NOT NULL,
	"intent" text,
	"searchMode" text DEFAULT 'rag' NOT NULL,
	"sourceCount" integer NOT NULL,
	"sessionId" text,
	"metadata" jsonb,
	"rating" integer,
	"userComment" text
);
--> statement-breakpoint
CREATE TABLE "CronRun" (
	"id" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text,
	"skipReason" text,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"finishedAt" timestamp (3),
	"durationMs" integer,
	"requestId" text,
	"vercelEnv" text,
	"release" text,
	"metrics" jsonb,
	"errorSample" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Demarche" (
	"id" text PRIMARY KEY NOT NULL,
	"titre" text NOT NULL,
	"categorie" text,
	"description_courte" text,
	"delai" text,
	"cout" text,
	"date_verification" timestamp (3),
	"pour_qui" text,
	"documents_necessaires" text[] DEFAULT '{}' NOT NULL,
	"etapes" jsonb,
	"ou_faire" text,
	"lien_officiel" text,
	"sources" jsonb,
	"updatedAt" timestamp (3) NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"updatedBy" text,
	"quality_score" integer DEFAULT 0 NOT NULL,
	"commentaire_statut" text,
	"published_at" timestamp (3),
	"mots_cles" text[] DEFAULT '{}' NOT NULL,
	"slug" text,
	"summary_falc" text,
	"audiences" text[] DEFAULT '{}' NOT NULL,
	"departements" text[] DEFAULT '{}' NOT NULL,
	"categoryId" text,
	"public_cible" text,
	"contenu_detaille" text,
	"lien_teleservice" text,
	"source_url_exact" text,
	"territory_scope" text,
	"region_codes" text[] DEFAULT '{}' NOT NULL,
	"department_codes" text[] DEFAULT '{}' NOT NULL,
	"insee_codes" text[] DEFAULT '{}' NOT NULL,
	"content_hash" text,
	"source_url" text,
	"retrieved_at" timestamp (3),
	"last_checked_at" timestamp (3),
	"source_last_modified" timestamp (3),
	"source_document_id" text,
	CONSTRAINT "Demarche_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "Dispositif" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text,
	"titre" text NOT NULL,
	"description_falc" text,
	"public" text[] NOT NULL,
	"departement" text,
	"montant" text,
	"liens" jsonb,
	"status" text DEFAULT 'actif' NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"published_at" timestamp (3),
	"summary_falc" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"source_url_exact" text,
	"territory_scope" text,
	"content_hash" text,
	"source_url" text,
	"retrieved_at" timestamp (3),
	"last_checked_at" timestamp (3),
	"source_last_modified" timestamp (3),
	"source_document_id" text,
	CONSTRAINT "Dispositif_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "EntityVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"reason" text,
	"actor_email" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Guide" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"titre" text NOT NULL,
	"resume_falc" text,
	"contenu_json" jsonb,
	"categorie" text,
	"publics" text[] NOT NULL,
	"contexte" text[] NOT NULL,
	"mots_cles" text[] NOT NULL,
	"sources_urls" text[] NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"published_at" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "Guide_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ImportLog" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"source_name" text NOT NULL,
	"status" text NOT NULL,
	"items_total" integer NOT NULL,
	"items_new" integer NOT NULL,
	"items_updated" integer NOT NULL,
	"items_skipped" integer NOT NULL,
	"duration_ms" integer,
	"logs" jsonb,
	"error_count" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "IngestJob" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"status" "IngestJobStatus" DEFAULT 'PENDING' NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"error_message" text,
	"started_at" timestamp (3),
	"finished_at" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp (3) NOT NULL,
	"used_at" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "Invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "LifeSituation" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "LifeSituation_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "PartnershipRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"structureName" text NOT NULL,
	"city" text,
	"type" text,
	"website" text NOT NULL,
	"email" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"consent" boolean NOT NULL,
	"ip_hash" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProAppointment" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"serviceId" text NOT NULL,
	"startAt" timestamp (3) NOT NULL,
	"endAt" timestamp (3) NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"beneficiaryName" text NOT NULL,
	"beneficiaryPhone" text,
	"notes" text,
	"createdByProUserId" text,
	"citizenUserId" text,
	"citizenEmailSnapshot" text,
	"idempotencyKey" text,
	"cancelledAt" timestamp (3),
	"cancelledBy" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"visioRoomId" text,
	"visioEnabled" boolean DEFAULT false NOT NULL,
	"visioStartedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ProAuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"proUserId" text NOT NULL,
	"action" text NOT NULL,
	"entityType" text,
	"entityId" text,
	"metadata" jsonb,
	"structureId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProAvailabilityRule" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"weekday" integer NOT NULL,
	"startTime" text NOT NULL,
	"endTime" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"conversationId" text NOT NULL,
	"senderId" text NOT NULL,
	"contentEncrypted" text NOT NULL,
	"iv" text NOT NULL,
	"readAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ProNotification" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"structureId" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"readAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "ProOutlookToken" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"email" text,
	"accessTokenEnc" text NOT NULL,
	"refreshTokenEnc" text NOT NULL,
	"iv" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"scope" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ProOutlookToken_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "ProRdvService" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"name" text NOT NULL,
	"durationMinutes" integer NOT NULL,
	"bufferBeforeMinutes" integer DEFAULT 0 NOT NULL,
	"bufferAfterMinutes" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProTimeOff" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"startAt" timestamp (3) NOT NULL,
	"endAt" timestamp (3) NOT NULL,
	"reason" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProUser" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"structureId" text NOT NULL,
	"notificationEmailEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text
);
--> statement-breakpoint
CREATE TABLE "RdvConversation" (
	"id" text PRIMARY KEY NOT NULL,
	"appointmentId" text NOT NULL,
	"structureId" text NOT NULL,
	"citizenUserId" text NOT NULL,
	"lastMessageAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "RdvConversation_appointmentId_unique" UNIQUE("appointmentId")
);
--> statement-breakpoint
CREATE TABLE "RdvConversationMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"senderType" text NOT NULL,
	"senderCitizenUserId" text,
	"senderProUserId" text,
	"body" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RdvNotificationLog" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'MESSAGE_EMAIL' NOT NULL,
	"conversationId" text NOT NULL,
	"messageId" text NOT NULL,
	"recipientType" text NOT NULL,
	"sentAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ResourceAccessibility" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"content" text,
	"source_url" text,
	"territory_scope" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"retrieved_at" timestamp (3),
	"last_checked_at" timestamp (3),
	"source_last_modified" timestamp (3),
	CONSTRAINT "ResourceAccessibility_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ReviewQueueItem" (
	"id" text PRIMARY KEY NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"entitySlug" text,
	"title" text,
	"reason" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RssSource" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"feed_url" text NOT NULL,
	"domain" text NOT NULL,
	"trust_level" text DEFAULT 'OFFICIAL' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp (3),
	"etag" text,
	"last_modified" text,
	"error_count" integer NOT NULL,
	"last_error" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "RssSource_feed_url_unique" UNIQUE("feed_url")
);
--> statement-breakpoint
CREATE TABLE "SharedDiagnostic" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"situation" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"viewCount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Situation" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "Situation_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "Source" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"url" text,
	"status" text DEFAULT 'actif' NOT NULL,
	"trust_level" text,
	"last_sync" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "SourceDocument" (
	"id" text PRIMARY KEY NOT NULL,
	"source_url" text,
	"fetched_at" timestamp (3) DEFAULT now() NOT NULL,
	"content_hash" text,
	"raw_content" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "SourceSnapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"fetched_at" timestamp (3) DEFAULT now() NOT NULL,
	"raw_excerpt" text,
	"content_hash" text,
	"http_status" integer,
	"final_url" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Structure" (
	"id" text PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"type_structure" text,
	"accessibilite_pmr" boolean DEFAULT false NOT NULL,
	"description_courte" text,
	"adresse" text,
	"code_postal" text,
	"ville" text,
	"departement" text,
	"telephone" text,
	"email" text,
	"site_web" text,
	"horaires" text,
	"services" text[] NOT NULL,
	"publics_accueillis" text[] NOT NULL,
	"date_verification" timestamp (3),
	"categories_aidees" text[] NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"status" text DEFAULT 'actif' NOT NULL,
	"commentaire_statut" text,
	"published_at" timestamp (3),
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"updatedBy" text,
	"mots_cles" text[] DEFAULT '{}' NOT NULL,
	"slug" text,
	"summary_falc" text,
	"is_pro_enabled" boolean DEFAULT false NOT NULL,
	"settings_json" jsonb DEFAULT '{}',
	"auto_publish" boolean DEFAULT false NOT NULL,
	"geoloc_status" text,
	"import_batch" text,
	"import_status" text DEFAULT 'pending' NOT NULL,
	"last_sync" timestamp (3) DEFAULT now() NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"quality_score" integer DEFAULT 50 NOT NULL,
	"raw_data_hash" text,
	"siret" text,
	"source_id" text,
	"source_url" text,
	"source_url_exact" text,
	"territory_scope" text,
	"region_codes" text[] DEFAULT '{}' NOT NULL,
	"department_codes" text[] DEFAULT '{}' NOT NULL,
	"insee_codes" text[] DEFAULT '{}' NOT NULL,
	"content_hash" text,
	"type_finess" text,
	"numero_finess" text,
	"rna_id" text,
	"source_annuaire" text,
	"retrieved_at" timestamp (3),
	"last_checked_at" timestamp (3),
	"source_last_modified" timestamp (3),
	"source_document_id" text,
	CONSTRAINT "Structure_slug_unique" UNIQUE("slug"),
	CONSTRAINT "Structure_raw_data_hash_unique" UNIQUE("raw_data_hash"),
	CONSTRAINT "Structure_siret_unique" UNIQUE("siret"),
	CONSTRAINT "Structure_numero_finess_unique" UNIQUE("numero_finess"),
	CONSTRAINT "Structure_rna_id_unique" UNIQUE("rna_id")
);
--> statement-breakpoint
CREATE TABLE "StructureRdvSettings" (
	"id" text PRIMARY KEY NOT NULL,
	"structureId" text NOT NULL,
	"isPublished" boolean NOT NULL,
	"bookingMode" "RdvBookingMode" DEFAULT 'IN_PERSON' NOT NULL,
	"contactEmail" text,
	"contactPhone" text,
	"publishedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "StructureRdvSettings_structureId_unique" UNIQUE("structureId")
);
--> statement-breakpoint
CREATE TABLE "SyncRun" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"status" text NOT NULL,
	"started_at" timestamp (3) DEFAULT now() NOT NULL,
	"ended_at" timestamp (3),
	"error" text,
	"stats" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ToolboxItem" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"titre" text NOT NULL,
	"resume_falc" text,
	"type" text NOT NULL,
	"categorie" text,
	"publics" text[] NOT NULL,
	"url_download" text,
	"contenu_html" text,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"published_at" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ToolboxItem_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "UpdateLog" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp (3) DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer,
	"items_fetched_count" integer NOT NULL,
	"items_created_count" integer NOT NULL,
	"items_updated_count" integer NOT NULL,
	"items_skipped_count" integer NOT NULL,
	"errors" text[] NOT NULL,
	"source_name" text,
	"is_dry_run" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserConsent" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"citizenId" text NOT NULL,
	"structureId" text NOT NULL,
	"purpose" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"ipAddress" text
);
--> statement-breakpoint
ALTER TABLE "Actualite" ADD CONSTRAINT "Actualite_sourceDocument_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."SourceDocument"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AidSituation" ADD CONSTRAINT "AidSituation_aid_fkey" FOREIGN KEY ("aidId") REFERENCES "public"."Aide"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AidSituation" ADD CONSTRAINT "AidSituation_situation_fkey" FOREIGN KEY ("situationId") REFERENCES "public"."Situation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Aide" ADD CONSTRAINT "Aide_category_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."AidCategory"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Aide" ADD CONSTRAINT "Aide_source_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."AidSource"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Aide" ADD CONSTRAINT "Aide_sourceDocument_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."SourceDocument"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "_AideToLifeSituation" ADD CONSTRAINT "_AideToLifeSituation_LifeSituation_fkey" FOREIGN KEY ("A") REFERENCES "public"."LifeSituation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "_AideToLifeSituation" ADD CONSTRAINT "_AideToLifeSituation_Aide_fkey" FOREIGN KEY ("B") REFERENCES "public"."Aide"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Demarche" ADD CONSTRAINT "Demarche_category_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."AidCategory"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Demarche" ADD CONSTRAINT "Demarche_sourceDocument_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."SourceDocument"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Dispositif" ADD CONSTRAINT "Dispositif_sourceDocument_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."SourceDocument"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_createdByProUser_fkey" FOREIGN KEY ("createdByProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_citizenUser_fkey" FOREIGN KEY ("citizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_service_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."ProRdvService"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProAuditLog" ADD CONSTRAINT "ProAuditLog_proUser_fkey" FOREIGN KEY ("proUserId") REFERENCES "public"."ProUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProAvailabilityRule" ADD CONSTRAINT "ProAvailabilityRule_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProNotification" ADD CONSTRAINT "ProNotification_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."ProUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProOutlookToken" ADD CONSTRAINT "ProOutlookToken_user_fkey" FOREIGN KEY ("userId") REFERENCES "public"."ProUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProRdvService" ADD CONSTRAINT "ProRdvService_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProTimeOff" ADD CONSTRAINT "ProTimeOff_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProUser" ADD CONSTRAINT "ProUser_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvConversation" ADD CONSTRAINT "RdvConversation_appointment_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."ProAppointment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvConversation" ADD CONSTRAINT "RdvConversation_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvConversation" ADD CONSTRAINT "RdvConversation_citizenUser_fkey" FOREIGN KEY ("citizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvConversationMessage" ADD CONSTRAINT "RdvConversationMessage_conversation_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."RdvConversation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvConversationMessage" ADD CONSTRAINT "RdvConversationMessage_senderCitizenUser_fkey" FOREIGN KEY ("senderCitizenUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvConversationMessage" ADD CONSTRAINT "RdvConversationMessage_senderProUser_fkey" FOREIGN KEY ("senderProUserId") REFERENCES "public"."ProUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvNotificationLog" ADD CONSTRAINT "RdvNotificationLog_conversation_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."RdvConversation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RdvNotificationLog" ADD CONSTRAINT "RdvNotificationLog_message_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."RdvConversationMessage"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Structure" ADD CONSTRAINT "Structure_sourceDocument_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."SourceDocument"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureRdvSettings" ADD CONSTRAINT "StructureRdvSettings_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AidSituation_aidId_situationId_key" ON "AidSituation" USING btree ("aidId","situationId");--> statement-breakpoint
CREATE UNIQUE INDEX "ProAppointment_citizenUserId_idempotencyKey_key" ON "ProAppointment" USING btree ("citizenUserId","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "ProUser_structureId_email_key" ON "ProUser" USING btree ("structureId","email");--> statement-breakpoint
CREATE UNIQUE INDEX "RdvNotificationLog_messageId_recipientType_key" ON "RdvNotificationLog" USING btree ("messageId","recipientType");--> statement-breakpoint
CREATE UNIQUE INDEX "ReviewQueueItem_entityType_entityId_reason_status_key" ON "ReviewQueueItem" USING btree ("entityType","entityId","reason","status");