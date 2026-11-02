#!/usr/bin/env node
/**
 * R28 — « Bonnes pratiques » guides built from official Service-Public practical sheets (DILA open-data archive, Licence Ouverte 2.0).
 *
 * A guide reproduces the official sheet WITHOUT any change: its title, DILA's own short description and its chapters, in order. Nothing is written by a
 * model, so nothing generated is published. Each guide keeps its provenance (sheet id, address, DILA's date of last important change, the archive date
 * and the date of this check) and is republished, updated or withdrawn when the sheet changes or disappears from the archive.
 *
 *   node scripts/official-guides.mjs <archive.zip> [--only r33|r36 --insert-only]                → dry run (with DATABASE_URL: the exact diff, read-only)
 *   DATABASE_URL=… node scripts/official-guides.mjs <archive.zip> --only r33 --insert-only --expect-published <n> --evidence f.json --apply
 * Since R34 --apply is bounded only: the unbounded R28 run (update and withdraw every curated guide) is no longer reachable from the command line.
 */
import crypto from 'node:crypto';
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
  // R33 — sheets for subdomains of the social reference that had nothing published (data/reference/social-coverage.v1.json)
  { id: 'F10424', categorie: 'protection juridique', publics: ['majeurs vulnérables', 'familles'], contexte: ['tutelle', 'curatelle'] },
  { id: 'F2094', categorie: 'protection juridique', publics: ['majeurs vulnérables', 'familles'], contexte: ['curatelle'] },
  { id: 'F2120', categorie: 'protection juridique', publics: ['majeurs vulnérables', 'familles'], contexte: ['tutelle'] },
  { id: 'F2075', categorie: 'protection juridique', publics: ['majeurs vulnérables', 'familles'], contexte: ['sauvegarde de justice'] },
  { id: 'F33367', categorie: 'protection juridique', publics: ['majeurs vulnérables', 'familles'], contexte: ['habilitation familiale'] },
  { id: 'F16670', categorie: 'protection juridique', publics: ['tous publics'], contexte: ['mandat de protection future'] },
  { id: 'F12544', categorie: 'violences', publics: ['victimes'], contexte: ['violences conjugales', 'urgence'] },
  { id: 'F20789', categorie: 'violences', publics: ['victimes'], contexte: ['victimes', 'justice'] },
  { id: 'F1043', categorie: 'violences', publics: ['victimes'], contexte: ['harcèlement'] },
  { id: 'F2354', categorie: 'violences', publics: ['victimes', 'salariés'], contexte: ['harcèlement'] },
  { id: 'F952', categorie: 'protection de l’enfance', publics: ['enfants', 'familles'], contexte: ['maltraitance', 'urgence'] },
  { id: 'F861', categorie: 'autonomie', publics: ['personnes âgées', 'aidants'], contexte: ['maltraitance', 'urgence'] },
  { id: 'F32010', categorie: 'santé', publics: ['tous publics'], contexte: ['fin de vie'] },
  { id: 'F39676', categorie: 'santé', publics: ['personnes malades', 'aidants'], contexte: ['fin de vie', 'soins palliatifs'] },
  { id: 'F706', categorie: 'santé', publics: ['aidants'], contexte: ['fin de vie', 'aidants'] },
  { id: 'F707', categorie: 'santé', publics: ['tous publics'], contexte: ['santé sexuelle'] },
  { id: 'F1551', categorie: 'santé', publics: ['femmes'], contexte: ['santé sexuelle'] },
  { id: 'F34917', categorie: 'santé', publics: ['tous publics'], contexte: ['santé mentale'] },
  { id: 'F2018', categorie: 'logement', publics: ['jeunes'], contexte: ['logement'] },
  { id: 'F37501', categorie: 'logement', publics: ['personnes âgées', 'personnes handicapées'], contexte: ['logement', 'autonomie'] },
  { id: 'F38243', categorie: 'famille', publics: ['parents'], contexte: ['garde d’enfants'] },
  { id: 'F31037', categorie: 'étrangers', publics: ['jeunes', 'mineurs isolés'], contexte: ['titre de séjour'] },
  { id: 'F17048', categorie: 'étrangers', publics: ['étrangers'], contexte: ['intégration', 'français'] },
  { id: 'F2284', categorie: 'emploi', publics: ['demandeurs d’emploi'], contexte: ['insertion'] },
  { id: 'F34049', categorie: 'handicap', publics: ['personnes handicapées', 'personnes âgées'], contexte: ['mobilité'] },
  // R36 — sheets for the service gaps of the social reference (manifest evidence/r36/guides; owner-authorised publication only: --only r36)
  { id: 'F2003', categorie: 'logement', publics: ['personnes sans domicile'], contexte: ['hébergement', 'urgence'] },
  { id: 'F33954', categorie: 'santé', publics: ['tous publics'], contexte: ['urgence', 'écoute', 'suicide'] },
  { id: 'F38589', categorie: 'budget', publics: ['tous publics'], contexte: ['factures', 'énergie', 'budget'] },
  { id: 'F34736', categorie: 'logement', publics: ['locataires'], contexte: ['trêve hivernale', 'énergie', 'expulsion'] },
  { id: 'F1334', categorie: 'logement', publics: ['locataires', 'tous publics'], contexte: ['FSL', 'énergie', 'loyer'] },
  { id: 'F18005', categorie: 'logement', publics: ['tous publics'], contexte: ['dalo', 'logement social', 'recours'] },
  { id: 'F20343', categorie: 'logement', publics: ['personnes sans domicile'], contexte: ['daho', 'hébergement', 'recours'] },
  { id: 'F16158', categorie: 'logement', publics: ['locataires', 'propriétaires occupants'], contexte: ['logement insalubre', 'habitat indigne'] },
  { id: 'F763', categorie: 'autonomie', publics: ['personnes âgées', 'aidants'], contexte: ['ehpad', 'hébergement'] },
  { id: 'F255', categorie: 'autonomie', publics: ['personnes âgées', 'aidants'], contexte: ['ehpad', 'résidence autonomie', 'hébergement'] },
  { id: 'F2444', categorie: 'autonomie', publics: ['personnes âgées', 'aidants'], contexte: ['ASH', 'hébergement', 'aide sociale'] },
  { id: 'F245', categorie: 'autonomie', publics: ['personnes âgées', 'aidants'], contexte: ['aide à domicile', 'aide ménagère'] },
  { id: 'F246', categorie: 'autonomie', publics: ['personnes âgées', 'personnes handicapées'], contexte: ['soins à domicile', 'SSIAD'] },
  { id: 'F32057', categorie: 'autonomie', publics: ['personnes âgées'], contexte: ['précarité', 'aides'] },
  { id: 'F740', categorie: 'santé', publics: ['personnes concernées', 'familles'], contexte: ['addictions', 'drogues', 'CSAPA'] },
  { id: 'F15814', categorie: 'santé', publics: ['personnes concernées', 'familles'], contexte: ['addictions', 'jeux d’argent'] },
  { id: 'F959', categorie: 'protection de l’enfance', publics: ['parents', 'familles'], contexte: ['ASE', 'placement', 'accueil provisoire'] },
  { id: 'F3140', categorie: 'protection de l’enfance', publics: ['parents', 'enfants'], contexte: ['ASE', 'placement', 'juge des enfants'] },
  { id: 'F970', categorie: 'protection de l’enfance', publics: ['parents', 'familles'], contexte: ['AED', 'prévention'] },
  { id: 'F39128', categorie: 'protection de l’enfance', publics: ['parents', 'enfants'], contexte: ['AEMO', 'assistance éducative'] },
  { id: 'F937', categorie: 'protection de l’enfance', publics: ['parents', 'jeunes majeurs'], contexte: ['parrainage', 'soutien', 'jeunes majeurs'] },
  { id: 'F815', categorie: 'famille', publics: ['parents isolés'], contexte: ['ASF', 'pension alimentaire', 'séparation'] },
  { id: 'F38245', categorie: 'famille', publics: ['parents isolés'], contexte: ['famille monoparentale', 'aides'] },
  { id: 'F1336', categorie: 'protection juridique', publics: ['majeurs vulnérables'], contexte: ['MASP', 'MAJ', 'budget'] },
  { id: 'F3165', categorie: 'protection juridique', publics: ['majeurs vulnérables', 'familles'], contexte: ['mandataire judiciaire', 'coût', 'tutelle'] },
  { id: 'F3079', categorie: 'santé', publics: ['étrangers'], contexte: ['AME', 'soins'] },
  { id: 'F299', categorie: 'étrangers', publics: ['étrangers'], contexte: ['protection temporaire', 'asile', 'réfugié'] },
  { id: 'F2313', categorie: 'violences', publics: ['victimes'], contexte: ['indemnisation', 'CIVI', 'FGTI'] },
  { id: 'F32584', categorie: 'justice', publics: ['personnes sortant de détention', 'familles'], contexte: ['sortie de prison', 'SPIP'] },
  { id: 'F358', categorie: 'budget', publics: ['tous publics'], contexte: ['impôt', 'déclaration de revenus'] },
  { id: 'F35456', categorie: 'discrimination', publics: ['personnes LGBTQI+'], contexte: ['homophobie', 'discrimination'] },
  { id: 'F34826', categorie: 'papiers', publics: ['personnes trans'], contexte: ['état civil', 'mention du sexe'] },
  { id: 'F16507', categorie: 'démarches', publics: ['familles'], contexte: ['décès', 'démarches'] },
  // R37: the sheets the multi-need orientation cites for its rules and cautions (api/lib/multi-need.js), not yet published
  { id: 'F20055', categorie: 'budget', publics: ['tous publics'], contexte: ['électricité', 'gaz', 'coupure', 'impayés', 'factures'] },
  { id: 'F12006', categorie: 'logement', publics: ['locataires'], contexte: ['APL', 'aide au logement', 'loyer'] },
  { id: 'F1280', categorie: 'logement', publics: ['locataires'], contexte: ['ALS', 'aide au logement', 'loyer'] },
  { id: 'F19778', categorie: 'budget', publics: ['tous publics'], contexte: ['RSA', 'revenu minimum'] },
  { id: 'F16920', categorie: 'autonomie', publics: ['aidants'], contexte: ['proche aidant', 'aidants', 'congé'] },
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

