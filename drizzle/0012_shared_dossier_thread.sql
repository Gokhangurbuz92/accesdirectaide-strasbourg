CREATE TABLE "SharedDossierMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"threadId" text NOT NULL,
	"senderType" text NOT NULL,
	"senderProUserId" text,
	"body" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SharedDossierThread" (
	"id" text PRIMARY KEY NOT NULL,
	"sharedDiagnosticId" text NOT NULL,
	"structureId" text NOT NULL,
	"openedByProUserId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"lastMessageAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "SharedDossierMessage" ADD CONSTRAINT "SharedDossierMessage_thread_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."SharedDossierThread"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SharedDossierThread" ADD CONSTRAINT "SharedDossierThread_sharedDiagnostic_fkey" FOREIGN KEY ("sharedDiagnosticId") REFERENCES "public"."SharedDiagnostic"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SharedDossierThread" ADD CONSTRAINT "SharedDossierThread_structure_fkey" FOREIGN KEY ("structureId") REFERENCES "public"."Structure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "SharedDossierMessage_thread_createdAt_idx" ON "SharedDossierMessage" USING btree ("threadId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "SharedDossierThread_diagnostic_structure_key" ON "SharedDossierThread" USING btree ("sharedDiagnosticId","structureId");