/**
 * R6 — the open-data import of data·inclusion for the Eurométropole de Strasbourg (owner machine only, never served). It reads the weekly open export of the
 * « Référentiel de l'offre d'insertion sociale et professionnelle — data·inclusion » (data.gouv.fr, Licence Ouverte 2.0, no token, no sign-up) and decides,
 * for each place of the 33 communes of the Eurométropole (data/geography/service-territory.v1.json), what the directory should do — and nothing more:
 *
 *  - MATCH: the place IS an existing record, on strong evidence only: the same SIRET with the same name or street in the same postal code, the same FINESS
 *    number in the same postal code, or (no SIRET match) the same name AND the same street in the same postal code with no contradicting SIRET. Its services
 *    are attached to that record (Structure.services_externes, the veille's own value: datainclusion.js servicesValue — same producers, same attribution).
 *    A record shown to the public is NOT written here: the weekly veille writes it through the publication path (versioned, evidence ledger) — the import
 *    only counts it. A record not shown to the public is written (prior version kept in EntityVersion).
 *  - UNCERTAIN: partial evidence (same SIRET but another name and street — often another site of the same organisation —, same name without a comparable
 *    street, a SIRET that contradicts the record's…): never merged; one entry in the administration review queue (ReviewQueueItem, reason
 *    DATA_INCLUSION_DOUBLON_POSSIBLE) for a person to decide.
 *  - NEW: no record, a well-formed SIRET, a producer whose places may become records (datainclusion.js PRODUCERS.growth), a name that is a place, at least one
 *    service its producer keeps up to date. In apply mode the SIRENE registry must confirm it first (growthRefusal, the veille's own rule, plus the SIRENE
 *    commune in the Eurométropole). It is created as a DRAFT (statut brouillon, UNVERIFIED, no source_url): hidden by publicVisibility; the automatic
 *    verification chain checks and publishes it — or not — at its next run, as any record (D-5 v2). The import never publishes, verifies or deletes.
 *  - SKIPPED: everything else, with its reason (outside the Eurométropole, no SIRET, producer whose places are not records, no fresh service…).
 *
 * Provenance: every value written names data·inclusion, the ORIGINAL producer of each place and service, the dataset page, the export date, the files (title,
 * SHA-1, URL), the time they were fetched and the licence. Needs: the 20 × 86 subdomains of the taxonomy's own correspondence (datainclusion-needs.js).
 * Nothing personal is kept (no telephone, no e-mail, no description: datainclusion.js placeOf / serviceOf).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { producerOf, servicesValue, servicesFor, sameServices, growthRefusal, NOT_A_PLACE_NAME, DATASET_PAGE } from '../../api/_services/verification/datainclusion.js';
import { needsOfServices } from '../../api/_services/verification/datainclusion-needs.js';
import { titleTokens } from '../../api/_services/verification/dila.js';
import { sameStreet } from '../../api/_services/verification/structure-check.js';
import { communeOfAddress } from '../../api/lib/geography/territoryScope.js';

export const IMPORTER = Object.freeze({ id: 'ada-datainclusion-import', role: 'system' });
export const REVIEW_REASON = 'DATA_INCLUSION_DOUBLON_POSSIBLE';
export const BATCH_PREFIX = 'datainclusion-import:';
/** the licence of the dataset as data.gouv.fr declares it (« lov2 », read 25/11/2026) and the attribution the licence asks for */
export const LICENCE = Object.freeze({
  id: 'lov2', name: 'Licence Ouverte 2.0', fullName: 'Licence Ouverte / Open Licence version 2.0 (Etalab)', url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  attribution: 'data·inclusion — Référentiel de l’offre d’insertion sociale et professionnelle, publié par la Plateforme de l’inclusion (GIP) sur data.gouv.fr, Licence Ouverte 2.0',
});
/** the dataset's licence id must be this one: any other licence stops the import (a change of licence needs a person's reading) */
export const ACCEPTED_LICENCES = new Set(['lov2']);

const digits = (v) => String(v ?? '').replace(/\D+/g, '');
const cp5 = (v) => digits(v).slice(0, 5);

// ------------------------------------------------------------------------------------------------------------------------------------ territory
/** the communes of the service territory (Eurométropole de Strasbourg, INSEE composition) @param {string} root */
export function loadTerritory(root = process.cwd()) {
  const t = JSON.parse(fs.readFileSync(path.join(root, 'data/geography/service-territory.v1.json'), 'utf8'));
  return { epci: t.epci, libelle: t.libelle, communes: new Map(t.communes.map(([code, nom]) => [String(code), String(nom)])), validation: t.validation?.status || null };
}

/**
 * Whether a place is in the territory: its INSEE commune code when the producer gives one, else its commune name and postal code (communeOfAddress: they
 * must agree on exactly one commune). @returns {{ in: true, code: string, basis: 'INSEE' | 'ADRESSE' } | { in: false, reason: string }}
 */
