// @ts-nocheck
import logger from '../../_utils/logger.js';
import { env } from '../../_utils/env.js';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { mailFailure, mailLedgerStatus, sendMail as defaultSendMail } from '../../_utils/mailer.js';
import { canNotify as defaultCanNotify } from '../../_services/citizen-account.js';
import { pushLedgerStatus, sendToUser as defaultSendToUser } from '../../_services/web-push.js';
import { isSmsSendWindow, optOutReady, withOptOut } from '../../lib/sms-policy.js';
import { formatParisDate } from '../../_services/appointment-notices.js';
import { sendTwilioSms } from '../../_utils/twilio-sms.js';
import { finishCronRun, startCronRun } from '../../_utils/cron-run.js';

/**
 * PKG-2 / C08 — reminders of Mon Parcours deadlines (GET|POST /api/cron/parcours-reminder, CRON_SECRET).
 * Only deadlines that cite their official source exist (DB rule), only open steps are reminded, only through a channel the person consented to (canNotify: preference +
 * latest consent decision), at J-7 and J-1, exactly once per step/threshold/channel (the ParcoursReminder row is CLAIMED before sending). The message names NO step and NO right
 * (an e-mail or SMS can be seen by others): it only says that a step of Mon Parcours is due and where to look. Delivery is recorded honestly: DELIVERED only when the provider
 * really delivered (PKG-5: PROVIDER_ACCEPTED = the provider accepted the request, TEST_RECORDED = test outbox); NOT_DELIVERED when no provider is configured or the provider
 * refused for good; NO_CONSENT when the person did not opt in for that channel.
 *
 * R41-E / G5 — reliability, without a schema change (the Production database is at 0042):
 *   - the claim time is kept in "createdAt" (set at every claim): a row left CLAIMED by a run that died is taken over after STALE_CLAIM_MINUTES, as in rdv-reminder;
 *   - catch-up: a threshold crossed during the last CATCHUP_DAYS days (a missed daily run, an SMS deferred by the quiet hours) is still sent, never after the due
 *     date and never a J-7 once the J-1 window is reached (the windows stay disjoint); the unique (item, threshold, channel) row keeps it exactly once;
 *   - FAILED now means « retryable » (provider unreachable, 5xx, 429, timeout): it is claimed again by a later run, at most once per RETRY_BACKOFF_HOURS, while
 *     the threshold is still inside the catch-up window — so at most 1 + CATCHUP_DAYS attempts with the daily schedule; a refusal is NOT_DELIVERED (final);
 *   - the claim re-checks, in the same statement, that the step is still open, still sourced and still due at the selected date (cancelled / moved before delivery);
 *   - a stable Idempotency-Key per (item, threshold, due date) so a retry within the provider's 24 h never sends a second copy;
 *   - Twilio through sendTwilioSms (timeout, nothing logged); each run writes a CronRun row (job « parcours-reminder ») from the handler.
 */
const OPEN = sql`i.status NOT IN ('DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED')`;
const day = 86400000;
export const STALE_CLAIM_MINUTES = 15;
export const CATCHUP_DAYS = 2;
export const RETRY_BACKOFF_HOURS = 20;
const THRESHOLDS = [['J7', 7, 1], ['J1', 1, 0]];   // [name, days before the due date, days of the next (later) threshold: its window starts there]

/** the selection window of one threshold at `now`: [from, to] on the due date (from exclusive) */
export function thresholdWindow(now, days, nextDays) {
  const lowerDays = Math.max(nextDays, days - 1 - CATCHUP_DAYS);
  return { from: new Date(now.getTime() + lowerDays * day), to: new Date(now.getTime() + days * day) };
}

/** ledger status of one e-mail result: accepted / test outbox, FAILED (retryable), NOT_DELIVERED (refused for good, or no provider) */
export function emailReminderStatus(out) {
  const f = mailFailure(out);
  if (f === 'none') return mailLedgerStatus(out);
  return f === 'retryable' ? 'FAILED' : 'NOT_DELIVERED';
}

async function sendSms(to, body) {
  if (!optOutReady()) return 'NOT_DELIVERED';   // PKG-11 / N02: no SMS while a « STOP » reply cannot be honoured — recorded NOT_DELIVERED
  const r = await sendTwilioSms({ to, body }, env.twilio);
  return r.ok ? 'PROVIDER_ACCEPTED' : r.failure === 'retryable' ? 'FAILED' : 'NOT_DELIVERED';
}

