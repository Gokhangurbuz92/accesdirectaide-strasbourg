CREATE TABLE "CitizenDelegation" (
	"id" text PRIMARY KEY NOT NULL,
	"principalUserId" text NOT NULL,
	"delegateUserId" text,
	"inviteEmail" text NOT NULL,
	"inviteTokenHash" text,
	"inviteExpiresAt" timestamp (3),
	"role" text NOT NULL,
	"scopes" text[] NOT NULL,
	"status" text DEFAULT 'INVITED' NOT NULL,
	"proofStatus" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"acceptedAt" timestamp (3),
	"endedAt" timestamp (3),
	"endedBy" text
);
--> statement-breakpoint
CREATE TABLE "DelegationAccessEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"delegationId" text NOT NULL,
	"principalUserId" text NOT NULL,
	"action" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_principal_fkey" FOREIGN KEY ("principalUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_delegate_fkey" FOREIGN KEY ("delegateUserId") REFERENCES "public"."CitizenUser"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DelegationAccessEvent" ADD CONSTRAINT "DelegationAccessEvent_delegation_fkey" FOREIGN KEY ("delegationId") REFERENCES "public"."CitizenDelegation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "CitizenDelegation_principal_idx" ON "CitizenDelegation" USING btree ("principalUserId");--> statement-breakpoint
CREATE INDEX "CitizenDelegation_delegate_idx" ON "CitizenDelegation" USING btree ("delegateUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "CitizenDelegation_inviteTokenHash_key" ON "CitizenDelegation" USING btree ("inviteTokenHash");--> statement-breakpoint
CREATE UNIQUE INDEX "CitizenDelegation_live_key" ON "CitizenDelegation" USING btree ("principalUserId","inviteEmail") WHERE "status" IN ('INVITED', 'ACTIVE', 'PROOF_REQUIRED');--> statement-breakpoint
CREATE INDEX "DelegationAccessEvent_delegation_idx" ON "DelegationAccessEvent" USING btree ("delegationId");--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_role_check" CHECK ("role" IN ('AIDANT', 'TUTEUR', 'CURATEUR', 'REPRESENTANT'));--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_scopes_check" CHECK (cardinality("scopes") >= 1 AND "scopes" <@ ARRAY['PARCOURS_READ', 'COFFRE_LIST', 'RDV_READ']::text[]);--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_status_check" CHECK ("status" IN ('INVITED', 'ACTIVE', 'PROOF_REQUIRED', 'DECLINED', 'REVOKED'));--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_proof_check" CHECK ("proofStatus" IN ('NOT_REQUIRED', 'REQUIRED_NOT_VERIFIED') AND (("role" = 'AIDANT') = ("proofStatus" = 'NOT_REQUIRED')));--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_active_without_proof_check" CHECK ("status" <> 'ACTIVE' OR "proofStatus" = 'NOT_REQUIRED');--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_accepted_has_delegate_check" CHECK ("status" NOT IN ('ACTIVE', 'PROOF_REQUIRED') OR "delegateUserId" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_not_self_check" CHECK ("delegateUserId" IS NULL OR "delegateUserId" <> "principalUserId");--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_duration_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '366 days');--> statement-breakpoint
ALTER TABLE "CitizenDelegation" ADD CONSTRAINT "CitizenDelegation_ended_by_check" CHECK ("endedBy" IS NULL OR "endedBy" IN ('PRINCIPAL', 'DELEGATE'));--> statement-breakpoint
ALTER TABLE "DelegationAccessEvent" ADD CONSTRAINT "DelegationAccessEvent_action_check" CHECK ("action" IN ('PARCOURS_VIEWED', 'COFFRE_LISTED', 'RDV_VIEWED'));--> statement-breakpoint
CREATE FUNCTION "DelegationAccessEvent_no_update"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DelegationAccessEvent is append-only' USING ERRCODE = 'integrity_constraint_violation'; END; $$;--> statement-breakpoint
CREATE TRIGGER "DelegationAccessEvent_append_only" BEFORE UPDATE ON "DelegationAccessEvent" FOR EACH ROW EXECUTE FUNCTION "DelegationAccessEvent_no_update"();
