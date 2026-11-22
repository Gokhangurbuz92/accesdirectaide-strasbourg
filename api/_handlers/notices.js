// @ts-nocheck
/**
 * G14 / DSA art. 16 — the public « Signaler un contenu » form (no account needed: « tout particulier ou toute entité », art. 16(1)), and the appeal of an
 * account-free notifier (art. 20, applied by owner decision 30) with the reference and the code of the acknowledgement e-mail.
 *   GET  /api/notices                                         { available, staffed, categories, contentTypes }  (no data)
 *   POST /api/notices { action: 'submit', contentType, contentRef, category, explanation, notifierName, notifierEmail, goodFaith: true, declaredTrustedFlagger? }
 *   POST /api/notices { action: 'appeal', noticeId, code, body }
 * Open only while at least one content capability is open (community.testimonials, community.stories, community.employment, community.entraide): there is
 * nothing to report otherwise. A submission also needs a NAMED moderator (fail closed, 503 MODERATION_NOT_STAFFED). CSRF (double-submit) applies, the
 * per-IP rate limit CONTENT_NOTICE too. The address given is used for the acknowledgement, the decision and an appeal only (DSA art. 16(4)–(5)).
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { capabilityOpen } from '../_utils/capabilities.js';
import { db as defaultDb } from '../../src/db/index.js';
import { NOTICE_CATEGORIES, NOTICE_CONTENT_TYPES, contentNotices, moderationSchemaAvailable, noticeAppeal, requireFeatureStaffed } from '../_services/moderation-dsa.js';
import logger from '../_utils/logger.js';

export const UGC_CAPABILITIES = Object.freeze(['community.testimonials', 'community.stories', 'community.employment', 'community.entraide']);
/** is any content capability open (the form has something to report) @param {Record<string, string | undefined>} [envVars] */
export const anyUgcOpen = (envVars = process.env) => UGC_CAPABILITIES.some((c) => capabilityOpen(c, envVars));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!anyUgcOpen()) return res.status(503).json({ error: 'CAPABILITY_NOT_OPEN', code: 'CAPABILITY_NOT_OPEN', message: 'Aucun contenu publié par les utilisateurs n’est ouvert sur ce service.' });
  try {
    if (req.method === 'GET') {
      const staffed = (await requireFeatureStaffed(defaultDb, 'notices')) === null;
      return res.status(200).json({ available: await moderationSchemaAvailable(defaultDb), staffed, categories: NOTICE_CATEGORIES, contentTypes: NOTICE_CONTENT_TYPES });
    }
    const rate = await checkRateLimit('CONTENT_NOTICE', getClientIp(req));
    if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error || { error: 'Too many requests' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let out;
    if (b.action === 'submit') out = (await requireFeatureStaffed(defaultDb, 'notices')) || (await contentNotices().submit(b));
    else if (b.action === 'appeal') out = await noticeAppeal({}, { noticeId: b.noticeId, code: b.code, body: b.body });
    else out = { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
    if (out.ok === false) return res.status(out.status || 400).json({ error: out.code, message: out.message, ...(out.problems ? { problems: out.problems } : {}) });
    return res.status(out.status || 200).json(Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'ok' && k !== 'status')));
  } catch (e) {
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[notices] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
