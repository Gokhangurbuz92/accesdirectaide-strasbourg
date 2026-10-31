// @ts-nocheck
/**
 * R29 — automatic, evidence-based publication of news drafts (owner decision of 31/10/2026: an official news item is published when it passes every
 * check below; nothing is attributed to a person and no human review is claimed).
 *
 * A draft is published only when ALL of these hold:
 *   1. reuse      — the publisher's legal notice allows reuse of its texts (checked by hand, dated, with the address of the notice: REUSE_BY_HOST);
 *   2. audience   — the item is written for private individuals (Service-Public « Particuliers »), not for companies;
 *   3. date       — published at most NEWS_MAX_AGE_DAYS ago and not in the future;
 *   4. own words  — the summary is the publisher's own text from its feed: no model-written summary or key points are stored on the item;
 *   5. duplicate  — no other item with the same title is already published or chosen in this run;
 *   6. live page  — the original page answers 200 on the publisher's own site, shows the same title, the same publication day (one day of margin for
 *                   time zones) and contains the summary word for word.
 * Any failed check keeps the item as a draft, with the reasons written on it (« commentaire_statut »); the next run checks it again.
 */
import { officialGet } from './verification/fetcher.js';
import { parseOfficialPage, decode, frenchDate } from './verification/pages.js';

export const NEWS_RULES_VERSION = 1;
export const NEWS_MAX_AGE_DAYS = 90;
export const PUBLISHER = 'verification-automatique';

/** Reuse terms read on each publisher's legal notice (31/10/2026). Only « open » publishers can be republished. */
export const REUSE_BY_HOST = {
  'www.service-public.gouv.fr': { status: 'open', publisher: 'Service-Public.fr (DILA)', licence: 'Licence Ouverte 2.0 (etalab-2.0)', evidenceUrl: 'https://www.service-public.gouv.fr/P10025', checkedAt: '2026-10-31' },
  'entreprendre.service-public.gouv.fr': { status: 'open', publisher: 'Service-Public.fr Entreprendre (DILA)', licence: 'Licence Ouverte 2.0 (etalab-2.0)', evidenceUrl: 'https://www.service-public.gouv.fr/P10025', checkedAt: '2026-10-31' },
  'www.grandest.fr': { status: 'authorisation-required', publisher: 'Région Grand Est', evidenceUrl: 'https://www.grandest.fr/mentions-legales/', checkedAt: '2026-10-31' },
  'www.grand-est.ars.sante.fr': { status: 'authorisation-required', publisher: 'ARS Grand Est', evidenceUrl: 'https://www.grand-est.ars.sante.fr/mentions-legales-9', checkedAt: '2026-10-31' },
};

/** who the item is written for, from its address */
export function audienceOf(url) {
  let u; try { u = new URL(url); } catch { return 'unknown'; }
  if (u.hostname === 'www.service-public.gouv.fr' && u.pathname.startsWith('/particuliers/')) return 'particuliers';
  if (u.hostname === 'entreprendre.service-public.gouv.fr' || u.pathname.startsWith('/professionnels')) return 'professionnels';
  return 'unknown';
}

