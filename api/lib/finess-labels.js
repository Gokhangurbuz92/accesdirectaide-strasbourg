/**
 * R37: a FINESS activity label often states what it does NOT cover (« prestations sur le lieu de vie (non compris placement familial) »: 89 of the 160
 * labels in production). Those words must not match: « placement » and « familial » brought home-care services for a child placement or a family
 * allowance. The clause is removed before matching (PostgreSQL regular expression).
 */
export const EXCLUSION_CLAUSE = '\\(non compris[^)]*\\)';
export const withoutExclusions = (/** @type {string} */ x) => String(x).replace(/\(non compris[^)]*\)/gi, '');
