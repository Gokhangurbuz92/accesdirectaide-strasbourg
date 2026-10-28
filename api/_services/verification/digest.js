// @ts-nocheck
/**
 * Automatic verification chain — what the owner reads (/admin/veille): the state of the veille (running, paused, last and next run), the alerts that matter
 * (only systemic problems and high-impact changes: never a record to validate), what was checked, published, corrected, added, withdrawn and merged, how fresh the
 * public directory is, the registry of sources (monitored, new, left out and why, outages), the texts the checks refused, the machine, the self-check — and,
 * for any record, its whole history from the source to the decision (events, ledger, source versions, content versions).
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../../src/db/index.js';
import { CronRun, VeilleEvent, ContentVerification, SourceSnapshot, EntityVersion } from '../../../src/db/schema.js';
import { pauseState, asUtc } from './control.js';

const iso = (v) => (v ? asUtc(v).toISOString() : null);
const KINDS = [['aide', 'Aide', `statut = 'publie'`], ['demarche', 'Demarche', `statut = 'publie'`], ['dispositif', 'Dispositif', `statut = 'publie'`], ['structure', 'Structure', `statut IN ('actif', 'publie')`]];
const FEEDS = ['dila-service-public', 'annuaire-administration', 'sirene'];
const sumKeys = (counts, re) => Object.entries(counts || {}).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + Number(v || 0), 0);

/** the counts of a set of runs, by what happened and by kind of record */
function periodOf(runs) {
  const c = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.metrics?.counts || {})) c[k] = (c[k] || 0) + Number(v || 0);
  const byKind = {};
  for (const kind of ['aide', 'demarche', 'dispositif', 'structure']) {
    byKind[kind] = { checked: c[`${kind}:checked`] || 0, published: c[`${kind}.PUBLISHED`] || 0, created: c[`${kind}.CREATED`] || 0, updated: (c[`${kind}.UPDATED`] || 0) + (c[`${kind}.CORRECTED`] || 0),
      withdrawn: c[`${kind}.WITHDRAWN`] || 0, retry: (c[`${kind}.RETRY`] || 0) + (c[`${kind}.UNRESOLVED`] || 0), unchanged: c[`${kind}:unchanged`] || 0 };
  }
  return { runs: runs.length, counts: c, byKind,
    checked: sumKeys(c, /^(aide|demarche|dispositif|structure):checked$/), published: sumKeys(c, /:PUBLISHED$/), created: sumKeys(c, /:CREATED$/), updated: sumKeys(c, /:(UPDATED|CORRECTED)$/),
    withdrawn: sumKeys(c, /:WITHDRAWN$/) - (c['DUPLICATE:WITHDRAWN'] || 0), duplicates: c['DUPLICATE:WITHDRAWN'] || 0, retry: sumKeys(c, /:(RETRY|UNRESOLVED)$/),
    textsRefused: c['texts:refused'] || 0, auditWithdrawn: c['AUDIT:WITHDRAWN'] || 0 };
}

