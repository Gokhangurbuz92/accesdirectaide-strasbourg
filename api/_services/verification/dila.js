// @ts-nocheck
/**
 * Automatic verification chain — the Service-Public open-data feed of the DILA (Direction de l'information légale et administrative, Premier ministre):
 * « Fiches pratiques et ressources de Service-Public.gouv.fr Particuliers » (data.gouv.fr dataset 53699fe5a3a729239d206232, Licence Ouverte), one archive rebuilt
 * every day (DILA_ARCHIVE_URL, about 25 MB).
 *
 * What the chain takes from it, as published by the administration itself:
 *  - existence: a fiche missing from the archive was withdrawn, unless redirections.xml sends its number to another fiche (moved or merged);
 *  - change: dateDerniereModificationImportante, the DILA's own date of the last IMPORTANT change (conditions, amounts, procedure), and our fingerprint of the text
 *    (any change at all);
 *  - substance: the introduction, the chapters with their situations and cases, the online services (téléservices, simulateurs, formulaires), where to go
 *    (PivotLocal: the kind of local office — caf, msa, mairie… — the codes of the Annuaire de l'administration), the acronyms and glossary definitions the fiche
 *    uses, its legal references (Légifrance).
 */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import * as cheerio from 'cheerio';
import { officialGet } from './fetcher.js';
import { sha256, keyFacts } from './pages.js';

export const DILA_ARCHIVE_URL = 'https://lecomarquage.service-public.gouv.fr/vdd/3.5/part/zip/vosdroits-latest.zip';
export const DILA_DATASET_URL = 'https://www.data.gouv.fr/fr/datasets/53699fe5a3a729239d206232/';

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const attr = (re, s) => { const m = String(s).match(re); return m ? m[1] : null; };

/**
 * The fiches (F….xml) and the redirections of an archive. The XML stays as text: a fiche is parsed only when the chain needs it.
 * @param {Uint8Array} bytes @returns {{ fiches: Map<string, string>, redirections: Map<string, string>, builtAt: string | null }}
 */
export function loadArchive(bytes) {
  const files = unzipSync(bytes, { filter: (f) => /^[FN]\d+\.xml$/.test(f.name) || f.name === 'redirections.xml' });
  const fiches = new Map(); let redirXml = '';
  for (const [name, u8] of Object.entries(files)) {
    if (name === 'redirections.xml') redirXml = strFromU8(u8);
    else fiches.set(name.replace(/\.xml$/, ''), strFromU8(u8));   // F… fiches and N… dossiers (a dossier groups the fiches of one right, e.g. N19775 RSA)
  }
  const redirections = new Map();
  for (const m of redirXml.matchAll(/<Redirection\s+from="([A-Z]\d+)"\s+to="([A-Z]\d+)"/g)) redirections.set(m[1], m[2]);
  return { fiches, redirections, builtAt: attr(/<dc:date[^>]*>([^<]+)<\/dc:date>/, redirXml.slice(0, 800)) };
}

/**
 * The official source the chain works from for one publication number: a fiche as it is; a dossier (N…) as its introduction followed by its main fiche (the
 * first one listed) and the titles of the other situations it groups; its date of last important change is the latest of its fiches.
 * @param {string} id @param {{ fiches: Map<string, string> }} archive
 */
