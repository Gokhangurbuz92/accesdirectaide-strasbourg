#!/usr/bin/env node
/**
 * R28 — « Bonnes pratiques » guides built from official Service-Public practical sheets (DILA open-data archive, Licence Ouverte 2.0).
 *
 * A guide reproduces the official sheet WITHOUT any change: its title, DILA's own short description and its chapters, in order. Nothing is written by a
 * model, so nothing generated is published. Each guide keeps its provenance (sheet id, address, DILA's date of last important change, the archive date
 * and the date of this check) and is republished, updated or withdrawn when the sheet changes or disappears from the archive.
 *
 *   node scripts/official-guides.mjs <archive.zip>             → dry run: what would be created, updated or withdrawn
 *   DATABASE_URL=… node scripts/official-guides.mjs <archive.zip> --apply
 */
import fs from 'node:fs';
import { loadArchive, readSource } from '../api/_services/verification/dila.js';

/** the curated practical sheets: everyday situations of the people AccesDirectAide serves (papers, address, budget, recourse, housing) */
export const OFFICIAL_GUIDES = [
  { id: 'F19134', categorie: 'papiers', publics: ['tous publics'], contexte: ['papiers'] },
  { id: 'F31421', categorie: 'papiers', publics: ['tous publics'], contexte: ['papiers', 'urgence'] },
  { id: 'F10774', categorie: 'papiers', publics: ['tous publics'], contexte: ['papiers', 'urgence'] },
  { id: 'F17317', categorie: 'logement', publics: ['personnes sans domicile'], contexte: ['adresse', 'logement'] },
  { id: 'F31272', categorie: 'logement', publics: ['locataires'], contexte: ['logement', 'budget'] },
  { id: 'F32037', categorie: 'logement', publics: ['locataires'], contexte: ['logement', 'budget'] },
  { id: 'F134', categorie: 'budget', publics: ['tous publics'], contexte: ['budget', 'dettes'] },
  { id: 'F2417', categorie: 'budget', publics: ['tous publics'], contexte: ['budget', 'banque'] },
  { id: 'F827', categorie: 'démarches', publics: ['tous publics'], contexte: ['démarches'] },
  { id: 'F2474', categorie: 'recours', publics: ['tous publics'], contexte: ['recours'] },
  { id: 'F13158', categorie: 'recours', publics: ['tous publics'], contexte: ['recours'] },
  { id: 'F20849', categorie: 'recours', publics: ['assurés sociaux'], contexte: ['recours', 'santé'] },
];

const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

/**
 * The official sheet cut into its chapters (the reader writes « ### » before a chapter and « ## Situation : » before a situation), text unchanged.
 * @param {string} text @returns {{ titre: string | null, texte: string }[]}
 */
export function chaptersOf(text) {
  const steps = []; let cur = { titre: null, lines: [] };
  for (const raw of String(text || '').split('\n')) {
    const h = raw.match(/^#{2,3}\s+(?:Situation\s*:\s*)?(.+)$/);
    if (h) { if (cur.lines.join('').trim() || cur.titre) steps.push(cur); cur = { titre: h[1].trim(), lines: [] }; continue; }
    cur.lines.push(raw.replace(/^#{4,}\s+/, '').replace(/^\*\*(.+)\*\*$/, '$1'));
  }
  if (cur.lines.join('').trim() || cur.titre) steps.push(cur);
  return steps.map((s) => ({ titre: s.titre, texte: s.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() })).filter((s) => s.texte);
}

/**
 * The guide record of one curated sheet, or null when the sheet is not in the archive (it is then withdrawn).
 * @param {{ id: string, categorie: string, publics: string[], contexte: string[] }} entry @param {any} archive @param {Date} now
 */
export function guideFromSheet(entry, archive, now = new Date()) {
  const src = readSource(entry.id, archive);
  if (!src || !src.title || !src.text) return null;
  const steps = chaptersOf(src.text);
  if (!steps.length) return null;
  return {
    slug: `${slugify(src.title)}-${entry.id.toLowerCase()}`,
    titre: src.title,
    resume_falc: null,   // no simplified text: nothing here is written by a model
    contenu_json: {
      version: 'official-sheet-v1',
      intro: src.description || null,
      steps,
      provenance: { origin: 'DILA', ficheId: entry.id, sourceUrl: src.url, importantChangeAt: src.importantChangeAt || null, archiveBuiltAt: archive.builtAt || null,
        checkedAt: now.toISOString(), licence: 'Licence Ouverte 2.0', unchanged: true },
    },
    categorie: entry.categorie,
    publics: entry.publics,
    contexte: entry.contexte,
    mots_cles: [entry.id, ...entry.contexte],
    sources_urls: [src.url].filter(Boolean),
  };
}

async function main() {
  const [zip] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (!zip) { console.error('usage: node scripts/official-guides.mjs <vosdroits archive.zip> [--apply]'); process.exit(2); }
  const archive = loadArchive(new Uint8Array(fs.readFileSync(zip)));
  const now = new Date();
  const built = OFFICIAL_GUIDES.map((e) => ({ e, g: guideFromSheet(e, archive, now) }));
  for (const { e, g } of built) console.log(g ? `GUIDE ${e.id} « ${g.titre} » ${g.contenu_json.steps.length} chapitres` : `MISSING ${e.id}: not in the archive → withdrawn`);
  if (!apply) { console.log('dry run: nothing written (add --apply)'); return; }
  const { db } = await import('../src/db/index.js');
  const { Guide } = await import('../src/db/schema.js');
  const { eq, and, like } = await import('drizzle-orm');
  let created = 0, updated = 0, withdrawn = 0;
  for (const { e, g } of built) {
    const existing = (await db.select().from(Guide).where(like(Guide.slug, `%-${e.id.toLowerCase()}`)).limit(1))[0];
    if (!g) { if (existing && existing.statut === 'publie') { await db.update(Guide).set({ statut: 'archive' }).where(eq(Guide.id, existing.id)); withdrawn += 1; } continue; }
    if (existing) {
      const prev = existing.contenu_json?.steps ? JSON.stringify(existing.contenu_json.steps) : null;
      await db.update(Guide).set({ ...g, statut: 'publie', published_at: existing.published_at || now }).where(and(eq(Guide.id, existing.id)));
      updated += prev === JSON.stringify(g.contenu_json.steps) ? 0 : 1;
    } else {
      await db.insert(Guide).values({ ...g, statut: 'publie', published_at: now }); created += 1;
    }
  }
  console.log(`OFFICIAL_GUIDES ${JSON.stringify({ created, updated, withdrawn, total: built.filter((x) => x.g).length })}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(`OFFICIAL_GUIDES {"ok":false,"error":${JSON.stringify(String(err?.message || err).slice(0, 200))}}`); process.exit(1); });