export function placeTerritory(pl, territory, { root = process.cwd(), locate = communeOfAddress } = {}) {
  const code = String(pl.code_insee || '').trim();
  if (code) return territory.communes.has(code) ? { in: true, code, basis: 'INSEE' } : { in: false, reason: 'HORS_EUROMETROPOLE' };
  const c = locate({ ville: pl.commune, code_postal: pl.code_postal }, { root });
  if (!c) return { in: false, reason: 'COMMUNE_NON_LOCALISEE' };
  return territory.communes.has(c.code) ? { in: true, code: c.code, basis: 'ADRESSE' } : { in: false, reason: 'HORS_EUROMETROPOLE' };
}

// ------------------------------------------------------------------------------------------------------------------------------------ matching
/** name words that identify nothing on their own (the veille's list, chain.js GENERIC, plus the words of a kind of place) */
const GENERIC = new Set(['demande', 'demander', 'information', 'generale', 'bas', 'rhin', 'strasbourg', 'eurometropole', 'alsace', 'grand', 'est', 'jeune', 'faire', 'obtenir',
  'informer', 'comment', 'vous', 'voulez', 'association', 'centre', 'service', 'services', 'agence', 'maison', 'espace', 'antenne']);
/** the share of the place's distinctive name words found in the record's name (null: the place's name has no distinctive word) */
export function nameAgreement(placeName, recordName) {
  const want = [...new Set(titleTokens(placeName).filter((w) => !GENERIC.has(w)))];
  if (!want.length) return null;
  const have = new Set(titleTokens(recordName));
  return want.filter((w) => have.has(w)).length / want.length;
}

/** @param {any[]} rows the reference records: { id, nom, adresse, code_postal, ville, siret, numero_finess, … } */
export function buildIndex(rows) {
  const bySiret = new Map(); const byFiness = new Map(); const byPostal = new Map(); const byId = new Map();
  for (const x of rows) {
    byId.set(x.id, x);
    const s = digits(x.siret); if (s.length === 14) bySiret.set(s, [...(bySiret.get(s) || []), x]);
    if (x.numero_finess) byFiness.set(String(x.numero_finess).trim(), [...(byFiness.get(String(x.numero_finess).trim()) || []), x]);
    const cp = cp5(x.code_postal); if (cp) byPostal.set(cp, [...(byPostal.get(cp) || []), x]);
  }
  return { bySiret, byFiness, byPostal, byId };
}

const samePostal = (x, pl) => Boolean(cp5(x.code_postal)) && cp5(x.code_postal) === cp5(pl.code_postal);
const streetOf = (x, pl) => sameStreet(x.adresse, pl.adresse, pl.code_postal, pl.commune);

/**
 * Which record a place is — strong evidence only. @returns {{ kind: 'MATCH', by: 'SIRET' | 'FINESS' | 'NOM_ADRESSE', id: string }
 *   | { kind: 'UNCERTAIN', reason: string, candidates: string[] } | { kind: 'NONE' }}
 */
export function matchPlace(pl, idx) {
  if (pl.siret && idx.bySiret.has(pl.siret)) {
    const list = idx.bySiret.get(pl.siret);
    const strong = list.filter((x) => samePostal(x, pl) && ((nameAgreement(pl.nom, x.nom) ?? 0) >= 0.75 || streetOf(x, pl) === true));
    if (strong.length === 1) return { kind: 'MATCH', by: 'SIRET', id: strong[0].id };
    return { kind: 'UNCERTAIN', reason: strong.length > 1 ? 'SIRET_PLUSIEURS_FICHES' : 'SIRET_IDENTIQUE_AUTRE_NOM_OU_ADRESSE', candidates: list.map((x) => x.id) };
  }
  if (pl.finess && idx.byFiness.has(pl.finess)) {
    const list = idx.byFiness.get(pl.finess);
    if (list.length === 1 && samePostal(list[0], pl)) return { kind: 'MATCH', by: 'FINESS', id: list[0].id };
    return { kind: 'UNCERTAIN', reason: list.length > 1 ? 'FINESS_PLUSIEURS_FICHES' : 'FINESS_AUTRE_CODE_POSTAL', candidates: list.map((x) => x.id) };
  }
  const cp = cp5(pl.code_postal);
  if (!cp) return { kind: 'NONE' };
  const near = (idx.byPostal.get(cp) || []).map((x) => ({ x, n: nameAgreement(pl.nom, x.nom), st: streetOf(x, pl) }));
  const strong = near.filter((c) => (c.n ?? 0) >= 0.75 && c.st === true);
  const contradicts = (x) => Boolean(pl.siret) && digits(x.siret).length === 14 && digits(x.siret) !== pl.siret;
  if (strong.length === 1 && !contradicts(strong[0].x)) return { kind: 'MATCH', by: 'NOM_ADRESSE', id: strong[0].x.id };
  if (strong.length === 1) return { kind: 'UNCERTAIN', reason: 'NOM_ADRESSE_IDENTIQUES_SIRET_DIFFERENT', candidates: [strong[0].x.id] };
  if (strong.length > 1) return { kind: 'UNCERTAIN', reason: 'PLUSIEURS_FICHES_MEME_NOM_ET_ADRESSE', candidates: strong.map((c) => c.x.id) };
  const weak = near.filter((c) => ((c.n ?? 0) >= 0.75 && c.st === null) || ((c.n ?? 0) >= 0.5 && c.st === true));
  if (weak.length) return { kind: 'UNCERTAIN', reason: 'NOM_OU_ADRESSE_PARTIELLEMENT_IDENTIQUES', candidates: weak.map((c) => c.x.id).slice(0, 5) };
  return { kind: 'NONE' };
}

