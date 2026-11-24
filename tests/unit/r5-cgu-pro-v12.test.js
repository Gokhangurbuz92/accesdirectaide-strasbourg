/**
 * R5 — cgu-professionnel v12-2026-11-25 (PROPOSED 25/11/2026): the approved v11-2026-11-24 plus EXACTLY two items in § 3 « use » — the encryption keys of
 * the dossiers shared with the organisation (/pro/partages-chiffres) and the job offers (X05). v11 unchanged byte for byte; nothing approved or activated.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as L from '../../src/config/legal-drafts.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

const keys = (/** @type {any} */ d) => Object.fromEntries(L.draftTextKeys(d));
const p11 = keys(L.LEGAL_DRAFT_DOCUMENTS_PRO_V11[0]);
const p12 = keys(L.LEGAL_DRAFT_DOCUMENTS_PRO_V12[0]);
const R4_APPROVED = 'cgu-citoyen@v14-2026-11-24,notice-confidentialite@v15-2026-11-24,cgu-professionnel@v11-2026-11-24,conditions-structures@v9-2026-11-23';
const WITH_V12 = 'cgu-citoyen@v14-2026-11-24,notice-confidentialite@v15-2026-11-24,cgu-professionnel@v12-2026-11-25,conditions-structures@v9-2026-11-23';

describe('cgu-professionnel v12-2026-11-25', () => {
  it('= v11 + exactly two items (use.encryption_v12, use.jobs_v12), nothing else changed', () => {
    expect(L.LEGAL_DRAFTS_PRO_V12).toBe('v12-2026-11-25');
    expect(Object.keys(p12).filter((k) => p11[k] !== p12[k]).sort()).toEqual(['use.encryption_v12', 'use.jobs_v12']);
    expect(Object.keys(p11).filter((k) => !(k in p12))).toEqual([]);
    const use = L.LEGAL_DRAFT_DOCUMENTS_PRO_V12[0].sections.find((s) => s.id === 'use');
    expect(Object.values(use.itemKeys).slice(-2)).toEqual(['encryption_v12', 'jobs_v12']);   // after delegate_v11
  });

  it('v11 is byte-identical to the approved text (hash taken before this change, commit 18329eb3)', () => {
    expect(createHash('sha256').update(JSON.stringify(L.LEGAL_DRAFT_DOCUMENTS_PRO_V11)).digest('hex')).toBe('fbe14a1bec589edee4477d7cb6760abd67c71b4cedca50b382ff0c03228d76c1');
  });

  it('a draft, the newest of that document; not in force while the approved list names v11; in force once named', () => {
    const d = L.LEGAL_DRAFT_DOCUMENTS_PRO_V12[0];
    expect(d.status).toBe(L.LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
    expect(L.LEGAL_DRAFTS_PRO_V12_STATUS).toMatch(/^DRAFT — proposée le 25\/11\/2026/);
    expect(L.latestDraftVersionOf('cgu-professionnel')).toBe('v12-2026-11-25');
    expect(L.knownApprovalToken('cgu-professionnel@v12-2026-11-25')).toBe(true);
    expect(L.approvedVersionOf('cgu-professionnel', R4_APPROVED)).toBe('v11-2026-11-24');
    expect(L.approvedVersionOf('cgu-professionnel', WITH_V12)).toBe('v12-2026-11-25');
    expect(L.approvedAtLeast('cgu-professionnel', L.LEGAL_DRAFTS_PRO_V11, WITH_V12)).toBe(true);   // the release-3 preflight stays satisfied
    expect([...L.LEGAL_DRAFT_VERSIONS].at(-1)).toBe('v12-2026-11-25');
  });

  it('clause 1 states what the code does: personal passphrase, administrator gives access, departure → key change, no recovery by AccesDirectAide', () => {
    const t = p12['use.encryption_v12'];
    expect(t).toMatch(/^Dossiers chiffrés partagés avec votre structure \(lorsque cette fonction est ouverte\)/);
    expect(t).toMatch(/phrase secrète personnelle/);
    expect(t).toMatch(/l'administrateur de la structure crée la clé de la structure et en donne l'accès aux membres/);
    expect(t).toMatch(/l'administrateur change la clé de la structure/);
    expect(t).toMatch(/AccesDirectAide ne peut ni retrouver ni réinitialiser une phrase secrète ou la clé de la structure/);
    // the code facts it relies on
    expect(readFileSync('src/pages/pro/PartagesChiffres.jsx', 'utf8')).toMatch(/Changer la clé de la structure \(après le départ d’un membre\)/);
    expect(readFileSync('src/components/hds/HdsUnlock.jsx', 'utf8')).toMatch(/Personne ne peut la retrouver pour vous/);
    const svc = readFileSync('services/hds/src/sharing.js', 'utf8');
    expect(svc).toMatch(/if \(p\.role !== 'STRUCTURE_ADMIN'\) return fail\(403, 'ADMIN_ONLY'/);
    expect(svc).toMatch(/DELETE FROM hds\.org_key_member WHERE member_id = \$1/);   // a replaced personal key loses its access until re-given
    expect(readFileSync('api/_handlers/pro/hds-ticket.js', 'utf8')).toMatch(/u\.status = 'active'/);   // a deactivated member gets no ticket
  });

  it('clause 2: non-discrimination with the verified articles, review before publication, refusal with a reason, removal; no entitlement claim', () => {
    const t = p12['use.jobs_v12'];
    for (const a of ['L1132-1', 'L1142-1', 'L5331-2', 'L5331-3', 'L5331-4']) expect(t).toContain(`article ${a}`);
    expect(t).toMatch(/Chaque offre est relue avant sa publication : AccesDirectAide peut la refuser, en indiquant le motif, et retirer à tout moment une offre publiée/);
    expect(t).toMatch(/seul un administrateur d'une structure vérifiée par AccesDirectAide publie les offres/);
    const svc = readFileSync('api/_services/job-board.js', 'utf8');
    expect(svc).toMatch(/FORBIDDEN_CRITERION/);
    expect(svc).toMatch(/STRUCTURE_ADMIN_REQUIRED/);
    for (const k of ['use.encryption_v12', 'use.jobs_v12']) expect(claimsEntitlement(p12[k]), k).toBe(false);
  });

  it('six languages: both keys translated, French legal names kept', () => {
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/legaldraft.json`, 'utf8'));
      expect(loc['cguPro.use.encryption_v12'], lang).toBeTruthy();
      expect(loc['cguPro.use.jobs_v12'], lang).toMatch(/Code du travail/);
      for (const a of ['L1132-1', 'L1142-1', 'L5331-2', 'L5331-3', 'L5331-4']) expect(loc['cguPro.use.jobs_v12'], `${lang} ${a}`).toContain(a);
      expect(loc['cguPro.use.encryption_v12'], lang).toContain('AccesDirectAide');
    }
  });
});
