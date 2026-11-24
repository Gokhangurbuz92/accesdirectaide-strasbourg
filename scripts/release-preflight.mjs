#!/usr/bin/env node
/**
 * Release preflight (WS9 production-like env). Evaluates configuration READINESS from an env object.
 * Prints check ids + PASS/WARN/FAIL + a reason; NEVER prints values. Exit code 1 when any FAIL.
 * Usage: node scripts/release-preflight.mjs            (checks process.env)
 * Launch-readiness campaign 2026-10-25 (items 41-44): this is the release GATE — every production prerequisite the application fails closed without, and every
 * variable that must not exist in production (plain-text or leaked credentials, unapproved AI keys), plus the legal identity of the publisher.
 */
import { evaluateMailerConfig } from '../api/_utils/mailer.js';
import { LEGAL_PLACEHOLDERS } from '../src/config/legal-documents.js';
import { openSurfaces, openJobs, proSelfRegistrationOpen, accountsScope, accountsExtras } from '../api/_utils/public-beta.js';
import { CAPABILITIES, capabilityState, capabilityStates, hdsAttestation } from '../api/_utils/capabilities.js';
import { approvedAtLeast, LEGAL_DRAFTS_R3_CGU, LEGAL_DRAFTS_R3_NOTICE } from '../src/config/legal-drafts.js';
import { isMainModule } from './lib/is-main.mjs';
import { citizenTermsInForce } from '../api/_utils/terms-in-force.js';
import { RETENTION_POLICY, executionGate, stepApprovalProblem } from '../api/_services/retention-policy.js';
import { workersAiState } from '../api/lib/ai-policy.js';
import { dailyNeuronBudget } from '../api/lib/workers-ai.js';
import { OPENFISCA_FRANCE_PIN, SCALEWAY_TIERS } from '../api/lib/openfiscaPins.js';

/** G14-R3: the capabilities whose texts exist only from notice v14-2026-11-24 / cgu-citoyen v13-2026-11-24 (community.events is in v12 / v13 already) */
export const R3_LEGAL_CAPABILITIES = Object.freeze(['citizen.household', 'citizen.guardians', 'citizen.delegations']);
/** G14-R3G: the representative of a protected adult — described only from notice v14-2026-11-24 (P27) and cgu-citoyen v13-2026-11-24 (§ 5 item « protection juridique ») */
export const R3G_LEGAL_CAPABILITY = 'citizen.legal_protection';

/**
 * G14-AI — the citizen assistant on Cloudflare Workers AI (owner decision 23/11/2026, 0 €). Off (AI_PROVIDER unset, no CF_WORKERS_AI_*) = PASS.
 * Selected = every prerequisite named (never a value): the approval flag, both Cloudflare variables, no Gemini / Google key, the shared KV counter, the
 * daily budget under the free allocation, and the build's privacy line naming the processor (VITE_ASSISTANT_PROVIDER=workers_ai).
 * @param {(k: string) => string} get @returns {['PASS' | 'WARN' | 'FAIL', string]}
 */
