// @vitest-environment jsdom
/**
 * R41-K A3 / A4 — the two modal dialogs found without focus management: the pro onboarding guide (Radix Dialog: initial focus inside, focus trapped,
 * Escape = « Passer le guide ») and the video window (focus on « Quitter » at opening, Escape = quit, the provider frame gets a title).
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OnboardingTour from '../../src/components/OnboardingTour.jsx';
import VisioWindow from '../../src/components/Visio/VisioWindow.jsx';

afterEach(() => { cleanup(); globalThis.localStorage.clear(); delete globalThis.window.JitsiMeetExternalAPI; });

describe('pro onboarding guide (A3)', () => {
  it('opens with the focus inside the dialog, and Escape ends the guide like « Passer »', async () => {
    const onComplete = vi.fn();
    render(createElement('div', null, createElement('button', { type: 'button' }, 'behind'), createElement(OnboardingTour, { onComplete })));
    const dialog = await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'behind' })).toBeNull();   // the page behind is hidden from assistive technologies while it is open
    expect(dialog).toHaveAccessibleName(/Bienvenue sur ADA Pro/);
    expect(dialog.contains(globalThis.document.activeElement)).toBe(true);
    fireEvent.keyDown(globalThis.document.activeElement, { key: 'Escape' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(globalThis.localStorage.getItem('ada_onboarding_done')).toBe('true');
  });
  it('« Passer le guide » still ends it once', async () => {
    const onComplete = vi.fn();
    render(createElement(OnboardingTour, { onComplete }));
    fireEvent.click(await screen.findByRole('button', { name: 'Passer le guide' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('video window (A4)', () => {
  const join = { domain: 'meet.example.test', roomName: 'r', jwt: 'j' };
  it('focuses « Quitter » at opening, Escape quits, and the provider frame is titled', async () => {
    const iframe = globalThis.document.createElement('iframe');
    globalThis.window.JitsiMeetExternalAPI = vi.fn(function Api() { return { addEventListener: () => {}, dispose: () => {}, getIFrame: () => iframe }; });
    const onClose = vi.fn();
    await act(async () => { render(createElement(VisioWindow, { join, onClose })); });
    expect(globalThis.document.activeElement).toBe(screen.getByTestId('visio-close'));
    expect(iframe.getAttribute('title')).toBe('Rendez-vous en visio');
    fireEvent.keyDown(screen.getByTestId('visio-window'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
