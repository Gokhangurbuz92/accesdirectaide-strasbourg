// @vitest-environment jsdom
/* global window, document */
/**
 * R39 — the readers aloud (page reader useReadAloud + ReadAloud, « Écouter » buttons VoiceAssistant) with a STUBBED speechSynthesis that behaves like
 * the real ones on cancel(): the cancelled utterances receive their `end` (Safari, Firefox) or `error: interrupted` (Chrome) event LATE, after the
 * cancel. Proves: stop / unmount / route change cancel the speech and no later chunk is spoken; one voice at a time between the readers; each
 * passage is spoken with a voice of ITS language (French inside an Arabic page); the controls stay focusable while unavailable; nothing without
 * speech synthesis. Not proven here: real device voices (scripts/acceptance/r32-accept.mjs runs a real browser). No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ReadAloud from '../../src/components/a11y/ReadAloud.jsx';
import VoiceAssistant from '../../src/components/VoiceAssistant.jsx';
import { extractSections, languageRuns, releaseSpeech, silenceSpeech } from '../../src/lib/readAloud.js';

const VOICES = [{ lang: 'fr-FR', voiceURI: 'fr1', name: 'Amélie', localService: true }, { lang: 'ar-SA', voiceURI: 'ar1', name: 'Maged', localService: true }, { lang: 'en-GB', voiceURI: 'en1', name: 'Daniel', localService: true }];

/** a speech queue like the browsers': one utterance spoken at a time; cancel() empties it and the dropped utterances get their event later */
function stubSynth(late = 'end', voices = VOICES) {
  const s = {
    queue: [], dropped: [], spoken: [], cancels: 0,
    speak(u) { s.spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.voiceURI }); s.queue.push(u); },
    cancel() { s.cancels += 1; s.dropped.push(...s.queue); s.queue = []; },
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
  };
  return s;
}
let synth;
const install = (late, voices) => { synth = stubSynth(late, voices); synth.late = late; window.speechSynthesis = synth; window.SpeechSynthesisUtterance = function U(text) { this.text = text; }; };
/** the events of the cancelled utterances arrive (after the cancel, as in a real browser) */
const deliverLate = () => act(() => { const d = synth.dropped; synth.dropped = []; for (const u of d) { if (synth.late === 'end') u.onend?.(); else u.onerror?.({ error: 'interrupted' }); } });
/** the utterance being spoken ends normally */
const finish = () => act(() => { const u = synth.queue.shift(); u?.onend?.(); });

const page = (html, lang = 'fr') => {
  document.documentElement.lang = lang;
  const main = document.createElement('main'); main.id = 'main-content'; main.innerHTML = html;
  document.body.appendChild(main);
  return main.insertBefore(document.createElement('div'), main.firstChild);
};
function Go() { const navigate = useNavigate(); return h('button', { type: 'button', 'data-testid': 'go', onClick: () => navigate('/autre-page') }, 'Autre page'); }
const mountReader = (container, extra = null) => render(h(MemoryRouter, { initialEntries: ['/'] }, h(ReadAloud), h(Go), extra), { container });
const openAndPlay = () => { fireEvent.click(screen.getByTestId('read-aloud-toggle')); fireEvent.click(screen.getByTestId('read-page')); };
const status = () => screen.getByTestId('read-position').textContent;

beforeEach(() => { document.body.innerHTML = ''; silenceSpeech(); });
afterEach(() => { cleanup(); silenceSpeech(); delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; document.documentElement.lang = 'fr'; });

