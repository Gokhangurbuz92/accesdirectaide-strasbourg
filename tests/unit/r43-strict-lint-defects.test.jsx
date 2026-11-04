// @vitest-environment jsdom
/**
 * R43 — the genuine defects the strict lint pointed at (an unused variable that was a missing behaviour), each proven here; the review-queue cursor is
 * proven on real PostgreSQL in tests/integration/r43-review-queue-cursor-db.test.js. No JSX in the body.
 *   - Gemini structured calls ignored their `timeoutMs` and `signal` (an external call could hang, a caller's abort did nothing);
 *   - the assistant's feedback buttons set `failed` and never showed it (a feedback the server refused was silent);
 *   - the dead header scrubber of the Sentry filter is gone: the request headers are still redacted by sanitizeDeep (a superset of its keys).
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/lib/ai-policy.js', async (orig) => {
  const real = await orig();
  // the Gemini provider is blocked by policy in every audience (pending review): allowed here only to reach the SDK call
  return { ...real, AIProviderPolicy: { ...real.AIProviderPolicy, evaluate: () => ({ allowed: true }) } };
});

import { GeminiProvider } from '../../api/lib/ai-provider.js';
import FeedbackButtons from '../../src/components/assistant/FeedbackButtons.jsx';
import { sanitizeSentryEvent } from '../../api/_utils/sentryServer.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Gemini structured call: timeout and abort reach the SDK', () => {
  const provider = (generateContent) => {
    const p = new GeminiProvider(undefined);
    p.genAI = { getGenerativeModel: () => ({ generateContent }) };
    return p;
  };
  const ok = { response: { text: () => '{"a":1}', usageMetadata: {}, functionCalls: () => [] } };

  it('the default 120 s limit and a caller signal are passed as per-request options', async () => {
    const generateContent = vi.fn(async () => ok);
    const controller = new AbortController();
    const out = await provider(generateContent).generateStructured({ prompt: 'x', schema: { type: 'object' }, signal: controller.signal });
    expect(out.content).toEqual({ a: 1 });
    expect(generateContent).toHaveBeenCalledWith('x', { timeout: 120000, signal: controller.signal });
  });

  it('an explicit timeout is used; an abort is not retried', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const generateContent = vi.fn(async () => { throw abort; });
    await expect(provider(generateContent).generateStructured({ prompt: 'x', schema: { type: 'object' }, timeoutMs: 5000, maxRetries: 2 })).rejects.toBe(abort);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][1]).toEqual({ timeout: 5000 });
  });
});

describe('assistant feedback: a refused feedback is said, with a retry', () => {
  it('a 500 shows an alert (no thanks); the retry that succeeds shows the thanks as a status', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    render(h(FeedbackButtons, { logId: 'log-1' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Réponse utile' })); });
    expect(screen.getByTestId('feedback-failed')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('feedback-failed')).toHaveTextContent('Votre avis n’a pas pu être envoyé.');
    expect(screen.queryByText('Merci pour votre aide !')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })); });
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toMatchObject({ logId: 'log-1', rating: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('Merci pour votre aide !');
  });

  it('the comment field of a negative vote has an accessible name (it had only a placeholder)', () => {
    render(h(FeedbackButtons, { logId: 'log-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Réponse pas utile' }));
    expect(screen.getByRole('textbox', { name: 'Qu\'est-ce qui manquait ? (Optionnel)' })).toBeInTheDocument();
  });
});

describe('Sentry filter after removing the dead header scrubber', () => {
  it('request headers are still redacted (authorization, cookie, tokens, keys)', () => {
    const out = sanitizeSentryEvent({ request: { headers: { authorization: 'Bearer abc', cookie: 'sid=1', 'x-api-key': 'k', 'x-csrf-token': 't', accept: 'text/html' } } });
    expect(out.request.headers).toMatchObject({ authorization: '[REDACTED]', cookie: '[REDACTED]', 'x-api-key': '[REDACTED]', 'x-csrf-token': '[REDACTED]', accept: 'text/html' });
  });
});
