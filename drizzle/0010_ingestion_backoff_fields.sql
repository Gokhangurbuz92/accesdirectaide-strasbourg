ALTER TABLE "SyncRun" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "SyncRun" ADD COLUMN "nextRunAt" timestamp(3);