// @ts-nocheck
/** RA-06 — reading the answer of GET /api/admin/link-checks?kind=link (pure functions; the classes follow api/_services/link-check.js). */
export const linkClass = (c) => {
  const s = c.http_status;
  if (s === null || s === undefined) return 'OUTSIDE';
  if (s === 0) return 'NETWORK';
  if (s === 404 || s === 410) return 'BROKEN';
  if ([401, 403, 429].includes(s)) return 'BLOCKED';
  if (s >= 500) return 'SERVER';
  if (s >= 200 && s < 300) return c.url && c.final_url && c.final_url !== c.url ? 'REDIRECTED' : 'OK';
  return 'OTHER';
};
/** one line per record and address: the newest result (the answer is newest first), and how many results the answer holds for it */
export const linkRows = (items) => {
  const rows = new Map();
  for (const i of items || []) for (const c of i.checks || []) {
    if (!c.url) continue;
    const key = `${i.entity_type}:${i.entity_id}:${c.url}`;
    if (rows.has(key)) rows.get(key).results += 1;
    else rows.set(key, { key, entityType: i.entity_type, entityId: i.entity_id, ...c, cls: linkClass(c), results: 1 });
  }
  return [...rows.values()];
};
