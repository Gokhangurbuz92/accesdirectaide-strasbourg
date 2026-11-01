// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../src/db/index.js';
import { Actualite, Aide, Demarche, Dispositif, Guide } from '../../src/db/schema.js';
import { and, eq } from 'drizzle-orm';
import logger from '../_utils/logger.js';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { decide, stripReviewFields, visibleWhere } from '../lib/publicVisibility.js';
import { KINDS, publicView } from '../lib/contentTranslation.js';
import { TARGET_LANGUAGES } from '../../src/i18n/languages.js';

/**
 * R32 — public, read-only translations of the verified content (allowed in the public beta, like the content it translates).
 *   GET /api/translations/<kind>/<slug>?lang=en   one record: the translated fields that may be shown, the status of every field
 *   GET /api/translations/<kind>?lang=en          every published record of the kind: title and summary fields only (lists, cards)
 * The French record is read again here, with the same D-5 rule as the content routes: a record that is not visible has no translation either
 * (same 404). Its fingerprint is compared with the one the translation was made from — a French text changed since is « outdated » and nothing
 * of the translation is returned. Only fields that passed the automatic checks (or a recorded human review) are returned; see
 * api/lib/contentTranslation.js. The translation files (data/translations) are produced on the publisher's machine with a local engine.
 */
// the content tables read here (named so the D-5 read-path ratchet sees them)
const TABLES = { aide: { table: Aide }, demarche: { table: Demarche }, guide: { table: Guide }, actualite: { table: Actualite }, dispositif: { table: Dispositif } };
const SUMMARY = { aide: ['titre', 'description', 'cest_quoi'], demarche: ['titre', 'description_courte'], guide: ['titre'], actualite: ['titre', 'resume'], dispositif: ['titre', 'summary_falc'] };
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;
const files = new Map();

function translationFile(kind, slug) {
  const key = `${kind}/${slug}`;
  if (!files.has(key)) {
    let v = null;
    try { v = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'translations', kind, `${slug}.json`), 'utf8')); } catch { v = null; }
    files.set(key, v);
  }
  return files.get(key);
}

/** a record as the public API returns it (the fingerprint is computed on that view), or null when it is not publicly visible */
function publicRecord(kind, row) {
  if (!row) return null;
  if (kind === 'guide' || kind === 'actualite') return row.statut === 'publie' ? stripReviewFields(row, false) : null;
  return decide(row, kind).visible ? stripReviewFields(row, false) : null;
}

async function visibleRows(kind) {
  const t = TABLES[kind].table;
  if (kind === 'guide' || kind === 'actualite') return db.select().from(t).where(eq(t.statut, 'publie'));
  return db.select().from(t).where(and(visibleWhere(t, kind)));
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'Method not allowed' }); }
    const limit = await checkRateLimit('TRANSLATION_READ', getClientIp(req));
    if (limit && limit.allowed === false) return res.status(429).json(limit.error || { error: 'Too many requests' });
    const parts = String(req.url || '').split('?')[0].replace(/^\/?(api\/)?translations\/?/, '').split('/').filter(Boolean);
    const [kind, slug] = parts;
    const lang = String(req.query?.lang || new URL(req.url, 'http://x').searchParams.get('lang') || '');
    if (!KINDS.includes(kind) || !TARGET_LANGUAGES.includes(lang) || parts.length > 2 || (slug !== undefined && !SLUG.test(slug))) {
      return res.status(400).json({ error: 'Invalid parameters', details: { kinds: KINDS, languages: TARGET_LANGUAGES } });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Language', lang);
    if (slug) {
      const t = TABLES[kind].table;
      const [row] = await db.select().from(t).where(eq(t.slug, slug)).limit(1);
      const record = publicRecord(kind, row);
      if (!record) return res.status(404).json({ error: 'Not found' });
      const file = translationFile(kind, slug);
      const view = publicView(file, lang, kind, record);
      return res.status(200).json({ ...view, slug, source: { lang: 'fr', verifiedAt: file?.source?.verifiedAt || record.date_verification || null, sourceUrl: record.source_url_exact || record.source_url || file?.source?.sourceUrl || null, licence: file?.source?.licence || null } });
    }
    const items = {};
    for (const row of await visibleRows(kind)) {
      const record = publicRecord(kind, row);
      if (!record?.slug) continue;
      const view = publicView(translationFile(kind, record.slug), lang, kind, record);
      if (view.status === 'unavailable') continue;
      items[record.slug] = { status: view.status, fields: Object.fromEntries(SUMMARY[kind].filter((f) => f in view.fields).map((f) => [f, view.fields[f]])) };
    }
    return res.status(200).json({ kind, lang, items });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Translations] failed');
    return res.status(500).json({ error: 'TRANSLATIONS_FAILED' });
  }
}