describe.each(['end', 'error'])('cancelling (late `%s` event of the cancelled utterance)', (late) => {
  beforeEach(() => install(late));
  const html = '<h1>Titre</h1><p>Premier paragraphe.</p><p>Second paragraphe.</p>';

  it('Stop cancels the speech, and the late event of the cancelled utterance never starts the next chunk', () => {
    mountReader(page(html)); openAndPlay();
    expect(synth.spoken.map((x) => x.text)).toEqual(['Titre']);
    const before = synth.cancels;
    fireEvent.click(screen.getByTestId('read-stop'));
    expect(synth.cancels).toBeGreaterThan(before); expect(synth.queue).toHaveLength(0);
    deliverLate();
    expect(synth.spoken.map((x) => x.text)).toEqual(['Titre']);
    expect(status()).toMatch(/Prêt à lire/);
    expect(document.querySelector('.ada-reading')).toBeNull();
  });

  it('unmounting the reader cancels the speech; nothing is spoken afterwards', () => {
    const { unmount } = mountReader(page(html)); openAndPlay(); finish();
    expect(synth.spoken.at(-1).text).toBe('Premier paragraphe.');
    const before = synth.cancels;
    unmount();
    expect(synth.cancels).toBeGreaterThan(before); expect(synth.queue).toHaveLength(0);
    deliverLate();
    expect(synth.spoken).toHaveLength(2);
  });

  it('a route change cancels the speech and the reader returns to « Prêt à lire »', () => {
    mountReader(page(html)); openAndPlay();
    const before = synth.cancels;
    fireEvent.click(screen.getByTestId('go'));
    expect(synth.cancels).toBeGreaterThan(before); expect(synth.queue).toHaveLength(0);
    deliverLate();
    expect(synth.spoken).toHaveLength(1);
    expect(status()).toMatch(/Prêt à lire/);
  });

  it('one voice at a time: « Écouter » stops the page reader, and the page reader stops « Écouter »', () => {
    mountReader(page(html), h(VoiceAssistant, { text: 'Texte de l’étape.' })); openAndPlay();
    expect(synth.queue.map((u) => u.text)).toEqual(['Titre']);
    fireEvent.click(screen.getByTestId('voice-read'));                  // another reader starts
    expect(synth.queue.map((u) => u.text)).toEqual(['Texte de l’étape.']);
    deliverLate();                                                      // the page reader's cancelled chunk ends late: it must not go on
    expect(synth.queue.map((u) => u.text)).toEqual(['Texte de l’étape.']);
    expect(status()).toMatch(/Prêt à lire/);                           // its controls no longer claim it is reading
    expect(document.querySelector('.ada-reading')).toBeNull();
    expect(screen.getByTestId('voice-read')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('read-page'));                   // and back: the page reader starts again
    deliverLate();
    expect(synth.queue.map((u) => u.text)).toEqual(['Titre']);
    expect(screen.getByTestId('voice-read')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('voice-read')).toHaveTextContent('Écouter');
    expect(synth.spoken.map((x) => x.text)).toEqual(['Titre', 'Texte de l’étape.', 'Titre']);
  });

  it('an « Écouter » button that leaves the page does not silence the page reader', () => {
    const container = page(html);
    const view = mountReader(container, h(VoiceAssistant, { text: 'Texte.' }));
    openAndPlay();
    const before = synth.cancels;
    view.rerender(h(MemoryRouter, { initialEntries: ['/'] }, h(ReadAloud), h(Go)));   // the button unmounts, the page reader keeps reading
    expect(synth.cancels).toBe(before); expect(synth.queue.map((u) => u.text)).toEqual(['Titre']);
    finish(); expect(synth.spoken.at(-1).text).toBe('Premier paragraphe.');
  });
});