export async function runParcoursReminders({ now = new Date(), deps = {} } = {}) {
  const sendMail = deps.sendMail || defaultSendMail; const canNotify = deps.canNotify || defaultCanNotify;
  const sendToUser = deps.sendToUser || defaultSendToUser; const smsSender = deps.sendSms || sendSms;
  const summary = { considered: 0, providerAccepted: 0, testRecorded: 0, notDelivered: 0, noConsent: 0, failed: 0, alreadySent: 0, deferredQuietHours: 0, takenOver: 0, cancelled: 0 };
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60000);
  const retryBefore = new Date(now.getTime() - RETRY_BACKOFF_HOURS * 3600000);
  for (const [threshold, days, nextDays] of THRESHOLDS) {
    const { from, to } = thresholdWindow(now, days, nextDays);
    const rows = (await db.execute(sql`SELECT i.id, i."userId", i."dueDate", u.email, CASE WHEN u."phoneVerifiedAt" IS NOT NULL THEN u.phone END AS phone FROM "ParcoursItem" i JOIN "CitizenUser" u ON u.id = i."userId"
      WHERE i."dueDate" IS NOT NULL AND i."dueSourceUrl" IS NOT NULL AND ${OPEN} AND i."dueDate" > ${from} AND i."dueDate" <= ${to} AND u."emailVerifiedAt" IS NOT NULL`)).rows;
    for (const r of rows) {
      const due = new Date(r.dueDate);
      const dateStr = formatParisDate(due);   // PKG-11 audit pass 2: Paris date (servers run in UTC)
      const text = `Une étape de votre parcours arrive à échéance le ${dateStr}. Connectez-vous à Mon Espace (Mon Parcours) pour la voir.`;
      for (const channel of ['email', 'sms', 'push']) {
        summary.considered += 1;
        const consent = await canNotify(r.userId, channel, 'reminder').catch(() => false);
        const status = consent && (channel !== 'sms' || r.phone) ? 'CLAIMED' : 'NO_CONSENT';
        if (channel === 'sms' && status === 'CLAIMED' && !isSmsSendWindow(now)) { summary.deferredQuietHours += 1; continue; }   // PKG-11 / N02: no SMS 20:00-08:00 Paris; not claimed — a later run (catch-up window) sends it
        // R12 (C08): NO_CONSENT is not final — a person who opts in before the threshold has passed is reminded then (atomically claimed once, as before).
        // R41-E / G5: one statement claims (or takes over a stale CLAIMED / a FAILED past its backoff) only while the step is still open, sourced and due that day
        const claim = (await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status, "createdAt")
          SELECT i.id, ${threshold}, ${channel}, ${status}, ${now} FROM "ParcoursItem" i WHERE i.id = ${r.id} AND ${OPEN} AND i."dueSourceUrl" IS NOT NULL AND i."dueDate" = ${due}
          ON CONFLICT ("itemId", threshold, channel) DO UPDATE SET status = EXCLUDED.status, "createdAt" = EXCLUDED."createdAt"
          WHERE EXCLUDED.status = 'CLAIMED' AND ("ParcoursReminder".status = 'NO_CONSENT'
            OR ("ParcoursReminder".status = 'CLAIMED' AND "ParcoursReminder"."createdAt" < ${staleBefore})
            OR ("ParcoursReminder".status = 'FAILED' AND "ParcoursReminder"."createdAt" < ${retryBefore}))
          RETURNING "itemId", (xmax::text <> '0') AS retaken`)).rows;
        if (!claim.length) {
          const exists = (await db.execute(sql`SELECT 1 FROM "ParcoursReminder" WHERE "itemId" = ${r.id} AND threshold = ${threshold} AND channel = ${channel}`)).rows.length;
          summary[exists ? 'alreadySent' : 'cancelled'] += 1;   // cancelled: closed / moved / unsourced between the selection and the claim — nothing sent
          continue;
        }
        if (status === 'NO_CONSENT') { summary.noConsent += 1; continue; }
        if (claim[0].retaken === true || claim[0].retaken === 't') summary.takenOver += 1;
        let final = 'FAILED';
        try {
          if (channel === 'email') {
            const out = await sendMail({ to: r.email, subject: 'Rappel : une étape de Mon Parcours arrive à échéance', text, category: 'parcours-reminder',
              idempotencyKey: `parcours-reminder/${r.id}/${threshold}/${due.getTime()}/email` });
            final = emailReminderStatus(out);   // PKG-4: test outbox = TEST_RECORDED; R41-E: retryable = FAILED, refused / noop = NOT_DELIVERED
          } else if (channel === 'sms') final = await smsSender(r.phone, withOptOut(`Rappel ADA : ${text}`));   // PKG-5: accepted, not proven delivered
          else {   // R11 / N04: the push service of the person's browser accepted the encrypted message (not proof it was seen); no subscription / no keys: not delivered
            const out = await sendToUser(r.userId, { title: 'Rappel AccesDirectAide', body: `Une étape de votre parcours arrive à échéance le ${dateStr}.`, url: '/compte/parcours' });
            final = pushLedgerStatus(out);   // R40: every subscription ended by the browser (404 / 410) is NOT_DELIVERED, not a provider FAILED
          }
        } catch (e) { logger.error({ err: { name: e?.name }, channel }, '[cron/parcours-reminder] send failed'); }
        // only OUR claim is finalized (a run that was taken over after STALE_CLAIM_MINUTES does not overwrite the newer outcome)
        await db.execute(sql`UPDATE "ParcoursReminder" SET status = ${final} WHERE "itemId" = ${r.id} AND threshold = ${threshold} AND channel = ${channel} AND status = 'CLAIMED' AND "createdAt" = ${now}`);
        summary[final === 'PROVIDER_ACCEPTED' ? 'providerAccepted' : final === 'TEST_RECORDED' ? 'testRecorded' : final === 'NOT_DELIVERED' ? 'notDelivered' : 'failed'] += 1;
      }
    }
  }
  return summary;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!getCronAuth(req).ok) return res.status(401).json({ error: 'Unauthorized' });   // CRON_SECRET only (Vercel Cron sends it; a user-agent proves nothing)
  const startedAtMs = Date.now();
  const runId = await startCronRun(db, 'parcours-reminder', { trigger: 'cron' });   // R41-E / G5: a run record (health / admin cron page)
  try {
    const summary = await runParcoursReminders();
    logger.info(summary, '[Cron] Parcours reminders completed');
    await finishCronRun(db, runId, { status: summary.failed > 0 ? 'partial' : 'success', startedAtMs, metrics: summary });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    logger.error({ err: { name: error?.name, message: String(error?.message || '').split('\nparams:')[0].slice(0, 200) } }, '[Cron] Parcours reminders failed');
    await finishCronRun(db, runId, { status: 'failed', startedAtMs, error: error?.name || 'Error' });
    return res.status(500).json({ error: 'Cron parcours reminders failed.' });
  }
}
