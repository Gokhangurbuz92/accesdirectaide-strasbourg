/**
 * RC5 security closure - offline contract tests (no database).
 *  1. security-critical modules are type-checked (no @ts-nocheck);
 *  2. every shareId-keyed pro handler goes through the grant helper (a bare shareId can never be re-introduced silently);
 *  3. purpose-specific consent schema;
 *  4. no false "end-to-end / zero-knowledge" claim in user-visible copy, and the crypto modules say what they really are;
 *  5. owner-secret browser storage: expiry purge, scrub, forget.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proConsentSchema, publicDossierGrantsSchema } from '../../api/_utils/schemas.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('RC5 security-critical modules', () => {
  it.each(['api/_utils/share-access.js', 'api/_handlers/pro/dossier/redeem.js', 'api/_handlers/public/dossier-grants.js', 'api/_handlers/public/dossier-revoke.js', 'api/_services/key-rotation.js'])('%s is type-checked (no @ts-nocheck)', (f) => {
    expect(read(f)).not.toMatch(/^\s*\/\/\s*@ts-nocheck/m);   // the directive, not a mention in prose
  });

  it.each([
    'api/_handlers/pro/dossier.js', 'api/_handlers/pro/dossier/export.js', 'api/_handlers/pro/dossier/views.js', 'api/_handlers/pro/dossier/upload-secure.js',
    'api/_handlers/pro/dossier-synthesis.js', 'api/_handlers/pro/consent.js', 'api/_handlers/pro/interop-siao.js',
  ])('%s authorizes through the structure grant helper, never through the shareId alone', (f) => {
    expect(read(f)).toMatch(/resolveDossierForStructure/);
  });
  it('secure-messages (dossier path) requires an active grant and the revoke/passport/grants handlers require the OWNER secret', () => {
    expect(read('api/_handlers/secure-messages.js')).toMatch(/findActiveGrant/);
    for (const f of ['api/_handlers/public/dossier-revoke.js', 'api/_handlers/public/passport.js', 'api/_handlers/public/dossier-grants.js']) expect(read(f)).toMatch(/holdsOwnerSecret|holdsOwnership/);
    expect(read('api/_handlers/pro/dossier/redeem.js')).toMatch(/holdsShareToken/);
    expect(read('api/_handlers/public/dossier-revoke.js')).not.toMatch(/holdsShareToken/);   // a share token never confers destructive rights
  });
});

describe('RC5 purpose-specific consent (PURP-05 AI / PURP-06 sharing) is the CITIZEN\'s, per organization', () => {
  const base = { shareId: 'd', signatureData: 'data:image/png;base64,AAAA' };
  it('a professional can only record PURP-06; PURP-05 and anything else is refused by the schema', () => {
    expect(proConsentSchema.safeParse(base).success).toBe(true);
    expect(proConsentSchema.safeParse({ ...base, purposes: ['PURP-06'] }).success).toBe(true);
    for (const bad of [['PURP-05'], ['PURP-05', 'PURP-06'], ['PURP-99'], [], 'PURP-06']) expect(proConsentSchema.safeParse({ ...base, purposes: bad }).success).toBe(false);
  });
  it('the owner endpoint accepts exactly the two matrix purposes', () => {
    const owner = { shareId: 'd', action: 'set_purposes', structureId: 's' };
    expect(publicDossierGrantsSchema.safeParse({ ...owner, purposes: ['PURP-06', 'PURP-05'] }).success).toBe(true);
    for (const bad of [['PURP-07'], ['x']]) expect(publicDossierGrantsSchema.safeParse({ ...owner, purposes: bad }).success).toBe(false);
    expect(publicDossierGrantsSchema.safeParse({ shareId: 'd', action: 'delete' }).success).toBe(false);
  });
  it('the AI synthesis handler authorizes through the owner-set grant purpose, never through a professional-recorded consent', () => {
    const src = read('api/_handlers/pro/dossier-synthesis.js');
    expect(src).toMatch(/grantHasPurpose\(found\.grant, PURPOSE_AI\)/); expect(src).toMatch(/AI_CONSENT_REQUIRED/);
    expect(src).not.toMatch(/_consent\??\.(signed|purposes)/);
    expect(src).toMatch(/delete safeData\._followUps/); expect(src).toMatch(/delete safeData\._consent/); expect(src).toMatch(/delete safeData\._files/);
    expect(src).not.toMatch(/\.situation\b|situation\s*:/);                                 // the citizen's situation is never part of the prompt (code, not prose)
  });
});

describe('RC5 legacy links, invitations and membership (static contract)', () => {
  it('a legacy row has no owner and a recipient link is never ownership; the transitional read path is flag-gated', () => {
    const src = read('api/_utils/share-access.js');
    expect(src).toMatch(/!isLegacyShare\(shared\) && verifyCapability/); expect(src).toMatch(/ADA_LEGACY_SHARE_READ/);
    expect(read('api/_handlers/share/thread.js')).toMatch(/holdsOwnerSecret|holdsOwnership/);
  });
  it('redeem: organization-bound invitation, atomic single use, membership checked; a share link alone never authorizes an organization (non-legacy)', () => {
    const src = read('api/_handlers/pro/dossier/redeem.js');
    expect(src).toMatch(/invite\.structureId !== ctx\.structureId/); expect(src).toMatch(/isNull\(SharedDossierInvite\.usedAt\)/); expect(src).toMatch(/isActiveMember\(ctx\)/);
    expect(src).toMatch(/isLegacyShare\(shared\) && legacyShareReadEnabled\(\)/);
  });
  it('every write path re-checks grant AND active membership inside the statement (departure / revocation cannot be raced)', () => {
    expect(read('api/_utils/share-access.js')).toMatch(/upper\(u\.role\) IN \('PRO', 'STRUCTURE_ADMIN'\)/);
    for (const f of ['api/_handlers/pro/dossier.js', 'api/_handlers/pro/dossier/upload-secure.js', 'api/_handlers/pro/consent.js']) expect(read(f)).toMatch(/activeGrantExists\(shareId, proCtx\)/);
  });
  it('the login redirect no longer drops the invitation (fragment kept for this tab only)', () => {
    expect(read('src/lib/pendingInvite.js')).toMatch(/ada_pending_invite/); for (const f of ['src/components/ProGuard.jsx', 'src/pages/pro/ProLayout.jsx']) expect(read(f)).toMatch(/rememberPendingInvite/); expect(read('src/pages/pro/ProLayout.jsx')).toMatch(/pendingInvitePath/); expect(read('src/pages/pro/SharedDossier.jsx')).toMatch(/takePendingInvite/);
  });
});

describe('RC5 citizen sharing journey (static contract of the UI)', () => {
  const panel = () => read('src/components/sharing/CitizenSharingPanel.jsx');
  it('keeps four DISTINCT actions in plain language and never offers an ambiguous "revoke all"', () => {
    for (const label of ['Partager avec une structure', 'Retirer l\'accès de cette structure', 'Arrêter de partager', 'Supprimer mes données']) expect(panel()).toContain(label.replace(/'/g, '&apos;'));
    expect(read('src/pages/UserPassport.jsx')).not.toMatch(/Révoquer tous les accès/);
    expect(read('src/pages/UserPassport.jsx')).toMatch(/CitizenSharingPanel/);
  });
  it('is operable without a mouse and announces results (labels, live region, focus target, 44px targets)', () => {
    const src = panel();
    expect(src).toMatch(/htmlFor="org-search"/); expect(src).toMatch(/role="status"/); expect(src).toMatch(/aria-live="polite"/); expect(src).toMatch(/statusRef\.current\?\.focus\(\)/); expect(src).toMatch(/min-h-\[44px\]/);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/); expect(src).not.toMatch(/console\./);
  });
  it('the AI purpose is OFF by default and separate from sharing (checkbox, explicit text); erasure states the lawful-retention caveat', () => {
    const src = panel();
    expect(src).toMatch(/Désactivé par défaut/); expect(src).toMatch(/L&apos;analyse automatisée par IA n&apos;est PAS incluse/); expect(src).toMatch(/traces techniques/);
  });
  it('secrets never reach a URL query string or a log', () => {
    for (const f of ['src/components/sharing/CitizenSharingPanel.jsx', 'src/pages/UserPassport.jsx', 'src/pages/pro/SharedDossier.jsx', 'src/lib/shareOwner.js']) {
      const src = read(f);
      expect(src, f).not.toMatch(/\?(owner|invite|token|rightsSecret)=/); expect(src, f).not.toMatch(/console\.(log|info|debug)/);
    }
  });
});

describe('RC5 honest confidentiality claims', () => {
  const FALSE_CLAIMS = [/chiffrés de bout en bout/i, /Sécurisé E2EE/, /Chiffrement E2EE/, /Chiffrement E2E\b/, /Certification Impact Social/, /Messagerie E2EE/, /Architecture Zero-Knowledge/i, /Zero-Knowledge :/i, /même un administrateur ne peut pas lire/i, /Ni ADA ni votre hébergeur ne peuvent lire/i];
  it.each([
    'src/components/Messaging/SecureChat.jsx', 'src/components/OnboardingTour.jsx', 'src/pages/pro/Team.jsx', 'src/pages/pro/RegisterPro.jsx',
    'src/pages/UserPassport.jsx', 'src/components/FileVault.jsx', 'src/pages/MentionsLegales.jsx',
    'src/pages/pro/Login.jsx', 'src/pages/pro/ImpactReports.jsx',   // owner usefulness pass (2026-10-25)
  ])('%s makes no false end-to-end / zero-knowledge claim', (f) => {
    const src = read(f);
    for (const rx of FALSE_CLAIMS) expect(src, `${f} ${rx}`).not.toMatch(rx);
  });
  it('the crypto modules state that the key is derived from a server-known identifier and that this is not E2EE', () => {
    expect(read('src/lib/crypto-messaging.js')).toMatch(/NOT end-to-end encryption/);
    expect(read('src/lib/crypto-messaging.js')).toMatch(/server/i);
    expect(read('src/lib/crypto-files.js')).toMatch(/NOT end-to-end/);
  });
});

describe('RC5 owner-secret browser storage', () => {
  let store;
  beforeEach(async () => {
    store = new Map();
    globalThis.window = {
      location: { hash: '', pathname: '/passport/x', search: '' }, history: { replaceState(_a, _b, url) { globalThis.window.location.hash = ''; globalThis.__lastUrl = url; } },
      localStorage: { get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null, getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    };
  });
  afterEach(() => { delete globalThis.window; });

  it('remembers with the dossier expiry, returns it while valid, purges expired and unparseable entries, forgets on revoke', async () => {
    const m = await import('../../src/lib/shareOwner.js');
    m.rememberOwnerSecret('live', 'secret-live', new Date(Date.now() + 3600_000).toISOString());
    m.rememberOwnerSecret('dead', 'secret-dead', new Date(Date.now() - 1000).toISOString());
    store.set('ada_share_owner_junk', 'not-json');
    expect(m.resolveOwnerSecret('live')).toBe('secret-live');
    expect(m.resolveOwnerSecret('dead')).toBe('');
    expect([...store.keys()].sort()).toEqual(['ada_share_owner_live']);                       // expired + junk are gone
    m.forgetOwnerSecret('live'); expect(m.resolveOwnerSecret('live')).toBe('');
  });
  it('#owner= is taken from the fragment, scrubbed from the address and remembered', async () => {
    const m = await import('../../src/lib/shareOwner.js');
    globalThis.window.location.hash = '#owner=abc123';
    expect(m.resolveOwnerSecret('d1')).toBe('abc123');
    expect(globalThis.window.location.hash).toBe(''); expect(globalThis.__lastUrl).toBe('/passport/x');
    expect(m.resolveOwnerSecret('d1')).toBe('abc123');                                           // remembered for later visits
  });
});
