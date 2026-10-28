/**
 * Launch-readiness item 62 — retention REPORT for the data no job deletes yet. It counts, per category, how many records are past the decided duration (or, when
 * no duration is decided, how many exist and since when) — it deletes NOTHING. Personal data is never deleted on an assumed retention period: a duration
 * becomes a deletion only by an owner / DPO decision, implemented and tested as such (cron/gdpr-purge already applies the decided ones).
 *
 * Durations: the product registry (api/_services/privacy.js RETENTION_POLICY_REGISTRY) when it holds one, else RETENTION_<KEY>_DAYS from the environment, else
 * « à décider ». Counts only — never a value, an address or an identifier. Shown in the privacy console and in the weekly purge job's report.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { RETENTION_POLICY_REGISTRY } from './privacy.js';

/**
 * @typedef {{ key: string, label: string, registry?: string, personalData: boolean, blocker?: string,
 *   count: (db: any) => Promise<{ total: number, oldest: string | null }>, overdue: (db: any, days: number) => Promise<number> }} Category
 */
const one = async (/** @type {any} */ db, /** @type {any} */ q) => (await db.execute(q)).rows[0] || {};
const iso = (/** @type {unknown} */ v) => (v ? new Date(/** @type {string} */ (v)).toISOString() : null);

/** @type {Category[]} */
export const CATEGORIES = [
  { key: 'INACTIVE_ACCOUNT', label: 'Comptes sans connexion', registry: 'INACTIVE_ACCOUNT', personalData: true,
    blocker: 'avant toute suppression : un e-mail d’avertissement et un délai de réponse (à construire) ; l’inactivité n’est mesurée que depuis la mise en service de lastSeenAt',
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min("lastSeenAt") AS o FROM "CitizenUser" WHERE "lastSeenAt" IS NOT NULL`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async (db, days) => (await one(db, sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE "lastSeenAt" < NOW() - make_interval(days => ${days})`)).n || 0 },
  { key: 'RDV_MESSAGES', label: 'Messages des rendez-vous (conversations sans échange récent)', personalData: true,
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min(m."createdAt") AS o FROM "RdvConversationMessage" m`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async (db, days) => (await one(db, sql`SELECT count(*)::int AS n FROM "RdvConversationMessage" m JOIN "RdvConversation" c ON c.id = m."conversationId"
      WHERE COALESCE(c."lastMessageAt", c."createdAt") < NOW() - make_interval(days => ${days})`)).n || 0 },
  { key: 'SUPPORT_REQUEST', label: 'Demandes d’aide traitées', personalData: true,
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min("closedAt") AS o FROM "SupportRequest" WHERE "closedAt" IS NOT NULL`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async (db, days) => (await one(db, sql`SELECT count(*)::int AS n FROM "SupportRequest" WHERE "closedAt" < NOW() - make_interval(days => ${days})`)).n || 0 },
  { key: 'DSR_REQUEST', label: 'Demandes d’exercice des droits terminées (preuve de traitement)', personalData: true,
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min("completedAt") AS o FROM "DSRRequest" WHERE "completedAt" IS NOT NULL`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async (db, days) => (await one(db, sql`SELECT count(*)::int AS n FROM "DSRRequest" WHERE "completedAt" < NOW() - make_interval(days => ${days})`)).n || 0 },
  { key: 'LEGAL_HOLD_RELEASED', label: 'Gels juridiques levés', personalData: false,
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min("releasedAt") AS o FROM "LegalHold" WHERE status = 'RELEASED'`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async (db, days) => (await one(db, sql`SELECT count(*)::int AS n FROM "LegalHold" WHERE status = 'RELEASED' AND "releasedAt" < NOW() - make_interval(days => ${days})`)).n || 0 },
  { key: 'PRO_USER_DISABLED', label: 'Comptes professionnels désactivés', personalData: true,
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min("updatedAt") AS o FROM "ProUser" WHERE status = 'disabled'`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async (db, days) => (await one(db, sql`SELECT count(*)::int AS n FROM "ProUser" WHERE status = 'disabled' AND "updatedAt" < NOW() - make_interval(days => ${days})`)).n || 0 },
  { key: 'COFFRE_EXPIRED', label: 'Documents du Coffre dont la date d’expiration est passée', personalData: true,
    blocker: 'la date est celle du document (validité d’une pièce), pas une demande de suppression : la personne décide',
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min("expiresAt") AS o FROM "CitizenDocument" WHERE "expiresAt" < NOW()`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async () => 0 },
  { key: 'AI_OUTPUT_REVIEW', label: 'Textes rédigés automatiquement en attente ou décidés (fiches publiques)', personalData: false,
    count: async (db) => { const r = await one(db, sql`SELECT count(*)::int AS n, min("createdAt") AS o FROM "AiOutputReview"`); return { total: r.n || 0, oldest: iso(r.o) }; },
    overdue: async (db, days) => (await one(db, sql`SELECT count(*)::int AS n FROM "AiOutputReview" WHERE "createdAt" < NOW() - make_interval(days => ${days})`)).n || 0 },
];

/** The decided duration of a category in days, or null (« à décider »). @param {Category} category @param {Record<string, string | undefined>} [env] */
export function durationOf(category, env = process.env) {
  /** @type {Record<string, { durationDays: number | null }>} */ const registry = RETENTION_POLICY_REGISTRY;
  const reg = category.registry ? registry[category.registry] : null;
  const regDays = reg?.durationDays ?? null;
  if (regDays !== null && Number.isInteger(regDays) && regDays > 0) return { days: regDays, from: 'registre produit' };
  const n = Number(env[`RETENTION_${category.key}_DAYS`]);
  return Number.isInteger(n) && n > 0 ? { days: n, from: 'environnement' } : { days: null, from: 'à décider' };
}

/** @param {any} [db] @param {Record<string, string | undefined>} [env] */
export async function retentionReport(db = defaultDb, env = process.env) {
  const items = [];
  for (const c of CATEGORIES) {
    const d = durationOf(c, env);
    try {
      const { total, oldest } = await c.count(db);
      items.push({ key: c.key, label: c.label, personalData: c.personalData, durationDays: d.days, durationFrom: d.from, total, oldest,
        overdue: d.days ? await c.overdue(db, d.days) : null, deletion: 'aucune (rapport seulement)', ...(c.blocker ? { blocker: c.blocker } : {}) });
    } catch {
      items.push({ key: c.key, label: c.label, personalData: c.personalData, durationDays: d.days, durationFrom: d.from, total: null, oldest: null, overdue: null,
        deletion: 'aucune (rapport seulement)', error: 'comptage impossible (table absente ?)' });
    }
  }
  return { generatedAt: new Date().toISOString(), deletes: false, items };
}
