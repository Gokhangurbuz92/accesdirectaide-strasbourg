// @ts-nocheck
/**
 * FA-D7 — partner referral adapter: the database side (outbox of signed events, application of signed partner callbacks). Contract and transport:
 * api/lib/partner-adapter/contract.js and config.js. Design note: docs/vision/FA_D7_PARTNER_REFERRAL_ADAPTER.md.
 *
 * No migration: the state of each delivery and of each callback lives in AuditLog (append-only, identifiers only, never a text):
 *   PARTNER_EVENT_DELIVERED | PARTNER_EVENT_REJECTED | PARTNER_EVENT_FAILED (one per failed run) | PARTNER_EVENT_ABANDONED   entity ReferralEvent / <event id>
 *   PARTNER_CALLBACK_APPLIED | PARTNER_CALLBACK_REFUSED                                                                       entity PartnerCallback / <partner>:<key>
 * The referral transition itself is the concurrency guard (one conditional UPDATE in act()): two identical callbacks at once apply ONE step; the second
 * one answers as a replay once the first is recorded. The partner deduplicates outbound events on Idempotency-Key (= ReferralEvent id).
 *
 * Accountability: an inbound step is executed through the native act() AS the partner's named delegate member (ADA_PARTNER_ADAPTERS[].delegateProUserId):
 * same membership, grant, case-assignment and state rules as a click in ADA Pro; ReferralEvent.actorId = that member; the audit row names the partner.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { act } from './referrals.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import { OUTBOUND_STATES, buildOutboundEvent, validateInbound } from '../lib/partner-adapter/contract.js';
import { deliverEvent, partnerAdapterConfig } from '../lib/partner-adapter/config.js';

export const OUTBOX_WINDOW_DAYS = 7;
export const OUTBOX_MAX_FAILED_RUNS = 6;
export const OUTBOX_BATCH = 100;
const inList = (values) => sql.join(values.map((v) => sql`${v}`), sql`, `);
const audit = (db, action, entity, entityId, details) => db.insert(AuditLog).values({ action, actor: 'system', entity, entity_id: entityId, details, ip_hash: 'SYSTEM_GATEWAY' });

/**
 * The events a partner must receive: states the RECEIVER must know (OUTBOUND_STATES) of referrals addressed to its organization, only once the person
 * authorized them (sentAt set; a proposal the person refused or the sender withdrew before consent is never disclosed), never the partner's own steps,
 * not yet settled for this partner, in the window.
 */
async function pendingEvents(db, partner, now) {
  const since = new Date(now.getTime() - OUTBOX_WINDOW_DAYS * 86400000);
  return (await db.execute(sql`SELECT e.id, e."toStatus", e."createdAt", r.id AS "referralId", r."reasonCode", r."dueAt",
      (SELECT COUNT(*)::int FROM "AuditLog" f WHERE f.action = 'PARTNER_EVENT_FAILED' AND f.entity = 'ReferralEvent' AND f.entity_id = e.id AND f.details->>'partner' = ${partner.id}) AS "failedRuns"
    FROM "ReferralEvent" e JOIN "Referral" r ON r.id = e."referralId"
    WHERE r."toStructureId" = ${partner.structureId} AND r."sentAt" IS NOT NULL AND e."toStatus" IN (${inList(OUTBOUND_STATES)})
      AND e."actorType" <> 'RECEIVER' AND NOT (e."toStatus" = 'CANCELLED' AND e."fromStatus" IN ('DRAFT', 'PENDING_CITIZEN'))
      AND e."createdAt" >= ${since}
      AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.action IN ('PARTNER_EVENT_DELIVERED', 'PARTNER_EVENT_REJECTED', 'PARTNER_EVENT_ABANDONED')
        AND a.entity = 'ReferralEvent' AND a.entity_id = e.id AND a.details->>'partner' = ${partner.id})
    ORDER BY e."createdAt" LIMIT ${OUTBOX_BATCH}`)).rows;
}

