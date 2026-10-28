// @ts-nocheck
import logger from '../../_utils/logger.js';
import { env } from '../../_utils/env.js';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { mailLedgerStatus, sendMail } from '../../_utils/mailer.js';
import { canNotify } from '../../_services/citizen-account.js';
import { sendToUser } from '../../_services/web-push.js';
import { isSmsSendWindow, normalizeFrenchPhone, optOutReady, withOptOut } from '../../lib/sms-policy.js';
import { formatParisDate } from '../../_services/appointment-notices.js';

/**
 * PKG-2 / C08 — reminders of Mon Parcours deadlines (GET|POST /api/cron/parcours-reminder, CRON_SECRET).
 * Only deadlines that cite their official source exist (DB rule), only open steps are reminded, only through a channel the person consented to (canNotify: preference +
 * latest consent decision), at J-7 and J-1, exactly once per step/threshold/channel (the ParcoursReminder row is CLAIMED before sending). The message names NO step and NO right
 * (an e-mail or SMS can be seen by others): it only says that a step of Mon Parcours is due and where to look. Delivery is recorded honestly: DELIVERED only when the provider
 * really delivered (PKG-5: PROVIDER_ACCEPTED = the provider accepted the request, TEST_RECORDED = test outbox); NOT_DELIVERED when no provider is configured; NO_CONSENT when the person did not opt in for that channel.
 */
const OPEN = sql`i.status NOT IN ('DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED')`;
const day = 86400000;

async function sendSms(to, body) {
  if (!optOutReady()) return false;   // PKG-11 / N02: no SMS while a « STOP » reply cannot be honoured — recorded NOT_DELIVERED
  if (!(env.twilio.sid && env.twilio.authToken && env.twilio.from)) return false;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilio.sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${env.twilio.sid}:${env.twilio.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: normalizeFrenchPhone(to) || String(to).replace(/\s/g, ''), From: env.twilio.from, Body: body }).toString(),
  });
  return r.ok;
}

export async function runParcoursReminders({ now = new Date() } = {}) {
  const summary = { considered: 0, providerAccepted: 0, testRecorded: 0, notDelivered: 0, noConsent: 0, failed: 0, alreadySent: 0, deferredQuietHours: 0 };
  for (const [threshold, days] of [['J7', 7], ['J1', 1]]) {
    const from = new Date(now.getTime() + (days - 1) * day); const to = new Date(now.getTime() + days * day);
    const rows = (await db.execute(sql`SELECT i.id, i."userId", i."dueDate", u.email, CASE WHEN u."phoneVerifiedAt" IS NOT NULL THEN u.phone END AS phone FROM "ParcoursItem" i JOIN "CitizenUser" u ON u.id = i."userId"
      WHERE i."dueDate" IS NOT NULL AND i."dueSourceUrl" IS NOT NULL AND ${OPEN} AND i."dueDate" > ${from} AND i."dueDate" <= ${to} AND u."emailVerifiedAt" IS NOT NULL`)).rows;
    for (const r of rows) {
      const dateStr = formatParisDate(r.dueDate);   // PKG-11 audit pass 2: Paris date (servers run in UTC)
      const text = `Une étape de votre parcours arrive à échéance le ${dateStr}. Connectez-vous à Mon Espace (Mon Parcours) pour la voir.`;
      for (const channel of ['email', 'sms', 'push']) {
        summary.considered += 1;
        const consent = await canNotify(r.userId, channel, 'reminder').catch(() => false);
        const status = consent && (channel !== 'sms' || r.phone) ? 'CLAIMED' : 'NO_CONSENT';
        if (channel === 'sms' && status === 'CLAIMED' && !isSmsSendWindow(now)) { summary.deferredQuietHours += 1; continue; }   // PKG-11 / N02: no SMS 20:00-08:00 Paris; not claimed, the next run in the window sends it
        // R12 (C08): NO_CONSENT is not final — a person who opts in before the threshold has passed is reminded then (atomically claimed once, as before)
        const claim = (await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status) VALUES (${r.id}, ${threshold}, ${channel}, ${status})
          ON CONFLICT ("itemId", threshold, channel) DO UPDATE SET status = EXCLUDED.status WHERE "ParcoursReminder".status = 'NO_CONSENT' AND EXCLUDED.status = 'CLAIMED' RETURNING "itemId"`)).rows;
        if (!claim.length) { summary.alreadySent += 1; continue; }
        if (status === 'NO_CONSENT') { summary.noConsent += 1; continue; }
        let final = 'FAILED';
        try {
          if (channel === 'email') { const out = await sendMail({ to: r.email, subject: 'Rappel : une étape de Mon Parcours arrive à échéance', text, category: 'parcours-reminder' }); final = mailLedgerStatus(out); }   // PKG-4: test outbox = TEST_RECORDED
          else if (channel === 'sms') final = (await sendSms(r.phone, withOptOut(`Rappel ADA : ${text}`))) ? 'PROVIDER_ACCEPTED' : 'NOT_DELIVERED';   // PKG-5: accepted, not proven delivered
          else {   // R11 / N04: the push service of the person's browser accepted the encrypted message (not proof it was seen); no subscription / no keys: not delivered
            const out = await sendToUser(r.userId, { title: 'Rappel AccesDirectAide', body: `Une étape de votre parcours arrive à échéance le ${dateStr}.`, url: '/compte/parcours' });
            final = out.status === 'ACCEPTED' ? 'PROVIDER_ACCEPTED' : out.status === 'FAILED' ? 'FAILED' : 'NOT_DELIVERED';
          }
        } catch (e) { logger.error({ err: { name: e?.name } }, '[cron/parcours-reminder] send failed'); }
        await db.execute(sql`UPDATE "ParcoursReminder" SET status = ${final} WHERE "itemId" = ${r.id} AND threshold = ${threshold} AND channel = ${channel}`);
        summary[final === 'PROVIDER_ACCEPTED' ? 'providerAccepted' : final === 'TEST_RECORDED' ? 'testRecorded' : final === 'NOT_DELIVERED' ? 'notDelivered' : 'failed'] += 1;
      }
    }
  }
  return summary;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!getCronAuth(req).ok) return res.status(401).json({ error: 'Unauthorized' });   // CRON_SECRET only (Vercel Cron sends it; a user-agent proves nothing)
  try {
    const summary = await runParcoursReminders();
    logger.info(summary, '[Cron] Parcours reminders completed');
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    logger.error({ err: { name: error?.name, message: String(error?.message || '').split('\nparams:')[0].slice(0, 200) } }, '[Cron] Parcours reminders failed');
    return res.status(500).json({ error: 'Cron parcours reminders failed.' });
  }
}
