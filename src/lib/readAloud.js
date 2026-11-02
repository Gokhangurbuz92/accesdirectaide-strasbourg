/**
 * R32 — what the page reader reads, and in which order. Pure DOM logic (tested with jsdom); speech itself is in src/hooks/useReadAloud.js and
 * src/components/VoiceAssistant.jsx, which share the device's one speech queue through claimSpeech / releaseSpeech / silenceSpeech below.
 *
 * The main content (#main-content) is cut into SECTIONS (a new one at each h1–h3) made of BLOCKS (a heading, a paragraph, a list item, a
 * definition, a quote, a table row read with its column headers). Never read: hidden content (hidden, aria-hidden, inert, display:none,
 * visibility:hidden), anything marked data-no-read (the reader's own controls, notices that would repeat), scripts, styles, icons (svg), form
 * controls, navigation landmarks, buttons. Each block keeps the language of its element (`lang` attribute), so a French passage inside a
 * translated page is spoken with a French voice — never with a voice of another language.
 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'NAV', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'LABEL', 'DIALOG', 'FORM']);
const BLOCK_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'DT', 'DD', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'PRE', 'ADDRESS', 'SUMMARY']);
const SECTION_TAGS = new Set(['H1', 'H2', 'H3']);
const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'UL', 'OL', 'DL', 'DETAILS', 'FIGURE', 'SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'SMALL', 'TIME', 'MARK']);

/** @typedef {{ el: Element, text: string, lang: string }} ReadBlock  one passage, with the language of its element */
/** @typedef {{ heading: string, el: Element, blocks: ReadBlock[] }} ReadSection  the passages from one h1–h3 to the next */
/** @typedef {{ lang: string, voiceURI?: string, localService?: boolean, default?: boolean }} VoiceLike  what voicesFor reads of a SpeechSynthesisVoice */

/** @param {Element} el */
export function isSkipped(el) {
  if (!el || el.nodeType !== 1) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert') || el.hasAttribute('data-no-read')) return true;
  const role = el.getAttribute('role');
  if (role === 'navigation' || role === 'search' || role === 'dialog' || role === 'alertdialog' || role === 'presentation' || role === 'none' || role === 'img') return true;
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
  }
  if (el.classList?.contains('sr-only') && !BLOCK_TAGS.has(el.tagName)) return true;   // visually hidden helper text is for screen readers, not repeated aloud
  return false;
}

/** the readable text of an element, without its skipped descendants @param {Node} node */
export function readableText(node) {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const el = /** @type {Element} */ (node);
  if (isSkipped(el)) return '';
  let out = '';
  for (const c of el.childNodes) {
    const t = readableText(c);
    out += (c.nodeType === 1 && /^(BR|LI|P|DIV|TR)$/.test(/** @type {Element} */ (c).tagName)) ? ` ${t} ` : t;
  }
  return out;
}
const clean = (/** @type {unknown} */ s) => String(s).replace(/\s+/g, ' ').trim();
const SPEAKABLE = /[\p{L}\p{N}]/u;
const baseLang = (/** @type {string} */ tag) => tag.toLowerCase().split('-')[0];
/** the language of an element: its own or its nearest ancestor's `lang`, else the fallback @param {Element} el @param {string} [fallback] */
export const langOf = (el, fallback) => baseLang(el.closest?.('[lang]')?.getAttribute('lang') || fallback || 'fr');

/**
 * R39 — the readable text of an element cut where its LANGUAGE changes. A block used to be spoken with the language of the block only, so the
 * French official text that a translated page marks lang="fr" INSIDE a sentence of the interface language (« Règle officielle : <span lang="fr">…</span> »,
 * the needs and cautions of the orientation panel) was read by the Arabic, Turkish… voice. Each run is now spoken with a voice of its own language.
 * Spaces and punctuation alone never make a run of their own (they stay with the text before them); one-language text gives exactly one run.
 * @param {Element} el @param {string} lang  the language of `el` @returns {{ text: string, lang: string }[]}
 */
