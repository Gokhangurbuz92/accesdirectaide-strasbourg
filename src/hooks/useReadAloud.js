import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LANGUAGE_EVENT } from '@/i18n';
import { canSpeak, chunkText, claimSpeech, currentSectionIndex, extractSections, holdsSpeech, langOf, releaseSpeech, silenceSpeech, voicesFor } from '@/lib/readAloud';

/**
 * R32 — the page reader's speech engine: the DEVICE's own speech synthesis (Web Speech API). No text is sent anywhere by AccesDirectAide; some
 * systems' voices are themselves online services of the system's maker, which the reader's help text says.
 *
 * Reading starts only on a user action. Pause / resume are implemented by stopping and restarting the current short chunk (≤ 220 characters):
 * the browsers' own pause() is unreliable (absent on Android, stuck after long utterances in Chrome), so the reader never pretends it works.
 * Reading stops when the page, the interface language or the reader itself goes away, and a change of voice or speed restarts the current chunk.
 * Each passage is spoken only with a voice of ITS language; a passage whose language has no voice on the device is skipped and the reader says so.
 * R39: one voice at a time — the reader claims the device's speech before speaking and gives it back when it stops, so an « Écouter » button
 * (VoiceAssistant) that starts reading stops the page reader (its controls return to « Prêt à lire »), and the other way round (src/lib/readAloud.js).
 */
export const PREFS_KEY = 'ada_reader_prefs';
const RATES = [0.75, 0.9, 1, 1.25, 1.5];
export { canSpeak };

/** @typedef {{ rate: number, voices: Record<string, string>, highlight: boolean }} ReaderPrefs  speed, chosen voice per language (voiceURI), highlighting */
/** @typedef {'idle' | 'playing' | 'paused'} ReaderStatus */
/** @typedef {{ status: ReaderStatus, section: number, total: number, heading: string, skipped: string[], error: string }} ReaderState */
/** @typedef {ReturnType<typeof useReadAloud>} ReadAloudController  what the reader's controls receive (src/components/a11y/ReadAloud.jsx) */

/** @returns {ReaderPrefs} */
function loadPrefs() {
  try { const p = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}'); return { rate: RATES.includes(p.rate) ? p.rate : 1, voices: p.voices && typeof p.voices === 'object' ? p.voices : {}, highlight: p.highlight !== false }; } catch { return { rate: 1, voices: {}, highlight: true }; }
}