/** the R33 additions, the only sheets the owner authorised for the bounded production publication of R34 (owner directive R34 §2.2) */
export const R33_ADDITIONS = ['F10424', 'F2094', 'F2120', 'F2075', 'F33367', 'F16670', 'F12544', 'F20789', 'F1043', 'F2354', 'F952', 'F861', 'F32010',
  'F39676', 'F706', 'F707', 'F1551', 'F34917', 'F2018', 'F37501', 'F38243', 'F31037', 'F17048', 'F2284', 'F34049'];

/** R36: the second batch (33 sheets; F33667 « Chèque énergie » left out: it still describes the 2025 campaign) — published only by the owner's bounded run */
export const R36_ADDITIONS = ['F2003', 'F33954', 'F38589', 'F34736', 'F1334', 'F18005', 'F20343', 'F16158', 'F763', 'F255', 'F2444', 'F245', 'F246', 'F32057', 'F740', 'F15814', 'F959', 'F3140', 'F970', 'F39128', 'F937', 'F815', 'F38245', 'F1336', 'F3165', 'F3079', 'F299', 'F2313', 'F32584', 'F358', 'F35456', 'F34826', 'F16507'];

/** R37: the third batch — the official sheets the orientation's rules and cautions cite (published only by the owner's bounded run) */
export const R37_ADDITIONS = ['F20055', 'F12006', 'F1280', 'F19778', 'F16920'];

