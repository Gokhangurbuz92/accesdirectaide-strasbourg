#!/usr/bin/env node
/**
 * R28 — human publication control for news drafts. Nothing is published without a named reviewer, and the decision is written on the item.
 *
 *   DATABASE_URL=… node scripts/review-actualites.mjs list
 *   DATABASE_URL=… node scripts/review-actualites.mjs publish <id> [<id>…] --reviewer "Prénom Nom"
 *   DATABASE_URL=… node scripts/review-actualites.mjs reject  <id> [<id>…] --reviewer "Prénom Nom" [--note "raison"]
 */
const [cmd, ...rest] = process.argv.slice(2);
const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
const ids = rest.filter((x, i) => !x.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
const reviewer = String(opt('--reviewer') || '').trim();

/** the decision written on an item (French, shown to the editorial team) @param {'publie'|'rejected'} statut @param {string} who @param {Date} at @param {string | null} note */
export function decisionNote(statut, who, at, note = null) {
  const day = at.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  return `${statut === 'publie' ? 'Publiée' : 'Refusée'} par ${who} le ${day} après relecture humaine${note ? ` : ${note}` : ''}.`;
}

async function main() {
  const { db } = await import('../src/db/index.js');
  const { Actualite } = await import('../src/db/schema.js');
  const { eq, and, inArray, desc } = await import('drizzle-orm');
  if (cmd === 'list') {
    const rows = await db.select({ id: Actualite.id, titre: Actualite.titre, source: Actualite.source_name, date: Actualite.date_publication, url: Actualite.canonical_url })
      .from(Actualite).where(eq(Actualite.statut, 'brouillon')).orderBy(desc(Actualite.date_publication)).limit(100);
    for (const r of rows) console.log(`${r.id}  ${r.date ? new Date(r.date).toISOString().slice(0, 10) : '—'}  [${r.source}]  ${r.titre}\n    ${r.url}`);
    console.log(`${rows.length} brouillon(s)`);
  } else if (cmd === 'publish' || cmd === 'reject') {
    if (reviewer.length < 3) { console.error('a named reviewer is required: --reviewer "Prénom Nom"'); process.exit(2); }
    if (!ids.length) { console.error('no item id given'); process.exit(2); }
    const now = new Date(); const statut = cmd === 'publish' ? 'publie' : 'rejected';
    const done = await db.update(Actualite).set({ statut, published_at: statut === 'publie' ? now : null, auto_publish: false, commentaire_statut: decisionNote(statut, reviewer, now, opt('--note')) })
      .where(and(inArray(Actualite.id, ids), eq(Actualite.statut, 'brouillon'))).returning({ id: Actualite.id });
    console.log(`REVIEW ${JSON.stringify({ decision: statut, reviewer, changed: done.length, asked: ids.length })}`);
  } else {
    console.error('usage: list | publish <id…> --reviewer "…" | reject <id…> --reviewer "…" [--note "…"]'); process.exit(2);
  }
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e?.message || e).slice(0, 200)); process.exit(1); });
