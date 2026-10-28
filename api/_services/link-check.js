// @ts-nocheck
/**
 * PKG-11 / A05 — checking the official links of the published catalogue, within what is permitted. Before: the cron fetched EVERY source URL of every record
 * (any site), with HEAD only (many official sites refuse it: falsely « broken »), never checked structures (it looked for statut 'publie', structures are 'actif'),
 * recorded the requested URL as the final one and did nothing with a broken link.
 *   - only the D-5-visible records (what people can see) and only https addresses on the official-source allow-list are contacted; any other address is recorded
 *     as OUTSIDE_ALLOWLIST and never requested; one request per distinct address per run, at most `perHost` per host, spaced by `spacingMs`;
 *   - HEAD first; on 403 / 405 / 501 one GET of a single byte; redirects are followed by hand, at most 3, and only to allow-listed hosts;
 *   - every result is kept (SourceSnapshot: status, final address); a link found BROKEN (404 / 410) on two consecutive runs opens ONE review item for a person
 *     (SOURCE_LINK_BROKEN) — nothing is unpublished automatically;
 *   - the cron runs only when the owner enables it (LINK_CHECK_ENABLED=1): it contacts external official sites.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { visibleSql } from '../lib/publicVisibility.js';
import { isAllowedSource } from '../lib/services/official-sources.js';

const SOURCES = [
  { kind: 'aide', table: 'Aide', entity: 'Aide', cols: ['source_url', 'source_url_exact', 'lien_demande'] },
  { kind: 'demarche', table: 'Demarche', entity: 'Demarche', cols: ['source_url', 'source_url_exact', 'lien_officiel'] },
  { kind: 'dispositif', table: 'Dispositif', entity: 'Dispositif', cols: ['source_url', 'source_url_exact'], jsonLinks: 'liens' },
  { kind: 'structure', table: 'Structure', entity: 'Structure', cols: ['source_url', 'source_url_exact'] },
];
export const CLASSES = ['OK', 'REDIRECTED', 'BROKEN', 'BLOCKED', 'SERVER_ERROR', 'NETWORK_ERROR', 'OUTSIDE_ALLOWLIST'];
const httpsAllowed = (u) => { try { return new URL(u).protocol === 'https:' && isAllowedSource(u); } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The distinct addresses of the visible catalogue, each with the records that cite it. */
export async function collectLinks({ db = defaultDb, limitPerKind = 500 } = {}) {
  const byUrl = new Map();
  for (const s of SOURCES) {
    const extra = s.jsonLinks ? sql`, ${sql.raw(`"${s.jsonLinks}"`)} AS j` : sql``;
    const rows = (await db.execute(sql`SELECT id, ${sql.raw(s.cols.map((c) => `"${c}"`).join(', '))}${extra} FROM ${sql.raw(`"${s.table}"`)} WHERE ${visibleSql(s.kind)} ORDER BY id LIMIT ${limitPerKind}`)).rows;
    for (const r of rows) {
      const urls = new Set([...s.cols.map((c) => r[c]), ...(Array.isArray(r.j) ? r.j.map((l) => l?.url) : [])].map((u) => String(u || '').trim()).filter(Boolean));
      for (const url of urls) {
        if (!byUrl.has(url)) byUrl.set(url, { url, refs: [] });
        byUrl.get(url).refs.push({ entityType: s.entity, entityId: r.id });
      }
    }
  }
  return [...byUrl.values()];
}

