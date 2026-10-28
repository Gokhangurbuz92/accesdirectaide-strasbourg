import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Offline contract of api/_utils/mailer.js: provider selection, delivery semantics, request shape, failure handling.
// No network: global fetch is stubbed. No real addresses/keys: example.test + dummy keys.
async function load() {
  vi.resetModules();
  return import('../../api/_utils/mailer.js');
}
const MAIL = { to: 'citizen@example.test', subject: 'Sujet', text: 'Corps', category: 'unit' };

describe('mailer providers', () => {
  beforeEach(() => { vi.stubEnv('MAILER_FROM', 'noreply@example.test'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('test provider records the message and attachments (no network)', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'test');
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const m = await load();
    const r = await m.sendMail({ ...MAIL, attachments: [{ filename: 'a.ics', contentType: 'text/calendar', content: 'X' }] });
    expect(r).toEqual({ accepted: true, delivered: true, provider: 'test', outcome: 'TEST_RECORDED' });   // PKG-4: the ledger outcome never calls the test outbox DELIVERED
    expect(m.__getTestOutbox()).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads without sending', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'test');
    const m = await load();
    expect((await m.sendMail({ to: '', subject: 's', text: 't' })).accepted).toBe(false);
    expect((await m.sendMail({ to: 'a@example.test', subject: '', text: 't' })).accepted).toBe(false);
    expect(m.__getTestOutbox()).toHaveLength(0);
  });

  it('default provider is noop: accepted but NOT delivered (e-mail verification cannot work until a provider is configured)', async () => {
    vi.stubEnv('MAILER_PROVIDER', '');
    const m = await load();
    expect(await m.sendMail(MAIL)).toEqual({ accepted: true, delivered: false, provider: 'noop', outcome: 'NOT_SENT' });
  });

  it('smtp / postmark / sendgrid / brevo are NOT wired: accepted but not delivered', async () => {
    const m0 = await load();
    for (const provider of ['smtp', 'postmark', 'sendgrid', 'brevo']) {
      vi.stubEnv('MAILER_PROVIDER', provider);
      const m = await load();
      expect((await m.sendMail(MAIL))).toEqual({ accepted: true, delivered: false, provider, outcome: 'NOT_DELIVERED' });
    }
    expect(m0).toBeTruthy();
  });

  it('resend: posts JSON with Bearer auth and a timeout signal; delivered only on 2xx', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'resend'); vi.stubEnv('MAILER_API_KEY', 're_dummy_key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    expect(await m.sendMail(MAIL)).toMatchObject({ delivered: true, provider: 'resend' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_dummy_key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toMatchObject({ from: 'noreply@example.test', to: MAIL.to, subject: MAIL.subject, text: MAIL.text });
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 422 }));
    expect(await m.sendMail(MAIL)).toMatchObject({ accepted: true, delivered: false });
  });

  it('resend without key/from stays undelivered and never calls the network', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'resend'); vi.stubEnv('MAILER_API_KEY', '');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    expect(await m.sendMail(MAIL)).toMatchObject({ delivered: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mailjet: requires public:secret key, uses Basic auth + timeout, reports delivery from the API status', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'mailjet');
    vi.stubEnv('MAILER_API_KEY', 'badformat');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    let m = await load();
    expect(await m.sendMail(MAIL)).toMatchObject({ delivered: false });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv('MAILER_API_KEY', 'pub:sec');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageID: 1 }] }] }), { status: 200 }));
    m = await load();
    expect(await m.sendMail(MAIL)).toMatchObject({ delivered: true, provider: 'mailjet' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mailjet.com/v3.1/send');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('pub:sec').toString('base64')}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('provider outage or timeout resolves as undelivered (never throws into the booking flow)', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'resend'); vi.stubEnv('MAILER_API_KEY', 're_dummy_key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    const m = await load();
    await expect(m.sendMail(MAIL)).resolves.toMatchObject({ accepted: true, delivered: false });
  });
});
