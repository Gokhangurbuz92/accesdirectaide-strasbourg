/**
 * G14-R3 (24/11/2026, founder's yes to preparing the release-3 package) — « Mon foyer » (C03), the minor ↔ legal guardian link in its guarded form (C05),
 * the trusted persons (C23) and the Académie / events (X04). PROPOSED, not approved. Covers:
 *   - the narrow gate: ADA_BETA_ACCOUNTS_EXTRA=household,guardians,delegations opens exactly these routes and capabilities (each still named in
 *     ADA_CAPABILITIES_OPEN), where ADA_BETA_ACCOUNTS_SCOPE=full would also open favourites / history / shares / referrals routes and the optional profile
 *     fields (age band, département — Release B minimisation);
 *   - the guardian guard: no NEW link while minors' own accounts are closed (MINOR_ACCOUNTS_CLOSED), enforced wherever capabilities are enforced;
 *   - the proposed durations and purge steps of C23 / C05 (pendingApproval: never executable);
 *   - notice-confidentialite v14-2026-11-24 and cgu-citoyen v13-2026-11-24: exact differences with their bases, figures = code, six languages, drafts until
 *     VITE_LEGAL_DOCS_APPROVED_VERSION names them;
 *   - the register lines T29–T32.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/_utils/citizen-handler.js', () => ({ citizenHandler: (_name, _methods, fn) => fn }));

const { isAllowedInPublicBeta, accountsExtras, accountsExtraCapabilities, ACCOUNTS_EXTRAS } = await import('../../api/_utils/public-beta.js');
const { CAPABILITIES, capabilityState } = await import('../../api/_utils/capabilities.js');
const { optionalProfileFieldsOpen } = await import('../../api/_utils/profile-minimisation.js');
const { isBetaRestrictedPath, ACCOUNTS_EXTRA_SCREENS } = await import('../../src/lib/publicBeta.js');
const { MINOR_ACCOUNTS_CLOSED } = await import('../../api/_services/guardianship.js');
const guardiansHandler = (await import('../../api/_handlers/citizen/guardians.js')).default;
const { RETENTION_POLICY, R3_PROPOSAL, stepApprovalProblem } = await import('../../api/_services/retention-policy.js');
const { PURGE_STEPS, delegationInvitationsExpiredWhere, delegationsEndedWhere, guardianLinksRevokedWhere } = await import('../../api/_handlers/cron/gdpr-purge.js');
const L = await import('../../src/config/legal-drafts.js');
const { claimsEntitlement } = await import('../../api/lib/entitlementWording.js');
const { MAX_HOUSEHOLD, HOUSEHOLD_RELATIONS } = await import('../../api/_services/citizen-account.js');
const { INVITE_DAYS, DELEGATION_DURATIONS, MAX_LIVE_DELEGATIONS } = await import('../../api/_services/delegation.js');

/** Production after release 2 (activate_g14_r2.sh, with OpenFisca), plus the release-3 switches */
const R2 = Object.freeze({ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic',
  ADA_BETA_ACCOUNTS_EXTRA: 'parcours,push,assist', ADA_CAPABILITIES_OPEN: 'citizen.parcours,citizen.assisted_mode,ai.citizen_assistant,pro.referrals_social,video,diagnostic.questionnaire' });
const R3_CAPS = ['citizen.household', 'citizen.guardians', 'citizen.delegations', 'community.events'];
const R3 = Object.freeze({ ...R2, ADA_BETA_OPEN_SURFACES: `${R2.ADA_BETA_OPEN_SURFACES},events`, ADA_BETA_ACCOUNTS_EXTRA: `${R2.ADA_BETA_ACCOUNTS_EXTRA},household,guardians,delegations`,
  ADA_CAPABILITIES_OPEN: `${R2.ADA_CAPABILITIES_OPEN},${R3_CAPS.join(',')}` });
/** the same capabilities opened with the FULL accounts scope instead of the named modules (what the package avoids) */
const R3_FULL = Object.freeze({ ...R3, ADA_BETA_ACCOUNTS_EXTRA: '', ADA_BETA_ACCOUNTS_SCOPE: 'full' });
const open = (/** @type {any} */ env) => Object.keys(CAPABILITIES).filter((c) => capabilityState(c, env).open).sort();

