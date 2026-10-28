// @ts-nocheck
/**
 * D13 (owner LAB audit) — the duplicate register of the directory (institution identity).
 *  - candidates: pairs of structures with the same SIRET / RNA / FINESS number (compared without spaces or punctuation: SIRET is unique as written, a duplicate
 *    carries it formatted differently), the same address in the same postal code, or a very similar name (pg_trgm
 *    similarity >= 0.6) in the same postal code — a pair with an active decision is no longer proposed. Detection decides nothing.
 *  - decide: a named MFA administrator records, on INSTITUTIONAL evidence (an https page of an official register: annuaire-entreprises.data.gouv.fr, FINESS,
 *    Journal officiel / RNA, service-public.fr… — the D-5 allow-list), that the two records are the SAME organization (one is kept; the other is put on the
 *    publication hold of the verification ledger, so it leaves the public directory) or DISTINCT. The decision is bound to the content versions read (409 if a
 *    record changed), supersedes the previous decision of the pair (nothing is deleted), and is journalised. Records are never merged automatically: moving
 *    information from one record to the other is an ordinary, versioned catalogue edit.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, StructureDuplicateDecision } from '../../src/db/schema.js';
import { contentVersion, evidenceUrlAllowed, recordVerification, reviewContent, rowJson } from './content-verification.js';

const bad = (status, code, message) => ({ ok: false, status, code, message });
const ordered = (x, y) => (String(x) < String(y) ? [String(x), String(y)] : [String(y), String(x)]);
export const DUPLICATE_HOLD = 'Doublon (registre des doublons)';

// Owner LAB audit (2026-10-25): a pair proposed only for close names must still be close AFTER the prefix the two names share — the agencies of one network
// (« Agence France Travail STRASBOURG MEINAU » / « … DANUBE ») share a long prefix that made pg_trgm call them similar. An identifier or the same address still
// proposes the pair whatever the names.
const nameTokens = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const trigrams = (s) => { const p = `  ${s} `; const out = new Set(); for (let i = 0; i < p.length - 2; i += 1) out.add(p.slice(i, i + 3)); return out; };
const trigramSimilarity = (x, y) => { const a = trigrams(x); const b = trigrams(y); let both = 0; for (const g of a) if (b.has(g)) both += 1; return both / ((a.size + b.size - both) || 1); };
export function distinctivePartsClose(nameA, nameB) {
  const ta = nameTokens(nameA); const tb = nameTokens(nameB); let i = 0;
  while (i < ta.length && i < tb.length && ta[i] === tb[i]) i += 1;
  const ra = ta.slice(i).join(' '); const rb = tb.slice(i).join(' ');
  if (!ra || !rb) return true;   // one name is the other plus words (« Mission locale pour l'emploi » / « … de Strasbourg »): kept
  return trigramSimilarity(ra, rb) >= 0.5;
}

export async function candidates({ db = defaultDb, limit = 100 } = {}) {
  const rows = (await db.execute(sql`
    WITH s AS (SELECT id, nom, code_postal AS cp, ville, regexp_replace(lower(coalesce(adresse, '')), '[^a-z0-9]+', '', 'g') AS addr,
        nullif(regexp_replace(coalesce(siret, ''), '[^0-9]', '', 'g'), '') AS siret, nullif(upper(regexp_replace(coalesce(rna_id, ''), '[^0-9A-Za-z]', '', 'g')), '') AS rna,
        nullif(regexp_replace(coalesce(numero_finess, ''), '[^0-9A-Za-z]', '', 'g'), '') AS finess, verification_status AS vs, publication_hold IS NOT NULL AS held FROM "Structure")   -- the same number written differently (spaces, dots)
    SELECT a.id AS a, b.id AS b, a.nom AS "nomA", b.nom AS "nomB", a.ville AS "villeA", b.ville AS "villeB",
      (a.siret IS NOT NULL AND a.siret = b.siret) AS "sameSiret", (a.rna IS NOT NULL AND a.rna = b.rna) AS "sameRna", (a.finess IS NOT NULL AND a.finess = b.finess) AS "sameFiness",
      (a.addr <> '' AND a.addr = b.addr AND a.cp IS NOT DISTINCT FROM b.cp) AS "sameAddress", round(similarity(coalesce(a.nom, ''), coalesce(b.nom, ''))::numeric, 2) AS "nameSimilarity",
      a.vs AS "decisionA", b.vs AS "decisionB", a.held AS "heldA", b.held AS "heldB"
    FROM s a JOIN s b ON a.id < b.id AND ((a.siret IS NOT NULL AND a.siret = b.siret) OR (a.rna IS NOT NULL AND a.rna = b.rna) OR (a.finess IS NOT NULL AND a.finess = b.finess)
      OR (a.addr <> '' AND a.addr = b.addr AND a.cp IS NOT DISTINCT FROM b.cp) OR (a.cp = b.cp AND similarity(coalesce(a.nom, ''), coalesce(b.nom, '')) >= 0.6))
    WHERE NOT EXISTS (SELECT 1 FROM "StructureDuplicateDecision" d WHERE d."structureA" = a.id AND d."structureB" = b.id AND d."supersededAt" IS NULL)
    ORDER BY 7 DESC, 8 DESC, 9 DESC, 10 DESC, 11 DESC LIMIT ${Math.min(Number(limit) || 100, 200)}`)).rows;
  const kept = rows.filter((r) => r.sameSiret || r.sameRna || r.sameFiness || r.sameAddress || distinctivePartsClose(r.nomA, r.nomB));
  return { ok: true, candidates: kept };
}

/** Both records in full (what the reviewer compares) with their versions, and the decisions of the pair (active and superseded). */
export async function readPair(x, y, { db = defaultDb } = {}) {
  const [a, b] = ordered(x, y);
  if (a === b) return bad(400, 'SAME_RECORD', 'Choisissez deux fiches différentes.');
  const ja = await rowJson(db, 'structure', a); const jb = await rowJson(db, 'structure', b);
  if (!ja || !jb) return bad(404, 'not_found', 'Fiche introuvable.');
  const view = (j) => ({ id: j.id, nom: j.nom, statut: j.statut, verification: j.verification_status || null, hold: j.publication_hold || null, content: reviewContent(j), version: contentVersion(j) });
  const decisions = (await db.execute(sql`SELECT id, decision, "primaryId", "evidenceUrl", note, "reviewerId", "decidedAt", "supersededAt" FROM "StructureDuplicateDecision"
    WHERE "structureA" = ${a} AND "structureB" = ${b} ORDER BY "decidedAt" DESC LIMIT 20`)).rows;
  return { ok: true, a: view(ja), b: view(jb), decisions };
}