const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
/** the guide row of one sheet id: its slug ends with « -<id> » (never a longer number such as -f1706 for F706) */
export const rowOf = (rows, id) => rows.find((r) => String(r.slug).endsWith(`-${id.toLowerCase()}`));

/**
 * The exact write plan, pure (no database). Unbounded (no allowlist): every curated sheet, and a sheet gone from the archive is withdrawn, as in R28.
 * Bounded (allowlist): only the listed sheets; a listed sheet that is missing, redirected or empty is WITHHELD (never a withdrawal); with insertOnly, an
 * existing row is never touched (« skip_existing ») — so nothing outside the inserts can change.
 * @param {{ e: { id: string }, g: any }[]} built @param {any[]} rows existing Guide rows @param {{ allow?: string[] | null, insertOnly?: boolean, redirections?: Map<string,string> }} opts
 */
export function planGuides(built, rows, { allow = null, insertOnly = false, redirections = new Map() } = {}) {
  const ids = new Set(allow || []);
  const plan = { insert: [], update: [], unchanged: [], skip_existing: [], withdraw: [], withheld: [], refused: [] };
  if (allow) for (const id of ids) if (!built.some((b) => b.e.id === id)) plan.refused.push({ id, reason: 'NOT_IN_CURATED_LIST' });
  for (const { e, g } of built) {
    if (allow && !ids.has(e.id)) continue;
    const row = rowOf(rows, e.id);
    if (!g) {
      const reason = redirections.has(e.id) ? `REDIRECTED_TO_${redirections.get(e.id)}` : 'NOT_IN_ARCHIVE_OR_EMPTY';
      if (allow) plan.withheld.push({ id: e.id, reason });
      else if (row && row.statut === 'publie') plan.withdraw.push({ id: e.id, rowId: row.id, slug: row.slug });
      continue;
    }
    const item = { id: e.id, slug: g.slug, titre: g.titre, chapitres: g.contenu_json.steps.length, contentSha: sha(g.contenu_json.steps) };
    if (!row) { if (rows.some((r) => r.slug === g.slug)) plan.refused.push({ ...item, reason: 'SLUG_TAKEN_BY_OTHER_ROW' }); else plan.insert.push(item); continue; }
    const same = JSON.stringify(row.contenu_json?.steps || null) === JSON.stringify(g.contenu_json.steps) && row.titre === g.titre && row.statut === 'publie';
    if (insertOnly) plan.skip_existing.push({ ...item, rowId: row.id, statut: row.statut, sameContent: same });
    else (same ? plan.unchanged : plan.update).push({ ...item, rowId: row.id });
  }
  return plan;
}

