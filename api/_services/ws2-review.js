// @ts-nocheck
/**
 * PKG-5 — WS2 closure work queue. Joins the 49 launch records (data/strasbourg/ws2-review-queue.v2.json, derived from the earlier evidence matrix: research aid only)
 * with the database record they correspond to and with the MFA content-verification ledger (ContentVerification). A record counts as human-verified ONLY when
 * its latest ledger outcome is VERIFIED (named reviewer, official source, server time). CSV self-declared flags never count. Nothing here writes data files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { contentVersion, evidenceUrlAllowed, reviewContent } from './content-verification.js';
import { isEditHold } from './content-versions.js';
import { db as defaultDb } from '../../src/db/index.js';

// what the reviewer compares with the source: every public field, in full (owner LAB audit: the view used to cut each field at 1 200 characters and left out the
// service area insee_codes), and the version a decision will be bound to (content-verification.js contentVersion)
const TABLE = { aides: { entityType: 'aide', table: 'Aide' }, demarches: { entityType: 'demarche', table: 'Demarche' }, structures: { entityType: 'structure', table: 'Structure' } };
export function readQueue(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'data/strasbourg/ws2-review-queue.v2.json'), 'utf8'));
}

/** Latest ledger decision per (entityType, entityId). */
async function latestDecisions(db) {
  const rows = (await db.execute(sql`SELECT DISTINCT ON ("entityType", "entityId") "entityType" AS t, "entityId" AS id, outcome, "reviewerRole" AS role, "sourceUrl" AS source, "verifiedAt" AS at
    FROM "ContentVerification" ORDER BY "entityType", "entityId", "verifiedAt" DESC, "createdAt" DESC`)).rows;
  return new Map(rows.map((r) => [`${r.t}:${r.id}`, r]));
}

/**
 * PKG-5 — review PREPARATION (research aid computed from the earlier evidence matrix; it decides nothing): a group to work through similar cases together, the
 * suggested next step, what to check, and the candidate official source pre-filled as an https link. Groups, most urgent first:
 *   E_BLOQUANT    a blocking finding, a nominative e-mail or a missing launch field: correct the record first (hold), never verify as is
 *   C_A_TRANCHER  contradiction, inconsistent scope, duplicate concept, territory or source finding: correct or reject, never verify as is
 *   D_IDENTITE    structure identity / address / possible duplicate to confirm on an official or the structure's own source
 *   B_A_RECHERCHER no source researched yet: find the official source; otherwise hold
 *   A_PRET        source located, no finding: compare the record with the source, then verify (or correct)
 */
