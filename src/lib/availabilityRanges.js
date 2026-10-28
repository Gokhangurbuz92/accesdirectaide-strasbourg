// DTA S8: client-side mirror of the server rule for opening hours (api/_handlers/pro/availability.js): HH:MM-HH:MM, 24 h, end after start, no overlap within a day.
// The server stays the authority; this only spares a round trip and says which day is wrong.
const RANGE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * @param {string[]} ranges the ranges typed for ONE day
 * @param {string} dayLabel
 * @returns {string | null} a French message, or null when every non-blank range is valid and none overlaps
 */
export function findInvalidRange(ranges, dayLabel) {
  const parsed = [];
  for (const raw of ranges) {
    const range = String(raw ?? '').trim();
    if (!range) continue;
    const m = RANGE.exec(range);
    if (!m) return `Plage invalide « ${range.slice(0, 20)} » (${dayLabel}). Utilisez HH:MM-HH:MM, par exemple 09:00-12:00.`;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    if (end <= start) return `Plage invalide « ${range} » (${dayLabel}) : la fin doit être après le début.`;
    parsed.push({ range, start, end });
  }
  parsed.sort((a, b) => a.start - b.start);
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].start < parsed[i - 1].end) return `Plages qui se chevauchent (${dayLabel}) : ${parsed[i - 1].range} et ${parsed[i].range}.`;
  }
  return null;
}
