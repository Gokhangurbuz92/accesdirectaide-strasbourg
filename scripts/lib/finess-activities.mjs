/**
 * R36 — the bounded FINESS activity import (owner machine only, never served). It adds to the directory records made from FINESS the social and medico-social
 * activities the register records as authorized and exercised (finess.js activityServices, official labels) — and nothing else:
 *  - only records whose source is the FINESS register, matched by their FINESS number (never by name); a number found twice, in the register or in the
 *    directory, is rejected, not guessed;
 *  - only records already published and verified (statut actif, VERIFIED, launch_eligible, no hold): a suspended, archived, draft or held record is left as
 *    it is, and the import never publishes, withdraws, creates or deletes a record;
 *  - only the `services` field changes (plus updatedBy / updatedAt and the verification bookkeeping that records the evidence): name, address, telephone,
 *    e-mail, hours and status are never written;
 *  - services written by a person are never overwritten: a record whose services differ and were last written by someone other than the veille or this
 *    import is a conflict, reported and left as it is;
 *  - an authorized activity is not an admission or a free place: the labels say what FINESS authorizes, nothing more (the record texts already say so).
 * Each change is one transaction: row locked, the exact prior version kept (EntityVersion, reversible), the field written, a VERIFY in the ledger whose
 * evidence names the register file, its date and its SHA-1 (the provenance of the labels), the same decision in the administration journal.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { arrayElements, gzipText, activityServices } from '../../api/_services/verification/finess.js';

export const IMPORTER = Object.freeze({ id: 'ada-finess-activites', role: 'system' });
export const SYSTEM_WRITERS = new Set(['ada-veille-automatique', IMPORTER.id]);
const FINESS_SOURCE = 'https://finess.esante.gouv.fr/';

/**
 * The activities of each establishment in « FINESS - Activités »; an establishment number listed twice with different activities is ambiguous.
 * @param {string} file @returns {Promise<{ byFiness: Map<string, string[]>, ambiguous: Set<string>, entries: number }>}
 */
export async function readActivities(file) {
  const byFiness = new Map(); const ambiguous = new Set(); let entries = 0;
  for await (const pm of arrayElements(gzipText(file), 'pmej')) {
    for (const g of pm.ege || []) {
      const num = String(g.numFinessEge || ''); if (!num) continue;
      entries += 1;
      const sv = activityServices(g);
      if (byFiness.has(num) && JSON.stringify(byFiness.get(num)) !== JSON.stringify(sv)) ambiguous.add(num);
      byFiness.set(num, sv);
    }
  }
  return { byFiness, ambiguous, entries };
}

const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

/** the records the import may consider: those made from the FINESS register (the only SELECT on content it makes) */
export async function finessRows(db) {
  return (await db.execute(sql`SELECT id, nom, numero_finess, source_url, statut, verification_status, launch_eligible, publication_hold, data_origin, services, "updatedBy" AS updated_by
    FROM "Structure" WHERE numero_finess IS NOT NULL AND source_url LIKE ${`${FINESS_SOURCE}%`} ORDER BY numero_finess, id`)).rows;
}

/** counts for the before / after lines: statut actif is the published state of a structure */
export async function finessCounts(db) {
  return (await db.execute(sql`SELECT count(*)::int AS records, count(*) FILTER (WHERE cardinality(services) > 0)::int AS with_services,
    count(*) FILTER (WHERE statut = 'actif')::int AS published, count(*) FILTER (WHERE statut = 'actif' AND cardinality(services) > 0)::int AS published_with_services,
    coalesce(sum(cardinality(services)), 0)::int AS activity_labels
    FROM "Structure" WHERE numero_finess IS NOT NULL AND source_url LIKE ${`${FINESS_SOURCE}%`}`)).rows[0];
}

/**
 * The change set, decided per record from the register and the record (pure). Categories:
 *  add / update / remove   the change the apply makes (remove: activities the veille or this import wrote that the register no longer lists)
 *  unchanged               already equal (a second run changes nothing)
 *  noActivity              the register lists no social activity for it: nothing to add, the record is kept as it is
 *  held                    not published and verified, or held: left as it is (suspended, archived, draft, hold, unverified)
 *  conflict                services written by a person that differ from the register: left as it is, for a person to decide
 *  rejected                not matched safely: number twice, absent from the register, closed, out of scope or of another territory
 * @param {{ rows: any[], register: Map<string, any>, activities: { byFiness: Map<string, string[]>, ambiguous: Set<string> }, departement?: string }} o
 */