describe('G14-R3 gate — the three account modules by name, never the full scope', () => {
  it('ACCOUNTS_EXTRAS names household, guardians and delegations with one route and one capability each', () => {
    expect(ACCOUNTS_EXTRAS.household).toEqual({ routes: ['citizen/household'], capabilities: ['citizen.household'] });
    expect(ACCOUNTS_EXTRAS.guardians).toEqual({ routes: ['citizen/guardians'], capabilities: ['citizen.guardians'] });
    expect(ACCOUNTS_EXTRAS.delegations).toEqual({ routes: ['citizen/delegations'], capabilities: ['citizen.delegations'] });
    expect([...accountsExtras(R3)]).toEqual(['parcours', 'push', 'assist', 'household', 'guardians', 'delegations']);
    expect([...accountsExtraCapabilities(R3)].sort()).toEqual(['citizen.assisted_mode', 'citizen.delegations', 'citizen.guardians', 'citizen.household', 'citizen.parcours', 'citizen.push']);
    expect(ACCOUNTS_EXTRA_SCREENS).toMatchObject({ household: [], guardians: [], delegations: ['/compte/delegations'] });
  });

  it('release 3 opens exactly the four capabilities on top of release 2; favourites, history, HDS parts, FranceConnect and minors stay closed', () => {
    const before = open(R2); const after = open(R3);
    expect(after.filter((c) => !before.includes(c))).toEqual([...R3_CAPS].sort());
    expect(before.filter((c) => !after.includes(c))).toEqual([]);
    for (const c of ['citizen.favorites', 'citizen.history', 'citizen.orientation_records', 'citizen.vault', 'citizen.shared_dossier', 'citizen.saved_diagnostic',
      'citizen.franceconnect', 'citizen.minor_accounts', 'community.testimonials', 'community.stories', 'community.employment', 'community.entraide']) {
      expect(capabilityState(c, R3).open, c).toBe(false);
    }
    // each module still needs its capability listed (AIPD extension): the name alone opens nothing
    const unlisted = { ...R3, ADA_CAPABILITIES_OPEN: R2.ADA_CAPABILITIES_OPEN };
    for (const c of R3_CAPS) expect(capabilityState(c, unlisted).reason, c).toMatch(/NOT_LISTED_IN_ADA_CAPABILITIES_OPEN|SURFACE_CLOSED/);
    // and the capability alone (without the module named) stays behind the narrow scope
    expect(capabilityState('citizen.household', { ...R3, ADA_BETA_ACCOUNTS_EXTRA: R2.ADA_BETA_ACCOUNTS_EXTRA }).reason).toBe('SURFACE_CLOSED');
  });

  it('routes: the three modules and the events surface pass the beta gate; favourites, history, shares, referrals do not', () => {
    for (const [m, r] of [['GET', 'citizen/household'], ['POST', 'citizen/household'], ['DELETE', 'citizen/household'], ['GET', 'citizen/guardians'], ['POST', 'citizen/guardians'],
      ['GET', 'citizen/delegations'], ['POST', 'citizen/delegations'], ['GET', 'events'], ['GET', 'events/some-event'], ['POST', 'citizen/events'], ['POST', 'admin/events']]) {
      expect(isAllowedInPublicBeta(m, r, R3), `${m} ${r}`).toBe(true);
      expect(isAllowedInPublicBeta(m, r, R2), `${m} ${r} (R2)`).toBe(false);
    }
    for (const r of ['citizen/favorites', 'citizen/history', 'citizen/shares', 'citizen/referrals', 'citizen/testimonials', 'citizen/stories', 'citizen/entraide']) {
      expect(isAllowedInPublicBeta('GET', r, R3), r).toBe(false);
    }
  });

  it('finding: the full scope would ALSO pass favourites / history / shares / referrals at the gate and open the optional profile fields', () => {
    for (const r of ['citizen/favorites', 'citizen/history', 'citizen/shares', 'citizen/referrals']) expect(isAllowedInPublicBeta('GET', r, R3_FULL), r).toBe(true);
    expect(optionalProfileFieldsOpen(R3_FULL)).toBe(true);    // age band (« moins-de-18 » included) and département collected again
    expect(optionalProfileFieldsOpen(R3)).toBe(false);        // the named modules keep the Release B minimisation
    expect(open(R3_FULL)).toEqual(open(R3));                  // the capability layer still refuses favourites, history and the HDS parts
  });

  it('screens: /compte/delegations opens with the module; favourites and history stay behind the beta notice', () => {
    const sub = { accountsScope: /** @type {'booking'} */ ('booking'), proSelfRegistration: false, accountsExtras: ['parcours', 'push', 'assist', 'household', 'guardians', 'delegations'] };
    const surfaces = R3.ADA_BETA_OPEN_SURFACES.split(',');
    expect(isBetaRestrictedPath('/compte/delegations', surfaces, sub)).toBe(false);
    expect(isBetaRestrictedPath('/compte/delegations/abc', surfaces, sub)).toBe(false);
    expect(isBetaRestrictedPath('/compte/delegations', surfaces, { ...sub, accountsExtras: ['parcours'] })).toBe(true);
    for (const p of ['/compte/favoris', '/compte/historique', '/compte/coffre', '/compte/orientations']) expect(isBetaRestrictedPath(p, surfaces, sub), p).toBe(true);
    for (const p of ['/compte/profil', '/evenements', '/academie', '/compte/evenements']) expect(isBetaRestrictedPath(p, surfaces, sub), p).toBe(false);
  });
});

