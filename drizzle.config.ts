import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// Load environment variables dynamically depending on the environment
dotenv.config({ path: '.env' });
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    dotenv.config({ path: '.env.local', override: true });
}

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
