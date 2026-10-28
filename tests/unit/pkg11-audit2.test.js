/**
 * PKG-11 deep audit, pass 2 (2026-10-23) — the pure parts of the fixes (no database): link-check robustness, the Paris day of reminders, the « password not
 * chosen yet » rule, and the source-level guarantees of screens whose text claimed what the code does not do (behaviour on real PostgreSQL: pkg11-audit2-db).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { checkOne } from '../../api/_services/link-check.js';
import { parisDayWindow, formatParisTime, formatParisDate } from '../../api/_services/appointment-notices.js';
import { citizenSessionRevoked, isUnsetPassword, signUserSessionToken, unsetPasswordHash, verifyPassword, verifyUserSessionToken } from '../../api/_utils/user-auth.js';

const src = (p) => readFileSync(p, 'utf8');

describe('PKG-11 audit pass 2 — services', () => {
  it('link check: a malformed redirect target is a broken link, not a crash of the whole run', async () => {
    const fetchImpl = async () => ({ status: 301, headers: { get: () => 'http://[::1' } });
    expect(await checkOne('https://www.service-public.fr/particuliers/vosdroits/F1', { fetchImpl })).toMatchObject({ class: 'BROKEN', status: 301 });
  });
  it('reminders: « demain » is the Paris calendar day (summer and winter), and times are Paris times', () => {
    const summer = parisDayWindow(new Date('2026-07-10T22:30:00Z'), 1);   // 00:30 on 11 July in Paris: tomorrow is 12 July
    expect([summer.start.toISOString(), summer.end.toISOString()]).toEqual(['2026-07-11T22:00:00.000Z', '2026-07-12T22:00:00.000Z']);
    const winter = parisDayWindow(new Date('2026-01-10T12:00:00Z'), 1);
    expect([winter.start.toISOString(), winter.end.toISOString()]).toEqual(['2026-01-10T23:00:00.000Z', '2026-01-11T23:00:00.000Z']);
    expect(formatParisTime('2026-07-12T08:00:00Z')).toBe('10:00');
    expect(formatParisDate('2026-07-12T08:00:00Z')).toBe('dimanche 12 juillet');
    const dst = parisDayWindow(new Date('2026-10-24T12:00:00Z'), 1);   // 25 October 2026: the 25-hour day
    expect(dst.end.getTime() - dst.start.getTime()).toBe(25 * 3600000);
  });
  it('citizen sessions are compared to the millisecond: issued before a reset / logout = revoked, just after = valid; old tokens keep the whole-second rule', () => {
    const after = new Date('2026-10-23T10:00:00.500Z');
    expect(citizenSessionRevoked(Math.floor(after.getTime() / 1000), after, after.getTime() - 1)).toBe(true);
    expect(citizenSessionRevoked(Math.floor(after.getTime() / 1000), after, after.getTime() + 1)).toBe(false);
    expect(citizenSessionRevoked(Math.floor(after.getTime() / 1000), after)).toBe(false);   // a pre-change token of the same second
    const claims = verifyUserSessionToken(signUserSessionToken({ userId: 'u-ms', email: 'ms@example.test' }));
    expect(typeof claims.iatMs).toBe('number'); expect(Math.abs(claims.iatMs - Date.now())).toBeLessThan(5000);
  });
  it('a password nobody chose never verifies, whatever is typed', async () => {
    const h = unsetPasswordHash(); expect(isUnsetPassword(h)).toBe(true); expect(isUnsetPassword('scrypt:a:b')).toBe(false);
    expect(await verifyPassword('anything-at-all', h)).toBe(false);
  });
});

describe('PKG-11 audit pass 2 — source-level guarantees', () => {
  it('sign-up / verification / recovery: a second sign-up sets no password; the verification click leads to choosing it; recovery leaves it unchosen', () => {
    expect(src('api/_handlers/auth/signup.js')).toMatch(/passwordHash: unsetPasswordHash\(\)/);
    expect(src('api/_handlers/auth/verify-email.js')).toMatch(/if \(isUnsetPassword\(tokenRow\.user\.passwordHash\)\)/);
    expect(src('api/_services/privacy-console.js')).toMatch(/const unusable = unsetPasswordHash\(\);/);
    expect(src('api/_handlers/auth/reset-password.js')).toMatch(/sessionsValidAfter: new Date\(\), emailVerifiedAt/);
  });
  it('SMS: the confirmation obeys canNotify (restriction, age policy) and says whether an SMS can leave at all; numbers are sent in E.164', () => {
    const s = src('api/_handlers/public/sms-notify.js');
    expect(s).toMatch(/isSmsSendWindow\(\) && await canNotify\(appointment\.citizenUserId, 'sms', 'reminder'\)/); expect(s).toMatch(/smsConfigured,/);
    expect(src('src/components/SmsToggle.jsx')).not.toMatch(/Vous recevrez un SMS la veille/);
    for (const f of ['api/_handlers/public/sms-notify.js', 'api/_handlers/cron/rdv-reminder.js']) expect(src(f), f).toMatch(/normalizeFrenchPhone\(/);
    expect(src('api/_handlers/cron/rdv-reminder.js')).not.toMatch(/errBody/);
  });
  it('restriction: share links sealed while it holds, requests serialised per person', () => {
    const s = src('api/_services/processing-restriction.js');
    expect(s).toMatch(/pg_advisory_xact_lock/); expect(s).toMatch(/const sealed = count\(await sealShares\(tx/); expect((s.match(/await unsealShares\(tx/g) || []).length).toBe(2);
  });
  it('screens say what is true: no E2EE, no fake status, no invented figure or promise, working links', () => {
    const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ [^\n]*$/gm, '');   // comments may quote what was removed
    const none = (f, rx) => expect(code(f), `${f} ${rx}`).not.toMatch(rx);
    none('src/pages/pro/Dashboard.jsx', /E2EE|clés souveraines|synchronisé avec succès|login\.microsoftonline\.com/);
    none('src/pages/pro/SharedDossier.jsx', /E2EE|RGPD audité/);
    none('src/pages/UserPassport.jsx', /Données chiffrées au stockage/);
    none('src/components/assistant/StepDiagnostic.jsx', /Rien n.apos;est enregistré|Rien n'est enregistré/);
    none('src/pages/SourcesMethode.jsx', /LLM fermé et audité|48 heures/);
    none('src/pages/Method.jsx', /new Date\(\)\.toLocaleDateString|Une deuxième personne/);
    none('src/pages/Partners.jsx', /qualifie le candidat|immédiatement notifié|100% Gratuit|SIRET|to="\/auth\/signup"/);
    none('src/pages/APropos.jsx', /1 usager sur 3|Haut-Rhin|Cryptographie complète|Pôle Emploi/);
    none('src/pages/admin/AIOrchestrator.jsx', /Pro Max|1560|setInterval|sleep\(/);
    // launch-readiness item 57: these unreachable pages (fake metrics, retired cloud AI) and the public internal grant page were deleted
    for (const gone of ['src/pages/SubventionDossier.jsx', 'src/pages/pro/FullSimulation.jsx', 'src/pages/pro/ProductionRehearsal.jsx', 'src/pages/pro/AiOrchestrator.jsx',
      'src/pages/pro/ContentFactory.jsx', 'src/pages/pro/HiveOrchestrator.jsx']) expect(existsSync(join(process.cwd(), gone)), gone).toBe(false);
    none('src/pages/ServiceError.jsx', /Failover|souverain|Souverain/);
    none('src/components/OnboardingTour.jsx', /Jitsi|jamais exposée/);
    none('src/components/StructureMap.jsx', /unpkg\.com|href=\{`\/annuaire\/|from 'react-leaflet'|import\('react-leaflet'\)/);
    // react-leaflet 5 needs React 19: under React 18 the « Carte » view crashed the whole site — no screen may import it while React is 18
    expect(JSON.parse(readFileSync('node_modules/react/package.json', 'utf8')).version.startsWith('18.')).toBe(true);
    expect(execSync(`grep -rlE "from ['\\"]react-leaflet|import\\(['\\"]react-leaflet" src || true`, { encoding: 'utf8' }).trim()).toBe('');
    none('api/_handlers/pro/health-check.js', /Gemini|status: env\.ai\.geminiKey \? 'operational'/);
    none('src/pages/Layout.jsx', /params: 'categorie=|page: 'APropos'|Site non lucratif/);
    none('src/components/news/NewsFallback.jsx', /to="\/guides"|`\/guides\//);
    expect(src('src/pages/Tools.jsx')).toMatch(/testId="tools-error"/);
    expect(src('src/pages/institution/Espace.jsx')).not.toMatch(/value="month"|value="year"/);
  });
});