describe('G14-R3 guardian guard — no new link while minors’ accounts are closed', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('citizen.minor_accounts is never openable, so a declaration is refused wherever capabilities are enforced', async () => {
    expect(CAPABILITIES['citizen.minor_accounts'].openable).toBe(false);
    for (const [k, v] of Object.entries(R3)) vi.stubEnv(k, v);
    const out = await guardiansHandler({ id: 'u1' }, { method: 'POST', body: { action: 'declare', guardianEmail: 'parent@example.test' } });
    expect(out).toEqual({ ...MINOR_ACCOUNTS_CLOSED });
    expect(out.status).toBe(409);
    expect(MINOR_ACCOUNTS_CLOSED.message).toMatch(/aucun nouveau lien/);
  });
});

describe('G14-R3 durations and purge steps — PROPOSED, never executable while pending', () => {
  const D = RETENTION_POLICY.durations;
  const ids = ['delegationInvitationsExpiredDeleted', 'delegationsEndedDeleted', 'guardianLinksRevokedDeleted'];
  it('three durations proposed, marked « à approuver », the policy version unchanged', () => {
    expect(D.DELEGATION_INVITATION_EXPIRED_DAYS).toMatchObject({ days: 30, ecode: 'C23', pendingApproval: R3_PROPOSAL });
    expect(D.DELEGATION_ENDED_DAYS).toMatchObject({ days: 365, ecode: 'C23', pendingApproval: R3_PROPOSAL });
    expect(D.GUARDIAN_LINK_REVOKED_DAYS).toMatchObject({ days: 30, ecode: 'C05', pendingApproval: R3_PROPOSAL });
    expect(R3_PROPOSAL).toMatch(/^À APPROUVER/);
    expect(RETENTION_POLICY.version).toBe('g14-expansion-2-2026-11-23-a7-365d');
    for (const id of ids) expect(RETENTION_POLICY.decidedSteps[id], id).toBeUndefined();
  });
  it('the steps exist and stay refused even with a complete approval record', () => {
    const rec = { approvedOn: '2026-11-24', dryRunReviewedOn: '2026-11-24', backupVerified: 'synthetic backup proof' };
    const withRecords = { ...RETENTION_POLICY, approvedSteps: { ...RETENTION_POLICY.approvedSteps, ...Object.fromEntries(ids.map((i) => [i, rec])) } };
    for (const id of ids) {
      const step = PURGE_STEPS.find((s) => s.id === id);
      expect(step, id).toBeTruthy();
      expect(step.kind).toBe('delete');
      expect(stepApprovalProblem(withRecords, step), id).toBe('DURATION_PENDING_APPROVAL');
    }
  });
  it('SQL: the anchors and the safeguards (legal hold, restriction, open request) of each step', () => {
    const d = new PgDialect(); const q = (/** @type {any} */ w) => d.sqlToQuery(w).sql; const at = new Date('2026-01-01T00:00:00Z');
    const a = q(delegationInvitationsExpiredWhere(at)); const b = q(delegationsEndedWhere(at)); const c = q(guardianLinksRevokedWhere(at));
    expect(a).toMatch(/"inviteExpiresAt" < /); expect(a).toMatch(/"status" = /);
    expect(b).toMatch(/COALESCE\("CitizenDelegation"\."endedAt", "CitizenDelegation"\."expiresAt"\)/); expect(b).toMatch(/"expiresAt" < /);
    expect(c).toMatch(/"updatedAt" < /);
    for (const s of [a, b, c]) { expect(s).toMatch(/"LegalHold"/); expect(s).toMatch(/"DSRRequest"/); }
  });
});

