// @ts-nocheck
/**
 * Automatic verification chain — the self-check of what is public (owner decision D-5 v2, 2026-10-25): the contract every published record must satisfy,
 * checked at the end of every run on the database itself, whoever or whatever published the record.
 *
 *  LEDGER     a public record has a VERIFIED decision in the append-only ledger (ContentVerification), by a named reviewer or by « ada-veille-automatique »;
 *  EVIDENCE   the evidence of that decision is an https address of an official source (allow-list or registry of sources);
 *  PRIVACY    a public organization shows no personal e-mail address of an employee (contacts.js);
 *  FRESHNESS  a record the system verified was checked again within its interval (+ two days): otherwise the veille is not running as it should (an alert,
 *             not a withdrawal: the record was right when last checked);
 *  DUPLICATE  two public organizations with the same SIRET or the same Annuaire entry (an alert: the duplicate register decides);
 *  TEXTS      (version 2, R11) texts written by the chain (summary, FALC) are not older than the last important change of the source they were written from:
 *             an old simplified text is never shown as current.
 * LEDGER, EVIDENCE, PRIVACY and TEXTS violations are withdrawn by the chain at once (fail-closed); the others are shown to the owner.
 * The legacy WS2 launch-data test (tests/unit/ws8-frozen-launch-data.test.js: flags in the static seed files) checked human verification of files; under D-5 v2
 * the publication contract is this one, on the live records (tests/unit/d5v2-publication-contract.test.js).
 */
import { sql } from 'drizzle-orm';
import { evidenceUrlAllowed } from '../content-verification.js';
import { nominativeEmail } from './contacts.js';

const KINDS = [
  { kind: 'aide', table: 'Aide', title: 'titre', shown: `statut = 'publie'`, auto: true },
  { kind: 'demarche', table: 'Demarche', title: 'titre', shown: `statut = 'publie'`, auto: true },
  { kind: 'dispositif', table: 'Dispositif', title: 'titre', shown: `statut = 'publie'`, auto: true },
  { kind: 'structure', table: 'Structure', title: 'nom', shown: `statut IN ('actif', 'publie')`, auto: true },
];
export const WITHDRAW_ON = new Set(['LEDGER', 'EVIDENCE', 'PRIVACY', 'TEXTS']);
/** the versioned acceptance contract of public information (D-5 v2): what a release accepts, on the live records — never the legacy WS2 file flags */
export const CONTRACT = Object.freeze({ name: 'D-5 v2 — contrat de publication', version: 2, clauses: ['LEDGER', 'EVIDENCE', 'PRIVACY', 'FRESHNESS', 'DUPLICATE', 'TEXTS'] });

/**
 * @param {{ db: any, env?: any, trusted?: string[], now?: Date, select?: (kind: string, row: any) => boolean }} p
 * @returns {Promise<{ checked: number, byKind: Record<string, number>, violations: { kind: string, id: string, title: string, code: string, detail: string }[] }>}
 */
export async function publicationAudit({ db, env = process.env, trusted = [], now = new Date(), select = () => true }) {
  const out = { contract: `${CONTRACT.name} v${CONTRACT.version}`, checked: 0, byKind: {}, violations: [] };
  const add = (k, row, code, detail) => out.violations.push({ kind: k, id: row.id, title: String(row.title || '').slice(0, 120), code, detail: String(detail).slice(0, 300) });
  for (const k of KINDS) {
    const extra = k.kind === 'structure' ? ', x.email, x.siret, x.source_annuaire' : '';
    const rows = (await db.execute(sql.raw(`SELECT x.id, x.${k.title} AS title, x.verified_by, x.auto_check${extra} FROM "${k.table}" x
      WHERE ${k.shown} AND x.verification_status = 'VERIFIED' AND x.publication_hold IS NULL`))).rows.filter((r) => select(k.kind, r));
    out.byKind[k.kind] = rows.length; out.checked += rows.length;
    if (!rows.length) continue;
    const ids = rows.map((r) => r.id);
    const ledger = new Map((await db.execute(sql`SELECT DISTINCT ON ("entityId") "entityId" AS id, "sourceUrl" AS url, "reviewerId" AS reviewer FROM "ContentVerification"
      WHERE "entityType" = ${k.kind} AND outcome = 'VERIFIED' AND "entityId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY "entityId", "verifiedAt" DESC, id DESC`)).rows.map((r) => [r.id, r]));
    for (const r of rows) {
      const v = ledger.get(r.id);
      if (!v) { add(k.kind, r, 'LEDGER', 'publiée sans décision « vérifiée » dans le registre des vérifications'); continue; }
      if (!v.url || !evidenceUrlAllowed(v.url, env, trusted)) add(k.kind, r, 'EVIDENCE', `preuve hors des sources officielles (${v.url || 'aucune adresse'})`);
      if (k.kind === 'structure' && r.email && nominativeEmail(r.email)) add(k.kind, r, 'PRIVACY', 'adresse électronique personnelle d’un agent affichée');
      const a = r.auto_check;
      if (a?.texts?.at && a?.importantChangeAt && String(a.importantChangeAt).slice(0, 10) > String(a.texts.at).slice(0, 10)) {
        add(k.kind, r, 'TEXTS', `textes rédigés le ${String(a.texts.at).slice(0, 10)}, avant la dernière modification importante de la source (${String(a.importantChangeAt).slice(0, 10)})`);
      }
      if (r.verified_by === 'ada-veille-automatique' && a?.nextCheckAt && new Date(a.nextCheckAt).getTime() + 2 * 86400000 < now.getTime()) {
        add(k.kind, r, 'FRESHNESS', `pas revérifiée depuis le ${String(a.checkedAt || '').slice(0, 10)} (prévu le ${String(a.nextCheckAt).slice(0, 10)})`);
      }
    }
    if (k.kind === 'structure') {
      const seen = new Map();
      for (const r of rows) for (const key of [r.siret ? `SIRET ${String(r.siret).replace(/\D/g, '')}` : null, r.source_annuaire ? `fiche de l’Annuaire ${r.source_annuaire}` : null].filter(Boolean)) {
        if (seen.has(key)) add('structure', r, 'DUPLICATE', `même ${key} que « ${seen.get(key).title} »`); else seen.set(key, r);
      }
    }
  }
  return out;
}