export default function useReadAloud() {
  const supported = canSpeak();
  const { pathname } = useLocation();
  const [voices, setVoices] = useState(/** @type {SpeechSynthesisVoice[]} */ ([]));
  const [prefs, setPrefsState] = useState(/** @returns {ReaderPrefs} */ () => (supported ? loadPrefs() : { rate: 1, voices: {}, highlight: true }));
  const [state, setState] = useState(/** @type {ReaderState} */ ({ status: 'idle', section: 0, total: 0, heading: '', skipped: [], error: '' }));
  const run = useRef({ sections: /** @type {import('@/lib/readAloud').ReadSection[]} */ ([]), s: 0, b: 0, c: 0, token: 0, status: /** @type {ReaderStatus} */ ('idle'), el: /** @type {Element|null} */ (null), skipped: /** @type {Set<string>} */ (new Set()), prefs, voices: /** @type {SpeechSynthesisVoice[]} */ ([]) });
  run.current.prefs = prefs; run.current.voices = voices;
  // this reader as a holder of the device's speech: when another reader starts, nothing more is spoken and the controls return to idle
  const owner = useRef(/** @type {import('@/lib/readAloud').SpeechOwner} */ ({ preempt: () => {} }));

  useEffect(() => {
    if (!supported) return undefined;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices() || []);
    update();
    synth.addEventListener?.('voiceschanged', update);
    return () => synth.removeEventListener?.('voiceschanged', update);
  }, [supported]);

  const unmark = () => { run.current.el?.classList?.remove('ada-reading'); run.current.el = null; };
  const mark = (/** @type {Element} */ el) => {
    unmark();
    if (!run.current.prefs.highlight || !el) return;
    el.classList.add('ada-reading'); run.current.el = el;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  };
  /** forgets the utterance being spoken (its late end / error events are ignored) and empties the queue this reader holds */
  const cancel = () => { run.current.token += 1; if (supported && holdsSpeech(owner.current)) window.speechSynthesis.cancel(); };
  /** before speaking: this reader takes the speech (any other reader stops) */
  const claim = () => { run.current.token += 1; if (supported) claimSpeech(owner.current); };

  const publish = (/** @type {Partial<ReaderState>} */ patch = {}) => {
    const r = run.current; const sec = r.sections[r.s];
    if (patch.status) r.status = patch.status;
    setState((st) => ({ ...st, section: r.s, total: r.sections.length, heading: sec?.heading || '', skipped: [...r.skipped], ...patch }));
  };

  const speakNext = useCallback(() => {
    const r = run.current;
    for (;;) {
      const sec = r.sections[r.s];
      if (!sec) { unmark(); publish({ status: 'idle' }); r.s = 0; r.b = 0; r.c = 0; releaseSpeech(owner.current); return; }
      const blk = sec.blocks[r.b];
      if (!blk) { r.s += 1; r.b = 0; r.c = 0; publish(); continue; }
      const voice = voicesFor(r.voices, blk.lang, r.prefs.voices[blk.lang])[0];
      if (!voice) { r.skipped.add(blk.lang); r.b += 1; r.c = 0; continue; }
      const chunks = chunkText(blk.text);
      if (r.c >= chunks.length) { r.b += 1; r.c = 0; continue; }
      mark(blk.el);
      const token = r.token;
      const u = new window.SpeechSynthesisUtterance(chunks[r.c]);
      u.lang = voice.lang; u.voice = voice; u.rate = r.prefs.rate;
      u.onend = () => { if (token !== run.current.token) return; run.current.c += 1; speakNext(); };
      u.onerror = (/** @type {any} */ e) => {
        if (token !== run.current.token || e?.error === 'interrupted' || e?.error === 'canceled') return;
        run.current.token += 1; releaseSpeech(owner.current); unmark(); publish({ status: 'idle', error: String(e?.error || 'error') });
      };
      window.speechSynthesis.speak(u);
      return;
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** @param {'page'|'section'|'selection'} mode */
  const play = useCallback((mode = 'page') => {
    if (!supported) return;
    claim();
    const main = document.getElementById('main-content') || document.body;
    const docLang = document.documentElement.lang || 'fr';
    const r = run.current; r.skipped = new Set(); r.b = 0; r.c = 0;
    if (mode === 'selection') {
      const sel = window.getSelection?.(); const text = String(sel?.toString() || '').trim();
      const node = sel?.anchorNode;
      const anchor = node && node.nodeType === 1 ? /** @type {Element} */ (node) : node?.parentElement ?? null;
      if (!text || !anchor || !main.contains(anchor)) { publish({ status: 'idle', error: 'no-selection' }); return; }
      r.sections = [{ heading: '', el: anchor, blocks: [{ el: anchor, text, lang: langOf(anchor, docLang) }] }];
      r.s = 0;
    } else {
      r.sections = extractSections(main, docLang.split('-')[0]);
      r.s = mode === 'section' ? currentSectionIndex(r.sections) : 0;
    }
    if (!r.sections.length) { publish({ status: 'idle', error: 'empty' }); return; }
    publish({ status: 'playing', error: '' });
    speakNext();
  }, [supported, speakNext]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => { cancel(); publish({ status: 'paused' }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const resume = useCallback(() => { if (!run.current.sections.length) return; claim(); publish({ status: 'playing', error: '' }); speakNext(); }, [speakNext]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** back to the start, nothing spoken; `release` gives the device's speech back (emptying the queue unless another reader holds it) */
  const reset = (release = true) => { run.current.token += 1; if (release && supported) releaseSpeech(owner.current); unmark(); const r = run.current; r.s = 0; r.b = 0; r.c = 0; publish({ status: 'idle' }); };
  owner.current.preempt = () => reset(false);
  const stop = useCallback(() => reset(), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const move = useCallback((/** @type {number} */ delta) => {
    const r = run.current;
    if (!r.sections.length) { play('page'); return; }
    claim(); r.s = Math.min(Math.max(0, r.s + delta), r.sections.length - 1); r.b = 0; r.c = 0;
    publish({ status: 'playing', error: '' }); speakNext();
  }, [play, speakNext]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setPrefs = useCallback((/** @type {Partial<typeof prefs>} */ patch) => {
    const p = run.current.prefs;
    const next = { ...p, ...patch, voices: { ...p.voices, ...(patch.voices || {}) } };
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private browsing */ }
    run.current.prefs = next;
    setPrefsState(next);
    if (patch.highlight === false) unmark();
    if (run.current.status === 'playing') { claim(); speakNext(); }   // a new voice or speed applies from the current chunk
  }, [speakNext]);   // eslint-disable-line react-hooks/exhaustive-deps

  // stop on a new page (R39: every reader, not only this one — nothing goes on speaking over the next page), a new interface language, or when
  // the reader goes away
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; stop(); return; }
    if (supported) silenceSpeech();
    stop();
  }, [pathname]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!supported) return undefined;
    const onLang = () => stop();
    const r = run.current; const me = owner.current;   // the same objects for the life of the reader
    window.addEventListener(LANGUAGE_EVENT, onLang);
    return () => { window.removeEventListener(LANGUAGE_EVENT, onLang); r.token += 1; releaseSpeech(me); unmark(); };
  }, [supported]);   // eslint-disable-line react-hooks/exhaustive-deps

  return { supported, voices, prefs, setPrefs, state, play, pause, resume, stop, next: () => move(1), previous: () => move(-1), rates: RATES };
}