export const sameText = (s) => decode(String(s || '')).normalize('NFC').replace(/[’‘`]/g, "'").replace(/[«»“”"]/g, '"').replace(/[\u00a0\u202f\s]+/g, ' ').trim().toLowerCase();
/** the item's address without tracking parameters (« ?xtor=RSS-111 ») */
export function cleanUrl(url) {
  try { const u = new URL(url); for (const k of [...u.searchParams.keys()]) if (/^(xtor|utm_)/i.test(k)) u.searchParams.delete(k); return u.toString(); } catch { return url; }
}
const parisDay = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });   // « 2026-10-30 »
const dayGap = (a, b) => Math.abs((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

/**
 * The checks that need no network (1–5). @param {any} item @param {{ now: Date, takenTitles: Set<string> }} ctx
 * @returns {{ reasons: string[], reuse: any }}
 */
export function offlineChecks(item, ctx) {
  const reasons = [];
  const url = item.canonical_url || item.url || '';
  let host = ''; try { host = new URL(url).hostname; } catch { /* reported below */ }
  const reuse = REUSE_BY_HOST[host] || null;
  if (!/^https:\/\//i.test(url)) reasons.push('adresse d’origine absente ou non sécurisée');
  if (!reuse) reasons.push(`éditeur inconnu (${host || 'aucune adresse'}) : conditions de réutilisation non vérifiées`);
  else if (reuse.status !== 'open') reasons.push(`réutilisation non autorisée sans accord écrit de ${reuse.publisher} (mentions légales vérifiées le ${reuse.checkedAt.split('-').reverse().join('/')})`);
  const audience = audienceOf(url);
  if (audience === 'professionnels') reasons.push('actualité destinée aux entreprises (Service-Public Entreprendre)');
  else if (audience !== 'particuliers') reasons.push('public visé non établi (seules les actualités « Particuliers » de Service-Public sont publiées)');
  const at = item.date_publication ? new Date(item.date_publication) : null;
  if (!at || Number.isNaN(at.getTime())) reasons.push('date de publication absente');
  else {
    const age = (ctx.now.getTime() - at.getTime()) / 86400000;
    if (age > NEWS_MAX_AGE_DAYS) reasons.push(`actualité de plus de ${NEWS_MAX_AGE_DAYS} jours`);
    if (age < -1) reasons.push('date de publication dans le futur');
  }
  if (!String(item.resume || '').trim()) reasons.push('aucun résumé de l’éditeur');
  if (item.summary_falc || (item.key_points_falc || []).length) reasons.push('un texte non rédigé par l’éditeur est attaché à l’actualité');
  if (ctx.takenTitles.has(sameText(item.titre))) reasons.push('doublon d’une actualité déjà publiée');
  return { reasons, reuse };
}

/**
 * Check 6: the original page. @param {any} item @param {{ fetchImpl?: typeof fetch, env?: any }} [opts]
 * @returns {Promise<{ reasons: string[], page?: { url: string, title: string | null, day: string | null } }>}
 */
export async function pageChecks(item, opts = {}) {
  const url = cleanUrl(item.canonical_url || item.url);
  let r;
  try { r = await officialGet(url, opts); } catch (err) { return { reasons: [`page d’origine non consultée (${String(err?.message || err).slice(0, 80)})`] }; }
  if (r.status !== 200) return { reasons: [`page d’origine indisponible (HTTP ${r.status})`] };
  let finalHost = ''; try { finalHost = new URL(r.url || url).hostname; } catch { /* */ }
  const reasons = [];
  if (finalHost !== new URL(url).hostname) reasons.push(`la page d’origine redirige vers un autre site (${finalHost})`);
  const page = parseOfficialPage(r.text, r.url || url);
  const raw = decode(String(r.text || ''));
  // the page's own date line: « Publié le 02 octobre 2025 - Mise à jour le 28 octobre 2026 » (an updated item is dated by the feed on its update)
  const DATE = '([0-9]{1,2}(?:er)?\\s+[a-zéû]+\\s+[0-9]{4})';
  const line = raw.match(new RegExp(`Publi[ée]e? le\\s*${DATE}(?:\\s*-\\s*Mise à jour le\\s*${DATE})?`, 'i')) || [];
  const day = frenchDate(line[1]); const updated = frenchDate(line[2]);
  if (sameText(page.title) !== sameText(item.titre)) reasons.push('le titre de la page d’origine est différent');
  if (!day) reasons.push('date de publication absente de la page d’origine');
  else if (![day, updated].filter(Boolean).some((d) => dayGap(d, parisDay(item.date_publication)) <= 1)) reasons.push(`la page d’origine est datée du ${(updated || day).split('-').reverse().join('/')}`);
  // word for word, spacing aside (« 1<sup>er</sup> » is « 1 er » once the tags are removed)
  const squashed = (s) => sameText(s).replace(/\s+/g, '');
  const body = squashed(raw.replace(/<[^>]+>/g, ' '));
  const summary = squashed(item.resume).replace(/(\[…\]|…|\.\.\.)$/, '');
  if (!body.includes(summary.slice(0, 160))) reasons.push('le résumé ne figure pas mot pour mot sur la page d’origine');
  return { reasons, page: { url: r.url || url, title: page.title, day, updated } };
}

const frDay = (d) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

/** the note written on a published item: what was checked, when, and under which licence (French, shown to the editorial team) */
export function publicationNote(item, reuse, now) {
  return `Publiée automatiquement le ${frDay(now)} après vérification automatique (règles v${NEWS_RULES_VERSION}) : source officielle ${reuse.publisher}, `
    + `page d’origine consultée (même titre, datée du ${frDay(item.date_publication)}), résumé repris mot pour mot de l’éditeur, sans doublon ; `
    + `réutilisation : ${reuse.licence} (${reuse.evidenceUrl}). Aucune relecture humaine.`;
}
/** the note written on an item kept as a draft */
export const draftNote = (reasons, now) => `Non publiée — vérification automatique du ${frDay(now)} : ${reasons.join(' ; ')}.`;

/**
 * Check every draft and publish those that pass. The database is passed in so the rule can be tested without one.
 * @param {{ db: any, schema: any, ops: any, now?: Date, apply?: boolean, fetchImpl?: typeof fetch, env?: any, log?: (s: string) => void }} deps
 */
export async function verifyNewsDrafts({ db, schema, ops, now = new Date(), apply = true, fetchImpl, env, log = () => {} }) {
  const { Actualite } = schema; const { eq } = ops;
  const published = await db.select({ titre: Actualite.titre }).from(Actualite).where(eq(Actualite.statut, 'publie'));
  const takenTitles = new Set(published.map((p) => sameText(p.titre)));
  const drafts = await db.select().from(Actualite).where(eq(Actualite.statut, 'brouillon'));
  // the « Particuliers » address first, then the most recent: a duplicate keeps the citizens' version
  drafts.sort((a, b) => (audienceOf(b.canonical_url) === 'particuliers') - (audienceOf(a.canonical_url) === 'particuliers') || new Date(b.date_publication) - new Date(a.date_publication));
  const result = { checked: 0, published: 0, kept: 0, reasons: {} };
  for (const item of drafts) {
    result.checked += 1;
    const off = offlineChecks(item, { now, takenTitles });
    const online = off.reasons.length ? { reasons: [] } : await pageChecks(item, { fetchImpl, env });
    const reasons = [...off.reasons, ...online.reasons];
    for (const r of reasons) { const k = r.replace(/\(.*?\)|du \d.*$|\d+/g, '').trim(); result.reasons[k] = (result.reasons[k] || 0) + 1; }
    if (!reasons.length) {
      takenTitles.add(sameText(item.titre));
      result.published += 1;
      log(`PUBLISH ${item.id} « ${item.titre} »`);
      if (apply) await db.update(Actualite).set({ statut: 'publie', published_at: now, auto_publish: true, updatedBy: PUBLISHER, commentaire_statut: publicationNote(item, off.reuse, now) }).where(eq(Actualite.id, item.id));
    } else {
      result.kept += 1;
      log(`KEEP ${item.id} « ${item.titre} » — ${reasons.join(' ; ')}`);
      if (apply) await db.update(Actualite).set({ commentaire_statut: draftNote(reasons, now) }).where(eq(Actualite.id, item.id));
    }
  }
  return result;
}