/** the alerts that matter (systemic problems, high-impact changes); never a record to validate */
function alertsOf({ runs, pause, feeds, important, now }) {
  const out = [];
  const real = runs.filter((r) => r.job === 'veille' && r.status !== 'skipped');
  const lastDone = real.find((r) => ['success', 'partial', 'stopped'].includes(r.status));
  if (pause.paused) out.push({ code: 'PAUSED', level: 'info', message: `La veille est en pause depuis le ${new Date(pause.since).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}${pause.reason ? ` (${pause.reason})` : ''}.` });
  else if (!lastDone || now - new Date(lastDone.startedAt).getTime() > 48 * 3600000) out.push({ code: 'NO_RUN', level: 'critical', message: lastDone ? `Aucune veille terminée depuis le ${new Date(lastDone.startedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} : le serveur du LAB est-il lancé ?` : 'Aucune veille terminée pour l’instant.' });
  if (real.length >= 2 && real[0].status === 'error' && real[1].status === 'error') out.push({ code: 'RUN_ERRORS', level: 'critical', message: `Les deux dernières veilles se sont arrêtées sur une erreur (${String(real[0].errorSample || '').slice(0, 160)}).` });
  const skipped = runs.find((r) => r.job === 'veille' && r.status === 'skipped' && now - new Date(r.startedAt).getTime() < 24 * 3600000 && r.skipReason !== 'PAUSED');
  if (skipped) out.push({ code: skipped.skipReason, level: 'info', message: `Veille reportée : ${skipped.errorSample}.` });
  for (const f of feeds) if ((f.health?.consecutiveFailures || 0) >= 2) out.push({ code: 'FEED_DOWN', level: 'warning', message: `${f.name} ne répond plus depuis le ${String(f.health.outageSince || '').slice(0, 10)} (${f.health.error || 'sans réponse'}) : les fiches qui en dépendent gardent leur état.` });
  const last = real[0];
  for (const a of last?.metrics?.alerts || []) out.push(a);
  const recent = important.filter((e) => now - new Date(e.createdAt).getTime() < 72 * 3600000);
  if (recent.length) out.push({ code: 'IMPORTANT_CHANGES', level: 'info', message: `${recent.length} changement(s) important(s) de conditions, de montants, de textes juridiques ou de territoire ces trois derniers jours : déjà répercutés sur les fiches (voir « Changements importants »).` });
  return out;
}

/**
 * The owner's dashboard. @param {{ db?: any, days?: number, probe?: Function | null, env?: any }} [opts]
 */