export function prepare(r, cand = null) {
  const has = (v) => v && v !== '-';
  const status = String(r.research_status || ''); const findings = String(r.findings || ''); const privacy = String(r.privacy || ''); const missing = String(r.missing_launch_fields || '');
  const spRef = String(r.source_ref || '').match(/Service-Public:([FN]\d+)/);
  const derived = !has(r.official_source) && spRef ? `https://www.service-public.fr/particuliers/vosdroits/${spRef[1]}` : null;   // the DILA reference of the record itself
  let source = has(r.official_source) ? (/^https?:\/\//.test(r.official_source) ? r.official_source : `https://${r.official_source}`) : derived;
  // PKG-5: candidate official pages from the automated web research (ws2-source-candidates.v1.json) replace a missing or non-accepted source; their findings become checks
  const best = cand?.candidates?.[0]?.url || null;
  if (best && (!source || !evidenceUrlAllowed(source))) source = best;
  let group; let next; const check = [];
  if (/BLOCKING/.test(findings) || has(privacy) || has(missing)) {
    group = 'E_BLOQUANT'; next = 'Corriger la fiche avant toute vérification (mettre en attente avec le motif).';
    if (has(privacy)) check.push('Retirer l’adresse e-mail nominative (donnée personnelle) de la fiche publique.');
    if (has(missing)) check.push(`Compléter : ${missing.replace(/\|/g, ', ')}.`);
    if (/BLOCKING/.test(findings)) check.push('Lever les constats bloquants indiqués.');
  } else if (/CONTRADICTION|INCONSISTENT_SCOPE|DUPLICATE_CONCEPT/.test(status) || /TERRITORY_|NO_SERVICE_PUBLIC_SOURCE/.test(findings)) {
    group = 'C_A_TRANCHER'; next = 'Trancher l’incohérence : corriger la fiche puis vérifier, ou refuser. Ne pas vérifier en l’état.';
    check.push('Lire le constat de recherche et la source officielle ; corriger le contenu publié qui la contredit.');
  } else if (r.dataset === 'structures' && (/IDENTITY_REGISTER|postcode differs/.test(status) || /POSSIBLE_DUPLICATE/.test(findings))) {
    group = 'D_IDENTITE'; next = 'Confirmer l’identité, l’adresse et l’activité sur une source officielle ou le site de la structure ; vérifier, ou mettre en attente.';
    if (/POSSIBLE_DUPLICATE/.test(findings)) check.push('Même adresse qu’une autre fiche : vérifier qu’il ne s’agit pas d’un doublon.');
    if (/postcode differs/.test(status)) check.push('Le code postal diffère de la source : le corriger si besoin.');
  } else if (/MISSING_INFO/.test(status) || !source) {
    group = 'B_A_RECHERCHER'; next = 'Trouver la source officielle ; si elle n’existe pas, mettre en attente.';
  } else {
    group = 'A_PRET'; next = 'Comparer chaque information publiée avec la source officielle, puis « Vérifié » (ou corriger).';
  }
  if (cand?.notFound) { group = group === 'A_PRET' ? 'B_A_RECHERCHER' : group; check.push(`Aucune page officielle trouvée automatiquement (${String(cand.searched || '').slice(0, 160)}).`); }
  for (const c of (cand?.candidates || []).slice(0, 2)) for (const d of (c.discrepancies || []).slice(0, 3)) check.push(`À vérifier (recherche automatique) : ${d}`);
  if (cand?.confidence) check.push(`Confiance de la recherche automatique : ${cand.confidence}.`);
  if (derived) check.push('Source : la fiche Service-Public de référence (identifiant DILA du dossier) — la recherche ne l’a pas encore relue : comparer montants, conditions et démarches.');
  if (has(r.human_validation)) {
    check.push('Vérifier chaque information publiée sur la source officielle, et relire le texte en français facile (FALC).');
    if (/privacy decision on contact e-mail/.test(r.human_validation)) check.push('Décider si l’adresse e-mail de contact peut être publiée (préférer une adresse générique de la structure).');
  }
  check.push('Confirmer que l’aide / la démarche / la structure s’applique bien à Strasbourg / au Bas-Rhin.');
  const sourceAccepted = source ? evidenceUrlAllowed(source) : false;
  if (source && !sourceAccepted) check.push('Cette source n’est pas dans la liste des sources officielles acceptées : utiliser une page d’un site public (service-public.fr, caf.fr, ameli.fr, *.gouv.fr…) ou faire ajouter le domaine par ADA (ADA_VERIFICATION_EXTRA_DOMAINS).');
  return { group, next, check, sourceUrl: source, sourceAccepted, isResearchOnly: true };
}

export function readCandidates(root = process.cwd()) {
  try { return new Map(JSON.parse(fs.readFileSync(path.join(root, 'data/strasbourg/ws2-source-candidates.v1.json'), 'utf8')).records.map((c) => [`${c.dataset}:${c.slug}`, c])); } catch { return new Map(); }
}

export async function ws2Queue({ db = defaultDb, root } = {}) {
  const q = readQueue(root); const cands = readCandidates(root);
  const decisions = await latestDecisions(db);
  const records = [];
  for (const r of q.records) {
    const m = TABLE[r.dataset];
    const [row] = m ? (await db.execute(sql`SELECT id, to_jsonb(t) AS j FROM ${sql.raw(`"${m.table}"`)} t WHERE slug = ${r.slug} LIMIT 1`)).rows : [];
    const d = row ? decisions.get(`${m.entityType}:${row.id}`) : null;
    const state = !row ? 'NOT_IN_DATABASE' : !d ? 'PENDING_HUMAN_VERIFICATION' : d.outcome === 'VERIFIED' ? 'HUMAN_VERIFIED' : d.outcome === 'REJECTED' ? 'REJECTED' : d.outcome === 'HOLD' ? 'ON_HOLD' : 'PENDING_HUMAN_VERIFICATION';
    records.push({ dataset: r.dataset, slug: r.slug, title: r.title, entityType: m?.entityType || null, entityId: row?.id || null, state,
      decision: d ? { outcome: d.outcome, at: d.at, source: d.source } : null,
      current: row ? reviewContent(row.j) : [], version: row ? contentVersion(row.j) : null, hold: row?.j?.publication_hold || null, editHold: isEditHold(row?.j?.publication_hold),
      research: { status: r.research_status, officialSourceCandidate: r.official_source || null, findings: r.findings, privacy: r.privacy, humanValidation: r.human_validation },
      preparation: prepare(r, cands.get(`${r.dataset}:${r.slug}`)) });
  }
  const count = (s) => records.filter((x) => x.state === s).length;
  const groups = {}; for (const x of records) if (x.state !== 'HUMAN_VERIFIED') groups[x.preparation.group] = (groups[x.preparation.group] || 0) + 1;
  return { ok: true, derivedFrom: q.derivedFrom, statement: q.statement, groups, totals: { records: records.length, humanVerified: count('HUMAN_VERIFIED'), pending: count('PENDING_HUMAN_VERIFICATION'), rejected: count('REJECTED'), onHold: count('ON_HOLD'), notInDatabase: count('NOT_IN_DATABASE') }, records };
}
