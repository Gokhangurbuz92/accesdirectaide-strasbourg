/**
 * R40 / R41-K F5 — one CSV cell: always quoted, and a value a spreadsheet would read as a formula (= + - @, or a leading tab / carriage return) is
 * prefixed with « ' ». Shared by the server exports (api/_utils/admin-personal-data.js) and the browser exports (pro audit log).
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** @param {unknown[]} values @returns {string} one CSV line, every cell through csvCell */
export function csvLine(values) {
  return values.map(csvCell).join(',');
}