describe('the language of the voice is the language of the text', () => {
  beforeEach(() => install('end'));

  it('in an Arabic interface, the interface text is read with the Arabic voice and the French official text inside it with the French voice', () => {
    const container = page('<h1>توجيه</h1><p data-testid="rule"><span>القاعدة الرسمية: </span><span lang="fr" dir="ltr">La trêve hivernale court jusqu’au 31 mars.</span> (<a lang="fr" href="#x">Fiche F34774</a>)</p>', 'ar');
    mountReader(container); openAndPlay();
    while (synth.queue.length) finish();
    expect(synth.spoken.map((x) => [x.text, x.voice])).toEqual([
      ['توجيه', 'ar1'], ['القاعدة الرسمية:', 'ar1'], ['La trêve hivernale court jusqu’au 31 mars.', 'fr1'], ['(Fiche F34774)', 'fr1'],   // one French run, spoken in two sentence chunks
    ]);
  });

  it('a block in one language is one run, exactly as before (punctuation and spaces never make a run of their own)', () => {
    const d = document.createElement('div'); d.innerHTML = '<p>Une aide <a href="#x">pour le loyer</a>.</p>';
    expect(languageRuns(d.firstElementChild, 'fr')).toEqual([{ text: 'Une aide pour le loyer.', lang: 'fr' }]);
    d.innerHTML = '<p lang="en">Read <span lang="fr-FR">la fiche</span>, then <span lang="fr">appelez le 115</span>.</p>';
    expect(languageRuns(d.firstElementChild, 'en')).toEqual([{ text: 'Read', lang: 'en' }, { text: 'la fiche', lang: 'fr' }, { text: ', then', lang: 'en' }, { text: 'appelez le 115.', lang: 'fr' }]);
    expect(extractSections(d, 'en')[0].blocks.map((b) => b.lang)).toEqual(['en', 'fr', 'en', 'fr']);
  });

  it('« Écouter » reads French text with the French voice even when the interface is Arabic, and says so when the device has no voice of that language', () => {
    document.documentElement.lang = 'ar';
    render(h(VoiceAssistant, { text: 'Bonjour.' }));
    fireEvent.click(screen.getByTestId('voice-read'));
    expect(synth.spoken).toEqual([{ text: 'Bonjour.', lang: 'fr-FR', voice: 'fr1' }]);
    cleanup(); install('end', [VOICES[2]]); synth.spoken.length = 0;
    render(h(VoiceAssistant, { text: 'Bonjour.' }));
    const b = screen.getByTestId('voice-read');
    fireEvent.click(b);
    expect(synth.spoken).toEqual([]);
    expect(screen.getByTestId('voice-read-none')).toHaveTextContent('Aucune voix en Français');
    expect(b).toHaveAttribute('aria-describedby', 'voice-read-none');
  });
});

describe('the controls', () => {
  beforeEach(() => install('error'));

  it('are real buttons that keep the keyboard focus when they become unavailable (aria-disabled, the press does nothing)', () => {
    mountReader(page('<h1>Titre</h1><p>Texte.</p>'));
    const toggle = screen.getByTestId('read-aloud-toggle');
    expect(toggle.tagName).toBe('BUTTON'); expect(toggle).toHaveAccessibleName('Écouter la page'); expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Fermer la lecture à voix haute');
    const play = screen.getByTestId('read-page');
    expect(screen.getByTestId('read-stop')).toHaveAttribute('aria-disabled', 'true');
    play.focus(); fireEvent.click(play);
    expect(play).toHaveAttribute('aria-disabled', 'true'); expect(play).not.toBeDisabled();
    expect(document.activeElement).toBe(play);                           // the focus did not fall back to the top of the page
    fireEvent.click(play); expect(synth.spoken).toHaveLength(1);         // pressing an unavailable control does nothing
    const stop = screen.getByTestId('read-stop');
    expect(stop).not.toHaveAttribute('aria-disabled');
    for (const b of screen.getByRole('group').querySelectorAll('button')) {
      expect(b.className).toMatch(/focus:ring-2/); expect(b.className).toMatch(/min-h-11/);
      expect(b.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it('nothing is rendered and nothing is spoken when the browser has no speech synthesis', () => {
    delete window.speechSynthesis;
    const { container } = render(h(MemoryRouter, null, h(ReadAloud), h(VoiceAssistant, { text: 'Texte.' })));
    expect(container.innerHTML).toBe('');
    expect(releaseSpeech({ preempt() {} })).toBe(true);                  // releasing without a device is harmless
  });
});
