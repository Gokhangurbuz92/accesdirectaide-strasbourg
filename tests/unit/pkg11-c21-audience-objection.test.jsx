// @vitest-environment jsdom
/**
 * PKG-11 / C21 · C22 — objection to audience measurement is self-service on /cookies (before: « écrivez-nous » only): the choice is kept on the device, nothing
 * is sent, events are dropped at once (beforeSend) and the measurement scripts are not loaded on the next visits. No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Cookies from '../../src/pages/Cookies.jsx';
import { AUDIENCE_OBJECTION_KEY, dropIfObjected, hasObjectedToAudience, measuredUrl } from '../../src/lib/audienceObjection.js';

beforeEach(() => globalThis.localStorage.clear());
afterEach(cleanup);
const page = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(Cookies))));

describe('PKG-11 / C21 audience-measurement objection', () => {
  it('objecting on /cookies keeps the choice on the device, says so, and can be withdrawn', () => {
    page();
    expect(screen.getByTestId('audience-objection')).toHaveTextContent("La mesure d'audience est active sur cet appareil.");
    fireEvent.click(screen.getByRole('button', { name: "Je m'oppose à la mesure d'audience" }));
    expect(globalThis.localStorage.getItem(AUDIENCE_OBJECTION_KEY)).toBe('yes');
    expect(hasObjectedToAudience()).toBe(true);
    expect(screen.getByTestId('audience-objection-message')).toHaveTextContent("Opposition enregistrée sur cet appareil : la mesure d'audience est arrêtée.");
    expect(screen.getByTestId('audience-objection')).toHaveTextContent("Vous vous êtes opposé(e) à la mesure d'audience sur cet appareil.");
    fireEvent.click(screen.getByRole('button', { name: 'Retirer mon opposition' }));
    expect(globalThis.localStorage.getItem(AUDIENCE_OBJECTION_KEY)).toBeNull();
    expect(screen.getByTestId('audience-objection-message')).toHaveTextContent('Opposition retirée sur cet appareil.');
  });

  it('R12 / A18: the measured address is the page, never a secret (no query, no fragment, no token or record id)', () => {
    expect(measuredUrl('https://www.accesdirectaide.fr/appointments/cancel/tok-abcdef0123456789?x=1#y')).toBe('https://www.accesdirectaide.fr/appointments/cancel/:id');
    expect(measuredUrl('/share/3f2b1c9a-1111-2222-3333-444455556666')).toBe('/share/:id');
    expect(measuredUrl('/pro/register?token=abc123')).toBe('/pro/register');
    expect(measuredUrl('/compte/partages/s-123')).toBe('/compte/partages/:id');
    expect(measuredUrl('/r/whatever/messages')).toBe('/r/:id/messages');
    expect(measuredUrl('/aides/prime-d-activite')).toBe('/aides/prime-d-activite');
    expect(measuredUrl('/structures/label-fripe-67-a84a38df')).toBe('/structures/label-fripe-67-a84a38df');
    expect(dropIfObjected({ type: 'pageview', url: '/passport/abc?k=1' })).toEqual({ type: 'pageview', url: '/passport/:id' });
  });

  it('every measurement event is dropped once the person has objected; the key is listed with the other storages', () => {
    const ev = { type: 'pageview', url: '/x' };
    expect(dropIfObjected(ev)).toEqual(ev);
    globalThis.localStorage.setItem(AUDIENCE_OBJECTION_KEY, 'yes');
    expect(dropIfObjected(ev)).toBeNull();
    page();
    expect(screen.getByText(AUDIENCE_OBJECTION_KEY)).toBeInTheDocument();
  });

  it('the measurement components are not mounted after an objection and both filter their events', () => {
    const app = fs.readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('{ANALYTICS_ENABLED && !hasObjectedToAudience() && (');
    expect(app).toContain("<Analytics mode={'production'} beforeSend={dropIfObjected} />");
    expect(app).toContain('<SpeedInsights beforeSend={dropIfObjected} />');
    expect(fs.readFileSync('src/lib/audienceObjection.js', 'utf8')).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest/);   // an objection is never sent anywhere
  });

  it('the control has no serious or critical axe violation', async () => {
    const { container } = page();
    const r = await axe.run(container.querySelector('[data-testid="audience-objection"]'), { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
});