export function workersAiCheck(get) {
  const selected = get('AI_PROVIDER').toLowerCase() === 'workers_ai';
  const cfSet = Boolean(get('CF_WORKERS_AI_ACCOUNT_ID') || get('CF_WORKERS_AI_TOKEN'));
  if (!selected) return cfSet ? ['WARN', 'CF_WORKERS_AI_* are set but AI_PROVIDER is not "workers_ai": unused credentials (delete them or select the provider)'] : ['PASS', 'Workers AI off (AI_PROVIDER is not "workers_ai")'];
  const env = { AI_PROVIDER: get('AI_PROVIDER'), AI_WORKERS_PRODUCTION_APPROVED: get('AI_WORKERS_PRODUCTION_APPROVED'), CF_WORKERS_AI_ACCOUNT_ID: get('CF_WORKERS_AI_ACCOUNT_ID'), CF_WORKERS_AI_TOKEN: get('CF_WORKERS_AI_TOKEN') };
  const missing = [];
  if (get('AI_WORKERS_PRODUCTION_APPROVED') !== 'true') missing.push('AI_WORKERS_PRODUCTION_APPROVED=true (owner approval: processor Cloudflare, Inc., AIPD line, privacy notice)');
  if (!/^[0-9a-f]{32}$/i.test(get('CF_WORKERS_AI_ACCOUNT_ID'))) missing.push('CF_WORKERS_AI_ACCOUNT_ID (32 hex characters)');
  if (get('CF_WORKERS_AI_TOKEN').length < 20) missing.push('CF_WORKERS_AI_TOKEN (Workers AI read/run API token)');
  if (get('GEMINI_API_KEY') || get('GOOGLE_API_KEY')) missing.push('no GEMINI_API_KEY / GOOGLE_API_KEY (Gemini stays refused)');
  if (!((get('KV_REST_API_URL') || get('UPSTASH_KV_REST_API_URL')) && (get('KV_REST_API_TOKEN') || get('UPSTASH_KV_REST_API_TOKEN')))) missing.push('Upstash KV (the daily neuron counter is shared there)');
  if (get('AI_WORKERS_DAILY_NEURON_BUDGET') && Number(get('AI_WORKERS_DAILY_NEURON_BUDGET')) > 9500) missing.push('AI_WORKERS_DAILY_NEURON_BUDGET <= 9500 (free allocation 10 000 / day)');
  if (get('VITE_ASSISTANT_PROVIDER').toLowerCase() !== 'workers_ai') missing.push('VITE_ASSISTANT_PROVIDER=workers_ai (the widget privacy line must name the processor)');
  if (missing.length || !workersAiState(env).enabled) return ['FAIL', `AI_PROVIDER=workers_ai needs: ${missing.join('; ') || workersAiState(env).reason}`];
  return ['PASS', `Workers AI approved and configured (citizen assistant only; daily budget ${dailyNeuronBudget({ AI_WORKERS_DAILY_NEURON_BUDGET: get('AI_WORKERS_DAILY_NEURON_BUDGET') })} neurons, refused beyond)`];
}

/**
 * G14 (owner 23/11/2026) — the indicative calculator's engine in Production: not configured = PASS (only the simulation mode answers); configured = the
 * self-hosted, token-protected engine of ops/openfisca/ (never the public prototype api.fr.openfisca.org), pinned version, a container shape the 0 € guard
 * knows (api/lib/openfiscaQuota.js), timeouts long enough for a cold start. Names only, never values.
 * @param {(k: string) => string} get
 * @returns {['PASS' | 'WARN' | 'FAIL', string]}
 */
export function openfiscaCheck(get) {
  const name = ['OPENFISCA_URL', 'OPENFISCA_API_URL'].find((k) => get(k));
  if (get('ALLOW_OPENFISCA_PUBLIC_PROTOTYPE') === 'true') return ['FAIL', 'ALLOW_OPENFISCA_PUBLIC_PROTOTYPE must not exist in Production'];
  if (!name) return ['PASS', 'OpenFisca not configured: only the simulation mode of the diagnostic answers (the indicative calculation stays unavailable)'];
  let u = null; try { u = new URL(get(name)); } catch { u = null; }
  const problems = [];
  if (!u) problems.push(`${name} is not a URL`);
  else {
    if (/(^|\.)openfisca\.org$/i.test(u.hostname)) problems.push(`${name} points to the public OpenFisca prototype (forbidden in Production): use the self-hosted engine (ops/openfisca/deploy_scaleway.mjs)`);
    if (u.protocol !== 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname)) problems.push(`${name} must be the https endpoint of the self-hosted container`);
  }
  if (get('OPENFISCA_AUTH_TOKEN').length < 20) problems.push('OPENFISCA_AUTH_TOKEN (the container token; the engine is private)');
  if (get('OPENFISCA_FRANCE_VERSION') !== OPENFISCA_FRANCE_PIN) problems.push(`OPENFISCA_FRANCE_VERSION=${OPENFISCA_FRANCE_PIN} (the verified engine version; another engine then fails closed)`);
  const mem = get('OPENFISCA_CONTAINER_MEMORY_MB'); const cpu = get('OPENFISCA_CONTAINER_MVCPU');
  if ((mem || cpu) && /** @type {Record<string, number>} */ (SCALEWAY_TIERS)[String(Number(mem || 1024))] !== Number(cpu || 560)) problems.push('OPENFISCA_CONTAINER_MEMORY_MB / OPENFISCA_CONTAINER_MVCPU must be one Scaleway tier, the one deployed (512/280, 1024/560 or 2048/1120)');
  if (problems.length) return ['FAIL', problems.join('; ')];
  const warns = [];
  if (!u || !/\.scw\.cloud$/i.test(u.hostname)) warns.push('endpoint is not a Scaleway default domain: check it is the container deployed by ops/openfisca/deploy_scaleway.mjs');
  if (Number(get('OPENFISCA_TIMEOUT_MS') || 5000) < 20000 || Number(get('OPENFISCA_HEALTH_TIMEOUT_MS') || 2000) < 20000) warns.push('OPENFISCA_TIMEOUT_MS / OPENFISCA_HEALTH_TIMEOUT_MS below 20000: the first call after 15 idle minutes (cold start) will time out');
  if (get('OPENFISCA_QUOTA_GUARD').toLowerCase() === 'off') warns.push('OPENFISCA_QUOTA_GUARD=off is ignored in Production (the 0 € guard always applies): remove it');
  return warns.length ? ['WARN', `self-hosted engine configured; ${warns.join('; ')}`]
    : ['PASS', 'self-hosted OpenFisca (private container + token, pinned version; monthly free-tier guard in KV, stops at 80 %)'];
}

