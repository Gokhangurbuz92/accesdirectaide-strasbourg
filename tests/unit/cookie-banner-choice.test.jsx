// @vitest-environment jsdom
/**
 * Launch-readiness item 64 — the information banner (option A, LEGAL_FR 03_COOKIES_TRACEURS § 4.2): « Fermer » records that the information was seen (not a
 * consent), the answer is kept 6 months then the banner is shown again, and nothing gates or loads a tracker.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import CookieBanner from '../../src/components/CookieBanner.jsx';
import { BANNER_CHOICE_MAX_AGE_MS, bannerAnswered } from '../../src/lib/cookieBanner.js';

afterEach(() => { cleanup(); globalThis.localStorage.clear(); });

describe('cookie information banner', () => {
  it('is shown until it is closed; « Fermer » stores « seen », never « accepted »', () => {
    render(createElement(CookieBanner));
    expect(screen.queryByRole('button', { name: 'Accepter' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    const stored = JSON.parse(globalThis.localStorage.getItem('ada_cookie_consent'));
    expect(stored.seen).toBe(true);
    expect(stored).not.toHaveProperty('accepted');
    expect(screen.queryByRole('region', { name: 'Information sur les cookies' })).toBeNull();
  });
  it('the answer is kept 6 months, then the information is shown again', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    expect(bannerAnswered(JSON.stringify({ seen: true, date: new Date(now - 30 * 86400000).toISOString() }), now)).toBe(true);
    expect(bannerAnswered(JSON.stringify({ seen: true, date: new Date(now - BANNER_CHOICE_MAX_AGE_MS - 1000).toISOString() }), now)).toBe(false);
    expect(bannerAnswered(JSON.stringify({ accepted: true, date: new Date(now).toISOString() }), now)).toBe(true);   // answers stored before stay valid until they age out
    for (const raw of [null, '', 'oui', '{}']) expect(bannerAnswered(raw, now)).toBe(false);
  });
});
