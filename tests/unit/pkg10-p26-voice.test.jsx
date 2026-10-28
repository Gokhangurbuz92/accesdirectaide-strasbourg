// @vitest-environment jsdom
/**
 * PKG-10 / P26 — « Écouter » reads with the device's own speech synthesis: no request (the text never leaves the device; the former /api/tts call to an external
 * AI voice was always refused by the AI policy), French voice preferred, press again to stop, stops on unmount, hidden where the device cannot speak. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceAssistant from '../../src/components/VoiceAssistant.jsx';

let synth; const spoken = [];
class Utterance { constructor(t) { this.text = t; } }
beforeEach(() => {
  spoken.length = 0;
  synth = { speak: vi.fn((u) => spoken.push(u)), cancel: vi.fn(), getVoices: () => [{ lang: 'en-US', name: 'en' }, { lang: 'fr-FR', name: 'Amélie' }] };
  vi.stubGlobal('speechSynthesis', synth); vi.stubGlobal('SpeechSynthesisUtterance', Utterance); vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PKG-10 / P26 device speech', () => {
  it('reads in French on the device, sends nothing, toggles to « Arrêter » and stops; axe clean', async () => {
    const { container, unmount } = render(createElement(VoiceAssistant, { text: 'Bonjour, voici vos démarches.' }));
    const b = screen.getByTestId('voice-read');
    expect(b).toHaveAttribute('aria-pressed', 'false'); expect(b).toHaveTextContent('Écouter');
    fireEvent.click(b);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(spoken[0]).toMatchObject({ text: 'Bonjour, voici vos démarches.', lang: 'fr-FR', voice: { lang: 'fr-FR' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(b).toHaveAttribute('aria-pressed', 'true'); expect(b).toHaveTextContent('Arrêter'); expect(b).toHaveAccessibleName('Arrêter la lecture vocale');
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
    fireEvent.click(b); expect(b).toHaveTextContent('Écouter');
    const cancels = synth.cancel.mock.calls.length; unmount(); expect(synth.cancel.mock.calls.length).toBe(cancels + 1);
  });
  it('the end of the reading resets the button', () => {
    render(createElement(VoiceAssistant, { text: 'Texte.' }));
    fireEvent.click(screen.getByTestId('voice-read')); expect(screen.getByTestId('voice-read')).toHaveTextContent('Arrêter');
    act(() => { spoken[0].onend(); });
    expect(screen.getByTestId('voice-read')).toHaveTextContent('Écouter');
  });
  it('no button where the device cannot speak, or with nothing to read', () => {
    vi.stubGlobal('speechSynthesis', undefined); delete globalThis.speechSynthesis;
    render(createElement(VoiceAssistant, { text: 'x' })); expect(screen.queryByTestId('voice-read')).toBeNull();
  });
  it('the component no longer calls the external voice proxy', async () => {
    const fs = await import('node:fs');
    const code = fs.readFileSync('src/components/VoiceAssistant.jsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/api\/tts|fetch\(|XMLHttpRequest|sendBeacon/);
  });
});
