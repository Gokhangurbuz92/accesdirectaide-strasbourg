// @ts-nocheck
/**
 * PKG-5 / A15 — feature flags with fail-closed defaults and audited kill switches.
 *   - The deployment environment decides what MAY be on (absent / anything but the explicit value = OFF).
 *   - An administrator (MFA + elevation) can only force a flag OFF (kill switch) or clear that override; turning a feature ON needs a deployment change.
 *   - Unknown flag = OFF. A database error while reading overrides = OFF (fail-closed). Every change is in AuditLog with the reason.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';

// Only flags that the code really consults. External integrations (AI provider, SIAO, Outlook, video, e-mail / SMS providers) are switched by the deployment
// environment and stay OFF unless explicitly configured (fail-closed); they are listed read-only by GET /api/admin/features.
export const FLAGS = {
  PUBLIC_FEEDBACK: { env: () => process.env.PUBLIC_FEEDBACK_DISABLED !== 'true', label: 'Signalements de contenu et suggestions de structures (public)' },
  SUPPORT_FORM: { env: () => process.env.SUPPORT_FORM_DISABLED !== 'true', label: 'Formulaire d’aide (support)' },
  OPEN_DATA_EXPORT: { env: () => process.env.OPEN_DATA_EXPORT_ENABLED === 'true', label: 'Export statistique territorial (licence à décider par le propriétaire)' },
};

let cache = { at: 0, off: new Set() };
async function overrides(db) {
  if (Date.now() - cache.at < 15000) return cache.off;
  const rows = (await db.execute(sql`SELECT key FROM "FeatureFlagOverride" WHERE "forcedOff" = true`)).rows;
  cache = { at: Date.now(), off: new Set(rows.map((r) => r.key)) };
  return cache.off;
}
export function resetFlagCache() { cache = { at: 0, off: new Set() }; }

export async function isFeatureOn(key, db = defaultDb) {
  const f = FLAGS[key]; if (!f) return false;
  if (!f.env()) return false;
  try { return !(await overrides(db)).has(key); } catch { return false; }
}

export async function listFlags(db = defaultDb) {
  const rows = (await db.execute(sql`SELECT key, reason, "setBy", "setAt" FROM "FeatureFlagOverride"`)).rows;
  const by = new Map(rows.map((r) => [r.key, r]));
  return Object.entries(FLAGS).map(([key, f]) => ({ key, label: f.label, environment: f.env() ? 'ON' : 'OFF', forcedOff: by.has(key), override: by.get(key) || null,
    effective: f.env() && !by.has(key) ? 'ON' : 'OFF' }));
}

export async function setKillSwitch(key, { forcedOff, reason }, actor, db = defaultDb) {
  if (!FLAGS[key]) return { ok: false, status: 400, code: 'UNKNOWN_FLAG', message: 'Indicateur inconnu.' };
  const why = String(reason || '').trim();
  if (why.length < 10) return { ok: false, status: 400, code: 'REASON_REQUIRED', message: 'Indiquez le motif (au moins 10 caractères).' };
  // R12 (A15): the switch and its journal entry are ONE transaction — never a feature switched off (or back on) without its audited reason
  await db.transaction(async (tx) => {
    if (forcedOff === true) await tx.execute(sql`INSERT INTO "FeatureFlagOverride" (key, "forcedOff", reason, "setBy", "setAt") VALUES (${key}, true, ${why.slice(0, 500)}, ${actor}, NOW())
      ON CONFLICT (key) DO UPDATE SET reason = EXCLUDED.reason, "setBy" = EXCLUDED."setBy", "setAt" = NOW()`);
    else await tx.execute(sql`DELETE FROM "FeatureFlagOverride" WHERE key = ${key}`);
    await tx.insert(AuditLog).values({ action: forcedOff === true ? 'FEATURE_FORCED_OFF' : 'FEATURE_OVERRIDE_CLEARED', actor, actor_id: actor, entity: 'FeatureFlag', entity_id: key, details: { reason: why.slice(0, 500) } });
  });
  resetFlagCache();
  return { ok: true, flags: await listFlags(db) };
}
