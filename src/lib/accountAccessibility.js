/**
 * Display preferences (text size, contrast, reduced motion, FALC, read-aloud settings) — ON THIS DEVICE ONLY.
 *
 * Owner decision P2b, 08/11/2026 (D2 V2, option B): these neutral display preferences are kept only in this browser's local storage. They are never sent to
 * the server, never stored in the citizen profile, and therefore do not follow the person to another device or browser. Signing in or out does not change
 * them. Nothing here infers or records health or disability: the values are display choices only, used for nothing else.
 * (Before: K0 / C04 saved them in CitizenProfile.accessibilityPrefs and re-applied them at login — removed.)
 *
 * The site applies them everywhere: AccessibilityPanel (text size, contrast, line height, simplified mode, reduced motion on <html>/<body>), FalcProvider
 * (FALC), useReadAloud (speed, voice, highlighting). A change made from any screen is written here and announced with ACCESSIBILITY_EVENT so the mounted
 * components follow at once; a reload reads the same storage.
 * Keys (listed on the « Cookies et stockage » page): accessibilitySettings, falc-mode, ada_reader_prefs (and the legacy ada_citizen_prefs, read once).
 */
export const ACCESSIBILITY_EVENT = 'ada:accessibility-settings';
export const TEXT_SCALE_PERCENT = Object.freeze({ normal: 100, large: 115, xlarge: 130 });
export const DEVICE_KEYS = Object.freeze({ settings: 'accessibilitySettings', falc: 'falc-mode', reader: 'ada_reader_prefs', legacy: 'ada_citizen_prefs' });

/** @typedef {{ fontSize: number, contrast: string, lineHeight: string, simplifiedMode: boolean, reduceMotion: boolean }} DeviceDisplay */
/** @type {Readonly<DeviceDisplay>} */
const DEFAULT_DEVICE = Object.freeze({ fontSize: 100, contrast: 'normal', lineHeight: 'normal', simplifiedMode: false, reduceMotion: false });

/** @param {{ storage?: Storage, target?: EventTarget }} [env] */
function envOf(env = {}) {
  return {
    storage: env.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined),
    target: env.target ?? (typeof window !== 'undefined' ? window : undefined),
  };
}

/** @param {Storage | undefined} storage @returns {DeviceDisplay} */
function readDevice(storage) {
  /** @type {Record<string, any>} */
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(DEVICE_KEYS.settings) || 'null') || {}; } catch { saved = {}; }
  const device = { ...DEFAULT_DEVICE, ...saved };
  if (typeof saved.reduceMotion !== 'boolean') {   // the settings screen used to keep « reduce motion » in its own key
    try { device.reduceMotion = JSON.parse(storage?.getItem(DEVICE_KEYS.legacy) || '{}').reduceMotion === true; } catch { device.reduceMotion = false; }
  }
  return device;
}

/** @param {Storage | undefined} storage */
function readFalc(storage) {
  try { return storage?.getItem(DEVICE_KEYS.falc) === 'true'; } catch { return false; }
}

/**
 * What this device currently uses.
 * @param {{ storage?: Storage }} [env]
 * @returns {{ falc: boolean, highContrast: boolean, fontSize: number, textScale: 'normal'|'large'|'xlarge'|null, reduceMotion: boolean }}
 */
export function readDisplayPreferences(env = {}) {
  const { storage } = envOf(env);
  const device = readDevice(storage);
  const scale = /** @type {any} */ (Object.keys(TEXT_SCALE_PERCENT).find((k) => TEXT_SCALE_PERCENT[/** @type {'normal'} */ (k)] === device.fontSize) ?? null);
  return { falc: readFalc(storage), highContrast: device.contrast === 'high', fontSize: device.fontSize, textScale: scale, reduceMotion: device.reduceMotion === true };
}

/**
 * Applies display choices on this device (local storage only) and tells the mounted components. Only the values given change; an unknown value is ignored.
 * @param {{ falc?: boolean, highContrast?: boolean, textScale?: string, fontSize?: number, reduceMotion?: boolean } | null | undefined} prefs
 * @param {{ storage?: Storage, target?: EventTarget }} [env]
 * @returns {{ applied: boolean, device: typeof DEFAULT_DEVICE, falc: boolean | null }}
 */
export function applyDisplayPreferences(prefs, env = {}) {
  const { storage, target } = envOf(env);
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  const device = readDevice(storage);
  let applied = false;
  if (Object.prototype.hasOwnProperty.call(TEXT_SCALE_PERCENT, String(p.textScale))) { device.fontSize = TEXT_SCALE_PERCENT[/** @type {'normal'|'large'|'xlarge'} */ (p.textScale)]; applied = true; }
  else if (typeof p.fontSize === 'number' && p.fontSize >= 80 && p.fontSize <= 150) { device.fontSize = p.fontSize; applied = true; }
  if (typeof p.highContrast === 'boolean') { device.contrast = p.highContrast ? 'high' : (device.contrast === 'high' ? 'normal' : device.contrast); applied = true; }
  if (typeof p.reduceMotion === 'boolean') { device.reduceMotion = p.reduceMotion; applied = true; }
  const falc = typeof p.falc === 'boolean' ? p.falc : null;
  try {
    if (applied) storage?.setItem(DEVICE_KEYS.settings, JSON.stringify(device));
    if (falc !== null) storage?.setItem(DEVICE_KEYS.falc, String(falc));
  } catch { /* private browsing: the event below still applies them for this page */ }
  if (applied || falc !== null) target?.dispatchEvent(new CustomEvent(ACCESSIBILITY_EVENT, { detail: { device, falc } }));
  return { applied: applied || falc !== null, device, falc };
}

/**
 * « Reset the display »: every display preference of this device back to the default (text size, contrast, line height, simplified mode, reduced motion,
 * FALC, read-aloud speed/voice/highlighting). Nothing on the server is involved.
 * @param {{ storage?: Storage, target?: EventTarget }} [env]
 */
export function resetDisplayPreferences(env = {}) {
  const { storage, target } = envOf(env);
  try {
    storage?.removeItem(DEVICE_KEYS.settings); storage?.removeItem(DEVICE_KEYS.falc); storage?.removeItem(DEVICE_KEYS.reader);
    const legacy = JSON.parse(storage?.getItem(DEVICE_KEYS.legacy) || 'null');
    if (legacy && typeof legacy === 'object') {
      delete legacy.reduceMotion; delete legacy.fontSize; delete legacy.highContrast;
      if (Object.keys(legacy).length) storage?.setItem(DEVICE_KEYS.legacy, JSON.stringify(legacy)); else storage?.removeItem(DEVICE_KEYS.legacy);
    }
  } catch { /* blocked storage: the event still resets this page */ }
  const device = { ...DEFAULT_DEVICE };
  target?.dispatchEvent(new CustomEvent(ACCESSIBILITY_EVENT, { detail: { device, falc: false, reset: true } }));
  return device;
}

/**
 * Kept for the settings screen (/compte/parametres): text size / contrast / reduced motion written to the same device settings.
 * @param {{ fontSize?: number, highContrast?: boolean, reduceMotion?: boolean }} partial
 * @param {{ storage?: Storage, target?: EventTarget }} [env]
 */
export function applyDeviceAccessibility(partial, env = {}) {
  return applyDisplayPreferences(partial, env).device;
}
