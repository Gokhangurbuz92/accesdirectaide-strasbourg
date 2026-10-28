/**
 * K0 / C04 — the accessibility preferences saved in the ACCOUNT (CitizenProfile.accessibilityPrefs) are applied site-wide.
 * The site already applies device-level settings everywhere (AccessibilityPanel: text size + contrast on <html>/<body>; FalcProvider: FALC mode); the account values are written into
 * those same device settings when the signed-in account is loaded (after login and on /compte/profil), and an event tells the mounted components to re-read them at once.
 * Nothing is fetched for anonymous visitors. Unknown keys are ignored; only the values the account actually set are applied (an unset value never resets a device choice).
 */
export const ACCESSIBILITY_EVENT = 'ada:accessibility-settings';
export const TEXT_SCALE_PERCENT = Object.freeze({ normal: 100, large: 115, xlarge: 130 });

const DEFAULT_DEVICE = { fontSize: 100, contrast: 'normal', lineHeight: 'normal', simplifiedMode: false };

/** @param {Storage | undefined} storage */
function readDevice(storage) {
  try { return { ...DEFAULT_DEVICE, ...(JSON.parse(storage?.getItem('accessibilitySettings') || 'null') || {}) }; } catch { return { ...DEFAULT_DEVICE }; }
}

/**
 * @param {{ falc?: boolean, highContrast?: boolean, textScale?: string } | null | undefined} prefs  account accessibilityPrefs
 * @param {{ storage?: Storage, target?: EventTarget }} [env]
 * @returns {{ applied: boolean, device: typeof DEFAULT_DEVICE, falc: boolean | null }}
 */
export function applyAccountAccessibility(prefs, env = {}) {
  const storage = env.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  const target = env.target ?? (typeof window !== 'undefined' ? window : undefined);
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  const device = readDevice(storage);
  let applied = false;
  if (Object.prototype.hasOwnProperty.call(TEXT_SCALE_PERCENT, String(p.textScale))) { device.fontSize = TEXT_SCALE_PERCENT[/** @type {'normal'|'large'|'xlarge'} */ (p.textScale)]; applied = true; }
  if (typeof p.highContrast === 'boolean') { device.contrast = p.highContrast ? 'high' : (device.contrast === 'high' ? 'normal' : device.contrast); applied = true; }
  const falc = typeof p.falc === 'boolean' ? p.falc : null;
  try {
    if (applied) storage?.setItem('accessibilitySettings', JSON.stringify(device));
    if (falc !== null) storage?.setItem('falc-mode', String(falc));
  } catch { /* private browsing: the event below still applies them for this page */ }
  if (applied || falc !== null) target?.dispatchEvent(new CustomEvent(ACCESSIBILITY_EVENT, { detail: { device, falc } }));
  return { applied: applied || falc !== null, device, falc };
}

/**
 * The settings screen (/compte/parametres) writes through the SAME device settings, so a choice made there survives a reload (it used to live in its own key that nothing
 * re-applied, and AccessibilityPanel overwrote it on the next page).
 * @param {{ fontSize?: number, highContrast?: boolean }} partial
 * @param {{ storage?: Storage, target?: EventTarget }} [env]
 */
export function applyDeviceAccessibility(partial, env = {}) {
  const storage = env.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  const target = env.target ?? (typeof window !== 'undefined' ? window : undefined);
  const device = readDevice(storage);
  if (typeof partial?.fontSize === 'number' && partial.fontSize >= 80 && partial.fontSize <= 150) device.fontSize = partial.fontSize;
  if (typeof partial?.highContrast === 'boolean') device.contrast = partial.highContrast ? 'high' : (device.contrast === 'high' ? 'normal' : device.contrast);
  try { storage?.setItem('accessibilitySettings', JSON.stringify(device)); } catch { /* private browsing */ }
  target?.dispatchEvent(new CustomEvent(ACCESSIBILITY_EVENT, { detail: { device, falc: null } }));
  return device;
}
