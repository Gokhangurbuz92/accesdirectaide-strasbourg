/** Launch-readiness item 64 (LEGAL_FR 03_COOKIES_TRACEURS C6, CNIL 2020-092): the answer to the information banner is kept 6 months, then it is shown again. */
export const BANNER_CHOICE_MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000;

/** @param {string | null} raw the stored answer @param {number} [now] */
export function bannerAnswered(raw, now = Date.now()) {
    try { const d = Date.parse(JSON.parse(String(raw)).date); return Number.isFinite(d) && now - d < BANNER_CHOICE_MAX_AGE_MS; } catch { return false; }
}
