// @vitest-environment jsdom
/* global document */
/**
 * R46 (N01 / N02 / N06 / B10) — the honest channel status: the state matrix of api/lib/communication-channels.js (no secret ever returned, nothing
 * presented as reaching people unless the adapter would really send), the offline verification script, and the team-facing panel in six languages
 * (Arabic right-to-left, axe-clean, no secret, never « delivered » / « verified »).
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { calendarChannel, channelStatuses, emailChannel, smsChannel, videoChannel } from '../../api/lib/communication-channels.js';
import { runChannelsCheck } from '../../scripts/channels-check.mjs';
import ChannelStatusPanel from '../../src/components/rdv/ChannelStatusPanel.jsx';
import { setLanguage } from '../../src/i18n/index.js';

afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const SECRET = 'r46-secret-value-never-shown-000000000000';
const states = (env) => channelStatuses(env).map((c) => [c.channel, c.state, c.reason, c.reachesPeople]);

describe('channel state matrix (pure, configuration only)', () => {
  it('nothing configured: four OFF lines, nothing reaches anyone', () => {
    expect(states({})).toEqual([['email', 'OFF', 'MAILER_PROVIDER_NOOP', false], ['sms', 'OFF', 'NOT_CONFIGURED', false], ['video', 'OFF', 'NOT_CONFIGURED', false], ['calendar', 'OFF', 'NOT_CONFIGURED', false]]);
  });

  it('e-mail: test / incomplete (names only) / Mailjet sandbox / configured — never claims delivery', () => {
    expect(emailChannel({ MAILER_PROVIDER: 'test' }).state).toBe('TEST');
    const inc = emailChannel({ MAILER_PROVIDER: 'mailjet', MAILER_FROM: 'noreply@example.test' });
    expect([inc.state, inc.missing, inc.reachesPeople]).toEqual(['INCOMPLETE', ['MAILER_API_KEY'], false]);
    expect(emailChannel({ MAILER_PROVIDER: 'mailjet', MAILER_FROM: 'noreply@example.test', MAILER_API_KEY: `a:${SECRET}`, MAILER_MAILJET_SANDBOX: '1' }).state).toBe('SANDBOX');
    const live = emailChannel({ MAILER_PROVIDER: 'mailjet', MAILER_FROM: 'noreply@example.test', MAILER_API_KEY: `a:${SECRET}` });
    expect(live.state).toBe('CONFIGURED');
    expect(JSON.stringify(live)).not.toContain(SECRET);
    expect(emailChannel({ MAILER_PROVIDER: 'carrier-pigeon' }).state).toBe('OFF');
  });

  it('SMS: incomplete (names) / configured but BLOCKED while « STOP » cannot be honoured (N02) — even with the inbound URL set, the webhook is not routed', () => {
    expect(smsChannel({ TWILIO_SID: 'AC1' })).toMatchObject({ state: 'INCOMPLETE', missing: ['TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] });
    const full = { TWILIO_SID: 'AC1', TWILIO_AUTH_TOKEN: SECRET, TWILIO_FROM: '+33600000000' };
    expect(smsChannel(full)).toMatchObject({ state: 'BLOCKED', reason: 'STOP_WEBHOOK_NOT_CONFIGURED', missing: ['SMS_INBOUND_URL'], reachesPeople: false });
    expect(smsChannel({ ...full, SMS_INBOUND_URL: 'https://lab.invalid/api/public/sms-stop' })).toMatchObject({ state: 'BLOCKED', reason: 'STOP_WEBHOOK_NOT_ROUTED', reachesPeople: false });
    expect(JSON.stringify(smsChannel(full))).not.toContain(SECRET);
  });

  it('video: incomplete / sandbox (LAB) / production approval pending / capability closed — never offered as live by configuration alone', () => {
    const jitsi = { VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'meet.lab.invalid', VIDEO_JITSI_APP_ID: 'lab', VIDEO_JITSI_SECRET: SECRET };
    expect(videoChannel({ VIDEO_PROVIDER: 'jitsi-jwt' })).toMatchObject({ state: 'INCOMPLETE', missing: ['VIDEO_JITSI_DOMAIN', 'VIDEO_JITSI_APP_ID', 'VIDEO_JITSI_SECRET'] });
    expect(videoChannel({ ...jitsi, VIDEO_SANDBOX: 'true' })).toMatchObject({ state: 'SANDBOX', reachesPeople: false });
    expect(videoChannel({ ...jitsi, VERCEL_ENV: 'production' })).toMatchObject({ state: 'BLOCKED', reason: 'PRODUCTION_ACTIVATION_PENDING' });
    expect(videoChannel({ ...jitsi, VERCEL_ENV: 'production', VIDEO_PRODUCTION_APPROVED: 'true' })).toMatchObject({ state: 'BLOCKED', reason: 'CAPABILITY_NOT_OPEN', reachesPeople: false });
    expect(JSON.stringify(videoChannel(jitsi))).not.toContain(SECRET);
  });

  it('calendar: incomplete / key missing / production approval pending / a mock or sandbox host is SANDBOX, Microsoft hosts CONFIGURED (read-only: reaches nobody)', () => {
    const base = { OUTLOOK_ENABLED: 'true', OUTLOOK_CLIENT_ID: 'c', OUTLOOK_CLIENT_SECRET: SECRET, OUTLOOK_REDIRECT_URI: 'https://lab.invalid/cb' };
    expect(calendarChannel({ OUTLOOK_ENABLED: 'true' })).toMatchObject({ state: 'INCOMPLETE', missing: ['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_REDIRECT_URI'] });
    expect(calendarChannel(base)).toMatchObject({ state: 'INCOMPLETE', missing: ['ADA_VAULT_KEY'] });
    const keyed = { ...base, ADA_VAULT_KEY: 'k'.repeat(40) };
    expect(calendarChannel({ ...keyed, VERCEL_ENV: 'production' })).toMatchObject({ state: 'BLOCKED', reason: 'PRODUCTION_ACTIVATION_PENDING' });
    expect(calendarChannel({ ...keyed, OUTLOOK_GRAPH_BASE_URL: 'http://127.0.0.1:9999/v1.0' })).toMatchObject({ state: 'SANDBOX' });
    expect(calendarChannel(keyed)).toMatchObject({ state: 'CONFIGURED', reachesPeople: false });
    expect(JSON.stringify(calendarChannel(keyed))).not.toContain(SECRET);
  });
});

describe('scripts/channels-check.mjs (offline)', () => {
  it('prints four lines; --expect-silent fails only when a channel could reach a person; --json is parseable; no value printed', async () => {
    const out = []; const log = (s) => out.push(s);
    expect(await runChannelsCheck(['--expect-silent'], { log, env: {} })).toBe(0);
    expect(out.length).toBe(4);
    out.length = 0;
    const live = { MAILER_PROVIDER: 'mailjet', MAILER_FROM: 'noreply@example.test', MAILER_API_KEY: `a:${SECRET}` };
    expect(await runChannelsCheck(['--expect-silent'], { log, env: live })).toBe(1);
    expect(out.join('\n')).not.toContain(SECRET);
    out.length = 0;
    expect(await runChannelsCheck(['--json'], { log, env: live })).toBe(0);
    expect(JSON.parse(out[0]).map((c) => c.channel)).toEqual(['email', 'sms', 'video', 'calendar']);
  });
});

describe('ChannelStatusPanel (team view)', () => {
  const rows = channelStatuses({ TWILIO_SID: 'AC1', TWILIO_AUTH_TOKEN: SECRET, TWILIO_FROM: '+33600000000', MAILER_PROVIDER: 'mailjet', MAILER_FROM: 'noreply@example.test', MAILER_API_KEY: `a:${SECRET}`, MAILER_MAILJET_SANDBOX: '1' });
  it.each(['fr', 'en', 'tr', 'ar', 'de', 'uk'])('%s: one line per channel, translated, no secret, never « delivered », accessible', async (code) => {
    await act(async () => { await setLanguage(code, { persist: false }); });
    render(h(ChannelStatusPanel, { channels: rows }));
    const panel = screen.getByTestId('pro-channel-status');
    expect(panel.querySelectorAll('dt').length).toBe(4);
    for (const c of ['email', 'sms', 'video', 'calendar']) expect(screen.getByTestId(`pro-channel-${c}`)).toBeInTheDocument();
    expect(screen.getByTestId('pro-channel-sms').getAttribute('data-state')).toBe('BLOCKED');
    const text = panel.textContent || '';
    expect(text).not.toContain(SECRET);
    if (code !== 'fr') expect(text).not.toMatch(/Canaux de notification|Non activé/);   // translated, not the French default
    // a sandbox / blocked channel is never presented as active: no line carries the « activated » wording
    for (const el of panel.querySelectorAll('[data-state]')) expect(el.getAttribute('data-state')).not.toBe('CONFIGURED');
    expect(text).not.toMatch(/^Activé|Activated\.|Activated:/m);
    if (code === 'ar') expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
  it('renders nothing without data (older server)', () => {
    const { container } = render(h(ChannelStatusPanel, { channels: undefined }));
    expect(container.textContent).toBe('');
  });
});

describe('R46 booking period: every bookable day up to 60 days ahead is reachable (Europe/Paris, DST)', () => {
  it('fortnight windows 0/14/28/42/56, clamped; Paris day after midnight; across the autumn change', async () => {
    const { BOOKING_AHEAD_DAYS, MAX_WINDOW_OFFSET, parisBookingWindow } = await import('../../src/lib/parisCalendar.js');
    expect([BOOKING_AHEAD_DAYS, MAX_WINDOW_OFFSET]).toEqual([60, 56]);
    const now = new Date('2027-10-20T22:30:00Z');   // 00:30 in Paris on 21/10 (UTC still says 20/10)
    expect(parisBookingWindow(now)).toEqual({ from: '2027-10-21', to: '2027-11-03' });   // spans the 31/10/2027 change
    expect(parisBookingWindow(now, 14)).toEqual({ from: '2027-11-04', to: '2027-11-17' });
    expect(parisBookingWindow(now, 56)).toEqual({ from: '2027-12-16', to: '2027-12-29' });   // contains day 60 (19/12)
    expect(parisBookingWindow(now, 999)).toEqual(parisBookingWindow(now, 56));
    expect(parisBookingWindow(now, -14)).toEqual(parisBookingWindow(now, 0));
    const { MAX_BOOKING_AHEAD_DAYS, MAX_RANGE_DAYS } = await import('../../api/_handlers/rdv.js');
    expect([MAX_BOOKING_AHEAD_DAYS, MAX_RANGE_DAYS]).toEqual([BOOKING_AHEAD_DAYS, 14]);   // the client windows follow the server limits
  });
});
