/**
 * Launch-readiness item 60 (DPIA A2) — a jsonb column stored ENCRYPTED AT REST: the database holds { "enc": "v2:…" } (envelope encryption of
 * api/lib/data-keys.ts), the application reads and writes the plain object, so the byte-pinned handlers (share/create.js, share/get.js) need no change.
 * Rows stored before stay readable as they are (plain objects). This is server-side encryption at rest, not end-to-end: the server holds the keys.
 *
 * The codec needs the data key, so src/db/index.ts registers it only where ADA_ENCRYPTION_KEY exists (api/lib/situation-codec.js). Without it a write FAILS:
 * nothing is ever stored in clear by mistake. No crypto import here: drizzle-kit and every importer of the schema keep working without a key.
 */
import { customType } from 'drizzle-orm/pg-core';

type Codec = { seal: (json: string) => string; open: (sealed: string) => string };
let codec: Codec | null = null;
export function registerSealedJsonCodec(c: Codec): void { codec = c; }
export const sealedJsonCodecLoaded = (): boolean => codec !== null;

/** True for the stored envelope { enc: "v2:…" } (and nothing else: a plain object of the person's answers never has that exact shape). */
export function isSealedJson(value: unknown): value is { enc: string } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 1
    && typeof (value as { enc?: unknown }).enc === 'string' && String((value as { enc: string }).enc).startsWith('v2:');
}

export const sealedJson = customType<{ data: unknown; driverData: unknown }>({
  dataType() { return 'jsonb'; },
  toDriver(value: unknown): string {
    if (!codec) throw new Error('sealedJson: the encryption codec is not loaded (ADA_ENCRYPTION_KEY): nothing is stored in clear');
    return JSON.stringify({ enc: codec.seal(JSON.stringify(value ?? null)) });
  },
  fromDriver(value: unknown): unknown {
    const j = typeof value === 'string' ? JSON.parse(value) : value;
    if (!isSealedJson(j)) return j;
    if (!codec) throw new Error('sealedJson: the encryption codec is not loaded (ADA_ENCRYPTION_KEY)');
    return JSON.parse(codec.open(j.enc));
  },
});
