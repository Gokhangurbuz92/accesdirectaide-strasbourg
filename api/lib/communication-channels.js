/**
 * R46 (N01 / N02 / N06 / B10) — ONE honest status line per communication channel of the appointments: e-mail, SMS, video, connected calendar (Outlook).
 * Pure (no I/O, no network): it reads only the configuration through the existing adapters' own readiness rules, and it never returns a secret, a key, an
 * address or a provider error text — only a state, a reason code and the names of missing variables (names only).
 *
 * States (the same vocabulary for every channel; no state ever says « delivered » or « verified »: delivery is per message, in the notice ledger):
 *   OFF                  not configured — nothing is sent / offered (the safe default)
 *   TEST                 test transport only (unit / integration tests): nothing leaves the process
 *   SANDBOX              a provider sandbox / LAB mock: the provider may validate, nothing reaches a person
 *   INCOMPLETE           a provider is named but variables are missing — nothing is sent
 *   BLOCKED              configured, but a rule keeps it closed (SMS: « STOP » cannot be honoured yet; video / calendar: activation approval pending)
 *   CONFIGURED           the provider would be called; whether a message really arrives is NOT known here (provider verification is an owner step)
 */
import { mailerReadiness } from '../_utils/mailer.js';
import { inboundStopConfigured, optOutReady } from './sms-policy.js';
import { publicVideoStatus, videoStatus } from './video-provider.js';
import { outlookStatus } from './outlook-status.js';

export const CHANNEL_STATES = Object.freeze(['OFF', 'TEST', 'SANDBOX', 'INCOMPLETE', 'BLOCKED', 'CONFIGURED']);
export const CHANNELS = Object.freeze(['email', 'sms', 'video', 'calendar']);

/** @typedef {{ channel: string, state: string, reason: string | null, provider: string, missing: string[], reachesPeople: boolean }} ChannelStatus */

/** @param {Record<string, string | undefined>} env @returns {ChannelStatus} */
export function emailChannel(env = process.env) {
  const r = mailerReadiness(env);
  const base = { channel: 'email', provider: r.provider || 'noop', missing: r.missing };
  if (r.mode === 'off') return { ...base, state: 'OFF', reason: 'MAILER_PROVIDER_NOOP', reachesPeople: false };
  if (r.mode === 'test') return { ...base, state: 'TEST', reason: 'TEST_TRANSPORT', reachesPeople: false };
  if (r.mode === 'not_wired') return { ...base, state: 'OFF', reason: 'UNKNOWN_PROVIDER', reachesPeople: false };
  if (r.missing.length) return { ...base, state: 'INCOMPLETE', reason: 'MISSING_VARIABLES', reachesPeople: false };
  if (r.mode === 'sandbox') return { ...base, state: 'SANDBOX', reason: 'PROVIDER_SANDBOX', reachesPeople: false };
  return { ...base, state: 'CONFIGURED', reason: r.deliverable ? null : String(r.reason || 'NOT_DELIVERABLE'), reachesPeople: Boolean(r.deliverable) };
}

/** @param {Record<string, string | undefined>} env @returns {ChannelStatus} */
export function smsChannel(env = process.env) {
  const names = ['TWILIO_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'];
  const missing = names.filter((k) => !String(env[k] ?? '').trim());
  const base = { channel: 'sms', provider: missing.length === names.length ? 'none' : 'twilio' };
  if (missing.length === names.length) return { ...base, state: 'OFF', reason: 'NOT_CONFIGURED', missing: [], reachesPeople: false };
  if (missing.length) return { ...base, state: 'INCOMPLETE', reason: 'MISSING_VARIABLES', missing, reachesPeople: false };
  // N02 (owner decision 2026-10-24): a configured provider sends NOTHING until a reply « STOP » is really honoured (inbound webhook routed + signed)
  if (!optOutReady(env)) {
    return { ...base, state: 'BLOCKED', reason: inboundStopConfigured(env) ? 'STOP_WEBHOOK_NOT_ROUTED' : 'STOP_WEBHOOK_NOT_CONFIGURED', missing: inboundStopConfigured(env) ? [] : ['SMS_INBOUND_URL'], reachesPeople: false };
  }
  return { ...base, state: 'CONFIGURED', reason: null, missing: [], reachesPeople: true };
}

/** @param {Record<string, string | undefined>} env @returns {ChannelStatus} */
export function videoChannel(env = process.env) {
  const s = videoStatus(env); const p = publicVideoStatus(env);
  const base = { channel: 'video', provider: s.provider || 'off', missing: [] };
  if (s.reason === 'NOT_CONFIGURED') return { ...base, state: 'OFF', reason: s.reason, reachesPeople: false };
  if (s.reason === 'INCOMPLETE_CONFIGURATION' || s.reason === 'UNKNOWN_PROVIDER') {
    const missing = ['VIDEO_JITSI_DOMAIN', 'VIDEO_JITSI_APP_ID', 'VIDEO_JITSI_SECRET'].filter((k) => !String(env[k] ?? '').trim());
    return { ...base, state: 'INCOMPLETE', reason: s.reason, missing, reachesPeople: false };
  }
  if (!s.bookable) return { ...base, state: 'BLOCKED', reason: s.reason, reachesPeople: false };   // production approval pending / sandbox in production
  if (!p.available) return { ...base, state: 'BLOCKED', reason: p.reason, reachesPeople: false };  // R45 capability « video » closed
  if (s.sandbox) return { ...base, state: 'SANDBOX', reason: 'VIDEO_SANDBOX', reachesPeople: false };
  return { ...base, state: 'CONFIGURED', reason: null, reachesPeople: true };
}

/** @param {Record<string, string | undefined>} env @returns {ChannelStatus} */
export function calendarChannel(env = process.env) {
  const s = outlookStatus(env);
  const base = { channel: 'calendar', provider: 'outlook', missing: [] };
  if (s.reason === 'NOT_CONFIGURED') return { ...base, provider: 'none', state: 'OFF', reason: s.reason, reachesPeople: false };
  if (s.reason === 'INCOMPLETE_CONFIGURATION' || s.reason === 'MISSING_ENCRYPTION_KEY') {
    const missing = s.reason === 'MISSING_ENCRYPTION_KEY' ? ['ADA_VAULT_KEY'] : ['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_REDIRECT_URI'].filter((k) => !String(env[k] ?? '').trim());
    return { ...base, state: 'INCOMPLETE', reason: s.reason, missing, reachesPeople: false };
  }
  if (!s.enabled) return { ...base, state: 'BLOCKED', reason: s.reason, reachesPeople: false };
  // a sandbox / local mock authority or Graph (anything but Microsoft's own hosts) is never presented as the real service
  const hosts = [env.OUTLOOK_AUTHORITY_URL, env.OUTLOOK_GRAPH_BASE_URL].filter(Boolean).map((u) => { try { return new URL(String(u)).hostname; } catch { return 'invalid'; } });
  if (hosts.some((h) => !/(^|\.)(microsoftonline\.com|microsoft\.com)$/.test(h))) return { ...base, state: 'SANDBOX', reason: 'OUTLOOK_SANDBOX', reachesPeople: false };
  return { ...base, state: 'CONFIGURED', reason: null, reachesPeople: false };   // free/busy read only: nothing is ever sent to a person
}

/** every channel, in a fixed order @param {Record<string, string | undefined>} [env] @returns {ChannelStatus[]} */
export function channelStatuses(env = process.env) {
  return [emailChannel(env), smsChannel(env), videoChannel(env), calendarChannel(env)];
}
