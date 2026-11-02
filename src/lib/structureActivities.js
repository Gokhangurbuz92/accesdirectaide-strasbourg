/**
 * R37 — the activities a FINESS establishment is AUTHORISED for (the national register's « activités autorisées »: discipline, mode of care, public) are
 * a legal authorisation, not a list of services the place offers today: no free place, appointment or admission follows from it. A FINESS record is
 * recognised by its register number or by its register source; any other record's `services` stays what the place itself declared.
 */
const FINESS_HOST = /^https:\/\/finess\.esante\.gouv\.fr\//;

/** @param {any} s */
export const isFinessRecord = (s) => Boolean(s && (s.numero_finess || FINESS_HOST.test(String(s.source_url_exact || s.source_url || ''))));
