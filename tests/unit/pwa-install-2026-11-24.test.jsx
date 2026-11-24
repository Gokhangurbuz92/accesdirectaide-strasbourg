// @vitest-environment jsdom
/* global window, localStorage */
/**
 * 24/11/2026 (owner: « install the web app on the home screen on iOS, Android and PC, on every screen ») — src/lib/pwaInstall.js and
 * src/components/pwa/InstallApp.jsx: the right path per browser, the browser's own dialog only from a click, the floating suggestion closable and remembered,
 * nothing on an installed app; the manifest and the install meta tags. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InstallApp from '../../src/components/pwa/InstallApp.jsx';
import { INSTALL_DISMISS_KEY, installKind } from '../../src/lib/pwaInstall.js';

const nav = (userAgent, extra = {}) => ({ userAgent, platform: '', maxTouchPoints: 0, ...extra });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const ANDROID_FF = 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0';
const ANDROID_OTHER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SomeBrowser/2.0 Mobile Safari/537.36';

beforeEach(() => { window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('install path per browser', () => {
  it('iPhone / iPad Safari, Mac Safari, Firefox, other Android, installed', () => {
    expect(installKind(nav(IPHONE))).toBe('ios');
    expect(installKind(nav(MAC_SAFARI, { platform: 'MacIntel', maxTouchPoints: 5 }))).toBe('ios');   // iPadOS reports a Mac with touch
    expect(installKind(nav(MAC_SAFARI, { platform: 'MacIntel' }))).toBe('mac-safari');
    expect(installKind(nav(MAC_CHROME))).toBe('other');
    expect(installKind(nav(FIREFOX))).toBe('firefox');
    expect(installKind(nav(ANDROID_FF))).toBe('firefox');
    expect(installKind(nav(ANDROID_OTHER))).toBe('android-other');
    window.matchMedia = vi.fn(() => ({ matches: true }));
    expect(installKind(nav(IPHONE))).toBe('installed');
  });
});

describe('InstallApp', () => {
  it('Chrome / Edge: the button opens the browser dialog only on click', async () => {
    const prompt = vi.fn(async () => {});
    const ev = new Event('beforeinstallprompt'); Object.assign(ev, { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    act(() => { window.dispatchEvent(ev); });
    render(h(InstallApp));
    expect(prompt).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId('install-app-button')); });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('plus tard');
  });
  it('iPhone: the steps of Safari (Partager → Sur l’écran d’accueil)', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    render(h(InstallApp));
    const steps = screen.getByTestId('install-app-steps');
    expect(steps).toHaveAttribute('data-install-kind', 'ios');
    expect(steps).toHaveTextContent('Partager');
    expect(steps).toHaveTextContent('Sur l’écran d’accueil');
  });
  it('the floating suggestion can be closed and stays closed on this device; nothing once installed', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    const { unmount } = render(h(InstallApp, { variant: 'floating' }));
    fireEvent.click(screen.getByTestId('install-app-close'));
    expect(screen.queryByTestId('install-app-floating')).toBeNull();
    expect(localStorage.getItem(INSTALL_DISMISS_KEY)).toMatch(/^\d+$/);
    unmount();
    render(h(InstallApp, { variant: 'floating' }));
    expect(screen.queryByTestId('install-app-floating')).toBeNull();
    cleanup();
    window.matchMedia = vi.fn(() => ({ matches: true }));
    render(h(InstallApp));
    expect(screen.getByTestId('install-app-done')).toBeInTheDocument();
  });
});

describe('manifest and meta tags', () => {
  it('standalone app with icons (maskable included), shortcuts and the iOS meta tags', () => {
    const m = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
    expect(m.display).toBe('standalone');
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(m.shortcuts.map((s) => s.url)).toEqual(['/aides', '/demarches', '/structures']);   // public screens only: a closed space must not be a shortcut
    expect(m.categories).not.toContain('government');
    const html = fs.readFileSync('index.html', 'utf8');
    for (const tag of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-title', 'mobile-web-app-capable', 'rel="manifest"', 'apple-touch-icon']) expect(html).toContain(tag);
  });
  it('the cookies page lists the device key', () => {
    expect(fs.readFileSync('src/pages/Cookies.jsx', 'utf8')).toContain('ada_install_dismissed');
  });
});
