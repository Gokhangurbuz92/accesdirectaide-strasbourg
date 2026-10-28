/**
 * R7 (advisory GHSA-mrhx-c7xc-m3w5, zod < 4.6.6): the project moved to zod 4. Zod 4 renamed ZodError.errors to ZodError.issues. The byte-pinned api/index.js
 * (SEC-05 input validation) still reads `.errors` and must not change, so this alias keeps its answer — 400 validation_failed with the field list — instead of a
 * TypeError turned into a 500. Loaded by api/_utils/validation-registry.js, which api/index.js imports before it validates anything. New code reads `.issues`.
 * Zod 4 throws ZodRealError instances (its own `instanceof` makes them pass `instanceof z.ZodError`): the alias goes on that prototype too.
 */
import { z } from 'zod';

const sample = z.string().safeParse(0).error;
for (const proto of new Set([z.ZodError.prototype, sample ? Object.getPrototypeOf(sample) : null])) {
  if (proto && !Object.getOwnPropertyDescriptor(proto, 'errors')) {
    Object.defineProperty(proto, 'errors', { configurable: true, get() { return /** @type {import('zod').ZodError} */ (/** @type {unknown} */ (this)).issues; } });
  }
}
