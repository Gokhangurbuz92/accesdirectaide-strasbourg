/**
 * RA-09 — the operations documents follow the code. Every repository path they cite (scripts, API files, workflows, ops, migrations) exists; every npm
 * script that runs a file points at a file that exists (`db:baseline:rdv` pointed at a script that was never there); the runbook has the sections an
 * operator needs; and statements that the code contradicted are gone.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const DOCS = ['docs/runbooks.md', 'docs/deployment.md', 'docs/security.md', 'docs/monitoring.md', 'docs/disaster-recovery.md', 'docs/database.md', 'docs/ops/EXTERNAL_WATCHDOG.md', 'ops/cloud-backup/README.md'];
const read = (f) => fs.readFileSync(f, 'utf8');
/** repository paths cited in back-ticks: `scripts/x.mjs`, `api/_utils/y.js`, `.github/workflows/z.yml`, `ops/…`, `drizzle/…`, `docs/…`, `src/…`, `config/…` */
const cited = (text) => [...text.matchAll(/`((?:scripts|api|\.github|ops|drizzle|docs|src|config|tests)\/[A-Za-z0-9_./-]+\.[a-z]{2,5}(?:\.proposed)?)`/g)].map((m) => m[1]).filter((p) => !/[<>*]|NNNN/.test(p));

describe('RA-09 operations documents match the code', () => {
  it.each(DOCS)('%s cites only files that exist', (doc) => {
    const text = read(doc);
    // a path named as ABSENT on purpose (« n'existe pas », « does not exist ») is written without back-ticks around a repository path, except the two below
    const allowedAbsent = new Set(['.github/workflows/healthcheck.yml']);   // the activation target of the proposed watchdog (docs/ops/EXTERNAL_WATCHDOG.md)
    const missing = [...new Set(cited(text))].filter((p) => !fs.existsSync(p) && !allowedAbsent.has(p));
    expect(missing).toEqual([]);
  });

  it('every npm script that runs a repository file points at a file that exists', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    const broken = [];
    for (const [name, cmd] of Object.entries(scripts)) for (const m of String(cmd).matchAll(/(?:^|\s)((?:scripts|tests|api|ops)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|sh))\b/g)) if (!fs.existsSync(m[1])) broken.push(`${name} → ${m[1]}`);
    expect(broken).toEqual([]);
    expect(scripts['db:baseline:rdv']).toBeUndefined();
  });

  it('the runbook has the operator sections: cloud restore, release rollback, GDPR purge, breach register, failing job', () => {
    const rb = read('docs/runbooks.md');
    for (const h of [/^## 9\. Restaurer depuis les sauvegardes cloud/m, /^## 10\. Retour arrière d'une version \(`scripts\/release-production\.sh`\)/m, /^## 11\. Purge RGPD/m,
      /^## 12\. Registre des violations de données/m, /^## 13\. Une tâche planifiée échoue ou ne tourne plus/m]) expect(rb).toMatch(h);
    expect(rb).toMatch(/cloud-restore-verify\.mjs --confirm-target <hôte>\/<base> --keep-restored/);
    expect(rb).toMatch(/vercel rollback/); expect(rb).toMatch(/code \*\*4\*\*/); expect(rb).toMatch(/code \*\*5\*\*/);
    expect(rb).toMatch(/GDPR_PURGE_ENABLED=true/); expect(rb).toMatch(/GDPR_PURGE_POLICY_VERSION/); expect(rb).toMatch(/GDPR_PURGE_APPROVED_STEPS/);
    expect(rb).toMatch(/incident-register-validate\.mjs/); expect(rb).toMatch(/72 h/);
    expect(rb).toMatch(/job\.failed\.<tâche>/); expect(rb).toMatch(/job\.stale\.<tâche>/);
  });

  it('the release script still behaves as the runbook says (exit 4 after an automatic rollback, exit 5 with the rollback command)', () => {
    const sh = read('scripts/release-production.sh');
    expect(sh).toMatch(/\$VERCEL rollback "\$PREV" --yes\nexit 4/);
    expect(sh).toMatch(/restore it with: \$VERCEL rollback \\"\$PREV\\" --yes"\n\s*exit 5/);
  });

  it('statements the code contradicts are gone', () => {
    const rb = read('docs/runbooks.md'); const dep = read('docs/deployment.md'); const mon = read('docs/monitoring.md');
    expect(rb).not.toMatch(/`ALERT_WEBHOOK_URL` \(obligatoire/);
    expect(rb).toMatch(/`ALERT_WEBHOOK_URL` \(https\) \*\*ou\*\* `ALERT_EMAIL`/);
    expect(read('scripts/release-preflight.mjs')).toMatch(/ALERT_WEBHOOK_URL \(https\) or ALERT_EMAIL with a real mail provider/);
    expect(dep).not.toMatch(/toutes les 5 minutes \(`\/api\/cron\/health-alert`\)|n'est pas planifiée|deploy\.yml|db-migrate-deploy\.yml|Semgrep/);
    expect(mon).not.toMatch(/every 5 minutes|docs\/incidents\.md|Slack channel/);
    for (const d of [rb, dep, mon]) expect(d).not.toMatch(/le flux `healthcheck\.yml` \(toutes les 30 minutes\) passe au vert|`\.github\/workflows\/healthcheck\.yml`, toutes les 30 minutes/);
    // what the documents now say is what vercel.json says
    const crons = JSON.parse(read('vercel.json')).crons;
    expect(crons.find((c) => c.path === '/api/cron/veille').schedule).toBe('37 0-5 * * *'); expect(dep).toContain('`37 0-5 * * *`');
    expect(crons.find((c) => c.path === '/api/cron/health-alert').schedule).toBe('7 * * * *');
    expect(crons).toHaveLength(10); expect(dep).toMatch(/dix entrées/);
    expect(fs.readdirSync('.github/workflows').sort()).toEqual(['ci.yml', 'healthcheck.yml']);   // C1: the external watchdog (tests/unit/c1-external-watchdog.test.js)
  });
});