export async function veilleDigest({ db = defaultDb, days = 7, probe = null, env = process.env } = {}) {
  const now = Date.now();
  const since = new Date(now - days * 86400000);
  const runs = await db.select().from(CronRun).where(and(inArray(CronRun.job, ['veille', 'veille-registre']), gte(CronRun.startedAt, since))).orderBy(desc(CronRun.startedAt)).limit(80);
  const veilleRuns = runs.filter((r) => r.job === 'veille' && r.status !== 'skipped' && r.status !== 'running');
  const events = await db.select().from(VeilleEvent).where(gte(VeilleEvent.createdAt, since)).orderBy(desc(VeilleEvent.createdAt)).limit(500);
  const cutoff30 = new Date(now - 30 * 86400000).toISOString();
  const unresolved = (await db.execute(sql`SELECT entity_type, entity_id, max(summary) AS summary, count(*)::int AS times, max(created_at) AS last, max(details->>'title') AS title FROM "VeilleEvent"
    WHERE outcome IN ('UNRESOLVED', 'RETRY') AND created_at > ${cutoff30} AND entity_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) >= 3 ORDER BY 5 DESC LIMIT 50`)).rows.map((r) => ({ ...r, last: iso(r.last) }));
  const totals = []; const freshness = [];
  for (const [kind, table, shown] of KINDS) {
    const [t] = (await db.execute(sql.raw(`SELECT count(*) FILTER (WHERE ${shown} AND verification_status = 'VERIFIED' AND publication_hold IS NULL)::int AS published, count(*)::int AS total,
      count(*) FILTER (WHERE publication_hold LIKE 'Veille automatique%')::int AS "withdrawnBySystem", count(*) FILTER (WHERE publication_hold IS NOT NULL)::int AS held,
      count(*) FILTER (WHERE verified_by = 'ada-veille-automatique')::int AS "verifiedBySystem", count(*) FILTER (WHERE falc_origin = 'AI_LOCAL')::int AS "aiTexts" FROM "${table}"`))).rows;
    totals.push({ kind, ...t });
    const [f] = (await db.execute(sql.raw(`SELECT count(*)::int AS public, count(*) FILTER (WHERE (auto_check->>'checkedAt') > '${new Date(now - 48 * 3600000).toISOString()}')::int AS "within48h",
      count(*) FILTER (WHERE (auto_check->>'checkedAt') > '${new Date(now - 8 * 86400000).toISOString()}')::int AS "within8d", min(auto_check->>'checkedAt') AS oldest
      FROM "${table}" WHERE ${shown} AND verification_status = 'VERIFIED' AND publication_hold IS NULL`))).rows;
    freshness.push({ kind, ...f });
  }
  // the registry of sources
  const reg = (await db.execute(sql`SELECT source_id AS "sourceId", name, level, status, connector_class AS cls, capabilities, trusted_domains AS domains, health, created_at AS "createdAt", last_change_at AS "lastChangeAt",
    content_version AS version, successor_source_id AS successor, attestation, attestation_url AS "attestationUrl" FROM "SourceRegistryEntry"`)).rows;
  const by = (key) => { const m = new Map(); for (const r of reg) { const k = r[key] || '—'; const e = m.get(k) || { [key === 'cls' ? 'cls' : 'level']: k, active: 0, total: 0 }; e.total += 1; if (r.status === 'ACTIVE') e.active += 1; m.set(k, e); } return [...m.values()]; };
  const feeds = FEEDS.map((id) => reg.find((r) => r.sourceId === id)).filter(Boolean).map((r) => ({ sourceId: r.sourceId, name: r.name, health: r.health, version: r.version, lastChangeAt: iso(r.lastChangeAt) }));
  const lastRegistry = runs.find((r) => r.job === 'veille-registre') || (await db.select().from(CronRun).where(eq(CronRun.job, 'veille-registre')).orderBy(desc(CronRun.startedAt)).limit(1))[0] || null;
  const rejected = [...(lastRegistry?.metrics?.rejected || []), ...(lastRegistry?.metrics?.online?.rejected || [])];
  const sources = {
    active: reg.filter((r) => r.status === 'ACTIVE').length, total: reg.length, byLevel: by('level'), byClass: by('cls'),
    newSince: reg.filter((r) => asUtc(r.createdAt) >= since).length,
    newest: reg.filter((r) => asUtc(r.createdAt) >= since).sort((a, b) => asUtc(b.createdAt) - asUtc(a.createdAt)).slice(0, 12).map((r) => ({ name: r.name, level: r.level, cls: r.cls, attestation: r.attestation, attestationUrl: r.attestationUrl })),
    paused: reg.filter((r) => ['PAUSED', 'ERROR'].includes(r.status)).slice(0, 30).map((r) => ({ name: r.name, status: r.status, health: r.health, successor: r.successor })),
    retired: reg.filter((r) => r.status === 'DISABLED').length,
    feeds, rejectedCount: (lastRegistry?.metrics?.rejectedCount || 0) + (lastRegistry?.metrics?.online?.rejectedCount || 0), rejected: rejected.slice(0, 40),
    lastRefresh: lastRegistry ? iso(lastRegistry.startedAt) : null, nextRefresh: lastRegistry ? new Date(asUtc(lastRegistry.startedAt).getTime() + 7 * 86400000).toISOString() : null,
    reviewedLast30d: reg.filter((r) => r.health?.reviewedAt && now - new Date(r.health.reviewedAt).getTime() < 30 * 86400000).length,
  };
  const important = events.filter((e) => e.kind === 'CHANGE' && (e.details?.change?.important || e.details?.legal || e.details?.coverage || e.details?.territorial))
    .slice(0, 40).map((e) => ({ id: e.id, entityType: e.entityType, entityId: e.entityId, title: e.details?.title || '', summary: e.summary, createdAt: e.createdAt, legal: Boolean(e.details?.legal), territorial: Boolean(e.details?.coverage || e.details?.territorial) }));
  const textsRejected = events.filter((e) => e.kind === 'TEXTS' && e.details?.reasons).slice(0, 25).map((e) => ({ id: e.id, entityType: e.entityType, entityId: e.entityId, title: e.details?.title || '', reasons: (e.details.reasons || []).slice(-3), createdAt: e.createdAt }));
  const pause = await pauseState(db);
  const running = runs.find((r) => r.job === 'veille' && r.status === 'running') || null;
  const lastRun = runs.find((r) => r.job === 'veille' && !['running', 'skipped'].includes(r.status)) || null;
  const lastAudit = veilleRuns.find((r) => r.metrics?.audit)?.metrics?.audit || null;
  const live = probe ? await probe({ env }).catch(() => null) : null;
  const machine = { live, lastRun: lastRun?.metrics?.health || null, model: lastRun?.metrics?.model || null };
  return {
    status: { paused: pause, running: running ? { id: running.id, startedAt: running.startedAt, heartbeatAt: running.updatedAt, progress: running.metrics?.progress || null, counts: running.metrics?.counts || null } : null, lastRun },
    alerts: alertsOf({ runs, pause, feeds, important, now }),
    period: { days, ...periodOf(veilleRuns) }, totals, freshness, sources, important, textsRejected, unresolved, audit: lastAudit, machine,
    runs, events,
    sourcesByLevel: sources.byLevel,   // the earlier shape of the page
  };
}

