/**
 * G14-CHAN — the free reminder channels of an appointment (0 €): the calendar file and the OpenStreetMap directions link of the J-1 e-mail, and the
 * Web Push nudge. Pure module (no I/O).
 *
 *  - E-mail (the RECORD of the reminder): at the reduced privacy level only (a verified ordinary service), the e-mail carries a calendar file
 *    (title « Rendez-vous », start / end, LOCATION = the structure's PUBLIC address, a DESCRIPTION with no personal data: the generic service word and the
 *    directions link) and the same OpenStreetMap link in its text. At the minimal level (sensitive or unknown service, the default) nothing is added:
 *    api/_services/appointment-notices.js buildCitizenNoticeMail drops every attachment and the text is the neutral one.
 *  - Web Push (a NUDGE, never the record): the reduced level says « Rappel : rendez-vous demain à 10 h — ouvrir AccesDirectAide » (no name, no structure,
 *    no service, no place); the minimal level says only that there is new information in the person's space. The link is inside the site.
 */
import { locationOf } from './appointment-modes.js';
import { minimalPush, minimalTexts } from './notification-privacy.js';

const OSM = 'https://www.openstreetmap.org';
const finite = (/** @type {unknown} */ v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/**
 * The OpenStreetMap directions link to a structure (a public place): its coordinates when it has valid ones, else its public address as the destination
 * query; null for a video appointment or a structure without a usable address. Nothing about the person (no origin: the browser asks for it).
 * @param {{ latitude?: unknown, longitude?: unknown, adresse?: string, code_postal?: string, ville?: string } | null | undefined} structure
 * @param {{ mode?: string }} [appointment]
 * @returns {string | null}
 */
export function osmDirectionsUrl(structure, appointment = {}) {
  if (!structure || appointment?.mode === 'VIDEO') return null;
  const lat = Number(structure.latitude); const lon = Number(structure.longitude);
  if (finite(structure.latitude) && finite(structure.longitude) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
    const to = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    return `${OSM}/directions?to=${encodeURIComponent(to)}#map=17/${lat.toFixed(5)}/${lon.toFixed(5)}`;
  }
  const loc = locationOf(structure);
  return loc ? `${OSM}/search?query=${encodeURIComponent(loc.address)}` : null;
}

/** « 10 h », « 10 h 30 » (Paris time) @param {Date | string | number} d */
export function parisHourFr(d) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Paris' })
    .formatToParts(new Date(d)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return parts.minute ? `${parts.hour} h ${String(parts.minute).padStart(2, '0')}` : `${parts.hour} h`;
}

/**
 * The Web Push nudge of a J-1 appointment reminder at a privacy level. Never a name, a structure, a service or a place.
 * @param {'minimal' | 'reduced'} level @param {Date | string} startAt @param {string} [lang]
 * @returns {{ title: string, body: string, url: string, tag: string }}
 */
export function appointmentReminderPush(level, startAt, lang = 'fr') {
  if (level !== 'reduced') return { ...minimalPush(lang), tag: 'account-notice' };
  return { title: 'Rappel AccesDirectAide', body: `Rappel : rendez-vous demain à ${parisHourFr(startAt)} — ouvrir AccesDirectAide`, url: '/compte/rendez-vous', tag: 'rdv-reminder' };
}

/**
 * TG — the Telegram text of a J-1 appointment reminder at a privacy level (same rule as the push nudge). Reduced (a verified ordinary service): the hour
 * only — « Rappel AccesDirectAide : vous avez un rendez-vous demain à 10 h. Détails : https://…/compte/rendez-vous ». Minimal (sensitive or unknown
 * service, the default): only that there is new information, in the person's language, with the link to the account. Never a name, a structure, a
 * service, a place, a health / disability / family detail or a document.
 * @param {'minimal' | 'reduced'} level @param {Date | string} startAt @param {string} [lang] @param {{ rdv?: string | null, account?: string | null }} [urls]
 * @returns {string}
 */
export function appointmentReminderTelegram(level, startAt, lang = 'fr', urls = {}) {
  const link = (/** @type {string} */ text, /** @type {string | null | undefined} */ url) => (url ? `${text} Détails : ${url}` : text);
  if (level !== 'reduced') return link(minimalTexts(lang).sms, urls.account);
  return link(`Rappel AccesDirectAide : vous avez un rendez-vous demain à ${parisHourFr(startAt)}.`, urls.rdv);
}

/**
 * The calendar input (api/_utils/ics.js buildAppointmentIcs) of a J-1 reminder: title « Rendez-vous », the structure's public address, the directions link
 * in the description and nothing personal (no name, no booking message, no management link). Used only at the reduced level (see the header).
 * @param {{ id: string, startAt: Date | string, endAt?: Date | string | null, mode?: string, rescheduleCount?: number, structure?: any }} rdv
 */
export function reminderCalendar(rdv) {
  const start = new Date(rdv.startAt);
  const end = rdv.endAt ? new Date(rdv.endAt) : new Date(start.getTime() + 30 * 60000);
  const loc = rdv.mode === 'VIDEO' ? 'À distance (visio) - accès sécurisé depuis Mes rendez-vous' : (locationOf(rdv.structure)?.address || '');
  return {
    appointmentId: rdv.id, startAt: start, endAt: end, structureName: rdv.structure?.nom || 'Accès Direct Aide', summary: 'Rendez-vous', serviceName: 'Rendez-vous',
    sequence: Number(rdv.rescheduleCount || 0), location: loc, directionsUrl: osmDirectionsUrl(rdv.structure, rdv) || undefined,
  };
}