// ------------------------------------------------------------------------------------------------------------------------------------ plan
/** the record is shown to the public (statut published, verified, no hold): the veille alone writes it */
export const isPublic = (x) => ['actif', 'publie'].includes(String(x.statut)) && x.verification_status === 'VERIFIED' && !x.publication_hold;
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
export const hashOf = (v) => crypto.createHash('sha256').update(canonical(v ?? null)).digest('hex').slice(0, 16);
const foldName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** a service as the comparison of two values sees it (works on the stored value and on the public detail value) */
const serviceKey = (s) => `${foldName(s?.nom)}|${s?.producerLabel || s?.producer || ''}`;
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const rank = { OPERATEUR_PUBLIC: 0, ORGANISME_GESTIONNAIRE: 1, PLATEFORME_DECLARATIVE: 2 };

/**
 * The provenance block written with every value (internal: not in the public part of services_externes).
 * @param {{ date: string, licence?: string | null, structures: any, services: any }} source @param {string} fetchedAt
 */
export function provenanceOf(source, fetchedAt) {
  return { tool: IMPORTER.id, source: 'data·inclusion', dataset: DATASET_PAGE, export: source.date, fetchedAt, licence: LICENCE.name, licenceId: source.licence || LICENCE.id, licenceUrl: LICENCE.url,
    attribution: LICENCE.attribution, files: ['structures', 'services'].map((k) => ({ title: source[k]?.title || null, sha1: source[k]?.sha1 || null, url: source[k]?.url || null })) };
}

/**
 * The decision for every place of the export in the département (pure: no I/O but the territory reference).
 * @param {{ read: { places: Map<string, any>, servicesOf: Map<string, any[]>, counts: any, unknown: any }, rows: any[], source: any, territory: any,
 *   root?: string, fetchedAt?: string, referenceKind?: 'database' | 'public-api', locate?: Function }} o
 */
