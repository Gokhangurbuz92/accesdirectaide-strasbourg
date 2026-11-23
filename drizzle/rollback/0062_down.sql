-- Rollback of 0062_g14_obs_demand_signals (G14-OBS anonymous demand signals). Independent of 0060 / 0061.
-- Both tables hold anonymous aggregates only (no person, no identifier): dropping them loses the published quarters of the demand signals, which the
-- public open-data files already distributed keep. Idempotent: a second run changes nothing.
DROP TRIGGER IF EXISTS "DemandSignalQuarter_no_update" ON "DemandSignalQuarter";
DROP FUNCTION IF EXISTS "demand_signal_quarter_immutable"();
DROP TABLE IF EXISTS "DemandSignalQuarter";
DROP TABLE IF EXISTS "DemandSignalDaily";
-- forget the migration too (its journal row, by the journal's « when » of 0062)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795040000000;
