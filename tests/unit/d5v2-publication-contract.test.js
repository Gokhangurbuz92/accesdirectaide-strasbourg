/**
 * Owner decision D-5 v2 (2026-10-25, confirmed by the owner's definitive directive): the publication contract of PUBLIC INFORMATION (aides, démarches,
 * dispositifs, structures, directory data) — evidence-based automatic publication, no routine human approval, truthful machine attribution.
 *
 * It replaces, as the current contract, the legacy WS2 launch-data gate (tests/unit/ws8-frozen-launch-data.test.js, a frozen WS8 test kept unchanged as historical
 * evidence): that gate required the static seed files to carry « verifiedCurrent / launchReady » flags set by a person's review of the files; under D-5 v2 no
 * person reviews each record, and what is public is decided on the live records, each with its own decision and evidence. Three kinds of contract are kept
 * apart:
 *  1. legacy human verification of files (WS2): historical, still run, expected to fail while the seed files are not flagged by a person;
 *  2. current automatic source verification (this file and tests/integration/veille-*-db.test.js): a record is public only with a VERIFIED decision in the
 *     append-only ledger, an https evidence on an official source, territory confirmed, no hold, provenance; the system's decisions are attributed to
 *     « ada-veille-automatique » (role system) — never presented as a person's; what breaks the contract is withdrawn by the self-check;
 *  3. genuine human approvals that stay human (personal data, DSR / erasure, legal holds, organization closure, privileged accounts): the automatic chain has
 *     no access to them (it imports none of their services) and their routes still require a named administrator with MFA.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { decide } = await import('../../api/lib/publicVisibility.js');
const { recordVerification, evidenceUrlAllowed } = await import('../../api/_services/content-verification.js');
const { SYSTEM_REVIEWER } = await import('../../api/_services/verification/chain.js');
const { WITHDRAW_ON, CONTRACT, publicationAudit } = await import('../../api/_services/verification/audit.js');
const { falcLabel } = await import('../../src/lib/falcLabel.js');

const NOW = new Date('2026-10-25T12:00:00Z');
const published = (x = {}) => ({ statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'ada-veille-automatique', territory_verified: true, publication_hold: null,
  data_origin: 'official', date_verification: new Date('2026-10-25T03:20:00Z'), source_url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1280', ...x });

describe('D-5 v2 — what is public', () => {
  it('a record verified by the automatic chain, with evidence and territory, no hold, is public like any verified record (no human approval required)', () => {
    expect(decide(published(), 'aide', { now: NOW, mode: 'strict' })).toMatchObject({ visible: true, contentStatus: 'VERIFIED' });
    expect(decide(published({ statut: 'actif' }), 'structure', { now: NOW, mode: 'strict' }).visible).toBe(true);
    expect(decide(published(), 'dispositif', { now: NOW, mode: 'strict' }).visible).toBe(true);
  });
  it('fail-closed: unverified, held (by the system or a person), without provenance or territory, or a synthetic record: never public', () => {
    for (const [x, reason] of [[{ verification_status: 'UNVERIFIED' }, 'NOT_VERIFIED'], [{ publication_hold: 'Veille automatique : source officielle retirée' }, 'PUBLICATION_HOLD'],
      [{ publication_hold: 'PRIVACY_REVIEW: numéro personnel' }, 'PUBLICATION_HOLD'], [{ source_url: null }, 'NO_PROVENANCE'], [{ territory_verified: false }, 'TERRITORY_NOT_VERIFIED'],
      [{ data_origin: 'synthetic_fixture' }, 'LAB_ORIGIN_NOT_PUBLIC_IN_STRICT_MODE']]) {
      const d = decide(published(x), 'aide', { now: NOW, mode: 'strict' });
      expect(d.visible, reason).toBe(false); expect(d.reasons).toContain(reason);
    }
  });
});

describe('D-5 v2 — every decision has its evidence and its true author', () => {
  const input = (x = {}) => ({ entityType: 'aide', entityId: 'a1', action: 'VERIFY', reviewer: SYSTEM_REVIEWER, sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1280',
    evidenceNote: 'Vérification automatique : fiche F1280 du flux officiel Service-Public.', territoryConfirmed: true, ...x });
  it('the automatic chain is the service actor « ada-veille-automatique », role system — never a person', () => {
    expect(SYSTEM_REVIEWER).toEqual({ id: 'ada-veille-automatique', role: 'system' });
    expect(Object.isFrozen(SYSTEM_REVIEWER)).toBe(true);
  });
  it('a verification without evidence, territory or an official https source is refused (before anything is written)', async () => {
    const db = {};   // the checks come first: the database is never reached
    expect(await recordVerification(input({ evidenceNote: 'court' }), { db })).toMatchObject({ ok: false, code: 'EVIDENCE_NOTE_REQUIRED' });
    expect(await recordVerification(input({ territoryConfirmed: false }), { db })).toMatchObject({ ok: false, code: 'TERRITORY_CONFIRMATION_REQUIRED' });
    expect(await recordVerification(input({ sourceUrl: 'https://www.service-public-gouv.info/F1280' }), { db })).toMatchObject({ ok: false, code: 'EVIDENCE_URL_NOT_ALLOWED' });
    expect(await recordVerification(input({ sourceUrl: 'http://www.service-public.gouv.fr/x' }), { db })).toMatchObject({ ok: false, code: 'EVIDENCE_URL_NOT_ALLOWED' });
    expect(await recordVerification(input({ reviewer: { role: 'system' } }), { db })).toMatchObject({ ok: false });
  });
  it('evidence on a site the registry attests is accepted; a look-alike is not', () => {
    expect(evidenceUrlAllowed('https://www.mairie-x.fr/aides', {}, ['mairie-x.fr'])).toBe(true);
    expect(evidenceUrlAllowed('https://www.mairie-x.fr.evil.example/aides', {}, ['mairie-x.fr'])).toBe(false);
  });
  it('the self-check withdraws at once a public record without a ledger decision, with evidence outside the official sources, showing a personal address, or with texts older than its source (contract v2)', () => {
    expect([...WITHDRAW_ON].sort()).toEqual(['EVIDENCE', 'LEDGER', 'PRIVACY', 'TEXTS']);
    expect(CONTRACT).toMatchObject({ version: 2, clauses: ['LEDGER', 'EVIDENCE', 'PRIVACY', 'FRESHNESS', 'DUPLICATE', 'TEXTS'] });
  });
  it('contract v2 / TEXTS: a summary written before the source\'s last important change is a violation; one written after is not', async () => {
    const row = (id, textsAt) => ({ id, title: id, verified_by: 'ada-veille-automatique', auto_check: { importantChangeAt: '2026-10-20', texts: { at: textsAt }, nextCheckAt: '2026-10-26T00:00:00Z', checkedAt: '2026-10-25T03:00:00Z' } });
    const fake = { execute: async (q) => {
      const text = JSON.stringify(q);
      if (/ContentVerification/.test(text)) return { rows: [{ id: 'old', url: 'https://www.service-public.gouv.fr/x', reviewer: 'ada-veille-automatique' }, { id: 'new', url: 'https://www.service-public.gouv.fr/y', reviewer: 'ada-veille-automatique' }] };
      return { rows: text.includes('FROM \\"Aide\\"') ? [row('old', '2026-10-01T03:00:00Z'), row('new', '2026-10-21T03:00:00Z')] : [] };
    } };
    const out = await publicationAudit({ db: fake, now: NOW });
    expect(out.contract).toBe('D-5 v2 — contrat de publication v2');
    expect(out.violations.map((v) => [v.id, v.code])).toEqual([['old', 'TEXTS']]);
  });
  it('labels tell an automatic check from a person’s reading; nothing claims that readers tested a text', () => {
    expect(falcLabel(true, { auto: '2026-10-25T03:20:00Z' })).toBe('Version simplifiée (contrôlée automatiquement)');
    expect(falcLabel(true, { auto: '2026-10-25T03:20:00Z' })).not.toMatch(/relue|validée|testée/);
    const note = fs.readFileSync(path.join(process.cwd(), 'src/components/AutoVerificationNote.jsx'), 'utf8');
    expect(note).toMatch(/Informations vérifiées automatiquement le/);
    expect(note).toMatch(/ni une validation de l’administration ni un conseil juridique/);
    expect(note).not.toMatch(/test[ée]e? (par|avec) des lecteurs|relue par/i);
  });
});

describe('D-5 v2 — genuine human approvals stay human', () => {
  const dir = path.join(process.cwd(), 'api/_services/verification');
  it('the automatic chain has no access to personal data, DSR / erasure, legal holds, closures, privileged accounts', () => {
    const forbidden = /(dsr|erasure|privacy-console|legal-hold|org-closure|org-lifecycle|admin-identity|elevation|citizen|dossier|share|messag)/i;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const imports = [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(imports.filter((i) => forbidden.test(i)), f).toEqual([]);
    }
  });
  it('their routes still require a named administrator with MFA', () => {
    const erasure = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/admin/dsr-erasure.js'), 'utf8');
    expect(erasure).toMatch(/HUMAN_MFA_SESSION_REQUIRED/);
  });
  it('the legacy WS2 launch-data test is kept unchanged as historical evidence (not rewritten to pass)', () => {
    const legacy = fs.readFileSync(path.join(process.cwd(), 'tests/unit/ws8-frozen-launch-data.test.js'), 'utf8');
    expect(legacy).toMatch(/WS8 frozen Strasbourg launch-data gate/);
    expect(legacy).toMatch(/verifyWs2Data/);
  });
});
