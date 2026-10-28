// @ts-nocheck
/**
 * PKG-3 — the two appointment modalities: IN_PERSON (at the structure's physical location) and VIDEO (remote). A modality is offered for a service only when the structure
 * offers it (StructureRdvSettings.bookingMode), the service offers it (ProRdvService.modes) and — for VIDEO — the video provider is activated (api/lib/video-provider.js).
 * Slots of a modality come only from opening periods that serve it (ProAvailabilityRule.modes). Nothing here changes a modality: callers refuse instead.
 */
export const MODES = ['IN_PERSON', 'VIDEO'];
export const MODE_LABELS = Object.freeze({ IN_PERSON: 'En présentiel', VIDEO: 'À distance (visio)' });
/** @param {unknown} mode */
export const modeLabel = (mode) => (mode === 'VIDEO' ? MODE_LABELS.VIDEO : MODE_LABELS.IN_PERSON);

export function structureModes(bookingMode) {
  if (bookingMode === 'BOTH') return ['IN_PERSON', 'VIDEO'];
  if (bookingMode === 'VIDEO') return ['VIDEO'];
  return ['IN_PERSON'];
}
export function offeredModes(bookingMode, serviceModes, video) {
  const svc = Array.isArray(serviceModes) && serviceModes.length ? serviceModes : ['IN_PERSON'];
  return structureModes(bookingMode).filter((m) => svc.includes(m) && (m !== 'VIDEO' || (video && video.available)));
}
export const rulesFor = (rules, mode) => rules.filter((r) => !Array.isArray(r.modes) || r.modes.includes(mode));
export const normalizeMode = (value) => (MODES.includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : null);

/** The physical location shown for an in-person appointment: the address only as recorded; `verified` says whether ADA verified the structure record. */
export function locationOf(structure) {
  if (!structure) return null;
  const line = [structure.adresse, [structure.code_postal, structure.ville].filter(Boolean).join(' ')].filter((x) => x && String(x).trim()).join(', ');
  if (!line) return null;
  return { address: line, verified: structure.verification_status === 'VERIFIED', stepFreeAccess: Boolean(structure.accessibilite_pmr) };
}
export function locationText(location) {
  if (!location) return 'Adresse : à confirmer auprès de la structure.';
  return `Adresse : ${location.address}${location.verified ? '' : ' (adresse non encore vérifiée par Accès Direct Aide : confirmez-la auprès de la structure)'}`
    + (location.stepFreeAccess ? '\nAccès : accessible aux personnes à mobilité réduite (selon la structure).' : '');
}