export function languageRuns(el, lang) {
  /** @type {{ text: string, lang: string }[]} */
  const runs = [];
  /** @param {string} text @param {string} l */
  const add = (text, l) => {
    const last = runs[runs.length - 1];
    if (last && (last.lang === l || !SPEAKABLE.test(text))) last.text += text;
    else if (!last && !SPEAKABLE.test(text)) runs.push({ text, lang: '' });   // leading spaces / punctuation: adopted by the first real run
    else if (last && !last.lang) { last.text += text; last.lang = l; }
    else runs.push({ text, lang: l });
  };
  /** @param {Node} node @param {string} l */
  const visit = (node, l) => {
    if (node.nodeType === 3) { add(node.nodeValue || '', l); return; }
    if (node.nodeType !== 1) return;
    const e = /** @type {Element} */ (node);
    if (isSkipped(e)) return;
    const own = e.getAttribute('lang');
    const here = own ? baseLang(own) : l;
    const spaced = /^(BR|LI|P|DIV|TR)$/.test(e.tagName);
    if (spaced) add(' ', here);
    for (const c of e.childNodes) visit(c, here);
    if (spaced) add(' ', here);
  };
  for (const c of el.childNodes) visit(c, lang);
  /** @type {{ text: string, lang: string }[]} */
  const out = [];
  for (const r of runs) {
    const text = clean(r.text);
    if (!text || !SPEAKABLE.test(text)) continue;
    const last = out[out.length - 1];
    if (last && last.lang === r.lang) last.text = `${last.text} ${text}`;
    else out.push({ text, lang: r.lang || lang });
  }
  return out;
}

/** a table read row by row: « Caption. Column A: value; Column B: value. » @param {HTMLTableElement} table @param {string} fallbackLang @returns {ReadBlock[]} */
function tableBlocks(table, fallbackLang) {
  /** @type {ReadBlock[]} */
  const blocks = [];
  const lang = langOf(table, fallbackLang);
  const caption = table.querySelector('caption');
  if (caption && !isSkipped(caption)) { const t = clean(readableText(caption)); if (t) blocks.push({ el: caption, text: t, lang }); }
  const headRow = table.querySelector('thead tr') || null;
  const headers = headRow ? [...headRow.children].map((c) => clean(readableText(c))) : [];
  const rows = [...table.querySelectorAll('tr')].filter((r) => r !== headRow && !isSkipped(r));
  for (const row of rows) {
    const cells = [...row.children].filter((c) => !isSkipped(c));
    const parts = cells.map((c, i) => { const v = clean(readableText(c)); if (!v) return ''; return headers[i] && headers[i] !== v ? `${headers[i]} : ${v}` : v; }).filter(Boolean);
    if (parts.length) blocks.push({ el: row, text: `${parts.join(' ; ')}.`, lang });
  }
  return blocks;
}

/**
 * @param {Element} root  usually #main-content
 * @param {string} [fallbackLang]  the document language
 * @returns {ReadSection[]}
 */