const N = 'notice-confidentialite'; const C = 'cgu-citoyen';
const find = (/** @type {any[]} */ set, /** @type {string} */ id) => /** @type {any} */ (set.find((x) => x.id === id));
const keys = (/** @type {any} */ doc) => Object.fromEntries(L.draftTextKeys(doc));
const n13 = find(L.LEGAL_DRAFT_DOCUMENTS_V13, N); const n14 = find(L.LEGAL_DRAFT_DOCUMENTS_R3_NOTICE, N);
const c12 = find(L.LEGAL_DRAFT_DOCUMENTS_V12, C); const c13 = find(L.LEGAL_DRAFT_DOCUMENTS_R3_CGU, C);
const NOTICE_ADDED = ['processors.i4_v14', 'purposes.p24_v14', 'purposes.p25_v14', 'purposes.p26_v14', 'recipients.trusted_v14', 'retention.delegations_v14',
  'retention.guardians_v14', 'retention.household_v14', 'retention.i14_v14', 'rights.r3_v14'];
const CGU_ADDED = ['account.household_v13', 'account.i1_v13', 'account.trusted_v13', 'appointments.p1_v13', 'appointments.p2_v13', 'appointments.p3_v13', 'appointments.p5_v13',
  'appointments.title_v13', 'use.i3_v13'];
const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const OPEN_R2 = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';
const OPEN_R3 = 'cgu-citoyen@v13-2026-11-24,notice-confidentialite@v14-2026-11-24,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';

