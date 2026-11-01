/**
 * R32 — what the page reader reads, and in which order. Pure DOM logic (tested with jsdom); speech itself is in src/hooks/useReadAloud.js.
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
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const langOf = (el, fallback) => (el.closest?.('[lang]')?.getAttribute('lang') || fallback || 'fr').toLowerCase().split('-')[0];

/** a table read row by row: « Caption. Column A: value; Column B: value. » @param {HTMLTableElement} table */
function tableBlocks(table, fallbackLang) {
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
 * @returns {{ heading: string, el: Element, blocks: { el: Element, text: string, lang: string }[] }[]}
 */
export function extractSections(root, fallbackLang = 'fr') {
  const sections = [];
  let current = null;
  const open = (el, heading) => { current = { heading, el, blocks: [] }; sections.push(current); };
  const push = (el, text, lang) => { if (!current) open(el, ''); current.blocks.push({ el, text, lang }); };
  const walk = (el) => {
    if (isSkipped(el)) return;
    if (el.tagName === 'TABLE') { for (const b of tableBlocks(/** @type {HTMLTableElement} */ (el), fallbackLang)) push(b.el, b.text, b.lang); return; }
    if (BLOCK_TAGS.has(el.tagName)) {
      const text = clean(readableText(el));
      if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
      if (SECTION_TAGS.has(el.tagName)) open(el, text);
      push(el, text, langOf(el, fallbackLang));
      return;
    }
    // a container with its own text (mixed content) is read as one block; otherwise its children are visited
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && /[\p{L}\p{N}]/u.test(n.nodeValue || ''));
    if (ownText && !CONTAINER_TAGS.has(el.tagName)) { const text = clean(readableText(el)); if (text) push(el, text, langOf(el, fallbackLang)); return; }
    if (ownText) {
      const blockChild = [...el.children].some((c) => BLOCK_TAGS.has(c.tagName) || c.tagName === 'TABLE' || c.querySelector?.('p,li,h1,h2,h3,h4,table'));
      if (!blockChild) { const text = clean(readableText(el)); if (text) push(el, text, langOf(el, fallbackLang)); return; }
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
  return sections.filter((s) => s.blocks.length);
}

/** speech chunks of at most `max` characters, cut at sentence ends, then at commas, then at spaces (long utterances stop early in some browsers) */
export function chunkText(text, max = 220) {
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

/** the voices for a language, best first (the user's choice, then voices on the device, then the platform default) */
export function voicesFor(voices, lang, preferredURI = null) {
  const base = String(lang || '').toLowerCase();
  const list = (voices || []).filter((v) => String(v.lang || '').toLowerCase().replace('_', '-').split('-')[0] === base);
  // voices running on the device first: Chrome's « Google » voices are network voices that send the text to Google
  return list.sort((a, b) => (b.voiceURI === preferredURI) - (a.voiceURI === preferredURI) || (b.localService === true) - (a.localService === true) || (b.default === true) - (a.default === true));
}

/** index of the section that holds the focus, else the first one whose heading is at or below the top of the window */
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