const TABLE = { aide: 'Aide', demarche: 'Demarche', dispositif: 'Dispositif', structure: 'Structure' };
/**
 * The history of one record, from its sources to the decisions: what the veille did (events), the ledger, the versions of its official source, the versions of
 * its content (each one can be restored from the « Versions » page). @param {{ db?: any, type: string, id: string }} p
 */
export async function recordHistory({ db = defaultDb, type, id }) {
  const table = TABLE[type]; if (!table || !id) return null;
  const titleCol = type === 'structure' ? 'nom' : 'titre';
  const [record] = (await db.execute(sql`SELECT id, ${sql.raw(`"${titleCol}"`)} AS title, statut, verification_status AS "verificationStatus", verified_by AS "verifiedBy", publication_hold AS hold, source_url AS "sourceUrl",
    falc_origin AS "falcOrigin", auto_check AS "autoCheck", "updatedAt" FROM ${sql.raw(`"${table}"`)} WHERE id = ${String(id)}`)).rows;
  if (!record) return null;
  const events = await db.select().from(VeilleEvent).where(and(eq(VeilleEvent.entityType, type), eq(VeilleEvent.entityId, String(id)))).orderBy(desc(VeilleEvent.createdAt)).limit(100);
  const ledger = await db.select({ id: ContentVerification.id, outcome: ContentVerification.outcome, reviewerId: ContentVerification.reviewerId, reviewerRole: ContentVerification.reviewerRole,
    sourceUrl: ContentVerification.sourceUrl, evidenceNote: ContentVerification.evidenceNote, createdAt: ContentVerification.createdAt })
    .from(ContentVerification).where(and(eq(ContentVerification.entityType, type), eq(ContentVerification.entityId, String(id)))).orderBy(desc(ContentVerification.createdAt)).limit(100);
  const snaps = await db.select().from(SourceSnapshot).where(and(eq(SourceSnapshot.entity_type, type), eq(SourceSnapshot.entity_id, String(id)))).orderBy(desc(SourceSnapshot.fetched_at)).limit(30);
  const snapshots = snaps.map((s) => { let x = {}; try { x = JSON.parse(s.raw_excerpt || '{}'); } catch { x = {}; }
    return { id: s.id, fetchedAt: s.fetched_at, url: s.final_url, fingerprint: s.content_hash, title: x.title || null, importantChangeAt: x.importantChangeAt || null, coverage: x.coverage || null, facts: x.facts || null, references: (x.references || []).length }; });
  const versions = await db.select({ id: EntityVersion.id, reason: EntityVersion.reason, actor: EntityVersion.actor_email, createdAt: EntityVersion.createdAt })
    .from(EntityVersion).where(and(eq(EntityVersion.entity_type, table), eq(EntityVersion.entity_id, String(id)))).orderBy(desc(EntityVersion.createdAt)).limit(30);
  return { type, record: { ...record, updatedAt: iso(record.updatedAt) }, events, ledger, snapshots, versions };
}