export function planImport({ read, rows, source, territory, root = process.cwd(), fetchedAt = new Date().toISOString(), referenceKind = 'database', locate }) {
  const version = source.date; const idx = buildIndex(rows);
  const skipped = {}; const byBasis = { INSEE: 0, ADRESSE: 0 }; const placesOfRecord = new Map(); const matchBy = {}; const review = new Map(); const groups = new Map();
  const byProducer = {}; let inTerritory = 0; let servicesInTerritory = 0;
  for (const pl of read.places.values()) {
    const t = placeTerritory(pl, territory, { root, ...(locate ? { locate } : {}) });
    if (!t.in) { inc(skipped, t.reason); continue; }
    inTerritory += 1; byBasis[t.basis] += 1; inc(byProducer, pl.source); servicesInTerritory += (read.servicesOf.get(pl.id) || []).length;
    const placeT = { ...pl, code_insee: pl.code_insee || t.code };
    const m = matchPlace(placeT, idx);
    if (m.kind === 'MATCH') { inc(matchBy, m.by); placesOfRecord.set(m.id, [...(placesOfRecord.get(m.id) || []), { ...placeT, matchedBy: m.by }]); continue; }
    if (m.kind === 'UNCERTAIN') {
      const key = `${m.candidates[0]}|${m.reason}`;
      const e = review.get(key) || { recordId: m.candidates[0], candidates: m.candidates, reason: m.reason, places: [] };
      e.places.push({ id: pl.id, producer: pl.source, nom: pl.nom, adresse: pl.adresse, code_postal: pl.code_postal, commune: pl.commune, siret: pl.siret, link: pl.link });
      review.set(key, e); continue;
    }
    if (!pl.siret) { inc(skipped, 'SIRET_ABSENT_OU_INVALIDE'); continue; }
    if (!producerOf(pl.source).growth) { inc(skipped, `PRODUCTEUR_SANS_CREATION:${pl.source}`); continue; }
    if (NOT_A_PLACE_NAME.test(pl.nom)) { inc(skipped, 'NOM_QUI_N_EST_PAS_UN_LIEU'); continue; }
    const key = `${pl.siret}|${cp5(pl.code_postal)}`;
    groups.set(key, [...(groups.get(key) || []), placeT]);
  }

  // the records the places are: the veille's value (same function), compared with what the record holds
  const matched = []; const conflicts = []; const unmapped = {}; const needsCount = {};
  for (const [id, placeList] of placesOfRecord) {
    const x = idx.byId.get(id);
    const before = x.services_externes && typeof x.services_externes === 'object' ? x.services_externes : null;
    const v = servicesValue({ version, placeList, servicesOf: read.servicesOf, previous: before });
    const n = needsOfServices(v.services); for (const [k, c] of Object.entries(n.unmapped)) inc(unmapped, k, c); for (const s of n.needs) inc(needsCount, s);
    const keysBefore = new Set((before?.services || []).map(serviceKey));
    const newServices = v.services.filter((s) => !keysBefore.has(serviceKey(s))).length;
    const removedServices = [...keysBefore].filter((k) => !v.services.some((s) => serviceKey(s) === k)).length;
    const changed = referenceKind === 'database' ? !sameServices(before, v) || Boolean(before?.absentFrom?.length) : newServices > 0 || removedServices > 0;
    const sirets = [...new Set(placeList.map((p) => p.siret).filter(Boolean))];
    const conflict = sirets.length > 1 ? 'PLUSIEURS_SIRET_POUR_UNE_FICHE'
      : String(x.publication_hold || '').length && !isPublic(x) ? 'FICHE_MISE_DE_COTE'
        : before && before.origin && before.origin !== 'DATA_INCLUSION' ? 'SERVICES_EXTERNES_D_UNE_AUTRE_ORIGINE' : null;
    const item = { recordId: id, nom: x.nom, by: [...new Set(placeList.map((p) => p.matchedBy))].sort(),
      places: placeList.map((p) => ({ id: p.id, producer: p.source })), public: isPublic(x), changed, beforeHash: hashOf(before), servicesBefore: (before?.services || []).length,
      servicesAfter: v.services.length, newServices, removedServices, newCategories: v.categories.filter((c) => !(x.categories_aidees || []).includes(c)), needs: n.needs,
      path: conflict ? 'CONFLIT' : isPublic(x) ? 'VEILLE' : 'IMPORT', conflict, value: { ...v, import: provenanceOf(source, fetchedAt) } };
    if (conflict) conflicts.push({ recordId: id, nom: x.nom, reason: conflict });
    matched.push(item);
  }
  matched.sort((a, b) => a.recordId.localeCompare(b.recordId));

  // the new places: one record per SIRET and postal code, the places of the highest authority first; only with a service kept up to date
  const candidates = [];
  for (const [key, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const places = [...list].sort((a, b) => rank[producerOf(a.source).authority] - rank[producerOf(b.source).authority] || a.id.localeCompare(b.id));
    const fresh = servicesFor(places, read.servicesOf, { asOf: version }).services;
    if (!fresh.length) { inc(skipped, 'AUCUN_SERVICE_A_JOUR'); continue; }
    const v = servicesValue({ version, placeList: places, servicesOf: read.servicesOf, created: true });
    const n = needsOfServices(v.services); for (const [k, c] of Object.entries(n.unmapped)) inc(unmapped, k, c); for (const s of n.needs) inc(needsCount, s);
    const pl = places[0];
    candidates.push({ key, siret: pl.siret, nom: pl.nom, adresse: pl.adresse, code_postal: pl.code_postal, commune: pl.commune, code_insee: pl.code_insee, latitude: pl.latitude, longitude: pl.longitude,
      producers: [...new Set(places.map((p) => p.source))], authority: producerOf(pl.source).authority, places: places.map((p) => ({ id: p.id, producer: p.source })),
      services: v.services.length, categories: v.categories, needs: n.needs, sirene: null, value: { ...v, import: provenanceOf(source, fetchedAt) } });
  }
  candidates.sort((a, b) => rank[a.authority] - rank[b.authority] || a.key.localeCompare(b.key));

  const reviewList = [...review.values()].sort((a, b) => a.recordId.localeCompare(b.recordId) || a.reason.localeCompare(b.reason));
  const counts = {
    exportStructures: read.counts.structures, exportServices: read.counts.services, departement: read.counts.inScope, inTerritory, byBasis, byProducer, servicesInTerritory,
    matchedPlaces: Object.values(matchBy).reduce((a, b) => a + b, 0), matchBy, matchedRecords: matched.length,
    toWrite: matched.filter((m) => m.path === 'IMPORT' && m.changed).length, toVeille: matched.filter((m) => m.path === 'VEILLE' && m.changed).length,
    unchanged: matched.filter((m) => !m.changed && m.path !== 'CONFLIT').length, conflicts: conflicts.length, review: reviewList.length,
    reviewPlaces: reviewList.reduce((a, r) => a + r.places.length, 0), newCandidates: candidates.length,
    skippedPlaces: Object.entries(skipped).filter(([k]) => k !== 'AUCUN_SERVICE_A_JOUR').reduce((a, [, n]) => a + n, 0) };
  return { kind: 'datainclusion-import-plan', version, referenceKind, territory: { epci: territory.epci, libelle: territory.libelle, communes: territory.communes.size, validation: territory.validation },
    counts, skipped, matched, conflicts, review: reviewList, candidates, needs: { bySubdomain: needsCount, unmappedThemes: unmapped }, unknownValues: read.unknown || {} };
}

/** the fingerprint the apply must be given back: the files and every planned change (another export or database state gives another one) */
export function fingerprint(source, plan) {
  const changes = {
    m: plan.matched.map((m) => [m.recordId, m.path, m.changed, m.beforeHash, hashOf({ p: m.value.places, s: m.value.services })]),
    c: plan.candidates.map((c) => [c.key, hashOf({ p: c.value.places, s: c.value.services })]),
    r: plan.review.map((r) => [r.recordId, r.reason, r.places.map((p) => p.id)]),
  };
  return crypto.createHash('sha256').update(JSON.stringify({ s: [source.structures.sha1, source.services.sha1, source.date], ref: plan.referenceKind, changes })).digest('hex');
}

// ------------------------------------------------------------------------------------------------------------------------------------ database
/** the reference records (the only SELECT on content the import makes) */
export async function referenceRows(db) {
  return (await db.execute(sql`SELECT id, slug, nom, adresse, code_postal, ville, siret, numero_finess, statut, verification_status, publication_hold, services_externes, categories_aidees
    FROM "Structure" ORDER BY id`)).rows;
}

/** counts for the before / after lines */
export async function importCounts(db) {
  const [r] = (await db.execute(sql`SELECT count(*)::int AS structures,
    count(*) FILTER (WHERE services_externes->>'origin' = 'DATA_INCLUSION')::int AS with_datainclusion,
    count(*) FILTER (WHERE import_batch LIKE ${`${BATCH_PREFIX}%`})::int AS created_by_import,
    count(*) FILTER (WHERE import_batch LIKE ${`${BATCH_PREFIX}%`} AND statut IN ('actif', 'publie') AND verification_status = 'VERIFIED' AND publication_hold IS NULL)::int AS created_by_import_public,
    count(*) FILTER (WHERE statut IN ('actif', 'publie') AND verification_status = 'VERIFIED' AND publication_hold IS NULL)::int AS public
    FROM "Structure"`)).rows;
  const [q] = (await db.execute(sql`SELECT count(*)::int AS n FROM "ReviewQueueItem" WHERE reason = ${REVIEW_REASON} AND lower(status) = 'open'`)).rows;
  return { ...r, review_open: q.n };
}

/** a text[] literal ('{"a","b"}'): drizzle expands a JS array into a parameter list, so arrays are passed as one literal */
export const pgTextArray = (a) => `{${(a || []).map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
const slugify = (s) => foldName(s).replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

/**
 * Write the plan: services of the records not shown to the public, new DRAFT records confirmed by SIRENE, review entries. One change per transaction, each
 * re-checked under its row lock; a record that changed since the dry-run is skipped (counted), never forced. Stops at the first database error.
 * @param {{ db: any, plan: any, source: any, territory: any, lookup: (siret: string) => Promise<any>, snapshotRow: Function, now?: () => Date, limitNew?: number,
 *   paceMs?: number, departement?: string }} o
 */
export async function applyPlan({ db, plan, territory, lookup, snapshotRow, now = () => new Date(), limitNew = 100, paceMs = 0, departement = '67' }) {
  const res = { updated: [], created: [], refused: [], queued: [], skipped: [], later: 0, failure: null };
  const batch = `${BATCH_PREFIX}${plan.version}`;
  try {
    for (const m of plan.matched.filter((x) => x.path === 'IMPORT' && x.changed)) {
      const r = await db.transaction(async (tx) => {
        const [cur] = (await tx.execute(sql`SELECT statut, verification_status, publication_hold, services_externes FROM "Structure" WHERE id = ${m.recordId} FOR UPDATE`)).rows;
        if (!cur || isPublic(cur) || hashOf(cur.services_externes ?? null) !== m.beforeHash) return { skipped: 'CHANGED_SINCE_DRY_RUN' };
        await snapshotRow(tx, 'structure', m.recordId, 'avant import data·inclusion (données ouvertes)', IMPORTER.id);
        await tx.execute(sql`UPDATE "Structure" SET services_externes = ${JSON.stringify(m.value)}::jsonb, "updatedBy" = ${IMPORTER.id}, "updatedAt" = ${now()} WHERE id = ${m.recordId}`);
        return { ok: true };
      });
      if (r.skipped) res.skipped.push({ id: m.recordId, reason: r.skipped }); else res.updated.push(m.recordId);
    }
    for (const c of plan.candidates) {
      if (res.created.length >= limitNew) { res.later += 1; continue; }
      let s;
      try { s = await lookup(c.siret); } catch { res.later += 1; continue; }   // SIRENE could not be read: examined again at the next run
      if (paceMs) await new Promise((ok) => setTimeout(ok, paceMs));
      const why = growthRefusal(s, c, departement) || (s.communeInsee && !territory.communes.has(String(s.communeInsee)) ? 'adresse SIRENE hors de l’Eurométropole' : null);
      if (why) { res.refused.push({ key: c.key, reason: why }); continue; }
      const id = crypto.randomUUID();
      const r = await db.transaction(async (tx) => {
        if ((await tx.execute(sql`SELECT 1 FROM "Structure" WHERE siret = ${c.siret} LIMIT 1`)).rows.length) return { skipped: 'DEJA_LISTE' };
        await tx.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, siret, departement, latitude, longitude, data_origin, statut, services, publics_accueillis,
          categories_aidees, insee_codes, department_codes, services_externes, import_batch, source_id, retrieved_at, source_last_modified, "updatedBy", "updatedAt")
          VALUES (${id}, ${c.nom}, ${`${slugify(c.nom)}-${id.slice(0, 8)}`}, ${c.adresse}, ${c.code_postal}, ${c.commune}, ${c.siret}, ${departement}, ${c.latitude}, ${c.longitude}, 'official', 'brouillon',
          '{}'::text[], '{}'::text[], ${pgTextArray(c.categories)}::text[], ${pgTextArray(c.code_insee ? [c.code_insee] : [])}::text[], ${pgTextArray([departement])}::text[],
          ${JSON.stringify(c.value)}::jsonb, ${batch}, 'data-inclusion', ${new Date(c.value.import.fetchedAt)}, ${new Date(`${plan.version}T00:00:00Z`)}, ${IMPORTER.id}, ${now()})`);
        return { ok: true };
      });
      if (r.skipped) res.skipped.push({ key: c.key, reason: r.skipped }); else res.created.push({ id, key: c.key });
    }
    for (const q of plan.review) {
      const details = { source: 'data·inclusion', export: plan.version, dataset: DATASET_PAGE, licence: LICENCE.name, reason: q.reason, candidates: q.candidates, places: q.places,
        note: 'Rapprochement incertain : ne pas fusionner sans preuve institutionnelle (registre des doublons).' };
      await db.execute(sql`INSERT INTO "ReviewQueueItem" (id, "entityType", "entityId", title, reason, severity, status, details, "createdAt", "updatedAt")
        VALUES (${crypto.randomUUID()}, 'STRUCTURE', ${q.recordId}, ${`data·inclusion : ${q.places[0].nom}`.slice(0, 200)}, ${REVIEW_REASON}, 'P2', 'OPEN', ${JSON.stringify(details)}::jsonb, ${now()}, ${now()})
        ON CONFLICT ("entityType", "entityId", reason, status) DO UPDATE SET details = EXCLUDED.details, title = EXCLUDED.title, "updatedAt" = EXCLUDED."updatedAt"`);
      res.queued.push(q.recordId);
    }
  } catch (e) {
    res.failure = { message: String(e?.code || e?.message || e).slice(0, 300) };
  }
  return res;
}