/**
 * R43 (E4) — Outlook free/busy readiness for a production release. Off = PASS. On = every production prerequisite, each named in the detail (never a value).
 * @param {Record<string, string | undefined>} env
 * @param {{ get: (k: string) => string, betaOn: boolean, opened: Set<string> }} ctx
 * @returns {['PASS' | 'FAIL', string]}
 */
export function outlookCheck(env, { get, betaOn, opened }) {
  if (get('OUTLOOK_ENABLED') !== 'true') return ['PASS', 'Outlook off (OUTLOOK_ENABLED is not "true")'];
  const missing = [];
  if (get('CALENDAR_PRODUCTION_APPROVED') !== 'true') missing.push('CALENDAR_PRODUCTION_APPROVED=true (owner approval: Microsoft app registration, DPO, security)');
  for (const k of ['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET']) if (!get(k)) missing.push(k);
  const base = get('APP_BASE_URL') || get('PUBLIC_BASE_URL');
  let baseHost = ''; try { baseHost = new URL(base).hostname; } catch { baseHost = ''; }
  let cb = null; try { cb = new URL(get('OUTLOOK_REDIRECT_URI')); } catch { cb = null; }
  if (!cb || cb.protocol !== 'https:' || cb.pathname.replace(/\/+$/, '') !== '/api/auth/callback/outlook' || !baseHost || cb.hostname !== baseHost)
    missing.push('OUTLOOK_REDIRECT_URI = https://<APP_BASE_URL host>/api/auth/callback/outlook');
  if ((get('ADA_VAULT_KEY') || get('OUTLOOK_TOKEN_ENCRYPTION_KEY')).length < 32) missing.push('ADA_VAULT_KEY (token envelope)');
  for (const k of ['OUTLOOK_AUTHORITY_URL', 'OUTLOOK_GRAPH_BASE_URL']) if (get(k)) missing.push(`${k} must not be set (sandbox endpoint)`);
  if (betaOn && !opened.has('appointments')) missing.push('the appointments surface (its routes serve the connection and the callback)');
  return missing.length ? ['FAIL', `OUTLOOK_ENABLED=true needs: ${missing.join('; ')}`] : ['PASS', 'Outlook free/busy (Calendars.ReadBasic) approved and configured; a real Microsoft sign-in is checked in the release acceptance'];
}

