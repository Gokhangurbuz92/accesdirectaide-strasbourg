import { useState } from 'react';

const READER_KEY = 'ada_news_reader_v1';

/** Actualités v2 — comfortable reading, kept for this viewer only (storage may be unavailable: the page then simply starts in normal mode) */
export default function useReaderMode() {
  const [on, setOn] = useState(() => { try { return window.localStorage.getItem(READER_KEY) === '1'; } catch { return false; } });
  const toggle = () => setOn((v) => { try { window.localStorage.setItem(READER_KEY, v ? '0' : '1'); } catch { /* */ } return !v; });
  return /** @type {[boolean, () => void]} */ ([on, toggle]);
}
