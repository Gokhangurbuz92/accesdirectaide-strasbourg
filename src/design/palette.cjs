/**
 * UI modernisation (24/11/2026) — the Tailwind palette as CSS variables (shared by tailwind.config.js and scripts/gen-theme-palette.mjs).
 * Each colour class reads a variable of its role: text (--ct-*), border / ring (--cb-* / --ct-*), background (--cg-*). The variables are defined in
 * src/styles/theme-palette.css (generated): Tailwind's own values in light, the dark theme and the high-contrast mode remap them.
 */
const PALETTE_FAMILIES = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

/** Dark theme (contrast checked against the surface #131C2E and the page #0B1220: neutral text ≥ 7:1, tinted panels keep their text ≥ 7:1). */
const DARK = {
  canvas: '#0B1220',
  surface: '#131C2E',
  neutralBg: { 50: '#0E1626', 100: '#1A2438', 200: '#243049', 300: '#2F3C57', 400: '#46546E' },
  neutralText: { 500: '#9DAABD', 600: '#AFBBCC', 700: '#C6CFDC', 800: '#DAE1EA', 900: '#ECF1F6', 950: '#F7F9FC' },
  neutralBorder: { 50: '#1A2438', 100: '#1F2A3F', 200: '#2A3750', 300: '#36445F', 400: '#4C5B76' },
  textShade: { 500: '400', 600: '300', 700: '300', 800: '200', 900: '100', 950: '50' },
  tintWeight: { 50: 0.12, 100: 0.18, 200: 0.26, 300: 0.36, 400: 0.5 },
  borderWeight: { 50: 0.22, 100: 0.3, 200: 0.4, 300: 0.5, 400: 0.62 },
};

/** @param {'t' | 'b' | 'g'} role */
function paletteFor(role) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  for (const f of PALETTE_FAMILIES) {
    out[f] = {};
    for (const s of SHADES) out[f][s] = `rgb(var(--c${role}-${f}-${s}, var(--c-${f}-${s})) / <alpha-value>)`;   // a role variable exists only where it differs
  }
  return out;
}

module.exports = { PALETTE_FAMILIES, NEUTRALS, SHADES, DARK, paletteFor };
