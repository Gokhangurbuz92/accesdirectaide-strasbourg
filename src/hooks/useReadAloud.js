import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LANGUAGE_EVENT } from '@/i18n';
import { chunkText, currentSectionIndex, extractSections, voicesFor } from '@/lib/readAloud';

/**
 * R32 — the page reader's speech engine: the DEVICE's own speech synthesis (Web Speech API). No text is sent anywhere by AccesDirectAide; some
 * systems' voices are themselves online services of the system's maker, which the reader's help text says.
 *
 * Reading starts only on a user action. Pause / resume are implemented by stopping and restarting the current short chunk (≤ 220 characters):
 * the browsers' own pause() is unreliable (absent on Android, stuck after long utterances in Chrome), so the reader never pretends it works.
 * Reading stops when the page, the interface language or the reader itself goes away, and a change of voice or speed restarts the current chunk.
 * Each passage is spoken only with a voice of ITS language; a passage whose language has no voice on the device is skipped and the reader says so.
 */
export const PREFS_KEY = 'ada_reader_prefs';
const RATES = [0.75, 0.9, 1, 1.25, 1.5];
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

function loadPrefs() {
  try { const p = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}'); return { rate: RATES.includes(p.rate) ? p.rate : 1, voices: p.voices && typeof p.voices === 'object' ? p.voices : {}, highlight: p.highlight !== false }; } catch { return { rate: 1, voices: {}, highlight: true }; }
}

export default function useReadAloud() {
  const supported = canSpeak();
  const { pathname } = useLocation();
  const [voices, setVoices] = useState(/** @type {SpeechSynthesisVoice[]} */ ([]));
  const [prefs, setPrefsState] = useState(() => (supported ? loadPrefs() : { rate: 1, voices: {}, highlight: true }));
  const [state, setState] = useState({ status: /** @type {'idle'|'playing'|'paused'} */ ('idle'), section: 0, total: 0, heading: '', skipped: /** @type {string[]} */ ([]), error: '' });
  const run = useRef({ sections: /** @type {any[]} */ ([]), s: 0, b: 0, c: 0, token: 0, status: 'idle', el: /** @type {Element|null} */ (null), skipped: new Set(), prefs, voices: /** @type {SpeechSynthesisVoice[]} */ ([]) });
  run.current.prefs = prefs; run.current.voices = voices;

  useEffect(() => {
    if (!supported) return undefined;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices() || []);
    update();
    synth.addEventListener?.('voiceschanged', update);
    return () => synth.removeEventListener?.('voiceschanged', update);
  }, [supported]);

  const unmark = () => { run.current.el?.classList?.remove('ada-reading'); run.current.el = null; };
  const mark = (el) => {
    unmark();
    if (!run.current.prefs.highlight || !el) return;
    el.classList.add('ada-reading'); run.current.el = el;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  };
  const cancel = () => { run.current.token += 1; if (supported && window.speechSynthesis) window.speechSynthesis.cancel(); };

  const publish = (patch = {}) => {
    const r = run.current; const sec = r.sections[r.s];
    if (patch.status) r.status = patch.status;
    setState((st) => ({ ...st, section: r.s, total: r.sections.length, heading: sec?.heading || '', skipped: [...r.skipped], ...patch }));
  };

  const speakNext = useCallback(() => {
    const r = run.current;
    for (;;) {
      const sec = r.sections[r.s];
      if (!sec) { unmark(); publish({ status: 'idle' }); r.s = 0; r.b = 0; r.c = 0; return; }
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
        cancel(); unmark(); publish({ status: 'idle', error: String(e?.error || 'error') });
      };
      window.speechSynthesis.speak(u);
      return;
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** @param {'page'|'section'|'selection'} mode */
  const play = useCallback((mode = 'page') => {
    if (!supported) return;
    cancel();
    const main = document.getElementById('main-content') || document.body;
    const docLang = document.documentElement.lang || 'fr';
    const r = run.current; r.skipped = new Set(); r.b = 0; r.c = 0;
    if (mode === 'selection') {
      const sel = window.getSelection?.(); const text = String(sel?.toString() || '').trim();
      const anchor = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
      if (!text || !anchor || !main.contains(anchor)) { publish({ status: 'idle', error: 'no-selection' }); return; }
      r.sections = [{ heading: '', el: anchor, blocks: [{ el: anchor, text, lang: (anchor.closest('[lang]')?.getAttribute('lang') || docLang).split('-')[0] }] }];
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
  const resume = useCallback(() => { if (!run.current.sections.length) return; publish({ status: 'playing', error: '' }); speakNext(); }, [speakNext]);
  const stop = useCallback(() => { cancel(); unmark(); const r = run.current; r.s = 0; r.b = 0; r.c = 0; publish({ status: 'idle' }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const move = useCallback((/** @type {number} */ delta) => {
    const r = run.current;
    if (!r.sections.length) { play('page'); return; }
    cancel(); r.s = Math.min(Math.max(0, r.s + delta), r.sections.length - 1); r.b = 0; r.c = 0;
    publish({ status: 'playing', error: '' }); speakNext();
  }, [play, speakNext]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setPrefs = useCallback((/** @type {Partial<typeof prefs>} */ patch) => {
    const p = run.current.prefs;
    const next = { ...p, ...patch, voices: { ...p.voices, ...(patch.voices || {}) } };
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private browsing */ }
    run.current.prefs = next;
    setPrefsState(next);
    if (patch.highlight === false) unmark();
    if (run.current.status === 'playing') { cancel(); speakNext(); }   // a new voice or speed applies from the current chunk
  }, [speakNext]);   // eslint-disable-line react-hooks/exhaustive-deps

  // stop on a new page, a new interface language, or when the reader goes away
  useEffect(() => { stop(); }, [pathname]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!supported) return undefined;
    const onLang = () => stop();
    window.addEventListener(LANGUAGE_EVENT, onLang);
    return () => { window.removeEventListener(LANGUAGE_EVENT, onLang); cancel(); unmark(); };
  }, [supported]);   // eslint-disable-line react-hooks/exhaustive-deps

  return { supported, voices, prefs, setPrefs, state, play, pause, resume, stop, next: () => move(1), previous: () => move(-1), rates: RATES };
}
