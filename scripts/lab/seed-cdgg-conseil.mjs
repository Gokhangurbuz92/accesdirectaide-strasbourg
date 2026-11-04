#!/usr/bin/env node
/**
 * R42 (owner decision DEC-R42-03) — the FICTIONAL LAB pilot « CDGG Conseil » and its synthetic accounts. LAB ONLY, never Production.
 *
 *   node --import tsx scripts/lab/seed-cdgg-conseil.mjs seed  --credentials <file outside the repository>
 *   node --import tsx scripts/lab/seed-cdgg-conseil.mjs enrol --credentials <file>      (MAILER_PROVIDER=test; in-process through api/index.js)
 *   node --import tsx scripts/lab/seed-cdgg-conseil.mjs remove
 *
 * Refuses to run unless ALL hold: DATABASE_URL host is 127.0.0.1 / localhost / ::1; the database name matches a LAB/test pattern (a « lab », « test » or
 * « e2e » word); ADA_PUBLIC_CONTENT_MODE=lab; NODE_ENV and VERCEL_ENV are not production. `enrol` also needs MAILER_PROVIDER=test (nothing is sent).
 *
 * What `seed` writes (fixed ids « lab-cdgg-… » / « lab-temoin-… », replaced on every run; append-only ConsentLog rows stay):
 *   - Structure « CDGG Conseil » (data_origin 'synthetic_fixture': visible ONLY in LAB mode, labelled LAB_UNVERIFIED there; never in strict/Production lists,
 *     search, sitemap, coverage; no source_url, no FINESS number, no SIRET; « adresse fictive », no phone, no e-mail, no website). verification_status is
 *     VERIFIED only because the booking requires an identity-checked organisation (api/_utils/org-eligibility.js): data_origin keeps it out of every public
 *     list, and the R42-CDGG booking guard refuses a synthetic fixture outside LAB mode.
 *   - two fictional test services: one Mode A (direct confirmation), one Mode B (approval by the structure); opening hours Mon–Fri 09:00–12:00 / 14:00–17:00
 *     Europe/Paris; team choice on.
 *   - professional accounts (@example.test only): org administrator, coordinator (schedule manager), three professionals (P3 not publicly selectable);
 *     weekly hours, one absence, one date exception (api/_services/rdv-member-hours.js).
 *   - adult citizens: an existing client with a real past appointment with P3 (« previous professional »), a second citizen; the first-time visitor is NOT
 *     created: the acceptance registers it in the browser.
 *   - « Structure témoin fictive » (unrelated) with its own administrator and professional, for cross-structure tests, and the LAB platform operator
 *     (SUPERADMIN) who invites the first administrators.
 * Professional MFA (R42-A08): only the LAB platform operator is enrolled directly by the seed (the root of trust of the fixture). Every other professional is
 * enrolled by `enrol` through the real invitation flow of the production API entry (invitation → e-mail in the test outbox → password sign-in →
 * password-only set-up refused → redeem → set-up → code).
 * Passwords and TOTP seeds are random per run and written ONLY to the --credentials file (mode 0600), never printed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const command = ['seed', 'enrol', 'remove'].find((c) => process.argv.includes(c)) || 'seed';
const refuse = (m) => { console.error(`refusing to run: ${m}`); process.exit(3); };

export const LAB_DB_NAME = /(^|_)(lab|test|e2e)(_|$)/i;
/** @param {Record<string, string | undefined>} env @returns {string | null} the reason to refuse, or null */
export function refusal(env) {
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') return 'production profile';
  if (env.ADA_PUBLIC_CONTENT_MODE !== 'lab') return 'ADA_PUBLIC_CONTENT_MODE must be lab';
  let u;
  try { u = new URL(env.DATABASE_URL || ''); } catch { return 'DATABASE_URL missing or invalid'; }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) return 'the database is not local';
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!LAB_DB_NAME.test(name)) return 'the database name is not a LAB/test database';
  return null;
}