/**
 * One outbox run (cron/partner-outbox). Graceful no-integration: without a CONFIGURED adapter it reads nothing and answers { noIntegration: true }.
 * @param {{ now?: Date, envVars?: Record<string, string | undefined>, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export async function runPartnerOutbox(opts = {}, db = defaultDb) {
  const now = opts.now || new Date();
  const cfg = partnerAdapterConfig(opts.envVars || process.env);
  const summary = { state: cfg.state, partners: 0, delivered: 0, rejected: 0, failed: 0, abandoned: 0 };
  if (cfg.state !== 'CONFIGURED') return { ...summary, noIntegration: true };
  for (const partner of cfg.partners) {
    summary.partners += 1;
    for (const ev of await pendingEvents(db, partner, now)) {
      const event = buildOutboundEvent({ id: ev.id, toStatus: ev.toStatus, createdAt: ev.createdAt }, { id: ev.referralId, reasonCode: ev.reasonCode, dueAt: ev.dueAt },
        buildAppUrl(`/pro/orientations/${encodeURIComponent(ev.referralId)}`));
      if (!event) continue;
      const out = await deliverEvent(partner, event, { fetchImpl: opts.fetchImpl, sleep: opts.sleep, nowSeconds: () => Math.floor(now.getTime() / 1000) });
      const details = { partner: partner.id, type: event.type, attempts: out.attempts, httpStatus: out.httpStatus };
      if (out.outcome === 'DELIVERED') { summary.delivered += 1; await audit(db, 'PARTNER_EVENT_DELIVERED', 'ReferralEvent', ev.id, details); continue; }
      if (out.outcome === 'REJECTED') { summary.rejected += 1; await audit(db, 'PARTNER_EVENT_REJECTED', 'ReferralEvent', ev.id, details); continue; }
      await audit(db, 'PARTNER_EVENT_FAILED', 'ReferralEvent', ev.id, details);
      summary.failed += 1;
      if (Number(ev.failedRuns) + 1 >= OUTBOX_MAX_FAILED_RUNS) {
        // bounded: the event stays in ADA Pro (the native inbox and its notices never depended on the partner); the partner is told nothing more
        await audit(db, 'PARTNER_EVENT_ABANDONED', 'ReferralEvent', ev.id, { partner: partner.id, type: event.type, failedRuns: Number(ev.failedRuns) + 1 });
        summary.abandoned += 1;
      }
    }
  }
  return summary;
}

/** @returns {Promise<{ status: number, body: any } | null>} the answer already given for this key (replay), or null */
async function previousAnswer(db, partner, key) {
  const [row] = (await db.execute(sql`SELECT action, details FROM "AuditLog" WHERE entity = 'PartnerCallback' AND entity_id = ${`${partner.id}:${key}`}
    AND action IN ('PARTNER_CALLBACK_APPLIED', 'PARTNER_CALLBACK_REFUSED') ORDER BY timestamp ASC LIMIT 1`)).rows;
  if (!row) return null;
  const d = row.details || {};
  return { status: Number(d.httpStatus) || 200, body: { ...(d.answer || {}), replay: true } };
}

/**
 * Apply one VERIFIED callback (the handler checked the signature). Idempotent on (partner, idempotencyKey): a replay returns the first answer and changes
 * nothing; a different command under a used key is refused (409 IDEMPOTENCY_KEY_REUSED).
 * @param {{ id: string, structureId: string, delegateProUserId: string }} partner @param {unknown} body
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function applyPartnerCallback(partner, body, deps = {}) {
  const db = deps.db || defaultDb;
  const v = validateInbound(body);
  if (!v.ok) return { status: 400, body: { error: 'INVALID_BODY', problems: v.problems } };
  const { cmd } = v;
  const fingerprint = `${cmd.referralId}|${cmd.action}|${cmd.input.responseCode || ''}|${cmd.input.outcome || ''}`;
  const replayOf = async () => {
    const prev = await previousAnswer(db, partner, cmd.idempotencyKey);
    if (!prev) return null;
    const [row] = (await db.execute(sql`SELECT details->>'fingerprint' AS f FROM "AuditLog" WHERE entity = 'PartnerCallback' AND entity_id = ${`${partner.id}:${cmd.idempotencyKey}`} ORDER BY timestamp ASC LIMIT 1`)).rows;
    return row?.f === fingerprint ? prev : { status: 409, body: { error: 'IDEMPOTENCY_KEY_REUSED' } };
  };
  const first = await replayOf();
  if (first) return first;
  // the delegate acts as an ordinary member of the partner organization: act() re-checks membership, grant, assignment and state
  const [m] = (await db.execute(sql`SELECT role FROM "ProUser" WHERE id = ${partner.delegateProUserId} AND "structureId" = ${partner.structureId} AND status = 'active'`)).rows;
  const record = async (action, httpStatus, answer, extra = {}) => {
    await audit(db, action, 'PartnerCallback', `${partner.id}:${cmd.idempotencyKey}`, { partner: partner.id, referralId: cmd.referralId, action: cmd.action, fingerprint, httpStatus, answer, ...extra });
    return { status: httpStatus, body: answer };
  };
  if (!m) return record('PARTNER_CALLBACK_REFUSED', 409, { error: 'DELEGATE_NOT_ACTIVE' });
  // only a referral addressed to THIS partner's organization (the same 404 for unknown and for another organization's: no existence oracle)
  if (!(await db.execute(sql`SELECT 1 AS ok FROM "Referral" WHERE id = ${cmd.referralId} AND "toStructureId" = ${partner.structureId}`)).rows.length) {
    return record('PARTNER_CALLBACK_REFUSED', 404, { error: 'NOT_FOUND' });
  }
  const ctx = { structureId: partner.structureId, userId: partner.delegateProUserId, role: m.role };
  const out = await (deps.act || act)(ctx, cmd.referralId, cmd.action, cmd.input, { db });
  if (out.ok === false) {
    // a concurrent identical callback may have applied the step first: answer as its replay
    if (out.code === 'INVALID_TRANSITION') { const again = await replayOf(); if (again) return again; }
    return record('PARTNER_CALLBACK_REFUSED', out.status === 404 ? 404 : 409, { error: out.code === 'not_found' ? 'NOT_FOUND' : out.code });
  }
  return record('PARTNER_CALLBACK_APPLIED', 200, { ok: true, referral: { id: out.referral.id, status: out.referral.status } }, { actorProUserId: partner.delegateProUserId });
}
