// @ts-check
/**
 * G14: « Ajouter à mon parcours » from a record page — OFF with the limited Mon Parcours (api/lib/parcours-limited.js refuses `records`). An object so that
 * the unit tests of the former control can switch it on for themselves; nothing in the application does.
 */
export const PARCOURS_RECORD_STEPS = { offered: false };
