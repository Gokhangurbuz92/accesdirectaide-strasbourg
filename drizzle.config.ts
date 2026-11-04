import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import { stockMigrateRefusal } from './scripts/db-migrate-guard.mjs';

// Load environment variables dynamically depending on the environment
dotenv.config({ path: '.env' });
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    dotenv.config({ path: '.env.local', override: true });
}

// R44: `drizzle-kit migrate` applies every journal entry newer than the last recorded one — on Production (0042) the obsolete 0043 / 0044 first — and
// `drizzle-kit push` writes the LAB schema: both are refused here against any non-local database (.env / .env.local included). Production migrations go
// through scripts/db-deploy-migrate.mjs only (journal, history and schema-drift checks, obsolete migrations never applied).
const refusal = stockMigrateRefusal(process.argv, process.env.DATABASE_URL);
if (refusal) throw new Error(refusal);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  verbose: true,
  strict: true,
});