// ------------------------------------------------------------------------------------------------------------------------------------ report
const SKIP_TR = {
  HORS_EUROMETROPOLE: 'Eurométropole dışında (Bas-Rhin’in diğer komünleri)', COMMUNE_NON_LOCALISEE: 'Komün belirlenemedi (INSEE kodu yok, ad + posta kodu tek komüne denk gelmiyor)',
  SIRET_ABSENT_OU_INVALIDE: 'Eşleşme yok ve geçerli SIRET yok (yeni kayıt açılamaz)', NOM_QUI_N_EST_PAS_UN_LIEU: 'Ad bir yer değil (okul, genel ad, siège)',
  AUCUN_SERVICE_A_JOUR: 'Yeni aday GRUBU (SIRET + posta kodu) ama üreticisinin güncel tuttuğu hizmet yok (730 gün) — birim: grup, yer değil',
};
const skipTr = (k) => SKIP_TR[k] || (k.startsWith('PRODUCTEUR_SANS_CREATION:') ? `Üreticinin yerleri yeni kayıt olamaz (${k.split(':')[1]}: kreş/eğitim yeri/FINESS doğrudan)` : k);
const REASON_TR = {
  SIRET_IDENTIQUE_AUTRE_NOM_OU_ADRESSE: 'Aynı SIRET, farklı ad ve sokak (çoğunlukla aynı kuruluşun başka şubesi)', SIRET_PLUSIEURS_FICHES: 'Aynı SIRET birden çok kayıtta',
  FINESS_AUTRE_CODE_POSTAL: 'Aynı FINESS, farklı posta kodu', FINESS_PLUSIEURS_FICHES: 'Aynı FINESS birden çok kayıtta',
  NOM_ADRESSE_IDENTIQUES_SIRET_DIFFERENT: 'Ad ve sokak aynı ama SIRET farklı', PLUSIEURS_FICHES_MEME_NOM_ET_ADRESSE: 'Aynı ad ve sokakta birden çok kayıt',
  NOM_OU_ADRESSE_PARTIELLEMENT_IDENTIQUES: 'Ad veya adres yalnızca kısmen aynı',
};
const CONFLICT_TR = { PLUSIEURS_SIRET_POUR_UNE_FICHE: 'Tek kayda farklı SIRET’li yerler bağlanıyor', FICHE_MISE_DE_COTE: 'Kayıt beklemede (publication_hold): dokunulmaz',
  SERVICES_EXTERNES_D_UNE_AUTRE_ORIGINE: 'services_externes başka bir kaynaktan' };
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n');

