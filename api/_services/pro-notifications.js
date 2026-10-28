// @ts-nocheck
/**
 * PKG-4 / R20 — professional notifications: ONE event catalogue, server-side preferences, an honest delivery record.
 *   - in-app: every notice is stored for its recipient (ProNotification) — always on, it is the work queue's memory;
 *   - e-mail: only for catalogue events marked e-mailable, only when the member keeps e-mail on (notificationEmailEnabled) AND has not switched the event's category off
 *     (notificationPrefs[category] === false). The e-mail carries the event title and a link — never a name, a note, a message or a dossier content;
 *   - the outcome of each attempt is kept with the notice (metadata.delivery.email): PROVIDER_ACCEPTED (a real provider accepted the request — not proof of receipt) | TEST_RECORDED (in-memory test outbox,
 *     nothing left the machine) | NOT_DELIVERED (no provider / refused) | OFF_BY_PREFERENCE | NOT_EMAILABLE | FAILED — never mixed up.
 * Metadata is restricted to identifiers and non-personal values (allow-list).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProNotification, ProUser } from '../../src/db/schema.js';
import { mailLedgerStatus, sendMail as defaultSendMail } from '../_utils/mailer.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import logger from '../_utils/logger.js';

export const CATEGORIES = Object.freeze({
  cases: 'Dossiers suivis', referrals: 'Orientations', appointments: 'Rendez-vous', team: 'Équipe', structure: 'Fiche de la structure', content: 'Veille des aides',
});
const ev = (category, label, email = true) => Object.freeze({ category, label, email });
export const CATALOGUE = Object.freeze({
  case_assigned: ev('cases', 'Un dossier vous est attribué'),
  case_handover: ev('cases', 'Des dossiers vous sont transmis'),
  case_mention: ev('cases', 'Vous êtes mentionné·e sur un dossier'),
  dossier_restricted: ev('cases', 'Accès à un dossier suspendu (limitation demandée par la personne)'),
  dossier_restriction_lifted: ev('cases', 'Accès à un dossier rétabli'),
  referral_received: ev('referrals', 'Nouvelle orientation reçue'),
  referral_refused: ev('referrals', 'Orientation refusée par la personne'),
  referral_accepted: ev('referrals', 'Orientation acceptée'),
  referral_declined: ev('referrals', 'Orientation déclinée'),
  referral_needs_info: ev('referrals', 'Précisions demandées'),
  referral_reply: ev('referrals', 'Précisions reçues'),
  referral_completed: ev('referrals', 'Orientation terminée'),
  referral_cancelled: ev('referrals', 'Orientation annulée'),
  referral_overdue: ev('referrals', 'Orientation sans réponse'),
  referral_expired: ev('referrals', 'Orientation expirée'),
  rdv_new: ev('appointments', 'Rendez-vous demain'),
  rdv_booked_by_structure: ev('appointments', 'Rendez-vous créé'),
  rdv_cancelled_by_citizen: ev('appointments', 'Rendez-vous annulé par la personne'),
  rdv_cancelled_by_structure: ev('appointments', 'Rendez-vous annulé par la structure'),
  rdv_rescheduled: ev('appointments', 'Rendez-vous déplacé'),
  rdv_reminder_j1: ev('appointments', 'Rappel de rendez-vous', false),
  rdv_visio_approved: ev('appointments', 'Visio validée'),
  rdv_visio_revoked: ev('appointments', 'Visio retirée'),
  team_role_change: ev('team', 'Votre rôle a changé'),
  structure_proposal_decided: ev('structure', 'Proposition de modification traitée'),
  NEW_AIDE: ev('content', 'Nouvelle aide dans la veille', false),
});
const METADATA_KEYS = new Set(['caseId', 'referralId', 'appointmentId', 'proposalId', 'aideId', 'startAt', 'previousRole', 'newRole', 'count', 'changedBy', 'kind']);
export function safeMetadata(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(m)) if (METADATA_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date)) out[k] = v instanceof Date ? v.toISOString() : typeof v === 'string' ? v.slice(0, 120) : v;
  return Object.keys(out).length ? out : null;
}
export const emailWanted = (member, category) => Boolean(member?.notificationEmailEnabled) && (member?.notificationPrefs || {})[category] !== false;

/**
 * Notify members of ONE organization. `to`: an array of user ids (only ACTIVE members of `structureId` are reached) or 'members' (every active member, max 25).
 * Returns { inApp, email: { DELIVERED, TEST_RECORDED, NOT_DELIVERED, OFF_BY_PREFERENCE, NOT_EMAILABLE, FAILED } }.
 */