export const STATUS_TEXT = 'Structure fictive de démonstration — environnement LAB uniquement';
export const DESCRIPTION = 'CDGG Conseil est une structure fictive de démonstration proposant un accompagnement des personnes en situation de handicap cognitif. Ses interventions simulées portent sur l\'aide aux démarches administratives, l\'insertion et la recherche d\'emploi, la sécurisation des parcours, l\'identification des besoins de compensation du handicap en emploi, la prévention des ruptures de parcours et l\'élaboration ou la validation du projet professionnel.';
export const CDGG = { id: 'lab-cdgg-conseil', slug: 'cdgg-conseil', nom: 'CDGG Conseil' };
export const TEMOIN = { id: 'lab-temoin-structure', slug: 'structure-temoin-fictive', nom: 'Structure témoin fictive (LAB)' };
export const SERVICES = {
  direct: { id: 'lab-cdgg-svc-demarches', name: 'Démarches administratives et emploi — service fictif de test (confirmation directe)', confirmation: 'DIRECT' },
  approval: { id: 'lab-cdgg-svc-projet', name: 'Projet professionnel — service fictif de test (validation par la structure)', confirmation: 'APPROVAL' },
  temoin: { id: 'lab-temoin-svc', name: 'Accueil fictif de test (structure témoin)' },
};
/** accounts: obviously fictional names, reserved domains only */
export const PROS = {
  operator: { id: 'lab-temoin-operator', email: 'operateur.plateforme@lab-cdgg.example.test', role: 'SUPERADMIN', sid: TEMOIN.id, name: 'Opérateur plateforme LAB (fictif)' },
  admin: { id: 'lab-cdgg-admin', email: 'admin@cdgg-conseil.example.test', role: 'STRUCTURE_ADMIN', sid: CDGG.id, name: 'Camille Administratrice-Fictive', job: 'Administratrice (fictive)' },
  coordinator: { id: 'lab-cdgg-coord', email: 'coordination@cdgg-conseil.example.test', role: 'PRO', sid: CDGG.id, name: 'Dominique Coordination-Fictive', job: 'Coordinatrice (fictive)', canManageSchedule: true },
  p1: { id: 'lab-cdgg-p1', email: 'alix.conseil@cdgg-conseil.example.test', role: 'PRO', sid: CDGG.id, name: 'Alix Conseil-Fictif', job: 'Conseiller en insertion (fictif)', selectable: true },
  p2: { id: 'lab-cdgg-p2', email: 'bastien.emploi@cdgg-conseil.example.test', role: 'PRO', sid: CDGG.id, name: 'Bastien Emploi-Fictif', job: 'Chargé d’accompagnement emploi (fictif)', selectable: true },
  p3: { id: 'lab-cdgg-p3', email: 'claude.interne@cdgg-conseil.example.test', role: 'PRO', sid: CDGG.id, name: 'Claude Interne-Fictif', job: 'Référent parcours (fictif)', selectable: false },
  temoinAdmin: { id: 'lab-temoin-admin', email: 'admin@structure-temoin.example.test', role: 'STRUCTURE_ADMIN', sid: TEMOIN.id, name: 'Eden Témoin-Fictif' },
  temoinPro: { id: 'lab-temoin-pro', email: 'pro@structure-temoin.example.test', role: 'PRO', sid: TEMOIN.id, name: 'Farah Témoin-Fictive' },
};
export const CITIZENS = {
  client: { id: 'lab-cdgg-cit-client', email: 'gabriel.client@cdgg-usagers.example.test', name: 'Gabriel Client-Fictif' },
  second: { id: 'lab-cdgg-cit-second', email: 'hana.seconde@cdgg-usagers.example.test', name: 'Hana Seconde-Fictive' },
};
/** the first-time visitor is registered by the acceptance (browser), with a fresh address of this reserved domain */
export const VISITOR_DOMAIN = 'cdgg-visiteurs.example.test';