export function extractSections(root, fallbackLang = 'fr') {
  /** @type {ReadSection[]} */
  const sections = [];
  /** @type {ReadSection | null} */
  let current = null;
  /** @param {Element} el @param {string} heading @returns {ReadSection} */
  const open = (el, heading) => { const s = { heading, el, blocks: /** @type {ReadBlock[]} */ ([]) }; current = s; sections.push(s); return s; };
  /** @param {Element} el @param {string} text @param {string} lang */
  const push = (el, text, lang) => { (current ?? open(el, '')).blocks.push({ el, text, lang }); };
  /** @param {Element} el */
  const walk = (el) => {
    if (isSkipped(el)) return;
    if (el.tagName === 'TABLE') { for (const b of tableBlocks(/** @type {HTMLTableElement} */ (el), fallbackLang)) push(b.el, b.text, b.lang); return; }
    /** one block per language run of `el` (see languageRuns) */
    const pushRuns = () => { for (const r of languageRuns(el, langOf(el, fallbackLang))) push(el, r.text, r.lang); };
    if (BLOCK_TAGS.has(el.tagName)) {
      const text = clean(readableText(el));
      if (!text || !SPEAKABLE.test(text)) return;
      if (SECTION_TAGS.has(el.tagName)) open(el, text);
      pushRuns();
      return;
    }
    // a container with its own text (mixed content) is read as one block; otherwise its children are visited
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && SPEAKABLE.test(n.nodeValue || ''));
    if (ownText && !CONTAINER_TAGS.has(el.tagName)) { pushRuns(); return; }
    if (ownText) {
      const blockChild = [...el.children].some((c) => BLOCK_TAGS.has(c.tagName) || c.tagName === 'TABLE' || c.querySelector?.('p,li,h1,h2,h3,h4,table'));
      if (!blockChild) { pushRuns(); return; }
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
  return sections.filter((s) => s.blocks.length);
}

/**
 * speech chunks of at most `max` characters, cut at sentence ends, then at commas, then at spaces (long utterances stop early in some browsers)
 * @param {string} text @param {number} [max] @returns {string[]}
 */
export function chunkText(text, max = 220) {
  /** @type {string[]} */
  const out = [];
  const sentences = clean(text).split(/(?<=[.!?;:…])\s+/);
  for (const s of sentences) {
    if (s.length <= max) { if (s) out.push(s); continue; }
    let rest = s;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(', ', max);
      if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max);
      if (cut < max * 0.4) cut = max;
      out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * the voices for a language, best first (the user's choice, then voices on the device, then the platform default)
 * @template {VoiceLike} V
 * @param {readonly V[] | null | undefined} voices @param {string} lang @param {string | null} [preferredURI] @returns {V[]}
 */
export function voicesFor(voices, lang, preferredURI = null) {
  const base = String(lang || '').toLowerCase();
  const list = (voices || []).filter((v) => String(v.lang || '').toLowerCase().replace('_', '-').split('-')[0] === base);
  const rank = (/** @type {boolean} */ yes) => (yes ? 1 : 0);
  // voices running on the device first: Chrome's « Google » voices are network voices that send the text to Google
  return list.sort((a, b) => rank(b.voiceURI === preferredURI) - rank(a.voiceURI === preferredURI) || rank(b.localService === true) - rank(a.localService === true) || rank(b.default === true) - rank(a.default === true));
}

/**
 * index of the section that holds the focus, else the first one whose heading is at or below the top of the window
 * @param {ReadSection[]} sections @param {Element | null} [active]
 */
export function currentSectionIndex(sections, active = typeof document !== 'undefined' ? document.activeElement : null) {
  if (active) {
    for (let i = sections.length - 1; i >= 0; i -= 1) {
      const first = sections[i].el;
      if (first === active || (first.compareDocumentPosition && (first.compareDocumentPosition(active) & 4))) return i;   // active comes after the section start
    }
  }
  for (let i = 0; i < sections.length; i += 1) {
    const r = sections[i].el.getBoundingClientRect?.();
    if (r && r.bottom >= 0) return i;
  }
  return 0;
}

/*
 * R39 — ONE voice at a time. The device has a single speech queue shared by the page reader (useReadAloud) and the « Écouter » buttons
 * (VoiceAssistant). Before, each of them called speechSynthesis.cancel() on its own: starting one left the other believing it was still reading
 * (its controls said « Lecture en cours », its passage stayed highlighted) and, in the browsers that end a cancelled utterance with an `end` event
 * instead of an `error`, the other one went on to its next chunk, so two texts were read in turn; and an « Écouter » button that left the page
 * silenced the page reader. Now a reader CLAIMS the speech before speaking: the reader that held it is told to stop (preempt) and the queue is
 * emptied. A reader that stops RELEASES it: the queue is emptied only when no other reader holds it.
 */
/** @typedef {{ preempt: () => void }} SpeechOwner  a reader: `preempt` resets it (no further chunk, controls back to idle) when another one starts */

/** true when the device can speak (Web Speech API); every reader is hidden otherwise */
export const canSpeak = () => typeof window !== 'undefined' && Boolean(window.speechSynthesis) && typeof window.speechSynthesis.speak === 'function' && typeof window.SpeechSynthesisUtterance === 'function';

/** @type {SpeechOwner | null} */
let speechOwner = null;
const emptyQueue = () => { if (canSpeak()) window.speechSynthesis.cancel(); };

/** `owner` takes the speech: the reader that held it is preempted and the queue is emptied (call it right before speaking) @param {SpeechOwner} owner */
export function claimSpeech(owner) {
  const previous = speechOwner;
  speechOwner = owner;
  if (previous && previous !== owner) previous.preempt();
  emptyQueue();
}

/** `owner` gives the speech back; the queue is emptied unless ANOTHER reader holds it @param {SpeechOwner} owner @returns {boolean} whether it emptied the queue */
export function releaseSpeech(owner) {
  if (speechOwner && speechOwner !== owner) return false;
  speechOwner = null;
  emptyQueue();
  return true;
}

/** silences every reader (a new page): the holder is preempted and the queue is emptied */
export function silenceSpeech() {
  const previous = speechOwner;
  speechOwner = null;
  previous?.preempt();
  emptyQueue();
}

/** @param {SpeechOwner} owner */
export const holdsSpeech = (owner) => speechOwner === owner;
