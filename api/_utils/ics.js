/**
 * N05 (R13): a lone CR is a line break too, and RFC 5545 §3.3.11 TEXT allows no CONTROL character but HTAB — a structure name or address imported from an
 * open-data source carrying NUL / BEL / ESC / a bare CR used to reach the content line raw (a broken line for strict readers).
 * @param {string} value
 * @returns {string}
 */
function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/**
 * A bare e-mail address out of `MAILER_FROM` (« Name <a@b.fr> » or « a@b.fr »); '' when there is none.
 * @param {unknown} value
 * @returns {string}
 */
export function mailAddress(value) {
  const raw = String(value || '').trim();
  const address = (raw.match(/<([^<>]+)>\s*$/)?.[1] || raw).trim();
  return /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/.test(address) ? address : '';
}

/** A parameter value (CN) as RFC 5545 §3.2 allows it: quoted, without DQUOTE or control characters. @param {string} value */
function paramValue(value) {
  // eslint-disable-next-line no-control-regex
  return `"${String(value || '').replace(/["\u0000-\u001f\u007f]/g, '').trim()}"`;
}

/**
 * RFC 5545 §3.7.2: an iCalendar object sent in a MIME entity carries the same METHOD as its Content-Type `method` parameter, and neither without the other.
 * @param {string} ics
 * @returns {string}
 */
export function calendarContentType(ics) {
  const method = String(ics).match(/\r\nMETHOD:([A-Z-]+)\r\n/)?.[1];
  return method ? `text/calendar; method=${method}; charset=utf-8` : 'text/calendar; charset=utf-8';
}

/**
 * RFC 5545 §3.1 — a content line is at most 75 OCTETS; longer lines are folded with CRLF + one space, never inside a UTF-8 character.
 * (Before PKG-11 nothing was folded: the description carrying the management link exceeded 75 octets.)
 * @param {string} line
 * @returns {string}
 */
export function foldIcsLine(line) {
  const parts = []; let cur = ''; let size = 0; let limit = 75;
  for (const ch of String(line)) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (size + n > limit) { parts.push(cur); cur = ''; size = 0; limit = 74; }   // continuation lines start with one space (1 octet of the 75)
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatUtc(date) {
  const value = new Date(date);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hour = String(value.getUTCHours()).padStart(2, '0');
  const minute = String(value.getUTCMinutes()).padStart(2, '0');
  const second = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

/**
 * @param {{
 *  appointmentId: string,
 *  startAt: Date,
 *  endAt: Date,
 *  structureName: string,
 *  serviceName: string,
 *  manageUrl?: string,
 *  sequence?: number,
 *  location?: string,
 *  cancelled?: boolean,
 *  itip?: { organizer?: string, attendee?: string },
 * }} input
 * PKG-3 / B05 / N05: the same UID for the life of the appointment; SEQUENCE grows with each move so calendar clients UPDATE the event; a cancellation is
 * STATUS:CANCELLED so clients remove it.
 * N05 (R13, checked with ical.js 2.2.1 and RFC 5546): METHOD makes the object a scheduling message, and iTIP PUBLISH / CANCEL require an ORGANIZER (CANCEL also the
 * ATTENDEE it removes). So only an e-mail sent from a real address (`itip.organizer` = the sending address, `itip.attendee` = the recipient) carries METHOD
 * PUBLISH / CANCEL with ORGANIZER (and ATTENDEE on a cancellation); a file downloaded from the site is a plain snapshot without METHOD (RFC 5545 §3.7.2).
 */
export function buildAppointmentIcs(input) {
  const now = new Date();
  const uid = `${String(input.appointmentId || '').trim() || 'rdv'}@accesdirectaide.fr`;
  const summary = `RDV - ${String(input.structureName || 'Acces Direct Aide').trim()}`;
  const organizer = mailAddress(input.itip?.organizer);
  const attendee = mailAddress(input.itip?.attendee);
  const scheduling = Boolean(organizer) && (!input.cancelled || Boolean(attendee));
  const descriptionLines = [
    `Service: ${String(input.serviceName || 'Rendez-vous').trim()}`,
    input.manageUrl ? `Gestion du RDV: ${String(input.manageUrl).trim()}` : '',
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Acces Direct Aide//Rendez-vous//FR',
    'CALSCALE:GREGORIAN',
    ...(scheduling ? [input.cancelled ? 'METHOD:CANCEL' : 'METHOD:PUBLISH'] : []),
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(Number(input.sequence) || 0))}`,
    `DTSTAMP:${formatUtc(now)}`,
    ...(scheduling ? [`ORGANIZER;CN=${paramValue(String(input.structureName || 'Acces Direct Aide').trim())}:mailto:${organizer}`] : []),
    ...(scheduling && input.cancelled ? [`ATTENDEE:mailto:${attendee}`] : []),
    `DTSTART:${formatUtc(input.startAt)}`,
    `DTEND:${formatUtc(input.endAt)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    `DESCRIPTION:${escapeIcsText(descriptionLines.join('\n'))}`,
    input.cancelled ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/**
 * PKG-3 / B10 / N05 — one calendar with several events (the professional's agenda export). Same UID / SEQUENCE / LOCATION rules as buildAppointmentIcs; a cancelled
 * appointment is exported with STATUS:CANCELLED. Built on demand from the database (nothing stored, no subscription URL, no token in a link).
 * N05 (R13): a data export, not a scheduling message — no METHOD (iTIP PUBLISH would require an ORGANIZER, and the HTTP Content-Type carries no method).
 * @param {Array<{ appointmentId: string, startAt: Date, endAt: Date, structureName: string, serviceName: string, sequence?: number, cancelled?: boolean, location?: string }>} events
 */
export function buildCalendarIcs(events) {
  const now = formatUtc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Acces Direct Aide//Agenda//FR', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeIcsText(`${e.appointmentId}@accesdirectaide.fr`)}`, `SEQUENCE:${Math.max(0, Math.trunc(Number(e.sequence) || 0))}`, `DTSTAMP:${now}`,
      `DTSTART:${formatUtc(e.startAt)}`, `DTEND:${formatUtc(e.endAt)}`, `SUMMARY:${escapeIcsText(`RDV - ${String(e.serviceName || 'Rendez-vous').trim()}`)}`,
      ...(e.location ? [`LOCATION:${escapeIcsText(e.location)}`] : []), e.cancelled ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
