// @vitest-environment jsdom
/* global document */
/**
 * TG — the « Rappels sur Telegram » card of /compte/profil: every state in words (not offered, off with an explicit consent box, pending with the single-use
 * link, on with « Arrêter », error), a closed route reads « pas encore proposé » (never an error), the consent box gates the button, the deep link opens
 * Telegram in a new tab without referrer, and the six languages carry the keys (inserted before the pinned Mon Parcours block of compte.json).
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../src/i18n/index.js';

const api = vi.hoisted(() => ({ citizenApi: { telegramStatus: vi.fn(), telegramLink: vi.fn(), telegramUnlink: vi.fn() } }));
vi.mock('@/lib/citizenApi', () => api);
const err = (status, code) => Object.assign(new Error('x'), { status, code });

beforeEach(async () => { vi.clearAllMocks(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
afterEach(() => cleanup());

const mount = async () => { const { default: C } = await import('../../src/components/account/TelegramNotifications.jsx'); return render(h(C)); };
const phase = () => screen.getByTestId('telegram-state').getAttribute('data-phase');

describe('TG Telegram card', () => {
  it('not offered (capability closed: 503, env missing: available false) reads « pas encore proposé », polite status, no button', async () => {
    api.citizenApi.telegramStatus.mockRejectedValueOnce(err(503, 'CAPABILITY_NOT_OPEN'));
    await mount();
    await waitFor(() => expect(phase()).toBe('unavailable'));
    expect(screen.getByTestId('telegram-state')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('telegram-state').textContent).toMatch(/pas encore proposés/);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    api.citizenApi.telegramStatus.mockResolvedValueOnce({ available: false, linked: false });
    await mount();
    await waitFor(() => expect(phase()).toBe('unavailable'));
  });

  it('off: the button needs the consent box; then the single-use link opens Telegram (new tab, no referrer)', async () => {
    api.citizenApi.telegramStatus.mockResolvedValue({ available: true, linked: false, pending: false });
    api.citizenApi.telegramLink.mockResolvedValue({ deepLink: 'https://t.me/AccesDirectAideBot?start=abc', expiresAt: '2026-11-25T10:10:00Z' });
    await mount();
    await waitFor(() => expect(phase()).toBe('off'));
    const button = screen.getByTestId('telegram-link');
    expect(button).toBeDisabled();
    expect(button.textContent).toBe('Recevoir mes rappels sur Telegram');
    fireEvent.click(screen.getByTestId('telegram-consent'));
    expect(button).not.toBeDisabled();
    await act(async () => { fireEvent.click(button); });
    expect(api.citizenApi.telegramLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(phase()).toBe('pending'));
    const a = screen.getByTestId('telegram-deeplink');
    expect(a).toHaveAttribute('href', 'https://t.me/AccesDirectAideBot?start=abc');
    expect(a).toHaveAttribute('target', '_blank'); expect(a.getAttribute('rel')).toMatch(/noopener/); expect(a.getAttribute('rel')).toMatch(/noreferrer/);
    expect(screen.getByTestId('telegram-state').textContent).toMatch(/10 minutes/);
  });

  it('on: « Arrêter » unlinks and returns to off; an error is said in words with « Réessayer »', async () => {
    api.citizenApi.telegramStatus.mockResolvedValue({ available: true, linked: true });
    api.citizenApi.telegramUnlink.mockResolvedValue({ removed: 1 });
    await mount();
    await waitFor(() => expect(phase()).toBe('on'));
    await act(async () => { fireEvent.click(screen.getByTestId('telegram-unlink')); });
    expect(api.citizenApi.telegramUnlink).toHaveBeenCalled();
    await waitFor(() => expect(phase()).toBe('off'));
    cleanup();
    api.citizenApi.telegramStatus.mockRejectedValueOnce(err(500));
    await mount();
    await waitFor(() => expect(phase()).toBe('error'));
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('six languages: the 13 keys exist in every locale, and the pinned Mon Parcours block stays last', () => {
    const keys = ['title', 'loading', 'unavailable', 'off', 'consent', 'enable', 'pending', 'open', 'check', 'on', 'disable', 'error', 'retry'].map((k) => `telegram.${k}`);
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const json = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/compte.json`, 'utf8'));
      for (const k of keys) expect(json[k]?.trim(), `${lang} ${k}`).toBeTruthy();
      expect(Object.keys(json).at(-1), lang).toMatch(/^parcours\./);
    }
    expect(document).toBeTruthy();
  });
});
