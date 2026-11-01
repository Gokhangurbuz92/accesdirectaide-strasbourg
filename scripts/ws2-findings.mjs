// DTA S4A — record-level TECHNICAL findings for the WS2 launch data. Read-only, offline, no network.
// This is NOT official-source verification: it cannot confirm that a record is accurate, current or applicable to a territory. It lists, for every record, the technical defects that
// `verify-ws2-data.mjs` would stop at (it throws on the first one), plus provenance-contract and duplicate/privacy hints, so a human validator can work through them.
// `launchReady` here is false while any BLOCKING finding exists AND while the authoritative manifest says so: nothing is promoted by this module.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, truthy } from './verify-ws2-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCH_FIELDS = { aides: ['summary_falc', 'conditions_falc'], demarches: ['summary_falc', 'pour_qui', 'ou_faire', 'etapes'], structures: ['nom', 'adresse', 'summary_falc'] };
const FILES = { aides: 'data/aides-alsace.csv', demarches: 'data/demarches-alsace.csv', structures: 'data/structures-alsace.csv' };
// service mailboxes (« espace-jeunes@ », « antenne-nord@ ») are not person names
const GENERIC_LOCAL = /^(contact|accueil|info|infos|secretariat|direction|mairie|ccas|cidff|bonjour|reception|administration|social|rdv|espace|maison|antenne|pole|service|point|relais|centre)/i;
// Public administrative facts used only to detect internal inconsistency (not to verify a record): the ten départements of the Grand Est region, and statutory regimes that apply nationwide.
const GRAND_EST_DEPARTMENTS = new Set(['08', '10', '51', '52', '54', '55', '57', '67', '68', '88']);
const NATIONAL_REGIMES = new Set(['apl', 'als', 'aah', 'aeeh', 'c2s', 'rsa', 'prime-activite']);
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function spRef(provenance) {
  const id = /Service-Public:([A-Z0-9]+)/.exec(String(provenance ?? ''));
  const sha = /recordSha256=([0-9a-f]{64})/.exec(String(provenance ?? ''));
  return { id: id ? id[1] : null, sha: sha ? sha[1] : null };
}

/** Pure: findings from already-parsed inputs (testable with synthetic fixtures). */
export function findingsFrom({ datasets, snapshotById = {}, manifest = {} }) {
  const out = [];
  const add = (dataset, slug, code, severity, detail) => out.push({ dataset, slug, code, severity, detail });
  for (const [dataset, rows] of Object.entries(datasets)) {
    const seenAddr = new Map();
    for (const r of rows) {
      const slug = String(r.slug ?? '').trim() || '(sans slug)';
      for (const f of LAUNCH_FIELDS[dataset] ?? []) if (!String(r[f] ?? '').trim()) add(dataset, slug, 'REQUIRED_FIELD_EMPTY', 'BLOCKING', f);
      if (!String(r.provenance ?? '').trim()) add(dataset, slug, 'PROVENANCE_EMPTY', 'BLOCKING', 'provenance');
      if (!truthy(r.verifiedCurrent)) add(dataset, slug, 'FLAG_NOT_VERIFIED_CURRENT', 'BLOCKING', 'verifiedCurrent');
      if (!truthy(r.launchEligible)) add(dataset, slug, 'FLAG_NOT_LAUNCH_ELIGIBLE', 'BLOCKING', 'launchEligible');
      if (dataset === 'aides') {
        const terr = norm(r.territoires); const deps = String(r.departements ?? '').split('|').map((d) => d.trim()).filter(Boolean);
        if (NATIONAL_REGIMES.has(slug) && terr !== 'france entière') add(dataset, slug, 'TERRITORY_NATIONAL_REGIME_NARROWED', 'REVIEW', `national statutory regime declared with territory "${String(r.territoires).trim()}" (peers say "France entière")`);
        if (terr === 'grand est' && deps.some((d) => !GRAND_EST_DEPARTMENTS.has(d))) add(dataset, slug, 'TERRITORY_DEPARTMENTS_OUTSIDE_SCOPE', 'REVIEW', `territory "Grand Est" lists ${deps.filter((d) => !GRAND_EST_DEPARTMENTS.has(d)).length} département code(s) outside Grand Est`);
      }
      if (dataset !== 'structures') {
        const ref = spRef(r.provenance);
        if (!ref.id || !ref.sha) add(dataset, slug, 'NO_SERVICE_PUBLIC_SOURCE', 'REVIEW', 'provenance cites no Service-Public identifier/hash');
        else if (!snapshotById[ref.id]) add(dataset, slug, 'SOURCE_ABSENT_FROM_SNAPSHOT', 'BLOCKING', ref.id);
        else if (snapshotById[ref.id].recordSha256 !== ref.sha) add(dataset, slug, 'SOURCE_HASH_MISMATCH', 'BLOCKING', ref.id);
      } else {
        const key = `${norm(r.adresse)}|${norm(r.code_postal)}`;
        if (norm(r.adresse)) seenAddr.set(key, [...(seenAddr.get(key) ?? []), slug]);
        const email = String(r.email ?? '');
        const local = email.includes('@') ? email.split('@')[0] : '';
        if (local && !GENERIC_LOCAL.test(local) && /^[a-z]+[._-][a-z]+$/i.test(local)) add(dataset, slug, 'NOMINATIVE_EMAIL', 'PRIVACY_REVIEW', 'e-mail local part looks like a person name (value not reproduced)');
        // PKG-1 / N1: a French mobile number (06/07, +33 6/7) in a public structure record is probably a person's, not a service line. Hint only; the value is never reproduced.
        const phone = String(r.telephone ?? '').replace(/[\s.\-()]/g, '');
        if (/^(\+33|0033|0)[67]\d{8}$/.test(phone)) add(dataset, slug, 'PERSONAL_PHONE_REVIEW', 'PRIVACY_REVIEW', 'telephone is a mobile number (06/07): confirm it is a service line before publication (value not reproduced)');
      }
    }
    for (const slugs of seenAddr.values()) if (slugs.length > 1) for (const s of slugs) add(dataset, s, 'POSSIBLE_DUPLICATE', 'REVIEW', `same address as ${slugs.length - 1} other record(s)`);
  }
  const blocking = out.filter((f) => f.severity === 'BLOCKING').length;
  return {
    findings: out,
    summary: { blocking, review: out.length - blocking, bySeverity: Object.fromEntries(['BLOCKING', 'REVIEW', 'PRIVACY_REVIEW'].map((k) => [k, out.filter((f) => f.severity === k).length])) },
    launchReady: blocking === 0 && manifest.launchReady === true,
  };
}

export async function collectWs2Findings({ rootDir = ROOT } = {}) {
  const root = path.resolve(rootDir);
  const datasets = {};
  for (const [k, f] of Object.entries(FILES)) datasets[k] = parseCsv(await readFile(path.join(root, f), 'utf8'));
  const snapshot = JSON.parse(await readFile(path.join(root, 'data/strasbourg/service-public-demarches.snapshot.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'data/strasbourg/ws2-source-manifest.json'), 'utf8'));
  return findingsFrom({ datasets, snapshotById: snapshot.byId ?? {}, manifest });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectWs2Findings().then((r) => { process.stdout.write(`${JSON.stringify({ launchReady: r.launchReady, summary: r.summary })}\n`); }).catch((e) => { process.stderr.write(`${e?.message || e}\n`); process.exitCode = 1; });
}