describe('G14-R3 legal drafts — notice v14-2026-11-24 and cgu-citoyen v13-2026-11-24 (PROPOSED)', () => {
  it('versions, order, status: drafts until the build names them; release 2 value keeps v13 / v12', () => {
    expect([L.LEGAL_DRAFTS_R3_NOTICE, L.LEGAL_DRAFTS_R3_CGU]).toEqual(['v14-2026-11-24', 'v13-2026-11-24']);
    expect([...L.LEGAL_DRAFT_VERSIONS].slice(-2)).toEqual([L.LEGAL_DRAFTS_R3_CGU, L.LEGAL_DRAFTS_R3_NOTICE]);
    expect(L.LEGAL_DRAFTS_R3_STATUS).toMatch(/^DRAFT — proposée le 24\/11\/2026, en attente de l’approbation du responsable/);
    expect(L.LEGAL_DRAFTS_R3_STATUS).not.toMatch(/avocat|expert|approuvée le/);
    expect(L.latestDraftVersionOf(N)).toBe('v14-2026-11-24'); expect(L.latestDraftVersionOf(C)).toBe('v13-2026-11-24');
    expect(L.approvedVersionOf(N, OPEN_R2)).toBe('v13-2026-11-23'); expect(L.approvedVersionOf(C, OPEN_R2)).toBe('v12-2026-11-23');
    expect(L.approvedVersionOf(N, OPEN_R3)).toBe('v14-2026-11-24'); expect(L.approvedVersionOf(C, OPEN_R3)).toBe('v13-2026-11-24');
    for (const t of OPEN_R3.split(',')) expect(L.knownApprovalToken(t), t).toBe(true);
    expect(L.draftVisibility(n14, { approved: OPEN_R2, production: true })).toBe('HIDDEN');
  });

  it('notice v14 = notice v13 + exactly the release-3 keys; nothing of v13 is removed except the two replaced items', () => {
    const a = keys(n13); const b = keys(n14);
    expect(Object.keys(b).filter((k) => a[k] !== b[k]).sort()).toEqual(NOTICE_ADDED);
    expect(Object.keys(a).filter((k) => !(k in b)).sort()).toEqual(['processors.i4_v13', 'retention.i14_v13']);
    expect(b['retention.i14_v14']).toBe(a['retention.i14_v13'].replace(', membres du foyer', ''));
    expect(b['processors.i4_v14']).toBe(a['processors.i4_v13'].replace('avis du compte, invitations et avis', 'avis du compte, invitations des personnes de confiance, invitations et avis'));
    const ks = Object.values(n14.sections.find((/** @type {any} */ s) => s.id === 'purposes').itemKeys);
    expect(ks.slice(-4)).toEqual(['p23_g14c', 'p24_v14', 'p25_v14', 'p26_v14']);
    const rk = Object.values(n14.sections.find((/** @type {any} */ s) => s.id === 'retention').itemKeys);
    expect(rk.slice(-4)).toEqual(['household_v14', 'delegations_v14', 'guardians_v14', 'i14_v14']);
    expect(n14.sections.map((/** @type {any} */ s) => s.id)).toEqual(n13.sections.map((/** @type {any} */ s) => s.id));
  });

  it('cgu-citoyen v13 = cgu v12 + § 5 two items and the corrections of § 5 / § 6 / § 7 made false by the release-2 appointments', () => {
    const a = keys(c12); const b = keys(c13);
    const changed = Object.keys(b).filter((k) => a[k] !== b[k]).sort();
    // the unchanged items of § 7 now carry their explicit default key (i1, i2): same key, same text
    expect(changed).toEqual(CGU_ADDED);
    expect(Object.keys(a).filter((k) => !(k in b)).sort()).toEqual(['account.i1', 'appointments.p1', 'appointments.p2', 'appointments.p3', 'appointments.p5', 'appointments.title', 'use.i3']);
    expect(b['appointments.p4']).toBe(a['appointments.p4']);
    expect(b['account.trusted_v13']).toMatch(/Si vous êtes la personne de confiance, vous utilisez cet accès seulement pour aider/);
    for (const k of CGU_ADDED) expect(b[k], k).not.toMatch(/sera ouverte|pas encore ouverts\)|lorsqu'elle sera ouverte/);
  });

  it('figures = code: household 12 / 30 characters, invitation 7 days, durations 30 / 90 / 180 / 365, proposed retention 30 days / 12 months / 30 days', () => {
    const b = keys(n14);
    expect(MAX_HOUSEHOLD).toBe(12); expect(HOUSEHOLD_RELATIONS).toEqual(['partner', 'child', 'parent', 'sibling', 'other']);
    expect(b['purposes.p24_v14']).toMatch(/12 au plus/); expect(b['purposes.p24_v14']).toMatch(/30 caractères au plus/);
    expect(INVITE_DAYS).toBe(7); expect(DELEGATION_DURATIONS).toEqual([30, 90, 180, 365]); expect(MAX_LIVE_DELEGATIONS).toBe(10);
    expect(b['purposes.p25_v14']).toMatch(/valable 7 jours/); expect(b['purposes.p25_v14']).toMatch(/pour 30, 90, 180 ou 365 jours/);
    const D = RETENTION_POLICY.durations;
    expect(b['retention.delegations_v14']).toMatch(new RegExp(`${D.DELEGATION_INVITATION_EXPIRED_DAYS.days} jours après son expiration`));
    expect(D.DELEGATION_ENDED_DAYS.days).toBe(365); expect(b['retention.delegations_v14']).toMatch(/12 mois après sa fin/);
    expect(b['retention.guardians_v14']).toMatch(new RegExp(`${D.GUARDIAN_LINK_REVOKED_DAYS.days} jours après son retrait`));
    expect(b['purposes.p26_v14']).toMatch(/aucun nouveau lien ne peut être créé/);
  });

  it('no entitlement wording, no claim of review; six languages, same figures, no shared key', () => {
    const b = keys(n14); const c = keys(c13);
    const fr = { ...Object.fromEntries(NOTICE_ADDED.map((k) => [`privacyNotice.${k}`, b[k]])), ...Object.fromEntries(CGU_ADDED.map((k) => [`cguCitoyen.${k}`, c[k]])) };
    for (const [k, t] of Object.entries(fr)) { expect(claimsEntitlement(t), k).toBe(false); expect(t, k).not.toMatch(/avocat|juriste|expert/i); }
    const digits = (/** @type {string} */ t) => (t.match(/\d+/g) || []).join(',');
    for (const lang of LANGS) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      for (const [k, t] of Object.entries(fr)) {
        expect(typeof loc[k], `${lang} ${k}`).toBe('string');
        expect(loc[k].length, `${lang} ${k}`).toBeGreaterThan(5);
        expect(digits(loc[k]), `${lang} ${k}`).toBe(digits(t));
      }
    }
  });

  it('LEGAL_DRAFT_DOCUMENTS shows the newest drafts (notice v14, cgu v13)', () => {
    expect(find(L.LEGAL_DRAFT_DOCUMENTS, N).version).toBe('v14-2026-11-24');
    expect(find(L.LEGAL_DRAFT_DOCUMENTS, C).version).toBe('v13-2026-11-24');
  });
});

