// @ts-nocheck
/**
 * G8 — computes the public indicators defined in api/lib/public-indicators.js. Every query reads the PUBLIC catalogue under the strict D-5 rule (whatever
 * ADA_PUBLIC_CONTENT_MODE says: a LAB fixture is never counted as a verified record) or the link-check results of those records. Only aggregates leave this
 * file: the structure rows read for the commune breakdown (town, postal code, two flags) are reduced to counts here and never returned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AidCategoryCode } from '../../src/db/schema.js';
import { CURRENT_DAYS, decide, maxAgeDays, stripReviewFields, visibleSql } from '../lib/publicVisibility.js';
import { communeOfAddress } from '../lib/geography/territoryScope.js';
import { publicView } from '../lib/contentTranslation.js';
import { TARGET_LANGUAGES } from '../../src/i18n/languages.js';
import { translationFile } from '../_handlers/translations.js';
import { complementColumn, primaryCell } from './territorial-stats.js';
import { K_MIN } from './org-stats.js';
import { LINK_WINDOW_DAYS, SCHEMA, assertAggregateOnly } from '../lib/public-indicators.js';

const STRICT = Object.freeze({ mode: /** @type {'strict'} */ ('strict') });
const KINDS = Object.freeze({ aide: 'Aide', demarche: 'Demarche', structure: 'Structure', dispositif: 'Dispositif' });
export const SCOPES = Object.freeze(['NATIONAL', 'REGIONAL', 'DEPARTMENTAL', 'COMMUNAL', 'UNSPECIFIED']);
const TRANSLATED_KINDS = Object.freeze(['aide', 'demarche', 'guide', 'actualite']);
const TRANSLATED_TABLES = Object.freeze({ aide: 'Aide', demarche: 'Demarche', guide: 'Guide', actualite: 'Actualite' });
const int = (v) => Number(v ?? 0) || 0;
const rowsOf = async (db, q) => (await db.execute(q)).rows;

/** visible records and their verification freshness, per kind */
async function catalogue(db) {
  /** @type {Record<string, { visible: number, current: number, updateNeeded: number }>} */
  const out = {};
  for (const [kind, table] of Object.entries(KINDS)) {
    const [r] = await rowsOf(db, sql`SELECT count(*)::int AS visible, count(*) FILTER (WHERE "date_verification" >= now() - make_interval(days => ${CURRENT_DAYS}))::int AS current
      FROM ${sql.raw(`"${table}"`)} WHERE ${visibleSql(/** @type {any} */ (kind), STRICT)}`);
    out[kind] = { visible: int(r?.visible), current: int(r?.current), updateNeeded: int(r?.visible) - int(r?.current) };
  }
  const [g] = await rowsOf(db, sql`SELECT count(*)::int AS n FROM "Guide" WHERE statut = 'publie'`);
  const [a] = await rowsOf(db, sql`SELECT count(*)::int AS n FROM "Actualite" WHERE statut = 'publie'`);
  return { kinds: out, guides: int(g?.n), actualites: int(a?.n) };
}

/**
 * R3H (live audit 24/11/2026: every published aide counted « AUTRE » and « UNSPECIFIED »): the catalogue import never writes "Aide".category_code (schema
 * default AUTRE) nor "Aide".territory_scope (null); it writes the platform category `categorie` (api/_services/verification/classify.js, the vocabulary the
 * search and the aide pages already use) and the declared territory fields. The domain is therefore the explicit category_code when one was set, else
 * this fixed table of the catalogue's own categories (no text is read, nothing is guessed); a category absent from it stays « AUTRE ».
 */
