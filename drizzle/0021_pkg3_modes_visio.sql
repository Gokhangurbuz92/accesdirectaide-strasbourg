ALTER TABLE "ProAppointment" ADD COLUMN "mode" text DEFAULT 'IN_PERSON' NOT NULL;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "visioApprovedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "visioApprovedByProUserId" text;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD COLUMN "visioCitizenConsentAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ProAvailabilityRule" ADD COLUMN "modes" text[] DEFAULT ARRAY['IN_PERSON', 'VIDEO']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ProRdvService" ADD COLUMN "modes" text[] DEFAULT ARRAY['IN_PERSON']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_mode_check" CHECK ("mode" IN ('IN_PERSON', 'VIDEO'));--> statement-breakpoint
ALTER TABLE "ProAppointment" ADD CONSTRAINT "ProAppointment_visio_only_video_check" CHECK (("visioApprovedAt" IS NULL AND "visioCitizenConsentAt" IS NULL) OR "mode" = 'VIDEO');--> statement-breakpoint
ALTER TABLE "ProRdvService" ADD CONSTRAINT "ProRdvService_modes_check" CHECK (cardinality("modes") >= 1 AND "modes" <@ ARRAY['IN_PERSON', 'VIDEO']::text[]);--> statement-breakpoint
ALTER TABLE "ProAvailabilityRule" ADD CONSTRAINT "ProAvailabilityRule_modes_check" CHECK (cardinality("modes") >= 1 AND "modes" <@ ARRAY['IN_PERSON', 'VIDEO']::text[]);