/** @param {Record<string, string | undefined>} env @param {{ legalText?: string, policy?: any }} [opts] legalText: the legal-pages source (tests pass their own); policy: a test copy of the retention policy */
export function evaluateReleasePreflight(env, opts = {}) {
  const get = (/** @type {string} */ k) => String(env[k] ?? '').trim();
  /** @type {{ id: string, status: 'PASS' | 'WARN' | 'FAIL', detail: string }[]} */
  const out = [];
  const add = (/** @type {string} */ id, /** @type {'PASS' | 'WARN' | 'FAIL'} */ status, /** @type {string} */ detail) => out.push({ id, status, detail });

  // Restricted public beta (owner directive 29/10/2026): the API refuses every account, upload and cron route server-side (api/_utils/public-beta.js),
  // so the services that only those routes use are not required; every other check is unchanged.
  const betaOn = ['1', 'true'].includes(get('ADA_PUBLIC_BETA_RESTRICTED').toLowerCase());
  // R35: a surface opened during the beta (ADA_BETA_OPEN_SURFACES) needs the services its routes use, as if the beta were off for it
  const opened = openSurfaces(env);
  const needs = (/** @type {string[]} */ names) => !betaOn || names.some((n) => opened.has(n));
  const mailNeeded = needs(['accounts', 'pro', 'institution', 'communications', 'appointments']);
  const beta = betaOn;
  const notUsed = (/** @type {string} */ what) => `not used: restricted public beta (${what} refused server-side)`;
  const mail = evaluateMailerConfig({ provider: get('MAILER_PROVIDER'), from: get('MAILER_FROM'), apiKey: get('MAILER_API_KEY'), mailjetSandbox: get('MAILER_MAILJET_SANDBOX'),   // R43-MAIL: a sandbox delivers nothing
    msgraph: { tenantId: get('MAILER_MSGRAPH_TENANT_ID'), clientId: get('MAILER_MSGRAPH_CLIENT_ID'), sender: get('MAILER_MSGRAPH_SENDER'), certPrivateKey: get('MAILER_MSGRAPH_CERT_PRIVATE_KEY'), certPem: get('MAILER_MSGRAPH_CERT_PEM'), clientSecret: get('MAILER_MSGRAPH_CLIENT_SECRET') } });   // R42-MAIL
  if (!mailNeeded) add('mail.deliverable', 'PASS', notUsed('accounts, password resets and notifications'));
  else add('mail.deliverable', mail.deliverable ? 'PASS' : 'FAIL', `${mail.provider}: ${mail.reason}`);

  add('auth.mode_jwt', get('AUTH_MODE').toLowerCase() === 'jwt' ? 'PASS' : 'FAIL', 'AUTH_MODE must be "jwt" (default "token" hands out the static admin token as session)');
  add('auth.legacy_admin_token_unset', get('ADMIN_TOKEN') ? 'FAIL' : 'PASS', get('ADMIN_TOKEN') ? 'ADMIN_TOKEN is set: a legacy bearer that bypasses MFA — delete it' : 'not set');
  add('auth.no_env_admin_password', get('ADMIN_PASSWORD') ? 'FAIL' : 'PASS', 'ADMIN_PASSWORD must not exist (plain text); production administrators are named accounts with MFA (scripts/admin-bootstrap.mjs)');
  add('auth.no_env_admin', get('ADMIN_PASSWORD_HASH') || get('ADMIN_EMAIL') ? 'WARN' : 'PASS', 'ADMIN_EMAIL / ADMIN_PASSWORD_HASH are ignored in production: remove them');
  add('env.boot_required', ['DATABASE_URL', 'JWT_SECRET', 'ADA_ENCRYPTION_KEY'].every((k) => get(k)) ? 'PASS' : 'FAIL', 'production refuses to start without DATABASE_URL, JWT_SECRET and ADA_ENCRYPTION_KEY (api/_utils/env.js)');
  add('auth.session_secret', Math.max(get('AUTH_SECRET').length, get('JWT_SECRET').length) >= 32 ? 'PASS' : 'FAIL', 'AUTH_SECRET/JWT_SECRET length >= 32');
  add('crypto.encryption_key', /^[0-9a-fA-F]{64}$/.test(get('ADA_ENCRYPTION_KEY')) ? 'PASS' : 'FAIL', 'ADA_ENCRYPTION_KEY must be 64 hex chars');
  add('cron.secret', get('CRON_SECRET').length >= 24 ? 'PASS' : 'FAIL', 'CRON_SECRET length >= 24');
  const db = get('DATABASE_URL');
  add('db.url_present_not_local', db && !/localhost|127\.0\.0\.1|::1/.test(db) ? 'PASS' : 'FAIL', 'DATABASE_URL present and not loopback (production-like)');
  add('flags.no_mocks', get('USE_MOCKS') === 'true' || get('VITE_USE_MOCKS') === 'true' || get('VITE_SKIP_DB') === 'true' ? 'FAIL' : 'PASS', 'USE_MOCKS / VITE_USE_MOCKS / VITE_SKIP_DB must not be "true"');
  const devFlags = ['VITE_DEV_LOGIN_ENABLED', 'VITE_PUBLIC_DIAGNOSTICS', 'ALLOW_DEV_TOOLS'].filter((k) => get(k) === 'true').concat(get('ADA_ALLOW_LEGACY_ADMIN_TOKEN') === '1' ? ['ADA_ALLOW_LEGACY_ADMIN_TOKEN'] : []);
  add('flags.no_dev_tools', devFlags.length ? 'FAIL' : 'PASS', devFlags.length ? `development switches on: ${devFlags.join(', ')}` : 'development login, public diagnostics, dev tools and the legacy admin token are off');
  // R43 (E4): the former blanket FAIL (« token formats are inconsistent ») predates the redesign (PKG-3/B10: one strict AES-256-GCM envelope, signed state bound
  // to the professional and the browser; R42-A03: Calendars.ReadBasic free/busy only). The check id is kept; it now FAILS on what Outlook really needs in
  // production: the owner's recorded approval (CALENDAR_PRODUCTION_APPROVED=true: Microsoft app registration, DPO and security sign-off), the app
  // credentials, an https callback on the public address, the vault key, no sandbox endpoint, and — in the beta — the appointments surface that serves it.
  add('outlook.disabled_until_redesign', ...outlookCheck(env, { get, betaOn, opened }));
  add('unused.bypass_secret', get('BYPASS_SECRET') ? 'FAIL' : 'PASS', 'BYPASS_SECRET is not used by any handler: delete it');
  const base = get('APP_BASE_URL') || get('PUBLIC_BASE_URL');
  add('app.base_url_https', /^https:\/\/(?!localhost\b|127\.0\.0\.1\b)[^/\s]+/i.test(base) ? 'PASS' : 'FAIL', 'APP_BASE_URL: the public https address (links in e-mails; production refuses to build them without it)');
  const vault = get('ADA_VAULT_KEY') || get('OUTLOOK_TOKEN_ENCRYPTION_KEY');
  add('crypto.vault_key', (/^[0-9a-fA-F]{64}$/.test(vault) || vault.length >= 32) && vault !== get('ADA_ENCRYPTION_KEY') ? 'PASS' : 'FAIL', 'ADA_VAULT_KEY (MFA secrets): 64 hex chars or >= 32 chars, distinct from ADA_ENCRYPTION_KEY');
  add('kv.configured', (get('KV_REST_API_URL') || get('UPSTASH_KV_REST_API_URL')) && (get('KV_REST_API_TOKEN') || get('UPSTASH_KV_REST_API_TOKEN')) ? 'PASS' : 'FAIL', 'Upstash KV: sign-in, sign-up, booking, contact and administration fail closed without it');
  if (!needs(['documents', 'communications'])) add('storage.configured', 'PASS', notUsed('the Coffre and attachments'));
  else add('storage.configured', ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'].every((k) => get(k)) ? 'PASS' : 'FAIL', 'object storage (Coffre, attachments): an EU bucket under a DPA');
  // R34 (G11): the LAB's local file store must not reach production (the runtime ignores it there; the variable signals a copied LAB environment)
  add('storage.no_local_dir', !get('ADA_LOCAL_STORAGE_DIR') ? 'PASS' : beta ? 'WARN' : 'FAIL', 'ADA_LOCAL_STORAGE_DIR is LAB only: delete it from the production environment');
  add('db.tls_verified', get('DATABASE_SSL_VERIFY') === 'true' ? 'PASS' : 'FAIL', 'DATABASE_SSL_VERIFY=true: the database certificate is verified');
  // R40 / G2: jobs open one at a time (ADA_BETA_OPEN_JOBS), never as a surface — any opened job needs the alert channel
  if (betaOn && openJobs(env).size === 0) add('alerts.webhook', 'WARN', notUsed('the health-alert cron (no cron in the beta)') + '; Vercel deployment notifications only');
  // R36: an e-mail to ALERT_EMAIL through the site's mail provider is an alert channel too (no Discord / Slack needed)
  else add('alerts.webhook', /^https:\/\//.test(get('ALERT_WEBHOOK_URL')) || (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(get('ALERT_EMAIL')) && ['resend', 'mailjet', 'msgraph'].includes(get('MAILER_PROVIDER').toLowerCase())) ? 'PASS' : 'FAIL', 'ALERT_WEBHOOK_URL (https) or ALERT_EMAIL with a real mail provider: operational alerts must reach a person, not only the logs');
  add('content.strict_mode', get('ADA_PUBLIC_CONTENT_MODE').toLowerCase() === 'lab' ? 'FAIL' : 'PASS', 'ADA_PUBLIC_CONTENT_MODE must not be "lab" (unverified records would be shown)');
  add('share.legacy_off', get('ADA_LEGACY_SHARE_READ') === '1' ? 'FAIL' : 'PASS', 'ADA_LEGACY_SHARE_READ stays off (a bare link would open a dossier)');
  add('ai.workers_ai', ...workersAiCheck(get));
  // G14-AI: the assistant opened (ai.citizen_assistant named) needs an approved provider that Production can reach — the local Ollama never is there
  if (get('ADA_CAPABILITIES_OPEN').split(',').map((x) => x.trim().toLowerCase()).includes('ai.citizen_assistant')) {
    const ok = workersAiCheck(get)[0] === 'PASS' && get('AI_PROVIDER').toLowerCase() === 'workers_ai';
    add('ai.assistant_provider', ok ? 'PASS' : 'FAIL', ok ? 'the citizen assistant is answered by the approved provider (Workers AI)' : 'ai.citizen_assistant is opened but no approved provider is configured (AI_PROVIDER=workers_ai and ai.workers_ai PASS): every question would end in « indisponible »');
  }
  add('openfisca.self_hosted', ...openfiscaCheck(get));
  add('ai.no_unapproved_provider_key', get('GEMINI_API_KEY') || get('GOOGLE_API_KEY') ? 'FAIL' : 'PASS', 'GEMINI_API_KEY / GOOGLE_API_KEY must not exist until an AI provider is approved (DPIA, DPA)');
  add('observability.sentry', get('SENTRY_DSN') ? 'PASS' : 'WARN', 'SENTRY_DSN (EU region, DPA) for error tracking');
  const dsnHosts = ['SENTRY_DSN', 'VITE_SENTRY_DSN'].map((k) => get(k)).filter(Boolean).map((d) => { try { return new URL(d).hostname; } catch { return '?'; } });
  add('observability.sentry_eu', dsnHosts.every((h) => /\.ingest\.de\.sentry\.io$/.test(h)) ? 'PASS' : 'FAIL', 'SENTRY_DSN / VITE_SENTRY_DSN in the EU region (*.ingest.de.sentry.io): the only Sentry origin the CSP allows');
  add('observability.no_session_replay', get('VITE_SENTRY_REPLAY') === 'true' ? 'FAIL' : 'PASS', 'Sentry Session Replay stays off (consent; DPIA A1)');
  add('ops.maintenance_off', ['1', 'true'].includes(String(get('MAINTENANCE_MODE') || '')) ? 'WARN' : 'PASS', 'MAINTENANCE_MODE=1 serves the maintenance page to every visitor');
  const legal = opts.legalText !== undefined ? opts.legalText : JSON.stringify(LEGAL_PLACEHOLDERS);
  add('legal.publisher_complete', legal && !/\[À COMPLÉTER/.test(legal.normalize('NFC')) ? 'PASS' : 'FAIL', 'legal pages: the publisher identity is complete (no « [À COMPLÉTER] »: registered association, publication director, host, contacts)');
  if (beta && !mailNeeded) add('beta.mailer_noop', ['', 'noop'].includes(get('MAILER_PROVIDER').toLowerCase()) ? 'PASS' : 'FAIL', 'MAILER_PROVIDER stays noop in the restricted beta (no real e-mail)');
  // R43 (E1, E2): the sub-switches are visible in the gate (WARN when widened; default closed / narrow)
  if (betaOn) add('beta.pro_self_registration', proSelfRegistrationOpen(env) ? 'WARN' : 'PASS', proSelfRegistrationOpen(env)
    ? 'ADA_PRO_SELF_REGISTRATION=open: anyone can create a structure and its administrator once « pro » is open'
    : 'public structure sign-up closed (structures are created by the platform; members join by invitation)');
  // V2 / D6: citizen accounts open only with the citizen terms and the privacy notice IN FORCE (the server refuses sign-ups otherwise)
  if (!betaOn || opened.has('accounts')) add('legal.citizen_terms_in_force', citizenTermsInForce({ ...env, VERCEL_ENV: 'production' }) ? 'PASS' : 'FAIL',
    'VITE_LEGAL_DOCS_APPROVED_VERSION names the approved cgu-citoyen and notice-confidentialite versions (sign-up refuses with TERMS_NOT_IN_FORCE otherwise)');
  // V2 (owner review 09/11/2026): the privacy notice promises that a never-confirmed account is erased 7 days after creation (D4, UNVERIFIED_ACCOUNT_DAYS).
  // The ONLY mechanism is purge step 6c (unverifiedAccountsDeleted): citizen accounts open only when that step really executes — the gdpr-purge job open
  // and approved, the policy approved and pinned, the step listed AND approved in the policy (dry run reviewed, verified backup). Otherwise the promise is false.
  if (!betaOn || opened.has('accounts')) {
    const policy = opts.policy || RETENTION_POLICY;
    const gate = executionGate(policy, env);
    const why = !openJobs(env).has('gdpr-purge') && betaOn ? 'the gdpr-purge job is not open (ADA_BETA_OPEN_JOBS + ADA_JOBS_APPROVED)'
      : !gate.execute ? `purge execution refused: ${gate.reason}`
        : !gate.approvedSteps.has('unverifiedAccountsDeleted') ? 'GDPR_PURGE_APPROVED_STEPS does not list unverifiedAccountsDeleted'
          : stepApprovalProblem(policy, { id: 'unverifiedAccountsDeleted' });
    add('retention.unverified_accounts_7d', why ? 'FAIL' : 'PASS', why
      ? `citizen accounts need purge step 6c in force (notice: never-confirmed account erased no later than 8 days after creation): ${why}`
      : 'step 6c (never-confirmed accounts: 7-day threshold, daily run, at most 8 days) executes');
  }
  // G14-R3: household (P24), trusted persons (P25) and the guardian link (P26) are described only from notice v14-2026-11-24 and cgu-citoyen
  // v13-2026-11-24 — opening one of them under an older approved text would process data the notice in force does not describe
  {
    const r3 = R3_LEGAL_CAPABILITIES.filter((c) => capabilityState(c, { ...env, VERCEL_ENV: 'production' }).open);
    if (r3.length) {
      const approved = get('VITE_LEGAL_DOCS_APPROVED_VERSION');
      const ok = approvedAtLeast('notice-confidentialite', LEGAL_DRAFTS_R3_NOTICE, approved) && approvedAtLeast('cgu-citoyen', LEGAL_DRAFTS_R3_CGU, approved);
      add('legal.r3_household_trusted_guardians', ok ? 'PASS' : 'FAIL', ok ? `${r3.join(', ')} open with notice ≥ ${LEGAL_DRAFTS_R3_NOTICE} and cgu-citoyen ≥ ${LEGAL_DRAFTS_R3_CGU} in force`
        : `${r3.join(', ')} open but VITE_LEGAL_DOCS_APPROVED_VERSION does not name notice-confidentialite@${LEGAL_DRAFTS_R3_NOTICE} and cgu-citoyen@${LEGAL_DRAFTS_R3_CGU} (or later)`);
    }
  }
  // G14-R3G: the representative of a protected adult — the texts that describe it (P27, retention, cgu § 5) exist only from notice v14 / cgu v13. The
  // table comes with migration 0064 (pending): on a database without it the feature answers « not installed » (this gate reads no database).
  if (capabilityState(R3G_LEGAL_CAPABILITY, { ...env, VERCEL_ENV: 'production' }).open) {
    const approved = get('VITE_LEGAL_DOCS_APPROVED_VERSION');
    const ok = approvedAtLeast('notice-confidentialite', LEGAL_DRAFTS_R3_NOTICE, approved) && approvedAtLeast('cgu-citoyen', LEGAL_DRAFTS_R3_CGU, approved);
    add('legal.r3_legal_protection', ok ? 'PASS' : 'FAIL', ok ? `${R3G_LEGAL_CAPABILITY} open with notice ≥ ${LEGAL_DRAFTS_R3_NOTICE} and cgu-citoyen ≥ ${LEGAL_DRAFTS_R3_CGU} in force (migration 0064 must be applied: not read here)`
      : `${R3G_LEGAL_CAPABILITY} open but VITE_LEGAL_DOCS_APPROVED_VERSION does not name notice-confidentialite@${LEGAL_DRAFTS_R3_NOTICE} and cgu-citoyen@${LEGAL_DRAFTS_R3_CGU} (or later)`);
  }
  if (betaOn && opened.has('accounts')) add('beta.accounts_scope', accountsScope(env) === 'full' ? 'WARN' : 'PASS', accountsScope(env) === 'full'
    ? 'ADA_BETA_ACCOUNTS_SCOPE=full: the whole citizen space is open (household, guardians, push, shares, parcours, favourites, history, delegations, referrals)'
    : `accounts in the booking scope: sign-up/in, verification, password, profile, adult statement, rectification, preferences, restriction, deletion, export, Mon Espace summary${
      accountsExtras(env).size ? ` + named additions (ADA_BETA_ACCOUNTS_EXTRA): ${[...accountsExtras(env)].sort().join(', ')}` : ''}`);
  // R45 / ENG-LR-6: capabilities outside the AIPD (api/_utils/capabilities.js) — evaluated as Production does (enforced). PASS when none is open; WARN when
  // one is named or open (an AIPD extension and, for the HDS ones, a certified host are needed); a malformed HDS token is a FAIL (it would open nothing)
  {
    const prodEnv = { ...env, VERCEL_ENV: 'production' };
    const named = get('ADA_CAPABILITIES_OPEN').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const unknown = named.filter((n) => !Object.prototype.hasOwnProperty.call(CAPABILITIES, n));
    const openOut = capabilityStates(prodEnv).filter((c) => c.aipd === 'out' && c.open).map((c) => c.name);
    const namedClosed = named.filter((n) => !unknown.includes(n) && !openOut.includes(n) && CAPABILITIES[n].aipd === 'out');
    const status = openOut.length || named.length ? 'WARN' : 'PASS';
    add('capabilities.out_of_aipd', status, status === 'PASS' ? 'no capability outside the AIPD is open (ADA_CAPABILITIES_OPEN unset)'
      : `outside the AIPD — open: ${openOut.join(', ') || 'none'}; named but still closed: ${namedClosed.join(', ') || 'none'}; unknown names (open nothing): ${unknown.join(', ') || 'none'}`);
    if (get('ADA_HDS_CERTIFIED_HOSTING')) {
      const h = hdsAttestation(env);
      add('capabilities.hds_attestation', h.valid ? 'WARN' : 'FAIL', h.valid ? 'ADA_HDS_CERTIFIED_HOSTING holds a well-formed, unexpired token: check the certificate itself (a token is a statement, not a verification)'
        : `ADA_HDS_CERTIFIED_HOSTING is set but invalid (${h.reason}): no HDS capability opens`);
    }
  }
  if (beta) add('beta.open_surfaces', opened.size ? 'WARN' : 'PASS', opened.size ? `surfaces opened during the beta: ${[...opened].sort().join(', ')} (their services are required above)` : 'no surface opened: only public read-only routes');
  return out;
}

if (isMainModule(import.meta.url)) {
  const results = evaluateReleasePreflight(process.env);
  for (const r of results) console.log(`${r.status.padEnd(4)} ${r.id} — ${r.detail}`);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}