export const DOMAIN_OF_CATEGORIE = Object.freeze({
  logement: 'LOGEMENT', sante: 'SANTE', handicap: 'HANDICAP', emploi: 'EMPLOI', 'travail-formation': 'EMPLOI', famille: 'FAMILLE', etudes: 'ETUDES',
  mobilite: 'MOBILITE', transports: 'MOBILITE', energie: 'ENERGIE', alimentation: 'ALIMENTATION', justice: 'JUSTICE', numerique: 'NUMERIQUE',
});
const fold = (v) => String(v ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** @param {{ category_code?: unknown, categorie?: unknown }} r @returns {string} one of AidCategoryCode */
export function aideDomain(r) {
  const codes = AidCategoryCode.enumValues;
  const code = String(r?.category_code ?? '').trim().toUpperCase();
  if (code && code !== 'AUTRE' && codes.includes(/** @type {any} */ (code))) return code;
  const c = fold(r?.categorie);
  return DOMAIN_OF_CATEGORIE[c] || (codes.includes(/** @type {any} */ (c.toUpperCase())) ? c.toUpperCase() : 'AUTRE');
}

/** the hosts of Service-Public (DILA): the source registry's level for them is NATIONAL (api/_services/verification/sources.js, « dila-service-public ») */
const SERVICE_PUBLIC = /(^|\.)service-public\.(gouv\.)?fr$/i;
const hostOf = (u) => { try { return new URL(String(u)).hostname; } catch { return ''; } };
const nonEmpty = (a) => Array.isArray(a) && a.some((x) => String(x ?? '').trim() !== '');

/**
 * The échelon of one aide, from what its record declares, in this order: an explicit territory_scope (a value outside the four échelons stays
 * UNSPECIFIED: the record says something this indicator cannot read); else INSEE commune codes → COMMUNAL; « France entière » / « national » in its
 * territories → NATIONAL; department codes → DEPARTMENTAL; region codes → REGIONAL; else, with no territory at all, a Service-Public fiche (national
 * regulations published by the DILA) → NATIONAL. Anything else (a town name alone, another site) stays UNSPECIFIED.
 * @param {{ territory_scope?: unknown, territoires?: unknown, departements?: unknown, department_codes?: unknown, region_codes?: unknown, insee_codes?: unknown, source_url?: unknown }} r
 */
export function aideScope(r) {
  const explicit = String(r?.territory_scope ?? '').trim().toUpperCase();
  if (explicit) return SCOPES.includes(explicit) ? explicit : 'UNSPECIFIED';
  if (nonEmpty(r?.insee_codes)) return 'COMMUNAL';
  const territories = (Array.isArray(r?.territoires) ? r.territoires : []).map(fold).filter(Boolean);
  if (territories.some((t) => t === 'france' || t === 'france entiere' || /\bnational/.test(t))) return 'NATIONAL';
  if (nonEmpty(r?.department_codes) || nonEmpty(r?.departements)) return 'DEPARTMENTAL';
  if (nonEmpty(r?.region_codes)) return 'REGIONAL';
  if (!territories.length && SERVICE_PUBLIC.test(hostOf(r?.source_url))) return 'NATIONAL';
  return 'UNSPECIFIED';
}

/** the classification fields of the visible aides (public catalogue fields only; reduced to counts below, never returned) */
async function aideClassRows(db) {
  return rowsOf(db, sql`SELECT category_code::text AS category_code, categorie, territory_scope, territoires, departements, department_codes, region_codes, insee_codes, source_url
    FROM "Aide" WHERE ${visibleSql('aide', STRICT)}`);
}

/** @param {any[]} rows */
export function domainCounts(rows) {
  const by = new Map();
  for (const r of rows) { const d = aideDomain(r); by.set(d, (by.get(d) ?? 0) + 1); }
  return AidCategoryCode.enumValues.map((domain) => ({ domain, count: by.get(domain) ?? 0 }));
}

/** @param {any[]} rows */
export function scopeCounts(rows) {
  const by = Object.fromEntries(SCOPES.map((s) => [s, 0]));
  for (const r of rows) by[aideScope(r)] += 1;
  return SCOPES.map((scope) => ({ scope, count: by[scope] }));
}

/** G12: the source's OWN theme (Service-Public « Famille - Scolarité », « Logement »…), as published on the record; no inference. Cells below K_MIN are kept: a
 * theme is not a person. Themes that are empty on the record are counted as « non indiqué » (theme: null). */
/** G12.1: a source theme the aggregate-only guard would refuse must not take the whole answer down — the theme breakdown is then omitted (null). */
export function safeSourceThemes(rows) {
  try { assertAggregateOnly({ aidesBySourceTheme: rows }); return rows; } catch { return null; }
}

async function aidesBySourceTheme(db) {
  const rows = await rowsOf(db, sql`SELECT NULLIF(btrim(theme), '') AS theme, count(*)::int AS n FROM "Aide" WHERE ${visibleSql('aide', STRICT)} GROUP BY 1`);
  return rows.map((r) => ({ theme: r.theme == null ? null : String(r.theme).slice(0, 120), count: int(r.n) }))
    .sort((a, b) => (a.theme === null) - (b.theme === null) || b.count - a.count || String(a.theme).localeCompare(String(b.theme), 'fr'));
}
const aidesBySourceThemeSafe = async (db) => safeSourceThemes(await aidesBySourceTheme(db));

/**
 * Structures by commune, with the observatory's suppression: a commune cell below K_MIN is masked (primaryCell), and when exactly one cell of the column is
 * masked the smallest published one is masked too (complementColumn) — the « not located » cell belongs to the same column. @param {Array<{ ville: unknown, code_postal: unknown }>} rows
 */
export function communeTable(rows) {
  /** @type {Map<string, { commune: string, label: string, n: number }>} */
  const byCommune = new Map(); let notLocated = 0;
  for (const r of rows) {
    const c = communeOfAddress({ ville: r.ville, code_postal: r.code_postal });
    if (!c) { notLocated += 1; continue; }
    const cell = byCommune.get(c.code) || { commune: c.code, label: c.nom, n: 0 };
    cell.n += 1; byCommune.set(c.code, cell);
  }
  const cells = [...byCommune.values()].sort((a, b) => b.n - a.n || (a.commune < b.commune ? -1 : 1));
  const primary = [...cells.map((c) => primaryCell(c.n)), notLocated > 0 ? primaryCell(notLocated) : 0];
  const published = complementColumn(primary);
  const out = cells.map((c, i) => ({ commune: c.commune, label: c.label, count: published[i] }));
  return {
    cells: out.filter((c) => c.count !== null),
    maskedCommunes: out.filter((c) => c.count === null).length,
    notLocated: published[published.length - 1],
    kMin: K_MIN,
  };
}

async function structures(db) {
  const rows = await rowsOf(db, sql`SELECT ville, code_postal, accessibilite_pmr AS pmr, (NULLIF(btrim(COALESCE(horaires, '')), '') IS NOT NULL) AS hours
    FROM "Structure" WHERE ${visibleSql('structure', STRICT)}`);
  return {
    byCommune: communeTable(rows),
    information: { visible: rows.length, stepFreeAccessIndicated: rows.filter((r) => r.pmr === true).length, openingHoursIndicated: rows.filter((r) => r.hours === true).length },
  };
}

/** the last link-check result of each official address cited by a record that is visible NOW, within the window */
async function linkHealth(db) {
  const visible = sql.join(Object.entries(KINDS).map(([kind, table]) => sql`SELECT ${table}::text AS t, id FROM ${sql.raw(`"${table}"`)} WHERE ${visibleSql(/** @type {any} */ (kind), STRICT)}`), sql` UNION ALL `);
  const [r] = await rowsOf(db, sql`WITH v AS (${visible}),
    latest AS (SELECT DISTINCT ON (s.raw_excerpt) s.raw_excerpt, s.http_status, s.fetched_at FROM "SourceSnapshot" s JOIN v ON v.t = s.entity_type AND v.id = s.entity_id
      WHERE s.raw_excerpt LIKE 'link:%' AND s.http_status IS NOT NULL AND s.fetched_at >= now() - make_interval(days => ${LINK_WINDOW_DAYS})
      ORDER BY s.raw_excerpt, s.fetched_at DESC, s."createdAt" DESC)
    SELECT count(*)::int AS addresses,
      count(*) FILTER (WHERE http_status BETWEEN 200 AND 299)::int AS reachable,
      count(*) FILTER (WHERE http_status BETWEEN 300 AND 399 AND http_status <> 310)::int AS redirected,
      count(*) FILTER (WHERE http_status = 310 OR (http_status BETWEEN 400 AND 499 AND http_status NOT IN (401, 403, 429)))::int AS broken,
      to_char(max(fetched_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last
    FROM latest`);
  const addresses = int(r?.addresses);
  if (!addresses) return { measured: false, windowDays: LINK_WINDOW_DAYS };
  const reachable = int(r.reachable); const redirected = int(r.redirected); const broken = int(r.broken);
  return { measured: true, windowDays: LINK_WINDOW_DAYS, lastCheckedOn: r.last, addresses, reachable, redirected, broken, inconclusive: addresses - reachable - redirected - broken };
}

/** the slugs that have a translation file (only those records can be translated) */
function translatedSlugs(kind, root = process.cwd()) {
  try { return fs.readdirSync(path.join(root, 'data', 'translations', kind)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; }
}

async function translations(db) {
  /** @type {Record<string, Record<string, { full: number, partial: number }>>} */
  const languages = Object.fromEntries(TARGET_LANGUAGES.map((l) => [l, Object.fromEntries(TRANSLATED_KINDS.map((k) => [k, { full: 0, partial: 0 }]))]));
  for (const kind of TRANSLATED_KINDS) {
    const slugs = translatedSlugs(kind);
    if (!slugs.length) continue;
    const rows = await rowsOf(db, sql`SELECT * FROM ${sql.raw(`"${TRANSLATED_TABLES[kind]}"`)} WHERE slug IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})`);
    for (const row of rows) {
      const shown = kind === 'guide' || kind === 'actualite' ? row.statut === 'publie' : decide(row, /** @type {any} */ (kind), { mode: 'strict' }).visible;
      if (!shown) continue;
      const record = stripReviewFields(row, false);   // the same public view the translations route fingerprints
      const file = translationFile(kind, row.slug);
      for (const lang of TARGET_LANGUAGES) {
        const st = publicView(file, lang, kind, record).status;
        if (st === 'auto_checked' || st === 'human_reviewed') languages[lang][kind].full += 1;
        else if (st === 'partial') languages[lang][kind].partial += 1;
      }
    }
  }
  return { languages };
}

/** the /droits page: needs and official fiches (static, generated at build time) */
export function rightsNeeds(root = process.cwd()) {
  try {
    const view = JSON.parse(fs.readFileSync(path.join(root, 'data/reference/rights-public-view.v1.json'), 'utf8'));
    const needs = Array.isArray(view.needs) ? view.needs : [];
    const fiches = new Set([...needs.flatMap((n) => (Array.isArray(n.fiches) ? n.fiches : [])), ...(Array.isArray(view.aidFiches) ? view.aidFiches : [])].map((f) => String(f?.id || '')).filter(Boolean));
    return { needs: needs.length, officialFiches: fiches.size, sourcesReadOn: /^\d{4}-\d{2}-\d{2}$/.test(String(view.sourcesReadAt)) ? view.sourcesReadAt : null };
  } catch { return null; }
}

/** @param {{ db?: any, now?: Date }} [opts] */
export async function computePublicIndicators({ db = defaultDb, now = new Date() } = {}) {
  const [cat, classRows, struct, links, tr, themes] = await Promise.all([catalogue(db), aideClassRows(db), structures(db), linkHealth(db), translations(db), aidesBySourceThemeSafe(db)]);
  const domains = domainCounts(classRows);
  const scopes = scopeCounts(classRows);
  const share = (n, d) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);
  return {
    schema: SCHEMA,
    computedAt: now.toISOString(),
    rules: { visibility: 'D5_STRICT', currentDays: CURRENT_DAYS, maxAgeDays: maxAgeDays(), kMin: K_MIN, linkWindowDays: LINK_WINDOW_DAYS },
    catalogue: { aides: cat.kinds.aide.visible, demarches: cat.kinds.demarche.visible, structures: cat.kinds.structure.visible, dispositifs: cat.kinds.dispositif.visible,
      guides: cat.guides, actualites: cat.actualites },
    aidesByDomain: domains,
    aidesBySourceTheme: themes,
    aidesByScope: scopes,
    structuresByCommune: struct.byCommune,
    freshness: Object.fromEntries(Object.entries(cat.kinds).map(([k, v]) => [k, { ...v, currentShare: share(v.current, v.visible) }])),
    linkHealth: links,
    translations: { ...tr, of: { aide: cat.kinds.aide.visible, demarche: cat.kinds.demarche.visible, guide: cat.guides, actualite: cat.actualites } },
    structuresInformation: struct.information,
    rightsNeeds: rightsNeeds(),
  };
}
