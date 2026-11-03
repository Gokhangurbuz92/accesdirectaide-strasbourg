/**
 * R41-E (G5 / G6) — the one Twilio « Messages » call of the reminder jobs, with a timeout (a hung provider used to stall the job until the platform killed
 * it) and a classified result. It logs nothing: the caller records the outcome, and Twilio's error body quotes the destination number (personal data).
 * The channel rules (quiet hours, « STOP » readiness, consent) stay with the callers and api/lib/sms-policy.js.
 */
import { normalizeFrenchPhone } from '../lib/sms-policy.js';

export const TWILIO_TIMEOUT_MS = 10_000;

/**
 * @typedef {{ ok: boolean, status: number, code: string | null, failure: 'none' | 'retryable' | 'permanent' | 'not_configured' }} SmsResult
 * @param {{ to: string, body: string }} message
 * @param {{ sid?: string, authToken?: string, from?: string }} twilio
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<SmsResult>}
 */
export async function sendTwilioSms({ to, body }, twilio, { fetchImpl = fetch, timeoutMs = TWILIO_TIMEOUT_MS } = {}) {
  if (!(twilio?.sid && twilio.authToken && twilio.from)) return { ok: false, status: 0, code: 'not_configured', failure: 'not_configured' };
  const number = normalizeFrenchPhone(to) || String(to || '').replace(/\s/g, '');
  if (!number) return { ok: false, status: 0, code: 'no_number', failure: 'permanent' };
  let res;
  try {
    res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilio.sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${twilio.sid}:${twilio.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: number, From: twilio.from, Body: body }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    return { ok: false, status: 0, code: name === 'TimeoutError' ? 'timeout' : 'network', failure: 'retryable' };
  }
  if (res.ok) return { ok: true, status: res.status, code: null, failure: 'none' };
  let code = null;
  try {
    const parsed = await res.json();
    const c = parsed && typeof parsed === 'object' ? parsed.code : null;
    code = (typeof c === 'number' || typeof c === 'string') && /^\d{1,6}$/.test(String(c)) ? String(c) : null;   // Twilio's numeric code only, never `message`
  } catch { code = null; }
  return { ok: false, status: res.status, code, failure: res.status === 429 || res.status >= 500 ? 'retryable' : 'permanent' };
}
