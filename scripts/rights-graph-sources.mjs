#!/usr/bin/env node
/**
 * FA-D6 (18/11/2026) — the source snapshot of the Rights Graph (api/lib/rightsGraph.js): for every DILA fiche the graph cites (orientation constants, D11
 * register, graph relations), its presence in the DILA Service-Public archive, a redirection, its title and its two dates (dateDerniereModificationImportante,
 * modification date) and the SHA-256 of its text; and, for every sentence the graph quotes (relations, dated parts, source conflicts, territories), whether
 * it is in the fiche today. Read-only; the archive is the public daily « vosdroits-latest.zip » (Licence Ouverte 2.0), downloaded beforehand.
 * Fails closed (exit 1, nothing written) when a cited fiche is missing or a quoted sentence is not found — unless --report-only.
 *   node scripts/rights-graph-sources.mjs <vosdroits.zip> --last-modified "<HTTP Last-Modified>" [--read-at YYYY-MM-DD] [--out data/rules/rights-graph-sources.v1.json] [--report-only]
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadArchive, parseFiche, resolveId, ficheMeta } from '../api/_services/verification/dila.js';
import { NEED_DEFINITIONS, CAUTION_DEFINITIONS } from '../api/lib/multi-need.js';
import { AIDS, INTERACTIONS, TERRITORIES } from '../api/lib/rightsGraph.js';
import { isMainModule } from './lib/is-main.mjs';

const squash = (s) => String(s || '').normalize('NFC').replace(/[  ]/g, ' ').replace(/[’]/g, "'").replace(/\s+/g, ' ').toLowerCase();
const ids = (t) => [...String(t || '').matchAll(/\b([FN]\d{2,6})\b/g)].map((m) => m[1]);

/** every fiche the graph cites and every sentence it quotes @param {any} register */
export function citedByGraph(register) {
  const fiches = new Set();
  /** @type {{ where: string, fiche: string, quote: string }[]} */
  const quotes = [];
  for (const n of NEED_DEFINITIONS) {
    n.sheets.forEach((s) => fiches.add(s));
    n.actions.forEach((a) => ids(a).forEach((s) => fiches.add(s)));
    (n.rules || []).forEach((r) => fiches.add(r.sheet));
  }
  for (const c of CAUTION_DEFINITIONS) c.sheets.forEach((s) => fiches.add(s));
  for (const r of register.rights) {
    r.sources.forEach((s) => { const m = String(s.url).match(/\/vosdroits\/([FN]\d+)$/); if (m) fiches.add(m[1]); });
    for (const c of r.conditions) {
      if (/^[FN]\d+$/.test(c.source)) fiches.add(c.source);
      for (const [j, p] of (c.datedParts || []).entries()) { fiches.add(p.source); quotes.push({ where: `register ${r.id}.${c.fact}.datedParts[${j}]`, fiche: p.source, quote: p.quote }); }
    }
    for (const k of r.conflicts || []) for (const s of k.sources) { fiches.add(s.id); quotes.push({ where: `register ${r.id}.conflicts[${k.fact}]`, fiche: s.id, quote: s.quote }); }
  }
  for (const [id, a] of Object.entries(AIDS)) { fiches.add(a.sheet); if (a.quote) quotes.push({ where: `AIDS.${id}`, fiche: a.sheet, quote: a.quote }); }
  for (const x of INTERACTIONS) { fiches.add(x.source); x.quotes.forEach((q) => quotes.push({ where: `INTERACTIONS.${x.id}`, fiche: x.source, quote: q })); }
  for (const [id, t] of Object.entries(TERRITORIES)) if (t.source) { fiches.add(t.source); quotes.push({ where: `TERRITORIES.${id}`, fiche: t.source, quote: t.quote }); }
  return { fiches: [...fiches].sort(), quotes };
}

/** @param {{ fiches: Map<string, string>, redirections: Map<string, string> }} archive @param {any} register */
export function snapshot(archive, register) {
  const { fiches, quotes } = citedByGraph(register);
  const texts = new Map();
  const rows = fiches.map((id) => {
    const to = resolveId(id, archive.redirections);
    const xml = archive.fiches.get(to);
    if (!xml) return { id, present: false, redirectedTo: to !== id ? to : null, title: null, importantChangeAt: null, modifiedAt: null, textSha256: null };
    const text = parseFiche(xml).text;
    texts.set(id, squash(text));
    const m = ficheMeta(xml);
    return { id, present: true, redirectedTo: to !== id ? to : null, title: m.title, importantChangeAt: m.importantChangeAt ?? null, modifiedAt: m.modifiedAt ?? null,
      textSha256: crypto.createHash('sha256').update(text).digest('hex') };
  });
  const checked = quotes.map((q) => ({ ...q, found: Boolean(texts.get(q.fiche)?.includes(squash(q.quote))) }));
  return { fiches: rows, quotes: checked };
}

if (isMainModule(import.meta.url)) {
  const zip = process.argv[2];
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  if (!zip || !fs.existsSync(zip)) { process.stderr.write('usage: node scripts/rights-graph-sources.mjs <vosdroits.zip> --last-modified "<date>" [--read-at YYYY-MM-DD] [--out file] [--report-only]\n'); process.exit(2); }
  const bytes = fs.readFileSync(zip);
  const archive = loadArchive(new Uint8Array(bytes));
  if (!archive.fiches.size) { process.stderr.write('empty archive: nothing written (fail closed)\n'); process.exit(1); }
  const register = JSON.parse(fs.readFileSync('data/rules/rights-rules.v1.json', 'utf8'));
  const snap = snapshot(archive, register);
  const out = {
    schema: 'ADA_RIGHTS_GRAPH_SOURCES_V1',
    statement: 'Fiches DILA (Service-Public) citées par le graphe des droits (api/lib/rightsGraph.js), relues dans l\'archive officielle ; phrases citées par le graphe, retrouvées ou non. Ce n\'est pas une lecture juridique.',
    archive: { url: 'https://lecomarquage.service-public.gouv.fr/vdd/3.5/part/zip/vosdroits-latest.zip', lastModified: arg('--last-modified') || null,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), fiches: archive.fiches.size, readAt: arg('--read-at') || new Date().toISOString().slice(0, 10),
      licence: 'Licence Ouverte / Open Licence 2.0', attribution: 'Direction de l’information légale et administrative (DILA) — Service-Public' },
    ...snap,
  };
  const missing = snap.fiches.filter((f) => !f.present);
  const notFound = snap.quotes.filter((q) => !q.found);
  process.stdout.write(`RIGHTS_GRAPH_SOURCES ${JSON.stringify({ fiches: snap.fiches.length, missing: missing.map((f) => f.id), redirected: snap.fiches.filter((f) => f.redirectedTo).map((f) => f.id), quotes: snap.quotes.length, notFound: notFound.map((q) => `${q.where}:${q.fiche}`) })}\n`);
  if ((missing.length || notFound.length) && !process.argv.includes('--report-only')) { process.stderr.write('fiche missing or quote not found: nothing written (fail closed)\n'); process.exit(1); }
  if (arg('--out')) fs.writeFileSync(String(arg('--out')), `${JSON.stringify(out, null, 1)}\n`);
}
