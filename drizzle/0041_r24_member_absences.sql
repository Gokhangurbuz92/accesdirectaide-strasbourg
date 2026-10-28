-- R24 (owner decision R18.5, 28/10/2026): an absence belongs to one member (NULL = a closure of the whole structure, as before); an administrator may delegate
-- the structure's schedule (opening hours, closures, other members' absences) to a named member.
-- R24 (owner decision R21.1): an institutional account's self-service reset link — only the SHA-256 of the token is stored, with its expiry; one pending link.
ALTER TABLE "ProTimeOff" ADD COLUMN "proUserId" text;--> statement-breakpoint
ALTER TABLE "ProTimeOff" ADD CONSTRAINT "ProTimeOff_proUser_fkey" FOREIGN KEY ("proUserId") REFERENCES "public"."ProUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ProTimeOff_proUserId_idx" ON "ProTimeOff" USING btree ("proUserId");--> statement-breakpoint
ALTER TABLE "ProUser" ADD COLUMN "canManageSchedule" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "InstitutionAccount" ADD COLUMN "resetTokenHash" text;--> statement-breakpoint
ALTER TABLE "InstitutionAccount" ADD COLUMN "resetExpiresAt" timestamp(3);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "InstitutionAccount_resetTokenHash_key" ON "InstitutionAccount" USING btree ("resetTokenHash");
