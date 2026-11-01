// @vitest-environment jsdom
/* global window, document, CustomEvent */
/**
 * R32 — the page reader. DOM segmentation on real markup patterns, and the speech controller with a STUBBED speechSynthesis (these tests prove
 * the logic — order, chunking, pause/resume, stopping, language of the voice — not the quality or availability of real device voices, which is
 * checked in a real browser by scripts/acceptance/r32-accept.mjs).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement as h } from 'react';
import { chunkText, extractSections, voicesFor } from '../../src/lib/readAloud.js';
import ReadAloud from '../../src/components/a11y/ReadAloud.jsx';
import { LANGUAGE_EVENT } from '../../src/i18n/index.js';

const html = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d; };

describe('what is read', () => {
  it('reads headings, paragraphs, list items and table rows with their headers; skips hidden, decorative and control content', () => {
    const root = html(`<h1>Aide au logement</h1><p>Une aide <a href="#">pour le loyer</a>.</p>
      <div aria-hidden="true">icône</div><p hidden>caché</p><div data-no-read><p>contrôles</p></div><nav><a>menu</a></nav><button>Imprimer</button>
      <h2>Pour qui ?</h2><ul><li>Locataires</li><li lang="fr">Étudiants</li></ul><svg><text>x</text></svg>
      <table><caption>Montants</caption><thead><tr><th>Situation</th><th>Montant</th></tr></thead><tbody><tr><td>Seul</td><td>300 €</td></tr></tbody></table>`);
    const s = extractSections(root, 'en');
    expect(s.map((x) => x.heading)).toEqual(['Aide au logement', 'Pour qui ?']);
    expect(s[0].blocks.map((b) => b.text)).toEqual(['Aide au logement', 'Une aide pour le loyer.']);
    expect(s[1].blocks.map((b) => b.text)).toEqual(['Pour qui ?', 'Locataires', 'Étudiants', 'Montants', 'Situation : Seul ; Montant : 300 €.']);
    expect(s[1].blocks.map((b) => b.lang)).toEqual(['en', 'en', 'fr', 'en', 'en']);
  });
  it('cuts long text into short chunks at sentence ends, never losing text (no 1,000-character limit)', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Phrase numéro ${i} avec un peu de texte pour dépasser la limite.`).join(' ');
    const c = chunkText(long);
    expect(long.length).toBeGreaterThan(2000);
    expect(c.every((x) => x.length <= 220)).toBe(true);
    expect(c.join(' ')).toBe(long);
  });
  it('picks a voice of the passage language only — never a voice of another language', () => {
    const v = [{ lang: 'fr-FR', voiceURI: 'fr1', default: true }, { lang: 'ar-SA', voiceURI: 'ar1' }, { lang: 'en_GB', voiceURI: 'en1' }];
    expect(voicesFor(v, 'ar').map((x) => x.voiceURI)).toEqual(['ar1']);
    expect(voicesFor(v, 'en').map((x) => x.voiceURI)).toEqual(['en1']);
    expect(voicesFor(v, 'uk')).toEqual([]);
  });
});

describe('speech controller (stubbed speechSynthesis)', () => {
  let spoken; let synth;
  beforeEach(() => {
    spoken = [];
    synth = { queue: [], speak(u) { spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); this.queue.push(u); }, cancel() { this.queue = []; this.cancelled = (this.cancelled || 0) + 1; },
      getVoices: () => [{ lang: 'fr-FR', voiceURI: 'fr1', name: 'Amélie', localService: true }], addEventListener() {}, removeEventListener() {} };
    window.speechSynthesis = synth;
    window.SpeechSynthesisUtterance = function U(text) { this.text = text; };
    document.body.innerHTML = '';
  });
  afterEach(() => { delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; });
  const finish = () => act(() => { const u = synth.queue.shift(); u?.onend?.(); });

  it('reads the page in order on demand only, pauses and resumes at the current chunk, stops on a language change', () => {
    const main = document.createElement('main'); main.id = 'main-content';
    main.innerHTML = '<h1>Titre</h1><p>Premier paragraphe.</p><h2>Suite</h2><p>Second paragraphe.</p>';
    document.body.appendChild(main);
    render(h(MemoryRouter, null, h(ReadAloud)), { container: main.insertBefore(document.createElement('div'), main.firstChild) });
    expect(spoken).toEqual([]);   // nothing is spoken on load
    fireEvent.click(screen.getByTestId('read-aloud-toggle'));
    fireEvent.click(screen.getByTestId('read-page'));
    expect(spoken.map((x) => x.text)).toEqual(['Titre']);
    finish(); expect(spoken.at(-1).text).toBe('Premier paragraphe.');
    fireEvent.click(screen.getByTestId('read-pause'));
    expect(screen.getByTestId('read-resume')).toBeTruthy();
    fireEvent.click(screen.getByTestId('read-resume'));
    expect(spoken.at(-1).text).toBe('Premier paragraphe.');   // resumes by restarting the current chunk
    finish(); expect(spoken.at(-1).text).toBe('Suite');
    expect(screen.getByTestId('read-position').textContent).toContain('2');
    const before = synth.cancelled;
    act(() => { window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { language: 'en' } })); });
    expect(synth.cancelled).toBeGreaterThan(before);
    expect(screen.getByTestId('read-position').textContent).toMatch(/Prêt/);
  });
  it('skips a passage whose language has no voice on the device and says so', () => {
    const main = document.createElement('main'); main.id = 'main-content';
    main.innerHTML = '<p lang="uk">Текст українською.</p><p>Texte français.</p>';
    document.body.appendChild(main);
    render(h(MemoryRouter, null, h(ReadAloud)), { container: main.insertBefore(document.createElement('div'), main.firstChild) });
    fireEvent.click(screen.getByTestId('read-aloud-toggle'));
    fireEvent.click(screen.getByTestId('read-page'));
    expect(spoken.map((x) => [x.text, x.lang])).toEqual([['Texte français.', 'fr-FR']]);
    finish();
    expect(screen.getByTestId('read-skipped').textContent).toContain('Українська');
  });
  it('shows no control at all when the device cannot speak', () => {
    delete window.speechSynthesis;
    const { container } = render(h(MemoryRouter, null, h(ReadAloud)));
    expect(container.innerHTML).toBe('');
  });
});