/**
 * @param {{ a: string, b: string, decision: 'SAME_ENTITY' | 'DISTINCT', primaryId?: string, evidenceUrl: string, note: string, versionA: string, versionB: string }} input
 * @param {string} reviewer named MFA administrator (the handler enforces the session)
 */
/** @param {any} input @param {string} reviewer @param {{ db?: any, env?: any, role?: string, trustedDomains?: string[] }} [deps] role « system »: the automatic verification chain (same SIRET / same Annuaire office) */
export async function decide(input, reviewer, { db = defaultDb, env = process.env, role = 'admin', trustedDomains = [] } = {}) {
  const [a, b] = ordered(input?.a, input?.b);
  const swapped = String(input?.a) !== a;
  const versionA = String((swapped ? input?.versionB : input?.versionA) || ''); const versionB = String((swapped ? input?.versionA : input?.versionB) || '');
  const decision = String(input?.decision || '');
  if (!a || !b || a === b) return bad(400, 'PAIR_REQUIRED', 'Choisissez deux fiches différentes.');
  if (!['SAME_ENTITY', 'DISTINCT'].includes(decision)) return bad(400, 'INVALID_DECISION', 'Décision : même organisation ou organisations distinctes.');
  const primaryId = decision === 'SAME_ENTITY' ? String(input?.primaryId || '') : null;
  if (decision === 'SAME_ENTITY' && ![a, b].includes(primaryId)) return bad(400, 'PRIMARY_REQUIRED', 'Indiquez la fiche à conserver.');
  const evidenceUrl = String(input?.evidenceUrl || '').trim();
  if (!evidenceUrlAllowed(evidenceUrl, env, trustedDomains)) return bad(400, 'EVIDENCE_URL_NOT_ALLOWED', 'La preuve doit être une page https d’un registre ou d’un site officiel (annuaire des entreprises, FINESS, Journal officiel, service-public…).');
  const note = String(input?.note || '').trim();
  if (note.length < 10) return bad(400, 'NOTE_REQUIRED', 'Indiquez ce que la source établit (au moins 10 caractères).');
  if (!/^[0-9a-f]{64}$/.test(versionA) || !/^[0-9a-f]{64}$/.test(versionB)) return bad(400, 'VERSION_REQUIRED', 'Relisez les deux fiches avant de décider.');
  return db.transaction(async (tx) => {
    const locked = (await tx.execute(sql`SELECT id, nom FROM "Structure" WHERE id IN (${a}, ${b}) ORDER BY id FOR UPDATE`)).rows;
    if (locked.length !== 2) return bad(404, 'not_found', 'Fiche introuvable.');
    if (contentVersion(await rowJson(tx, 'structure', a)) !== versionA || contentVersion(await rowJson(tx, 'structure', b)) !== versionB) {
      return bad(409, 'STALE_REVIEW', 'Une des fiches a changé depuis votre lecture : rechargez la paire et relisez-la.');
    }
    const superseded = (await tx.execute(sql`UPDATE "StructureDuplicateDecision" SET "supersededAt" = NOW() WHERE "structureA" = ${a} AND "structureB" = ${b} AND "supersededAt" IS NULL RETURNING id`)).rows.length;
    const [row] = await tx.insert(StructureDuplicateDecision).values({ structureA: a, structureB: b, decision, primaryId, evidenceUrl, note: note.slice(0, 1000), reviewerId: reviewer, versionA, versionB }).returning({ id: StructureDuplicateDecision.id });
    let held = null;
    if (decision === 'SAME_ENTITY') {
      held = primaryId === a ? b : a;
      const primary = locked.find((r) => r.id === primaryId);
      const r = await recordVerification({ entityType: 'structure', entityId: held, action: 'HOLD', holdReason: `${DUPLICATE_HOLD} : même organisation que « ${primary?.nom || primaryId} »`, reviewer: { id: reviewer, role } }, { db: tx });
      if (!r.ok) throw Object.assign(new Error('duplicate hold failed'), { code: r.code });
    }
    await tx.insert(AuditLog).values({ action: 'STRUCTURE_DUPLICATE_DECIDED', actor: reviewer, actor_id: reviewer, entity: 'Structure', entity_id: `${a}|${b}`,
      details: { decision, primaryId, held, evidenceUrl, superseded, decisionId: row.id }, ip_hash: role === 'system' ? 'SYSTEM_VEILLE' : 'ADMIN_MFA' });
    return { ok: true, status: 200, decision: { id: row.id, decision, primaryId, held, superseded } };
  });
}