/** One address: HEAD, then a 1-byte GET when HEAD is refused; manual redirects, allow-listed hosts only. */
export async function checkOne(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!httpsAllowed(url)) return { class: 'OUTSIDE_ALLOWLIST', status: null, finalUrl: url };
  let current = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    let res;
    try {
      res = await fetchImpl(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'AccesDirectAide-LinkCheck/2.0 (verification des sources officielles)' } });
      if ([403, 405, 501].includes(res.status)) {
        res = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Range: 'bytes=0-0', 'User-Agent': 'AccesDirectAide-LinkCheck/2.0 (verification des sources officielles)' } });
      }
    } catch { return { class: 'NETWORK_ERROR', status: 0, finalUrl: current }; }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers?.get?.('location');
      if (!next) return { class: 'BROKEN', status: res.status, finalUrl: current };
      let target; try { target = new URL(next, current).toString(); } catch { return { class: 'BROKEN', status: res.status, finalUrl: current }; }   // pass 2: a malformed Location aborted the whole run
      if (!httpsAllowed(target)) return { class: 'REDIRECTED', status: res.status, finalUrl: target, outsideAllowlist: true };   // recorded, never followed
      current = target; continue;
    }
    const cls = res.status < 300 ? (current === url ? 'OK' : 'REDIRECTED') : [404, 410].includes(res.status) ? 'BROKEN' : [401, 403, 429].includes(res.status) ? 'BLOCKED' : res.status >= 500 ? 'SERVER_ERROR' : 'BROKEN';
    return { class: cls, status: res.status, finalUrl: current };
  }
  return { class: 'BROKEN', status: 310, finalUrl: current };   // too many redirects
}

async function queueBroken(db, ref, url) {
  const last = (await db.execute(sql`SELECT http_status FROM "SourceSnapshot" WHERE entity_type = ${ref.entityType} AND entity_id = ${ref.entityId} AND raw_excerpt = ${'link:' + url}
    ORDER BY fetched_at DESC, "createdAt" DESC LIMIT 2`)).rows.map((r) => r.http_status);
  if (last.length < 2 || !last.every((s) => [404, 410].includes(s))) return false;
  const open = (await db.execute(sql`SELECT 1 FROM "ReviewQueueItem" WHERE "entityType" = ${ref.entityType.toLowerCase()} AND "entityId" = ${ref.entityId} AND reason = 'SOURCE_LINK_BROKEN' AND status = 'OPEN'
    AND details->>'url' = ${url} LIMIT 1`)).rows.length;
  if (open) return false;
  await db.execute(sql`INSERT INTO "ReviewQueueItem" (id, "entityType", "entityId", reason, severity, status, details, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${ref.entityType.toLowerCase()}, ${ref.entityId}, 'SOURCE_LINK_BROKEN', 'P2', 'OPEN', ${JSON.stringify({ url, consecutiveBroken: 2 })}::jsonb, NOW(), NOW())`);
  return true;
}

/** One run. `fetchImpl` is injectable (tests never touch the network). */
export async function runLinkCheck({ db = defaultDb, fetchImpl = fetch, perHost = 20, spacingMs = 1000, limitPerKind = 500 } = {}) {
  const links = await collectLinks({ db, limitPerKind });
  const stats = Object.fromEntries([...CLASSES.map((c) => [c, 0]), ['addresses', links.length], ['skippedHostBudget', 0], ['reviewQueued', 0]]);
  const perHostCount = new Map(); const lastHit = new Map();
  for (const link of links) {
    let host = ''; try { host = new URL(link.url).host; } catch { /* recorded as outside */ }
    let out;
    if (!httpsAllowed(link.url)) out = { class: 'OUTSIDE_ALLOWLIST', status: null, finalUrl: link.url };
    else if ((perHostCount.get(host) || 0) >= perHost) { stats.skippedHostBudget += 1; continue; }
    else {
      const wait = (lastHit.get(host) || 0) + spacingMs - Date.now(); if (wait > 0) await sleep(wait);
      perHostCount.set(host, (perHostCount.get(host) || 0) + 1); lastHit.set(host, Date.now());
      out = await checkOne(link.url, { fetchImpl });
    }
    stats[out.class] += 1;
    for (const ref of link.refs) {
      await db.execute(sql`INSERT INTO "SourceSnapshot" (id, entity_type, entity_id, fetched_at, raw_excerpt, http_status, final_url, "createdAt")
        VALUES (gen_random_uuid()::text, ${ref.entityType}, ${ref.entityId}, NOW(), ${'link:' + link.url}, ${out.status}, ${out.finalUrl}, NOW())`);
      if (out.class === 'BROKEN' && await queueBroken(db, ref, link.url)) stats.reviewQueued += 1;
    }
  }
  return stats;
}