export function planImport({ rows, register, activities, departement = '67' }) {
  const out = { add: [], update: [], remove: [], unchanged: [], noActivity: [], held: [], conflict: [], rejected: [] };
  const seen = new Map(); for (const r of rows) seen.set(r.numero_finess, (seen.get(r.numero_finess) || 0) + 1);
  for (const r of rows) {
    const base = { id: r.id, finess: r.numero_finess, before: [...(r.services || [])] };
    const e = register.get(String(r.numero_finess));
    const reject = seen.get(r.numero_finess) > 1 ? 'DUPLICATE_RECORD' : activities.ambiguous.has(r.numero_finess) ? 'AMBIGUOUS_REGISTER_ENTRY'
      : !e ? 'NOT_IN_REGISTER' : !e.open ? 'CLOSED_IN_REGISTER' : !e.scope ? 'OUT_OF_SCOPE'
        : !String(e.insee || e.code_postal || '').startsWith(departement) ? 'OTHER_TERRITORY' : null;
    if (reject) { out.rejected.push({ ...base, reason: reject }); continue; }
    const hold = r.statut !== 'actif' ? `STATUT_${String(r.statut).toUpperCase()}` : r.verification_status !== 'VERIFIED' ? `VERIFICATION_${r.verification_status}`
      : !r.launch_eligible ? 'NOT_LAUNCH_ELIGIBLE' : r.publication_hold ? 'PUBLICATION_HOLD' : r.data_origin === 'synthetic_fixture' ? 'SYNTHETIC' : null;
    if (hold) { out.held.push({ ...base, reason: hold }); continue; }
    const after = activities.byFiness.get(String(r.numero_finess)) || [];
    if (same(after, base.before)) { out[after.length ? 'unchanged' : 'noActivity'].push(base); continue; }
    if (base.before.length && !SYSTEM_WRITERS.has(r.updated_by)) { out.conflict.push({ ...base, after, reason: 'SERVICES_WRITTEN_BY_A_PERSON' }); continue; }
    const kind = !base.before.length ? 'add' : !after.length ? 'remove' : 'update';
    out[kind].push({ ...base, after });
  }
  return out;
}

/** the fingerprint the apply must be given back: the register files and every planned change (a different register or database state gives another one) */
export function fingerprint(source, plan) {
  const changes = ['add', 'update', 'remove'].flatMap((k) => plan[k].map((c) => [k, c.id, c.finess, c.before, c.after]));
  return crypto.createHash('sha256').update(JSON.stringify({ s: [source.structures.sha1, source.activites.sha1, source.structures.date, source.activites.date], changes })).digest('hex');
}

export const summary = (plan) => Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length]));

/**
 * Write the planned changes, one record per transaction, each re-checked under its row lock (still published, verified, unheld, same services as planned):
 * a record that changed since the dry-run is skipped (counted), never forced. Stops at the first database error: the result says what was committed.
 * @param {{ db: any, plan: any, source: any, recordVerification: Function, snapshotRow: Function, trustedDomains?: Set<string>, env?: any, now?: () => Date }} o
 */
export async function applyPlan({ db, plan, source, recordVerification, snapshotRow, trustedDomains, env = process.env, now = () => new Date() }) {
  const done = []; const skipped = []; let failure = null;
  const file = `fichier « ${source.activites.title} » du ${source.activites.date} (SHA-1 ${source.activites.sha1}, data.gouv.fr, ${source.activites.publisher || 'publié par le ministère de la Santé'})`;
  for (const kind of ['add', 'update', 'remove']) {
    for (const c of plan[kind]) {
      try {
        const r = await db.transaction(async (tx) => {
          const [cur] = (await tx.execute(sql`SELECT statut, verification_status, launch_eligible, publication_hold, services, numero_finess FROM "Structure" WHERE id = ${c.id} FOR UPDATE`)).rows;
          if (!cur || cur.numero_finess !== c.finess || cur.statut !== 'actif' || cur.verification_status !== 'VERIFIED' || !cur.launch_eligible || cur.publication_hold || !same(cur.services, c.before)) return { skipped: 'CHANGED_SINCE_DRY_RUN' };
          await snapshotRow(tx, 'structure', c.id, 'avant import des activités FINESS', IMPORTER.id);
          await tx.execute(sql`UPDATE "Structure" SET services = ${sql`ARRAY[${sql.join(c.after.map((s) => sql`${s}`), sql`, `)}]::text[]`}, "updatedBy" = ${IMPORTER.id}, "updatedAt" = ${now()} WHERE id = ${c.id}`);
          const evidence = c.after.length
            ? `Activités autorisées et exercées selon le répertoire FINESS, ${file}, établissement ${c.finess} : ${c.after.join(' ; ')}. Une activité autorisée ne dit ni les places libres ni l’admission.`
            : `Activités retirées : le répertoire FINESS (${file}) ne liste plus d’activité sociale ou médico-sociale active pour l’établissement ${c.finess}.`;
          const v = await recordVerification({ entityType: 'structure', entityId: c.id, action: 'VERIFY', reviewer: IMPORTER, sourceUrl: `https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFinesset=${encodeURIComponent(c.finess)}`,
            evidenceNote: evidence.slice(0, 2000), territoryConfirmed: true }, { db: tx, env, trustedDomains, now: now() });
          if (!v.ok) throw Object.assign(new Error(`VERIFY refused: ${v.code}`), { refused: v.code });
          return { ok: true };
        });
        if (r.skipped) skipped.push({ id: c.id, finess: c.finess, reason: r.skipped }); else done.push({ kind, id: c.id, finess: c.finess, labels: c.after.length });
      } catch (e) {
        failure = { id: c.id, finess: c.finess, kind, message: String(e?.refused || e?.code || e?.message || e).slice(0, 300) };
        return { ok: false, done, skipped, failure };
      }
    }
  }
  return { ok: true, done, skipped, failure };
}