export async function notify({ structureId, to = 'members', type, title, message, metadata } = {}, deps = {}) {
  const db = deps.db || defaultDb; const sendMail = deps.sendMail || defaultSendMail;
  const summary = { inApp: 0, email: { PROVIDER_ACCEPTED: 0, TEST_RECORDED: 0, NOT_DELIVERED: 0, OFF_BY_PREFERENCE: 0, NOT_EMAILABLE: 0, FAILED: 0 } };
  const entry = CATALOGUE[type];
  if (!entry) { logger.warn({ type: String(type).slice(0, 40) }, '[pro-notifications] unknown event type refused'); return summary; }
  try {
    const where = [eq(ProUser.structureId, structureId), eq(ProUser.status, 'active'), sql`upper(${ProUser.role}) IN ('PRO', 'STRUCTURE_ADMIN')`];
    if (Array.isArray(to)) { if (!to.length) return summary; where.push(inArray(ProUser.id, to.map(String))); }
    const members = await db.select({ id: ProUser.id, email: ProUser.email, notificationEmailEnabled: ProUser.notificationEmailEnabled, notificationPrefs: ProUser.notificationPrefs })
      .from(ProUser).where(and(...where)).limit(25);
    const meta = safeMetadata(metadata);
    for (const m of members) {
      let email = 'NOT_EMAILABLE';
      if (entry.email) {
        if (!emailWanted(m, entry.category) || !m.email) email = 'OFF_BY_PREFERENCE';
        else {
          try {
            const out = await sendMail({ to: m.email, subject: `${title || entry.label} — Accès Direct Aide`, category: `pro-${type}`,
              text: `${title || entry.label}.\n\nConsultez votre espace professionnel : ${buildAppUrl('/pro/dashboard')}\n\nVous pouvez choisir les notifications reçues par e-mail dans Paramètres > Notifications.` });
            email = mailLedgerStatus(out);
          } catch { email = 'FAILED'; }
        }
      }
      summary.email[email] += 1;
      try {
        await db.insert(ProNotification).values({ userId: m.id, structureId, type, title: String(title || entry.label).slice(0, 200), message: String(message || '').slice(0, 1000),
          metadata: { ...(meta || {}), delivery: { inApp: 'STORED', email } } });
        summary.inApp += 1;
      } catch (err) { logger.warn({ err: { name: err?.name, code: err?.cause?.code || err?.code }, type }, '[pro-notifications] in-app write failed'); }
    }
  } catch (err) { logger.warn({ err: { name: err?.name }, type }, '[pro-notifications] notify failed'); }
  return summary;
}

/** Preferences of ONE member (their own). */
export async function getPreferences(ctx, db = defaultDb) {
  const [u] = await db.select({ email: ProUser.notificationEmailEnabled, prefs: ProUser.notificationPrefs }).from(ProUser).where(and(eq(ProUser.id, ctx.userId), eq(ProUser.structureId, ctx.structureId), eq(ProUser.status, 'active'))).limit(1);
  if (!u) return { ok: false, status: 404, code: 'not_found', message: 'Compte introuvable.' };
  const prefs = u.prefs || {};
  return { ok: true, preferences: { email: Boolean(u.email), categories: Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, prefs[c] !== false])) },
    catalogue: Object.entries(CATALOGUE).map(([type, e]) => ({ type, category: e.category, label: e.label, email: e.email })), categories: CATEGORIES };
}

export async function setPreferences(ctx, input, db = defaultDb) {
  const p = input && typeof input === 'object' ? input : {};
  const patch = {};
  if (p.email !== undefined) { if (typeof p.email !== 'boolean') return { ok: false, status: 400, code: 'invalid', message: 'Préférence invalide.' }; patch.notificationEmailEnabled = p.email; }
  if (p.categories !== undefined) {
    if (!p.categories || typeof p.categories !== 'object' || Array.isArray(p.categories)) return { ok: false, status: 400, code: 'invalid', message: 'Préférence invalide.' };
    const cats = {};
    for (const [k, v] of Object.entries(p.categories)) { if (!CATEGORIES[k] || typeof v !== 'boolean') return { ok: false, status: 400, code: 'invalid', message: 'Catégorie inconnue.' }; if (!v) cats[k] = false; }
    patch.notificationPrefs = cats;
  }
  if (!Object.keys(patch).length) return { ok: false, status: 400, code: 'invalid', message: 'Rien à modifier.' };
  const rows = await db.update(ProUser).set(patch).where(and(eq(ProUser.id, ctx.userId), eq(ProUser.structureId, ctx.structureId), eq(ProUser.status, 'active'))).returning({ id: ProUser.id });
  if (!rows.length) return { ok: false, status: 404, code: 'not_found', message: 'Compte introuvable.' };
  return getPreferences(ctx, db);
}
