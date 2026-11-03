/**
 * R41-E (G5 / G6) — sendTwilioSms: a timeout on every call, a classified result (retryable / permanent / not configured), Twilio's numeric error code only
 * (its message quotes the number), and no log line at all. No network: the fetch is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import { sendTwilioSms } from '../../api/_utils/twilio-sms.js';

const TW = { sid: 'ACsimulated', authToken: 'sim-token', from: 'ADA' };
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

describe('sendTwilioSms', () => {
  it('not configured: nothing attempted', async () => {
    const f = vi.fn();
    expect(await sendTwilioSms({ to: '0612345678', body: 'x' }, { sid: '', authToken: '', from: '' }, { fetchImpl: f })).toEqual({ ok: false, status: 0, code: 'not_configured', failure: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
  it('every call carries an abort signal (timeout) and the E.164 number', async () => {
    let init; let url;
    const f = async (u, i) => { url = u; init = i; return json(201, { sid: 'SM1' }); };
    expect(await sendTwilioSms({ to: '06 12 34 56 78', body: 'Rappel' }, TW, { fetchImpl: f })).toEqual({ ok: true, status: 201, code: null, failure: 'none' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(String(url)).toMatch(/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ACsimulated\/Messages\.json$/);
    expect(new URLSearchParams(init.body).get('To')).toBe('+33612345678');
  });
  it('a hung provider is cut by the timeout: retryable « timeout »', async () => {
    const f = (_u, i) => new Promise((_r, reject) => { i.signal.addEventListener('abort', () => reject(i.signal.reason)); });
    expect(await sendTwilioSms({ to: '0612345678', body: 'x' }, TW, { fetchImpl: f, timeoutMs: 20 })).toMatchObject({ ok: false, code: 'timeout', failure: 'retryable' });
  });
  it('5xx / 429 / network are retryable; 4xx permanent; only the numeric code is kept, never the message', async () => {
    const answer = (r) => async () => r;
    expect(await sendTwilioSms({ to: '0612345678', body: 'x' }, TW, { fetchImpl: answer(json(503, {})) })).toMatchObject({ failure: 'retryable', status: 503 });
    expect(await sendTwilioSms({ to: '0612345678', body: 'x' }, TW, { fetchImpl: answer(json(429, { code: 20429 })) })).toMatchObject({ failure: 'retryable', code: '20429' });
    expect(await sendTwilioSms({ to: '0612345678', body: 'x' }, TW, { fetchImpl: async () => { throw new TypeError('fetch failed'); } })).toMatchObject({ failure: 'retryable', code: 'network' });
    const r = await sendTwilioSms({ to: '0612345678', body: 'x' }, TW, { fetchImpl: answer(json(400, { code: 21211, message: "The 'To' number +33612345678 is not a valid phone number." })) });
    expect(r).toEqual({ ok: false, status: 400, code: '21211', failure: 'permanent' });
    expect(JSON.stringify(r)).not.toContain('612345678');
  });
  it('logs nothing (the caller records the outcome)', async () => {
    const spies = ['log', 'error', 'warn', 'info'].map((l) => vi.spyOn(console, l).mockImplementation(() => {}));
    await sendTwilioSms({ to: '0612345678', body: 'x' }, TW, { fetchImpl: async () => json(400, { code: 21211, message: '+33612345678' }) });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