describe('G14-R3 register lines T29–T32', () => {
  const reg = JSON.parse(readFileSync('REGISTRE_RGPD.json', 'utf8'));
  const t = (/** @type {string} */ id) => reg.traitements.find((x) => x.id === id);
  it('household, guardian link (restricted), trusted persons, events; proposed durations said « non appliqué » and « à approuver »', () => {
    expect(reg.version).toBe('0.7');
    expect(t('T29').nom).toMatch(/Mon foyer/); expect(t('T30').nom).toMatch(/représentant légal/); expect(t('T31').nom).toMatch(/Personnes de confiance/); expect(t('T32').nom).toMatch(/événements/);
    expect(t('T30').statut).toMatch(/MINOR_ACCOUNTS_CLOSED/);
    for (const id of ['T30', 'T31']) for (const c of t(id).conservation.filter((/** @type {any} */ x) => /PROPOSÉE/.test(x.description))) expect(c.statut).toBe('non appliqué');
    expect(t('T31').conservation.map((/** @type {any} */ c) => c.description).join(' ')).toMatch(/30 jours après son expiration.*365 jours après sa fin/);
    for (const id of ['T29', 'T30', 'T31']) expect(t(id).base_legale_proposee, id).toMatch(/à valider par le responsable/);
    expect(t('T32').base_legale_proposee).toMatch(/art\. 9\.2\.a/);
    expect(JSON.stringify([t('T29'), t('T30'), t('T31'), t('T32')])).not.toMatch(/avocat|juriste a validé|expert a validé|approuvé par le responsable/);
  });
});

describe('G14-R3 release preflight — the three account modules need the release-3 texts in force', () => {
  it('FAIL under the release-2 texts, PASS under notice v14 / cgu v13, absent when none of them is open', async () => {
    const { evaluateReleasePreflight, R3_LEGAL_CAPABILITIES } = await import('../../scripts/release-preflight.mjs');
    expect([...R3_LEGAL_CAPABILITIES]).toEqual(['citizen.household', 'citizen.guardians', 'citizen.delegations']);
    const check = (/** @type {any} */ env) => evaluateReleasePreflight(env, { legalText: 'ok' }).find((/** @type {any} */ x) => x.id === 'legal.r3_household_trusted_guardians');
    expect(check({ ...R3, VITE_LEGAL_DOCS_APPROVED_VERSION: OPEN_R2 }).status).toBe('FAIL');
    expect(check({ ...R3, VITE_LEGAL_DOCS_APPROVED_VERSION: OPEN_R3 }).status).toBe('PASS');
    expect(check({ ...R2, VITE_LEGAL_DOCS_APPROVED_VERSION: OPEN_R2 })).toBeUndefined();
  });
});