/** the Turkish dry-run report (owner language), tables of counts and samples; no personal value (places are organisations; no telephone or e-mail is read) */
export function renderReportTr(plan, meta) {
  const c = plan.counts; const L = [];
  L.push('# data·inclusion açık veri içe aktarımı — kuru çalıştırma (dry-run) raporu', '');
  L.push(`Tarih: ${meta.generatedAt} · Araç: \`scripts/datainclusion-import.mjs\` (commit ${meta.commit || '—'}) · Plan parmak izi: \`${meta.fingerprint.slice(0, 16)}…\``, '');
  L.push('## Özet', '');
  L.push(`- Kaynak: **data·inclusion** haftalık açık dışa aktarımı, **${plan.version}** tarihli (data.gouv.fr, yayıncı: ${meta.publisher || 'Plateforme de l’inclusion'}). Token yok, form yok.`);
  L.push(`- Lisans: **${LICENCE.fullName}** (data.gouv.fr’de \`${meta.licenceId}\`; ${meta.licenceCheckedAt} tarihinde okundu). Atıf: « ${LICENCE.attribution} ».`);
  L.push(`- Dosyalar SHA-1 ile yayıncının beyanına göre doğrulandı: ${meta.files.map((f) => `\`${f.title}\` (${f.sha1.slice(0, 12)}…)`).join(', ')}.`);
  L.push(`- Karşılaştırma tabanı: **${plan.referenceKind === 'database' ? `veritabanı (${meta.referenceLabel})` : `Production kamu API’si (${meta.referenceLabel}) — yalnız yayımlanmış kayıtlar`}**, ${meta.referenceRows} kayıt.`);
  if (plan.referenceKind !== 'database') L.push('  - **Not:** kamu API’si taslak/gizli kayıtları göstermez; kesin sayılar sahibinin veritabanı üzerinde çalıştıracağı dry-run’dan gelir (apply yalnız veritabanı planıyla çalışır).');
  L.push(`- Bölge: **${plan.territory.libelle}** (EPCI ${plan.territory.epci}, ${plan.territory.communes} komün; \`data/geography/service-territory.v1.json\`, doğrulama durumu: ${plan.territory.validation}).`);
  L.push(`- Hiçbir Production yazımı yapılmadı. Yeni kayıtlar yalnız **taslak** (brouillon, UNVERIFIED) olarak açılır; yayımlamayı otomatik doğrulama zinciri (D-5 v2) yapar.`, '');
  L.push('## Sayılar', '');
  L.push(table(['Ölçü', 'Sayı'], [
    ['Dışa aktarımdaki yerler (Fransa)', c.exportStructures], ['Dışa aktarımdaki hizmetler (Fransa)', c.exportServices], ['Bas-Rhin (67) yerleri', c.departement],
    ['Eurométropole yerleri', `${c.inTerritory} (INSEE kodu ile ${c.byBasis.INSEE}, adres ile ${c.byBasis.ADRESSE})`], ['Eurométropole yerlerinin hizmetleri', c.servicesInTerritory],
    ['**Eşleşen yer** (mevcut kayda bağlanan)', `${c.matchedPlaces} → ${c.matchedRecords} kayıt (${Object.entries(c.matchBy).map(([k, n]) => `${k}: ${n}`).join(', ')})`],
    ['— zenginleşecek, kamuya kapalı kayıt (import yazar)', c.toWrite], ['— zenginleşecek, kamuya açık kayıt (veille yazar, import yazmaz)', c.toVeille],
    ['— değişiklik yok', c.unchanged], ['**Çakışma** (dokunulmaz)', c.conflicts], ['**Belirsiz eşleşme → inceleme kuyruğu**', `${c.review} kayıt (${c.reviewPlaces} yer)`],
    ['**Yeni aday** (SIRENE onayı + taslak)', c.newCandidates], ['**Atlanan yer**', c.skippedPlaces],
  ])); L.push('');
  if (meta.sirene) {
    L.push('### Yeni adayların SIRENE ön kontrolü (salt okuma, recherche-entreprises.api.gouv.fr)', '');
    L.push(table(['Sonuç', 'Sayı'], Object.entries(meta.sirene).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n]))); L.push('');
  }
  L.push('## Atlananlar ve nedenleri', '');
  L.push(table(['Neden', 'Yer sayısı'], Object.entries(plan.skipped).sort((a, b) => b[1] - a[1]).map(([k, n]) => [skipTr(k), n]))); L.push('');
  L.push('## Üreticiye göre Eurométropole yerleri', '');
  L.push(table(['Üretici (kod)', 'Etiket', 'Yetki', 'Yer'], Object.entries(c.byProducer).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const p = producerOf(k); return [k, p.label, p.authority, n]; }))); L.push('');
  const fields = { services: plan.matched.filter((m) => m.newServices > 0 && m.path !== 'CONFLIT').length, categories: plan.matched.filter((m) => m.newCategories.length && m.path !== 'CONFLIT').length,
    needs: plan.matched.filter((m) => m.needs.length && m.path !== 'CONFLIT').length };
  L.push('## Zenginleşen alanlar (eşleşen kayıtlar)', '');
  L.push(table(['Alan', 'Kayıt', 'Not'], [
    ['services_externes.services', fields.services, `yeni hizmet toplamı: ${plan.matched.reduce((a, m) => a + (m.path !== 'CONFLIT' ? m.newServices : 0), 0)}; kaldırılacak: ${plan.matched.reduce((a, m) => a + (m.path !== 'CONFLIT' ? m.removedServices : 0), 0)}`],
    ['services_externes.categories (kategori_aidees’te olmayan)', fields.categories, 'categories_aidees sütununa yazılmaz (veille ile aynı)'],
    ['services_externes.needs (20×86 alt alan)', fields.needs, 'yalnız taksonominin kendi `dataInclusion` eşlemesi'],
    ['services_externes.import (köken)', plan.matched.filter((m) => m.path === 'IMPORT' && m.changed).length, 'üretici, veri seti, dosya tarihi + SHA-1, fetched_at, lisans'],
  ])); L.push('');
  L.push('## İhtiyaç taksonomisi (20×86) eşlemesi', '');
  const needRows = Object.entries(plan.needs.bySubdomain).sort((a, b) => b[1] - a[1]);
  L.push(needRows.length ? table(['Alt alan', 'Kayıt/aday'], needRows) : '_Eşlenen alt alan yok._'); L.push('');
  const un = Object.entries(plan.needs.unmappedThemes).sort((a, b) => b[1] - a[1]);
  L.push(`Eşlenmeyen tematikler (taksonomide karşılığı yok — tahmin edilmedi): ${un.length} farklı kod, ${un.reduce((a, [, n]) => a + n, 0)} kullanım.`, '');
  if (un.length) { L.push(table(['data·inclusion tematiği', 'Kullanım'], un.slice(0, 25))); L.push(''); }
  if (plan.conflicts.length) { L.push('## Çakışmalar', ''); L.push(table(['Kayıt', 'Ad', 'Neden'], plan.conflicts.map((x) => [x.recordId.slice(0, 8), x.nom, CONFLICT_TR[x.reason] || x.reason]))); L.push(''); }
  const byReason = {}; for (const r of plan.review) inc(byReason, r.reason);
  L.push('## Belirsiz eşleşmeler (inceleme kuyruğu, birleştirme yok)', '');
  L.push(table(['Neden', 'Kayıt'], Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => [REASON_TR[k] || k, n]))); L.push('');
  if (plan.review.length) { L.push('Örnekler (ilk 15):', ''); L.push(table(['Mevcut kayıt', 'data·inclusion yeri', 'Üretici', 'Neden'], plan.review.slice(0, 15).map((r) => [r.recordId.slice(0, 8), r.places[0].nom, r.places[0].producer, REASON_TR[r.reason] || r.reason]))); L.push(''); }
  L.push('## Yeni adaylar (ilk 25, yetki sırasına göre)', '');
  L.push(plan.candidates.length ? table(['Ad', 'Komün', 'Üretici', 'Hizmet', 'Alt alanlar', 'SIRENE ön kontrol'], plan.candidates.slice(0, 25).map((x) => [x.nom, x.commune, x.producers.join(', '), x.services, x.needs.join(', ') || '—', x.sirene || 'kontrol edilmedi']))
    : '_Aday yok._'); L.push('');
  L.push('## Nasıl yeniden üretilir', '', '```sh', ...meta.commands, '```', '');
  return `${L.join('\n')}\n`;
}
