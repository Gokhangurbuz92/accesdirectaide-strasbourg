/**
 * G4 (founder directive 19/11/2026) — Mon Parcours opened ALONE on top of the narrow accounts scope: ADA_BETA_ACCOUNTS_EXTRA=parcours (server) and
 * VITE_PUBLIC_BETA_ACCOUNTS_EXTRA=parcours (screens). Fail-closed: exact names, unknown = nothing, no wildcard; the capability citizen.parcours still has
 * to be named in ADA_CAPABILITIES_OPEN; the rest of the full scope (household, guardians, push, shares, favourites, history, delegations, referrals) and
 * the HDS-bound plan import stay closed.
 */
import { describe, expect, it, vi } from 'vitest';

// the gates run before any database access: a database call here is a failure
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

const { isAllowedInPublicBeta, accountsExtras, accountsExtraCapabilities, ACCOUNTS_BOOKING_SCOPE, ACCOUNTS_EXTRAS } = await import('../../api/_utils/public-beta.js');
const { capabilityState, capabilitiesOfRoute, CAPABILITIES } = await import('../../api/_utils/capabilities.js');
const { isBetaRestrictedPath, parcoursOpened, ACCOUNTS_EXTRA_SCREENS } = await import('../../src/lib/publicBeta.js');
const { planImportOpen } = await import('../../api/_services/mon-espace.js');
const { parcoursEmailRemindersOpen } = await import('../../api/_handlers/citizen/parcours.js');
const { evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');

/** the activation profile « accounts narrow + parcours, everything else closed » */
const G4 = Object.freeze({ ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_BETA_ACCOUNTS_EXTRA: 'parcours', ADA_CAPABILITIES_OPEN: 'citizen.parcours' });
const NARROW = Object.freeze({ ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts' });
// every accounts-surface route of api/routes.js
const ACCOUNT_ROUTES = ['login-pro-guard', 'auth/login', 'auth/signup', 'auth/logout', 'auth/me', 'auth/verify-email', 'auth/resend-verification', 'auth/forgot-password',
  'auth/reset-password', 'auth/delete-account', 'auth/franceconnect', 'auth/export-data', 'citizen/profile', 'citizen/age-declaration', 'citizen/email-change',
  'citizen/email-change-confirm', 'citizen/phone', 'citizen/household', 'citizen/guardians', 'citizen/preferences', 'citizen/push', 'citizen/shares', 'citizen/parcours',
  'citizen/favorites', 'citizen/history', 'citizen/coffre', 'citizen/notifications', 'citizen/espace', 'citizen/dossier', 'citizen/delegations', 'citizen/referrals', 'citizen/restriction'];
const CLOSED_CITIZEN = ['citizen/household', 'citizen/guardians', 'citizen/push', 'citizen/shares', 'citizen/favorites', 'citizen/history', 'citizen/delegations',
  'citizen/referrals', 'citizen/coffre', 'citizen/dossier'];
const open = (env) => ACCOUNT_ROUTES.filter((r) => isAllowedInPublicBeta('GET', r, env));
const capOpen = (env) => Object.keys(CAPABILITIES).filter((c) => capabilityState(c, env).open);

describe('G4 server — ADA_BETA_ACCOUNTS_EXTRA', () => {
  it('reads exact names only: unknown, wildcard and look-alikes add nothing; the full scope makes it moot', () => {
    expect(Object.keys(ACCOUNTS_EXTRAS)).toEqual(['parcours']);
    expect([...accountsExtras({ ADA_BETA_ACCOUNTS_EXTRA: ' Parcours , household,*' })]).toEqual(['parcours']);
    for (const v of ['', '*', 'all', 'full', 'parcour', 'parcours-reminder', 'citizen/parcours', 'citizen.parcours', 'household,favorites']) {
      expect([...accountsExtras({ ADA_BETA_ACCOUNTS_EXTRA: v })], v).toEqual([]);
    }
    expect([...accountsExtras({ ADA_BETA_ACCOUNTS_EXTRA: 'parcours', ADA_BETA_ACCOUNTS_SCOPE: 'full' })]).toEqual([]);
    expect([...accountsExtraCapabilities(G4)]).toEqual(['citizen.parcours']);
  });

  it('opens exactly the narrow scope + citizen/parcours (GET, POST, DELETE); every other module of the full scope stays refused', () => {
    const narrow = open(NARROW);
    expect(open(G4)).toEqual([...narrow, 'citizen/parcours'].sort((a, b) => ACCOUNT_ROUTES.indexOf(a) - ACCOUNT_ROUTES.indexOf(b)));
    for (const m of ['GET', 'POST', 'DELETE']) expect(isAllowedInPublicBeta(m, 'citizen/parcours', G4), m).toBe(true);
    for (const r of CLOSED_CITIZEN) for (const m of ['GET', 'POST', 'DELETE']) expect(isAllowedInPublicBeta(m, r, G4), `${m} ${r}`).toBe(false);
    for (const r of ['share/create', 'public/dossier-grants', 'diagnostic', 'assistant', 'pro/referrals', 'cron/parcours-reminder', 'rdv/appointments']) {
      expect(isAllowedInPublicBeta('POST', r, G4), r).toBe(false);
    }
    // a booking-scope route stays a booking-scope route (nothing removed)
    for (const r of ACCOUNTS_BOOKING_SCOPE) expect(open(G4)).toContain(r === 'auth' ? 'auth/login' : r);
  });

  it('needs the accounts surface: with « accounts » closed the addition opens nothing', () => {
    expect(isAllowedInPublicBeta('GET', 'citizen/parcours', { ...G4, ADA_BETA_OPEN_SURFACES: 'admin' })).toBe(false);
    expect(capabilityState('citizen.parcours', { ...G4, ADA_BETA_OPEN_SURFACES: 'admin' })).toEqual({ open: false, reason: 'SURFACE_CLOSED' });
  });

  it('capabilities: only citizen.parcours joins the in-AIPD ones; it still needs ADA_CAPABILITIES_OPEN (the AIPD extension)', () => {
    expect(capOpen(G4)).toEqual([...capOpen(NARROW), 'citizen.parcours']);
    expect(capabilityState('citizen.parcours', { ...G4, ADA_CAPABILITIES_OPEN: undefined })).toEqual({ open: false, reason: 'NOT_LISTED_IN_ADA_CAPABILITIES_OPEN' });
    expect(capabilityState('citizen.parcours', { ...NARROW, ADA_CAPABILITIES_OPEN: 'citizen.parcours' })).toEqual({ open: false, reason: 'SURFACE_CLOSED' });
    // naming another full-scope capability does not open it through the parcours addition
    const listedAll = { ...G4, ADA_CAPABILITIES_OPEN: 'citizen.parcours,citizen.household,citizen.guardians,citizen.favorites,citizen.history,citizen.delegations,citizen.orientation_records,citizen.shared_dossier,citizen.saved_diagnostic' };
    for (const c of ['citizen.household', 'citizen.guardians', 'citizen.push', 'citizen.favorites', 'citizen.history', 'citizen.delegations', 'citizen.orientation_records']) {
      expect(capabilityState(c, listedAll), c).toEqual({ open: false, reason: 'SURFACE_CLOSED' });
    }
    expect(capabilityState('citizen.shared_dossier', listedAll).open).toBe(false);
    expect(capabilitiesOfRoute('citizen/parcours')).toEqual(['citizen.parcours']);
  });

  it('the plan import from a shared dossier stays closed (citizen.shared_dossier, HDS); e-mail reminders follow the category C job', () => {
    expect(planImportOpen(G4)).toBe(false);
    expect(planImportOpen({ ...G4, ADA_CAPABILITIES_OPEN: 'citizen.parcours,citizen.shared_dossier' }), 'no HDS attestation').toBe(false);
    expect(parcoursEmailRemindersOpen(G4)).toBe(false);
    expect(parcoursEmailRemindersOpen({ ...G4, ADA_BETA_OPEN_JOBS: 'parcours-reminder' }), 'opened without the approval').toBe(false);
    // G14: and only with ADA_PARCOURS_EXTERNAL_REMINDERS=on (default off)
    expect(parcoursEmailRemindersOpen({ ...G4, ADA_BETA_OPEN_JOBS: 'parcours-reminder', ADA_JOBS_APPROVED: 'parcours-reminder' })).toBe(false);
    expect(parcoursEmailRemindersOpen({ ...G4, ADA_BETA_OPEN_JOBS: 'parcours-reminder', ADA_JOBS_APPROVED: 'parcours-reminder', ADA_PARCOURS_EXTERNAL_REMINDERS: 'on' })).toBe(true);
    expect(parcoursEmailRemindersOpen({})).toBe(false);
    expect(parcoursEmailRemindersOpen({ ADA_PARCOURS_EXTERNAL_REMINDERS: 'on' })).toBe(true);
  });

  it('the release preflight names the addition', () => {
    const c = evaluateReleasePreflight({ ...G4 }, { legalText: 'ok' }).find((x) => x.id === 'beta.accounts_scope');
    expect(c.status).toBe('PASS');
    expect(c.detail).toMatch(/ADA_BETA_ACCOUNTS_EXTRA\): parcours/);
    expect(evaluateReleasePreflight({ ...NARROW }, { legalText: 'ok' }).find((x) => x.id === 'beta.accounts_scope').detail).not.toMatch(/ADA_BETA_ACCOUNTS_EXTRA/);
  });
});

describe('G4 screens — VITE_PUBLIC_BETA_ACCOUNTS_EXTRA', () => {
  const sub = { accountsScope: 'booking', proSelfRegistration: false, accountsExtras: ['parcours'] };
  const narrow = { accountsScope: 'booking', proSelfRegistration: false };
  const SCREENS = ['/compte/messages', '/compte/profil', '/compte/coffre', '/compte/favoris', '/compte/historique', '/compte/delegations', '/compte/delegations/x',
    '/compte/orientations', '/compte/partages/abc', '/share/abc', '/passport'];

  it('shows /compte/parcours and keeps every other closed account screen behind the beta notice', () => {
    expect(ACCOUNTS_EXTRA_SCREENS).toEqual({ parcours: ['/compte/parcours'] });
    expect(isBetaRestrictedPath('/compte/parcours', ['accounts'], narrow)).toBe(true);
    expect(isBetaRestrictedPath('/compte/parcours', ['accounts'], sub)).toBe(false);
    expect(isBetaRestrictedPath('/compte/parcours/', ['accounts'], sub)).toBe(false);
    for (const p of SCREENS) expect(isBetaRestrictedPath(p, ['accounts'], sub), p).toBe(isBetaRestrictedPath(p, ['accounts'], narrow));
    for (const p of ['/compte', '/compte/rendez-vous', '/compte/parametres', '/auth/login']) expect(isBetaRestrictedPath(p, ['accounts'], sub), p).toBe(false);
  });

  it('fail-closed: unknown names, a closed accounts surface or no addition keep Mon Parcours closed', () => {
    for (const x of [['*'], ['full'], ['household'], ['Parcours '.trim().toUpperCase() + 'x'], []]) {
      expect(isBetaRestrictedPath('/compte/parcours', ['accounts'], { ...narrow, accountsExtras: x }), String(x)).toBe(true);
    }
    expect(isBetaRestrictedPath('/compte/parcours', ['admin'], sub)).toBe(true);
    expect(parcoursOpened(true, ['accounts'], sub)).toBe(true);
    expect(parcoursOpened(true, ['accounts'], narrow)).toBe(false);
    expect(parcoursOpened(true, [], sub)).toBe(false);
  });
});