export function readSource(id, archive) {
  const xml = archive.fiches.get(id); if (!xml) return null;
  if (!/^N/.test(id)) return parseFiche(xml);
  const d = parseFiche(xml);
  const children = [...new Set([...String(xml).matchAll(/<Fiche ID="(F\d+)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}|${squash(m[2])}`))].map((x) => { const [cid, ct] = x.split('|'); return { id: cid, title: ct }; })
    .filter((c) => archive.fiches.has(c.id));
  const parsed = children.map((c) => ({ ...c, src: parseFiche(archive.fiches.get(c.id)) })).filter((c) => !/Question-réponse/i.test(c.src.kind || ''));
  const main = parsed[0];
  const text = [d.text, main ? `## Situation principale : ${main.title || main.src.title}\n${main.src.text}` : '', parsed.length > 1 ? `Autres situations traitées par ce dossier : ${parsed.slice(1).map((c) => c.title || c.src.title).join(' ; ')}.` : '']
    .filter(Boolean).join('\n\n');
  const dates = parsed.map((c) => c.src.importantChangeAt).filter(Boolean).sort();
  const merge = (k) => Object.assign({}, ...parsed.map((c) => c.src[k] || {}), d[k] || {});
  return { ...d, text, chars: text.length, fingerprint: sha256(text.toLowerCase().replace(/\s+/g, ' ')), facts: keyFacts(text), importantChangeAt: dates[dates.length - 1] || d.importantChangeAt || d.modifiedAt,
    online: [...d.online, ...(main ? main.src.online : [])], whereToGo: [...d.whereToGo, ...(main ? main.src.whereToGo : [])], abbreviations: merge('abbreviations'), definitions: merge('definitions'),
    references: main ? main.src.references : d.references, children: parsed.map((c) => ({ id: c.id, title: c.title || c.src.title, importantChangeAt: c.src.importantChangeAt })) };
}

/**
 * Download and open the archive of the day. With opts.cacheDir (the LAB: its storage directory) the last archive is kept on disk (about 25 MB) and asked for again
 * only if it changed (If-Modified-Since: the DILA answers 304 when it did not) — a second run the same day downloads nothing.
 * @param {Parameters<typeof officialGet>[1] & { cacheDir?: string }} [opts]
 */
export async function fetchArchive(opts = {}) {
  const cache = opts.cacheDir ? { zip: path.join(opts.cacheDir, 'vosdroits-latest.zip'), meta: path.join(opts.cacheDir, 'vosdroits-latest.json') } : null;
  let meta = null;
  if (cache) { try { meta = JSON.parse(fs.readFileSync(cache.meta, 'utf8')); if (!fs.existsSync(cache.zip)) meta = null; } catch { meta = null; } }
  const t0 = Date.now();
  const r = await officialGet(DILA_ARCHIVE_URL, { ...opts, binary: true, maxBytes: 60 * 1024 * 1024, timeoutMs: opts.timeoutMs || 180000, accept: 'application/zip',
    headers: meta?.lastModified ? { 'If-Modified-Since': meta.lastModified } : undefined });
  if (r.status === 304 && cache && meta) {
    const bytes = new Uint8Array(fs.readFileSync(cache.zip));
    if (sha256(Buffer.from(bytes)) === meta.sha256) return { ok: true, cached: true, ms: Date.now() - t0, fetchedAt: r.fetchedAt, lastModified: meta.lastModified, sha256: meta.sha256, ...loadArchive(bytes) };
  }
  if (r.status !== 200) return { ok: false, status: r.status, ms: Date.now() - t0, fetchedAt: r.fetchedAt };
  const digest = sha256(Buffer.from(r.bytes));
  if (cache) {
    try {
      fs.mkdirSync(opts.cacheDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(cache.zip + '.tmp', r.bytes); fs.renameSync(cache.zip + '.tmp', cache.zip);
      fs.writeFileSync(cache.meta, JSON.stringify({ lastModified: r.lastModified, sha256: digest, fetchedAt: r.fetchedAt }));
    } catch { /* no cache this time: the next run downloads again */ }
  }
  return { ok: true, cached: false, ms: Date.now() - t0, fetchedAt: r.fetchedAt, lastModified: r.lastModified, sha256: digest, ...loadArchive(r.bytes) };
}

/** Follow the redirections of a fiche number (a fiche moved or merged into another). @param {string} id @param {Map<string, string>} redirections */
export function resolveId(id, redirections) {
  let cur = String(id || ''); const seen = new Set();
  while (redirections.has(cur) && !seen.has(cur) && seen.size < 6) { seen.add(cur); cur = redirections.get(cur); }
  return cur;
}

/** The light description of a fiche (no full parse): number, kind, title, short description, theme, date of the last important change, address, path. @param {string} xml */
export function ficheMeta(xml) {
  const head = String(xml || '').slice(0, 8000);
  const crumbs = [...head.matchAll(/<Niveau ID="([A-Za-z0-9]+)"[^>]*>([^<]*)<\/Niveau>/g)].map((m) => ({ id: m[1], title: squash(m[2]) }));
  return {
    id: attr(/<Publication[^>]* ID="([A-Z]\d+)"/, head),
    kind: attr(/<Publication[^>]* type="([^"]+)"/, head),
    title: squash(cheerio.load(`<t>${attr(/<dc:title>([\s\S]*?)<\/dc:title>/, head) || ''}</t>`, { xml: true })('t').text()),
    description: squash(cheerio.load(`<t>${attr(/<dc:description>([\s\S]*?)<\/dc:description>/, head) || ''}</t>`, { xml: true })('t').text()),
    subject: attr(/<dc:subject>([^<]*)<\/dc:subject>/, head),
    importantChangeAt: (attr(/dateDerniereModificationImportante="([0-9-]{10})/, head) || null),
    modifiedAt: (attr(/<dc:date>modified ([0-9-]{10})/, head) || null),
    url: attr(/spUrl="([^"]+)"/, head),
    audience: attr(/<Audience>([^<]+)<\/Audience>/, head),
    coverage: attr(/<dc:coverage>([^<]*)<\/dc:coverage>/, head),
    path: crumbs,
  };
}

const NOTE_LABEL = { ASavoir: 'À savoir', Attention: 'Attention', Rappel: 'Rappel', ANoter: 'À noter' };
/** blocks that are collected apart (or are navigation / quiz machinery), never part of the text */
const APART = new Set(['Titre', 'TitreRiche', 'Condition', 'Source', 'PivotLocal', 'RessourceWeb', 'Reference', 'PourEnSavoirPlus', 'QuestionReponse', 'Abreviation', 'Definition',
  'VoirAussi', 'NoticeLiee', 'Connexion', 'FranceConnect', 'Infographie', 'Questionnaire', 'Credits', 'CommentFaireSi', 'QuiPeutMAider', 'Choix', 'IntituleSiSelectionne',
  'SiSelectionne', 'Colonne', 'FilDAriane', 'Theme', 'SousThemePere', 'DossierPere', 'SurTitre', 'Audience', 'Canal', 'Fiche', 'ServiceEnLigneAnnexe', 'Legende']);

/**
 * Full reading of a fiche: the text the chain works from (headings marked with #, lists with -, tables as rows), the facts it contains, its fingerprint, and the
 * structured parts (online services, where to go, acronyms, definitions, legal references).
 * @param {string} xml
 */
export function parseFiche(xml) {
  const meta = ficheMeta(xml);
  const $ = cheerio.load(String(xml || ''), { xml: true });
  const kids = (el) => $(el).children().toArray();
  const text = (el) => squash($(el).text());
  const titleOf = (el) => { const t = kids(el).find((c) => c.name === 'Titre'); return t ? text(t) : ''; };
  const lines = [];
  const push = (s) => { const t = squash(s); if (t) lines.push(t); };
  const item = (el) => kids(el).map((c) => (c.name === 'Liste' ? kids(c).map((i) => item(i)).filter(Boolean).join(' ; ') : APART.has(c.name) ? '' : text(c))).filter(Boolean).join(' ');
  const walk = (el) => {
    for (const c of kids(el)) {
      const n = c.name;
      if (n === 'Paragraphe') push(text(c));
      else if (n === 'Liste') for (const i of kids(c)) { const t = item(i); if (t) lines.push(`- ${squash(t)}`); }
      else if (n === 'Tableau') {
        const caption = kids(c).find((x) => x.name === 'TitreRiche' || x.name === 'Titre');
        if (caption) push(`Tableau : ${text(caption)}`);
        for (const row of kids(c).filter((x) => x.name === 'Rangée' || x.name === 'Rangee')) push(kids(row).filter((x) => x.name === 'Cellule').map((x) => text(x)).join(' | '));
      } else if (n === 'Chapitre') { lines.push(''); push(`### ${titleOf(c)}`); walk(c); }
      else if (n === 'SousChapitre') { push(`#### ${titleOf(c)}`); walk(c); }
      else if (n === 'Situation') { lines.push(''); push(`## Situation : ${titleOf(c)}`); walk(c); }
      else if (n === 'Cas') { push(`#### Cas : ${titleOf(c)}`); walk(c); }
      else if (NOTE_LABEL[n]) push(`${NOTE_LABEL[n]} : ${kids(c).filter((x) => x.name !== 'Titre').map((x) => text(x)).join(' ')}`);
      else if (n === 'TitreFlottant') push(`**${text(c)}**`);
      else if (n === 'ServiceEnLigne') push(`→ Service en ligne : ${titleOf(c)}`);
      else if (n === 'OuSAdresser') push(`→ Où s'adresser : ${titleOf(c)}`);
      else if (!APART.has(n)) walk(c);
    }
  };
  const root = $('Publication').first();
  const intro = root.children('Introduction').first();
  if (intro.length) walk(intro.get(0));
  for (const c of kids(root.get(0) || {})) if (['Texte', 'ListeSituations'].includes(c.name)) walk(c);
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const online = []; const seenOnline = new Set();
  $('ServiceEnLigne').each((_, e) => {
    const url = $(e).attr('URL'); if (!url || seenOnline.has(url)) return; seenOnline.add(url);
    online.push({ id: $(e).attr('ID') || null, title: titleOf(e), url, type: $(e).attr('type') || null, source: squash($(e).children('Source').first().text()) || null });
  });
  const whereToGo = []; const seenWhere = new Set();
  $('OuSAdresser').each((_, e) => {
    const pivot = squash($(e).children('PivotLocal').first().text()) || null; const title = titleOf(e); const key = `${pivot}|${title}`;
    if (seenWhere.has(key)) return; seenWhere.add(key);
    whereToGo.push({ title, pivot, url: $(e).children('RessourceWeb').first().attr('URL') || null, kind: $(e).attr('type') || null });
  });
  const abbreviations = {};
  $('Abreviation').each((_, e) => { const k = titleOf(e); const v = squash($(e).children('Texte').first().text()); if (k && v && !abbreviations[k]) abbreviations[k] = v; });
  const definitions = {};
  $('Definition').each((_, e) => { const k = titleOf(e); const v = squash($(e).children('Texte').first().text()); if (k && v && !definitions[k]) definitions[k] = v.slice(0, 400); });
  const references = [];
  $('Reference').each((_, e) => { const url = $(e).attr('URL'); if (url) references.push({ title: titleOf(e), url, note: squash($(e).children('Complement').first().text()) || null }); });

  return { ...meta, text: body, chars: body.length, fingerprint: sha256(body.toLowerCase().replace(/\s+/g, ' ')), facts: keyFacts(body), online, whereToGo, abbreviations, definitions, references };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'et', 'en', 'pour', 'par', 'sur', 'un', 'une', 'ou', 'quelles', 'quels', 'comment', 'qu', 'est', 'ce', 'que']);
export const titleTokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
/** the acronym written in parentheses in a title: « Allocation de logement sociale (ALS) » → ALS @param {string} s */
export const titleAcronym = (s) => { const m = String(s || '').match(/\(([A-Z][A-Za-z0-9'’]{1,9})\)/); return m ? m[1].toUpperCase() : null; };

/**
 * The fiche that is the official page of a record, found by its title. Only a clear match is returned: the same acronym or most of the words, and no other
 * fiche nearly as close (ambiguous → null: the record keeps no automatic source rather than a wrong one).
 * @param {Iterable<{ id: string, title: string, kind?: string }>} metas @param {string} title
 */
export function matchFiche(metas, title) {
  const want = titleTokens(title); const acr = titleAcronym(title);
  if (!want.length) return null;
  const scored = [];
  for (const m of metas) {
    if (!m?.title || /Question-réponse|Recherche guidée/i.test(m.kind || '')) continue;
    const have = titleTokens(m.title); if (!have.length) continue;
    const hs = new Set(have); const common = want.filter((w) => hs.has(w)).length;
    let score = common / Math.max(want.length, have.length);
    const macr = titleAcronym(m.title);
    if (acr && macr && acr === macr) score += 0.5; else if (acr && macr && acr !== macr) score -= 0.3;
    if (score > 0) scored.push({ id: m.id, title: m.title, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < 0.75) return null;
  if (second && second.score > best.score - 0.2) return null;
  return best;
}