const argOf = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };

/**
 * Bounded mode (R34): --only <ids|r33> --insert-only --expect-published <n> [--evidence <file.json>].
 * One transaction: the inserts, then the postconditions (published count = before + inserts; every other row byte-identical) — any difference rolls back.
 * Exit codes: 0 done (or dry run), 2 usage, 3 plan refused (unrelated or forbidden change), 4 target identity mismatch, 1 error.
 */
async function main() {
  const [zip] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && /^--(only|expect-published|evidence)$/.test(all[i - 1])));
  const apply = process.argv.includes('--apply');
  const onlyArg = argOf('only');
  const allow = onlyArg ? [...new Set(onlyArg.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).flatMap((x) => (x === 'R33' ? R33_ADDITIONS : x === 'R36' ? R36_ADDITIONS : x === 'R37' ? R37_ADDITIONS : [x])))] : null;
  const insertOnly = process.argv.includes('--insert-only');
  const expectPublished = argOf('expect-published');
  const evidenceFile = argOf('evidence');
  if (!zip) { console.error('usage: node scripts/official-guides.mjs <vosdroits archive.zip> [--only <F…,F…|r33> --insert-only --expect-published <n>] [--evidence f.json] [--apply]'); process.exit(2); }
  if (apply && (!allow || !insertOnly || expectPublished == null)) {
    console.error('OFFICIAL_GUIDES refused: --apply needs --only, --insert-only and --expect-published (the unbounded R28 mode can update and withdraw guides)'); process.exit(2);
  }
  const archive = loadArchive(new Uint8Array(fs.readFileSync(zip)));
  const now = new Date();
  const built = OFFICIAL_GUIDES.map((e) => ({ e, g: guideFromSheet(e, archive, now) }));
  for (const { e, g } of built) if (!allow || allow.includes(e.id)) console.log(g ? `GUIDE ${e.id} « ${g.titre} » ${g.contenu_json.steps.length} chapitres` : `MISSING ${e.id}: not in the archive`);
  const archiveInfo = { builtAt: archive.builtAt, sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), fiches: archive.fiches.size };
  if (!process.env.DATABASE_URL) {
    const plan = planGuides(built, [], { allow, insertOnly, redirections: archive.redirections });
    console.log(`OFFICIAL_GUIDES dry run without database ${JSON.stringify({ insert: plan.insert.length, withheld: plan.withheld, refused: plan.refused })}`); return;
  }
  const { db } = await import('../src/db/index.js');
  const { Guide } = await import('../src/db/schema.js');
  const { sql } = await import('drizzle-orm');
  const ident = (await db.execute(sql`select current_database() as db, version() as v`)).rows[0];
  const rows = await db.select().from(Guide);
  const published = rows.filter((r) => r.statut === 'publie').length;
  const plan = planGuides(built, rows, { allow, insertOnly, redirections: archive.redirections });
  const fingerprint = (rs) => Object.fromEntries(rs.map((r) => [r.id, sha([r.slug, r.titre, r.statut, r.contenu_json, r.categorie, r.publics, r.contexte, r.mots_cles, r.sources_urls, r.published_at, r.updatedAt])]));
  const before = fingerprint(rows);
  const evidence = { at: now.toISOString(), apply, target: { database: ident.db, server: String(ident.v).split(' ').slice(0, 2).join(' '), rowsBefore: rows.length, publishedBefore: published },
    archive: archiveInfo, allow, insertOnly, plan: { insert: plan.insert, skip_existing: plan.skip_existing, withheld: plan.withheld, refused: plan.refused,
      update: plan.update.length, withdraw: plan.withdraw.length } };
  const out = (extra) => { Object.assign(evidence, extra); if (evidenceFile) fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2)); console.log(`OFFICIAL_GUIDES ${JSON.stringify({ ...evidence.target, insert: plan.insert.map((x) => x.id), skip_existing: plan.skip_existing.map((x) => x.id), withheld: plan.withheld, refused: plan.refused, ...extra })}`); };
  if (allow && (plan.update.length || plan.withdraw.length || plan.refused.length)) { out({ result: 'PLAN_REFUSED' }); process.exit(3); }
  if (expectPublished != null && Number(expectPublished) !== published) { out({ result: 'IDENTITY_MISMATCH', expectedPublished: Number(expectPublished) }); process.exit(4); }
  if (!apply) { out({ result: 'DRY_RUN' }); process.exit(0); }
  const toInsert = built.filter((b) => plan.insert.some((x) => x.id === b.e.id));
  await db.transaction(async (tx) => {
    for (const { g } of toInsert) await tx.insert(Guide).values({ ...g, statut: 'publie', published_at: now });
    const after = await tx.select().from(Guide);
    const fp = fingerprint(after);
    const changed = Object.keys(before).filter((id) => fp[id] !== before[id]);
    const added = after.filter((r) => !before[r.id]);
    const okAdded = added.length === toInsert.length && added.every((r) => toInsert.some((b) => b.g.slug === r.slug));
    const pubAfter = after.filter((r) => r.statut === 'publie').length;
    if (changed.length || !okAdded || pubAfter !== published + toInsert.length) throw new Error(`POSTCONDITION_FAILED changed=${changed.length} added=${added.length} published=${pubAfter}`);
    evidence.post = { rowsAfter: after.length, publishedAfter: pubAfter, unrelatedChanged: 0, inserted: added.map((r) => ({ slug: r.slug, id: r.id })) };
  });
  out({ result: 'APPLIED' });
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(`OFFICIAL_GUIDES {"ok":false,"error":${JSON.stringify(String(err?.message || err).slice(0, 200))}}`); process.exit(1); });
