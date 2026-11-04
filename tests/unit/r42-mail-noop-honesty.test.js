/**
 * R42-MAIL (task 4) — no flow reports an e-mail as sent when the provider is noop / absent / refusing:
 *   - notifyConversationMessage (appointment message alert) said { sent: true } whatever sendMail answered;
 *   - the readiness of every provider name: only a configured real provider (resend, mailjet, msgraph) or the LAB outbox is « deliverable »;
 *   - the public status page calls e-mail « operational » only for a configured real provider (msgraph included).
 * No database, no network: the database and the mailer are mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: async () => undefined }), execute: async () => undefined } }));
vi.mock('../../api/_utils/mailer.js', async (orig) => ({ ...(await orig()), sendMail: (...a) => sendMail(...a) }));

afterEach(() => { sendMail.mockReset(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const input = { conversationId: 'c1', messageId: 'm1', recipientType: 'USER', recipientEmail: 'personne@example.test', recipientEnabled: true, structureName: 'S', appointmentStartAt: null };

describe('notifyConversationMessage reports what the provider did', () => {
  it.each([
    ['NOT_SENT', false], ['NOT_DELIVERED', false], ['INVALID', false], ['PROVIDER_ACCEPTED', true], ['TEST_RECORDED', true],
  ])('outcome %s → sent %s', async (outcome, sent) => {
    sendMail.mockResolvedValue({ accepted: true, delivered: outcome === 'PROVIDER_ACCEPTED', provider: 'x', outcome });
    const { notifyConversationMessage } = await import('../../api/_utils/rdv-messaging.js');
    const r = await notifyConversationMessage(input);
    expect(r.sent).toBe(sent);
    expect(r.outcome).toBe(outcome);
  });

  it('no result at all is not « sent »', async () => {
    sendMail.mockResolvedValue(undefined);
    const { notifyConversationMessage } = await import('../../api/_utils/rdv-messaging.js');
    expect(await notifyConversationMessage(input)).toMatchObject({ sent: false, outcome: 'NOT_DELIVERED' });
  });
});

describe('readiness: only a configured real provider is deliverable', () => {
  it('noop, unwired names, and real providers without credentials are not deliverable', async () => {
    const { evaluateMailerConfig } = await import('../../api/_utils/mailer.js');
    for (const provider of ['', 'noop', 'smtp', 'brevo', 'postmark', 'sendgrid', 'graph', 'msgraph', 'resend', 'mailjet']) {
      expect(evaluateMailerConfig({ provider, from: 'n@example.test', apiKey: '' }).deliverable, provider).toBe(false);
    }
    expect(evaluateMailerConfig({ provider: 'msgraph', from: 'n@example.test', apiKey: 'a-resend-key-is-not-a-graph-credential' }).deliverable).toBe(false);
  });
});

describe('public status: « operational » only with a configured real provider', () => {
  it('noop is unavailable, test is degraded, a configured msgraph is operational', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'noop'); vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '');
    vi.stubGlobal('fetch', async () => { throw new Error('no network in this test'); });   // the assistant probe
    vi.resetModules();
    const status = async () => {
      const { computeStatus } = await import('../../api/_handlers/public-status.js');
      return JSON.stringify((await computeStatus()).components.find((c) => c.id === 'emails'));
    };
    expect(await status()).toContain('n\'est pas configuré');
    vi.stubEnv('MAILER_PROVIDER', 'msgraph'); vi.stubEnv('MAILER_FROM', 'notifications@example.test');
    vi.stubEnv('MAILER_MSGRAPH_TENANT_ID', '11111111-2222-4333-8444-555555555555'); vi.stubEnv('MAILER_MSGRAPH_CLIENT_ID', '66666666-7777-4888-9999-000000000000');
    vi.stubEnv('MAILER_MSGRAPH_CLIENT_SECRET', 'sim-secret');
    vi.resetModules();
    expect(await status()).toContain('sont envoyés');
  });
});