const DAY = 86_400_000;
/** the Paris date `n` days after today (YYYY-MM-DD) */
const parisDate = (n, from = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(from + n * DAY));
/** the n-th next Paris date (from day 2 on) that is a weekday in `days` (1 = Monday) */
function nextWeekday(days, nth = 0, start = 2) {
  let seen = 0;
  for (let i = start; i < 60; i += 1) { const d = parisDate(i); const wd = new Date(`${d}T12:00:00Z`).getUTCDay(); if (days.includes(wd)) { if (seen === nth) return d; seen += 1; } }
  throw new Error('no weekday found');
}

async function connect() {
  const pg = (await import('pg')).default;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

/** @param {import('pg').Client} c */
async function removeFixtures(c) {
  const sids = [CDGG.id, TEMOIN.id];
  const cits = Object.values(CITIZENS).map((x) => x.id);
  const visitors = (await c.query(`SELECT id FROM "CitizenUser" WHERE email LIKE $1`, [`%@${VISITOR_DOMAIN}`])).rows.map((r) => r.id);
  const allCit = [...cits, ...visitors];
  const pros = (await c.query(`SELECT id FROM "ProUser" WHERE "structureId" = ANY($1)`, [sids])).rows.map((r) => r.id);
  const q = async (sql, params) => { await c.query(sql, params).catch((e) => { if (e.code !== '42P01') throw e; }); };
  await q(`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ANY($1))`, [sids]);
  await q(`DELETE FROM "ProNotification" WHERE "structureId" = ANY($1)`, [sids]);
  for (const t of ['ProAppointment', 'ProTimeOff', 'ProAvailabilityRule', 'ProRdvService', 'StructureRdvSettings', 'Invitation']) await q(`DELETE FROM "${t}" WHERE "structureId" = ANY($1)`, [sids]);
  await q(`DELETE FROM "ProAppointment" WHERE "citizenUserId" = ANY($1)`, [allCit]);
  await q(`DELETE FROM "ProProfile" WHERE "proUserId" = ANY($1)`, [pros]);
  await q(`DELETE FROM "ProNotification" WHERE "userId" = ANY($1)`, [pros]);
  await q(`DELETE FROM "ProUser" WHERE id = ANY($1)`, [pros]);
  await q(`DELETE FROM "AuthToken" WHERE "userId" = ANY($1)`, [allCit]);
  await q(`DELETE FROM "CitizenProfile" WHERE "userId" = ANY($1)`, [allCit]);
  await q(`DELETE FROM "CitizenUser" WHERE id = ANY($1)`, [allCit]);
  await q(`DELETE FROM "Structure" WHERE id = ANY($1)`, [sids]);
}

const secret = () => crypto.randomBytes(18).toString('base64url');

async function seed() {
  const credPath = arg('credentials');
  if (!credPath) refuse('--credentials <file> is required (outside the repository)');
  if (path.resolve(credPath).startsWith(ROOT)) refuse('the credentials file must be outside the repository');
  const { hashPassword } = await import('../../api/_utils/password-hash.js');
  const { generateSecret } = await import('../../api/lib/totp.js');
  const { sealMfaSecret, isVaultReady } = await import('../../api/_utils/totp-guard.js');
  if (!isVaultReady()) refuse('the MFA vault key is not configured (run with the LAB server environment)');
  const c = await connect();
  try {
    await c.query('BEGIN');
    await removeFixtures(c);
    /** @type {Record<string, any>} */
    const cred = { generatedAt: new Date().toISOString(), structure: CDGG, temoin: TEMOIN, services: SERVICES, pros: {}, citizens: {}, visitorDomain: VISITOR_DOMAIN, dates: {} };
    const structure = async (s, desc, services, keywords) => c.query(`INSERT INTO "Structure" (id, nom, slug, type_structure, description_courte, adresse, code_postal, ville, departement, telephone, email, site_web,
        horaires, accessibilite_pmr, services, publics_accueillis, categories_aidees, mots_cles, statut, status, verification_status, launch_eligible, territory_verified, data_origin,
        source_url, source_url_exact, numero_finess, siret, is_pro_enabled, settings_json, "updatedAt", "createdAt")
      VALUES ($1, $2, $3, 'association', $4, 'Adresse fictive — aucun accueil réel (structure de démonstration LAB)', '67000', 'Strasbourg', '67', NULL, NULL, NULL,
        'Horaires fictifs de démonstration (LAB)', false, $5, $6, $7, $8, 'actif', 'actif', 'VERIFIED', false, false, 'synthetic_fixture', NULL, NULL, NULL, NULL, true, '{}'::jsonb, NOW(), NOW())`,
      [s.id, s.nom, s.slug, desc, services, ['Adultes en situation de handicap cognitif (public fictif de démonstration)'], ['handicap', 'emploi', 'demarches'], keywords]);
    await structure(CDGG, `${STATUS_TEXT}. ${DESCRIPTION}`,
      ['Aide aux démarches administratives (simulée)', 'Insertion et recherche d’emploi (simulée)', 'Sécurisation des parcours (simulée)', 'Identification des besoins de compensation du handicap en emploi (simulée)', 'Prévention des ruptures de parcours (simulée)', 'Élaboration ou validation du projet professionnel (simulée)'],
      ['démarches administratives', 'emploi', 'insertion', 'handicap cognitif', 'projet professionnel', 'structure fictive', 'LAB']);
    await structure(TEMOIN, `${STATUS_TEXT}. Structure témoin fictive, sans lien avec CDGG Conseil, utilisée pour les tests d’isolement entre structures.`, ['Accueil fictif de test'], ['structure fictive', 'LAB']);
    for (const s of [CDGG, TEMOIN]) {
      await c.query(`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "contactEmail", "contactPhone", "publishedAt", "updatedAt") VALUES ($1, $2, true, 'IN_PERSON', NULL, NULL, NOW(), NOW())`, [`lab-set-${s.id}`, s.id]);
      for (let wd = 1; wd <= 5; wd += 1) {
        for (const [a, b] of [['09:00', '12:00'], ['14:00', '17:00']]) await c.query(`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES ($1, $2, $3, $4, $5, 'Europe/Paris', true, NOW())`, [`lab-rule-${s.id}-${wd}-${a}`, s.id, wd, a, b]);
      }
    }
    for (const [k, svc] of Object.entries(SERVICES)) {
      await c.query(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", modes, "updatedAt") VALUES ($1, $2, $3, 60, 0, 0, true, ARRAY['IN_PERSON']::text[], NOW())`,
        [svc.id, k === 'temoin' ? TEMOIN.id : CDGG.id, svc.name]);
    }
    for (const [k, p] of Object.entries(PROS)) {
      const password = secret();
      /** @type {string | null} */ let totp = null;
      if (k === 'operator') totp = generateSecret();
      await c.query(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, mfa_secret, "canManageSchedule", "notificationEmailEnabled", "updatedAt", "createdAt")
        VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, false, NOW(), NOW())`, [p.id, p.email, await hashPassword(password), p.role, p.sid, Boolean(totp), totp ? sealMfaSecret(totp) : null, p.canManageSchedule === true]);
      await c.query(`INSERT INTO "ProProfile" (id, "proUserId", "displayName", "jobTitle", "isPubliclyVisible", "updatedAt") VALUES ($1, $2, $3, $4, false, NOW())`, [`lab-pp-${p.id}`, p.id, p.name, p.job || null]);
      cred.pros[k] = { id: p.id, email: p.email, role: p.role, structureId: p.sid, name: p.name, password, totpSecret: totp };
    }
    // booking rules (Structure.settings_json.rdvBooking, R42-BOOK) and the members' hours (rdvMemberHours, R42-CDGG)
    const rdvBooking = { v: 1, confirmation: 'DIRECT', services: { [SERVICES.approval.id]: { confirmation: 'APPROVAL' } }, team: { enabled: true, members: {
      [PROS.p1.id]: { bookable: true, selectable: true, serviceIds: [] }, [PROS.p2.id]: { bookable: true, selectable: true, serviceIds: [] }, [PROS.p3.id]: { bookable: true, selectable: false, serviceIds: [] } } } };
    const exceptionDay = nextWeekday([1, 2, 3], 1);   // P1 unavailable on their second working day ahead
    const extraDay = nextWeekday([4], 0);             // P1 additionally available one Thursday afternoon
    const now = new Date().toISOString();
    const rdvMemberHours = {
      [PROS.p1.id]: { v: 1, weekly: [1, 2, 3].flatMap((weekday) => [{ weekday, startTime: '09:00', endTime: '12:00' }, { weekday, startTime: '14:00', endTime: '17:00' }]),
        exceptions: [{ id: 'x1', kind: 'UNAVAILABLE', from: exceptionDay, to: exceptionDay, startTime: null, endTime: null }, { id: 'x2', kind: 'AVAILABLE', from: extraDay, to: extraDay, startTime: '14:00', endTime: '16:00' }], updatedAt: now },
      [PROS.p2.id]: { v: 1, weekly: [2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '12:00' })), exceptions: [], updatedAt: now },
    };
    await c.query(`UPDATE "Structure" SET settings_json = $2::jsonb WHERE id = $1`, [CDGG.id, JSON.stringify({ rdvBooking, rdvMemberHours })]);
    // one absence of P2 (ProTimeOff, the R24 member absence) on their first working morning ahead
    const absenceDay = nextWeekday([2, 3, 4, 5], 0);
    const { zonedWallTimeToUtc } = await import('../../api/_utils/pro-rdv.js');
    const at = (ymd, hm) => { const [y, m, d] = ymd.split('-').map(Number); return zonedWallTimeToUtc(y, m - 1, d, hm, 'Europe/Paris'); };
    await c.query(`INSERT INTO "ProTimeOff" (id, "structureId", "proUserId", "startAt", "endAt", reason, "updatedAt") VALUES ('lab-cdgg-absence-p2', $1, $2, $3, $4, 'Absence fictive de test', NOW())`,
      [CDGG.id, PROS.p2.id, at(absenceDay, '09:00'), at(absenceDay, '12:00')]);
    cred.dates = { p1UnavailableDay: exceptionDay, p1ExtraAvailableDay: extraDay, p2AbsenceDay: absenceDay };
    // adult citizens (verified e-mail, adult statement in the append-only ConsentLog — the R42-AUTH rule)
    for (const [k, p] of Object.entries(CITIZENS)) {
      const password = secret();
      await c.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "notificationEmailEnabled", "updatedAt", "createdAt") VALUES ($1, $2, $3, NOW(), true, NOW(), NOW())`, [p.id, p.email, await hashPassword(password)]);
      await c.query(`INSERT INTO "CitizenProfile" ("userId", "displayName", "ageBand", "updatedAt") VALUES ($1, $2, '25-59', NOW())`, [p.id, p.name]);
      await c.query(`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level)
        VALUES (gen_random_uuid()::text, 'CITIZEN_USER', $1, 'AGE_DECLARATION_ADULT', true, 'r42-a07-2026-11-04', 'r42-a07-2026-11-04:AGE_DECLARATION_ADULT', 'lab_fixture', false, 'SELF_DECLARATION')`, [p.id]);
      cred.citizens[k] = { id: p.id, email: p.email, name: p.name, password };
    }
    // the existing client's REAL past appointment with P3 (done, 14 days ago) — the « previous professional » relationship
    const past = new Date(Date.now() - 14 * DAY); past.setUTCHours(8, 0, 0, 0);
    await c.query(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "createdByProUserId", "idempotencyKey", mode, "updatedAt", "createdAt")
      VALUES ('lab-cdgg-past-appointment', $1, $2, $3, $4, 'done', 'Particulier fictif', $5, $6, 'lab-cdgg-past', 'IN_PERSON', NOW(), NOW())`,
      [CDGG.id, SERVICES.direct.id, past, new Date(past.getTime() + 3600_000), CITIZENS.client.id, PROS.p3.id]);
    await c.query('COMMIT');
    fs.writeFileSync(credPath, JSON.stringify(cred, null, 2), { mode: 0o600 });
    console.log(`SEEDED ${CDGG.nom} (${CDGG.slug}): ${Object.keys(PROS).length} professional accounts, ${Object.keys(CITIZENS).length} citizens, 2 structures, 3 services; credentials written (0600, not printed)`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { await c.end(); }
}

/**
 * The professional MFA enrolment of every fixture member through the real R42-A08 invitation flow, IN-PROCESS through the production API entry
 * (api/index.js: origin gate, CSRF double-submit, beta gate, rate limits, handlers), with MAILER_PROVIDER=test (the link is read from this process's test
 * outbox). Each member's requests come from their own documentation address (192.0.2.x, RFC 5737), as each person enrols from their own device: the
 * per-address limits (5 sign-ins / 15 min, 5 redemptions / hour) are real and not bypassed.
 */
async function enrol() {
  const credPath = arg('credentials');
  if (!credPath || !fs.existsSync(credPath)) refuse('--credentials <file written by seed> is required');
  if (process.env.MAILER_PROVIDER !== 'test') refuse('MAILER_PROVIDER must be test (the invitation link is read from the in-process test outbox)');
  const { default: api } = await import('../../api/index.js');
  const { __getTestOutbox } = await import('../../api/_utils/mailer.js');
  const { generateCode } = await import('../../api/lib/totp.js');
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const host = '127.0.0.1:5173';
  const csrf = crypto.randomBytes(16).toString('hex');
  /** @param {string} method @param {string} url @param {{ ip: string, token?: string, body?: unknown, headers?: Record<string, string> }} o */
  const call = async (method, url, { ip, token, body, headers = {} }) => {
    const u = new URL(url, `http://${host}`);
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? {}, socket: { remoteAddress: ip },
      headers: { host, 'content-type': 'application/json', 'x-forwarded-for': ip, cookie: `__csrf=${csrf}`, 'x-csrf-token': csrf, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } };
    /** @type {Record<string, unknown>} */ const out = { status: 200, json: null };
    /** @type {Record<string, unknown>} */ const hdrs = {};
    const res = { statusCode: 200, headersSent: false, setHeader(k, v) { hdrs[String(k).toLowerCase()] = v; }, getHeader(k) { return hdrs[String(k).toLowerCase()]; }, removeHeader(k) { delete hdrs[String(k).toLowerCase()]; },
      status(c) { this.statusCode = c; return this; }, json(d) { out.json = d; this.headersSent = true; return this; }, send(d) { out.json = d; this.headersSent = true; return this; },
      end(d) { if (d !== undefined && out.json === null) { try { out.json = JSON.parse(String(d)); } catch { out.json = d; } } this.headersSent = true; return this; }, writeHead(c) { this.statusCode = c; return this; }, on() { return this; } };
    await api(req, res);
    out.status = res.statusCode;
    return /** @type {{ status: number, json: any }} */ (out);
  };
  const ipOf = (/** @type {string} */ k) => `192.0.2.${10 + Object.keys(cred.pros).indexOf(k)}`;
  const step = () => Math.floor(Date.now() / 30_000);
  /** a code is accepted once per 30-second step (claimProStep): wait for a step this member has not used */
  const lastStep = new Map();
  const code = async (/** @type {string} */ k) => {
    while (lastStep.get(k) === step()) await new Promise((r) => setTimeout(r, 1000));
    lastStep.set(k, step());
    return generateCode(cred.pros[k].totpSecret, step());
  };
  /** @type {Map<string, string>} */ const sessions = new Map();
  const login = async (/** @type {string} */ k) => {
    if (sessions.has(k)) return /** @type {string} */ (sessions.get(k));
    const p = cred.pros[k];
    const r = await call('POST', '/api/pro/auth/login', { ip: ipOf(k), body: { email: p.email, password: p.password } });
    if (r.status !== 200) throw new Error(`login ${k}: ${r.status}`);
    let token = r.json.token;
    if (r.json.mfa_required) {
      const v = await call('POST', '/api/pro/auth/mfa-verify', { ip: ipOf(k), body: { mfa_token: r.json.mfa_token, code: await code(k) } });
      if (v.status !== 200 || !v.json?.token) throw new Error(`mfa-verify ${k}: ${v.status}`);
      token = v.json.token;
    }
    sessions.set(k, token);
    return token;
  };
  /** @param {string} inviter @param {string} k */
  const enrolOne = async (inviter, k) => {
    const p = cred.pros[k];
    const inv = await call('POST', '/api/pro/mfa-invitation', { ip: ipOf(inviter), token: await login(inviter), body: { memberId: p.id } });
    if (inv.status !== 201) throw new Error(`invitation ${k}: ${inv.status} ${inv.json?.error || ''}`);
    const mails = __getTestOutbox().filter((m) => String(Array.isArray(m.to) ? m.to.join(',') : m.to).toLowerCase() === p.email);
    const link = mails.map((m) => m.text).join('\n').match(/#invitation=([A-Za-z0-9%_-]+)/);
    if (!link) throw new Error(`no invitation link in the test outbox for ${k}`);
    const passwordOnly = await login(k);   // a password-only session: alone it cannot enrol a factor (R42-A08)
    const refused = await call('GET', '/api/pro/mfa-setup', { ip: ipOf(k), token: passwordOnly });
    if (refused.status !== 403) throw new Error(`password-only set-up was not refused for ${k}: ${refused.status}`);
    const red = await call('POST', '/api/pro/mfa-enrolment', { ip: ipOf(k), token: passwordOnly, body: { token: decodeURIComponent(link[1]) } });
    if (red.status !== 200 || !red.json?.enrolmentToken) throw new Error(`redeem ${k}: ${red.status}`);
    const grant = { 'x-ada-mfa-enrolment': red.json.enrolmentToken };
    const setup = await call('GET', '/api/pro/mfa-setup', { ip: ipOf(k), token: passwordOnly, headers: grant });
    if (setup.status !== 200 || !setup.json?.secret) throw new Error(`set-up ${k}: ${setup.status}`);
    p.totpSecret = setup.json.secret;
    const done = await call('POST', '/api/pro/mfa-setup', { ip: ipOf(k), token: passwordOnly, headers: grant, body: { code: await code(k), enrolmentToken: red.json.enrolmentToken } });
    if (done.status !== 200 || !done.json?.token) throw new Error(`enrol ${k}: ${done.status} ${done.json?.error || ''}`);
    sessions.set(k, done.json.token);
    p.mfaEnrolledVia = { invitationBy: inviter, mailStatus: inv.json.mailStatus, passwordOnlySetupRefused: true };
    fs.writeFileSync(credPath, JSON.stringify(cred, null, 2), { mode: 0o600 });
    console.log(`ENROLLED ${k} (invited by ${inviter}, mail ${inv.json.mailStatus}; password-only set-up refused first)`);
  };
  await enrolOne('operator', 'admin');
  await enrolOne('operator', 'temoinAdmin');
  for (const k of ['coordinator', 'p1', 'p2', 'p3']) await enrolOne('admin', k);
  await enrolOne('temoinAdmin', 'temoinPro');
}

async function main() {
  const why = refusal(process.env);
  if (why) refuse(why);
  if (command === 'seed') await seed();
  else if (command === 'enrol') await enrol();
  else { const c = await connect(); try { await c.query('BEGIN'); await removeFixtures(c); await c.query('COMMIT'); console.log('REMOVED the CDGG Conseil fixtures'); } finally { await c.end(); } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0), (e) => { console.error(`seed-cdgg-conseil failed: ${e?.message || e}`); process.exit(1); });
}
