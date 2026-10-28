CREATE TABLE "AudienceCategory" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "AudienceCategory_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ModalityType" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"icon" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ModalityType_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "NeedCategory" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "NeedCategory_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ProProfile" (
	"id" text PRIMARY KEY NOT NULL,
	"proUserId" text NOT NULL,
	"displayName" text,
	"jobTitle" text,
	"descriptionPublic" text,
	"photoUrl" text,
	"isPubliclyVisible" boolean DEFAULT false NOT NULL,
	"acceptsNewClients" boolean DEFAULT true NOT NULL,
	"contactMode" text DEFAULT 'both' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ProProfile_proUserId_unique" UNIQUE("proUserId")
);
--> statement-breakpoint
CREATE TABLE "ProProfileAudience" (
	"proProfileId" text NOT NULL,
	"audienceCategoryId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProProfileNeed" (
	"proProfileId" text NOT NULL,
	"needCategoryId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StructureAudience" (
	"structureId" text NOT NULL,
	"audienceCategoryId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StructureModality" (
	"structureId" text NOT NULL,
	"modalityTypeId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StructureNeed" (
	"structureId" text NOT NULL,
	"needCategoryId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ProProfile" ADD CONSTRAINT "ProProfile_proUser_fkey" FOREIGN KEY ("proUserId") REFERENCES "public"."ProUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProProfileAudience" ADD CONSTRAINT "ProProfileAudience_profile_fkey" FOREIGN KEY ("proProfileId") REFERENCES "public"."ProProfile"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProProfileAudience" ADD CONSTRAINT "ProProfileAudience_audience_fkey" FOREIGN KEY ("audienceCategoryId") REFERENCES "public"."AudienceCategory"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProProfileNeed" ADD CONSTRAINT "ProProfileNeed_profile_fkey" FOREIGN KEY ("proProfileId") REFERENCES "public"."ProProfile"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProProfileNeed" ADD CONSTRAINT "ProProfileNeed_need_fkey" FOREIGN KEY ("needCategoryId") REFERENCES "public"."NeedCategory"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureAudience" ADD CONSTRAINT "StructureAudience_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureAudience" ADD CONSTRAINT "StructureAudience_audience_fkey" FOREIGN KEY ("audienceCategoryId") REFERENCES "public"."AudienceCategory"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureModality" ADD CONSTRAINT "StructureModality_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureModality" ADD CONSTRAINT "StructureModality_modality_fkey" FOREIGN KEY ("modalityTypeId") REFERENCES "public"."ModalityType"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureNeed" ADD CONSTRAINT "StructureNeed_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StructureNeed" ADD CONSTRAINT "StructureNeed_need_fkey" FOREIGN KEY ("needCategoryId") REFERENCES "public"."NeedCategory"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ProProfileAudience_pk" ON "ProProfileAudience" USING btree ("proProfileId","audienceCategoryId");--> statement-breakpoint
CREATE UNIQUE INDEX "ProProfileNeed_pk" ON "ProProfileNeed" USING btree ("proProfileId","needCategoryId");--> statement-breakpoint
CREATE UNIQUE INDEX "StructureAudience_pk" ON "StructureAudience" USING btree ("structureId","audienceCategoryId");--> statement-breakpoint
CREATE UNIQUE INDEX "StructureModality_pk" ON "StructureModality" USING btree ("structureId","modalityTypeId");--> statement-breakpoint
CREATE UNIQUE INDEX "StructureNeed_pk" ON "StructureNeed" USING btree ("structureId","needCategoryId");