/**
 * FA-D1 — the synthetic LAB fixture of the persona suite (LAB_SYNTHETIC). Fictional people (@example.test), fictional organisations, LAB guides that only
 * point at the official Service-Public sheet they stand for (no legal content is written here), three official records of the SAME right with different
 * verification ages (current / update needed / beyond the 180-day rule). Called by e2e-fa1/run-lab.mjs on an empty, freshly migrated *_test database.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../api/_utils/password-hash.js';

const SP = (id) => `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}`;
const pw = () => `Lab-${crypto.randomBytes(9).toString('base64url')}-9a`;

/** @param {string} url */
export async function seed(url) {
  const u = new URL(url); if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) throw new Error('local *_test database only');
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    const out = { citizens: {}, structures: {}, pros: {}, guides: [], aides: {}, institutions: {}, admins: { a: 'fa1-admin-a@example.test', b: 'fa1-admin-b@example.test' } };
    // ── people (adult, verified address, adult statement in the append-only ConsentLog — as scripts/lab/seed-cdgg-conseil.mjs)
    const PEOPLE = { aine: 'Personne âgée fictive', locataire: 'Locataire fictif', famille: 'Parent fictif', arabophone: 'Personne arabophone fictive',
      clavier: 'Personne clavier fictive', retrait: 'Personne retrait fictive', golden: 'Personne parcours doré fictive', autre: 'Autre personne fictive' };
    for (const [k, name] of Object.entries(PEOPLE)) {
      const p = { id: `fa1-cit-${k}`, email: `fa1-${k}@usagers.example.test`, name, password: pw() };
      await c.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "notificationEmailEnabled", "updatedAt", "createdAt") VALUES ($1, $2, $3, NOW(), true, NOW(), NOW())`, [p.id, p.email, await hashPassword(p.password)]);
      await c.query(`INSERT INTO "CitizenProfile" ("userId", "displayName", "ageBand", "updatedAt") VALUES ($1, $2, $3, NOW())`, [p.id, p.name, k === 'aine' ? '60_plus' : '25-59']);
      await c.query(`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level)
        VALUES (gen_random_uuid()::text, 'CITIZEN_USER', $1, 'AGE_DECLARATION_ADULT', true, 'r42-a07-2026-11-04', 'r42-a07-2026-11-04:AGE_DECLARATION_ADULT', 'lab_fixture', false, 'SELF_DECLARATION')`, [p.id]);
      out.citizens[k] = p;
    }
    // ── organisations: X, Y, Z serve Strasbourg (INSEE 67482); M is in Mulhouse (Haut-Rhin) and serves Mulhouse only — another tenant
    const ORGS = {
      X: ['FA1 Accueil social fictif', 'Strasbourg', '67000', '{67482}'], Y: ['FA1 Bailleur social fictif', 'Strasbourg', '67100', '{67482}'],
      Z: ['FA1 Prévention expulsions fictive', 'Schiltigheim', '67300', '{67447,67482}'], M: ['FA1 Association Haut-Rhin fictive', 'Mulhouse', '68100', '{68224}'],
    };
    for (const [k, [nom, ville, cp, insee]] of Object.entries(ORGS)) {
      const id = `fa1-org-${k.toLowerCase()}`;
      await c.query(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, departement, insee_codes, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, data_origin, "updatedAt", "createdAt")
        VALUES ($1, $2, $1, 'association', '1 rue fictive', $3, $4, $5, $6::text[], $7, '{accompagnement logement,aide administrative}'::text[], '{tout_public}'::text[], '{social}'::text[], 'actif', 'VERIFIED', 'synthetic_fixture', NOW(), NOW())`,
      [id, nom, ville, cp, cp.slice(0, 2), insee, k === 'Z']);
      out.structures[k] = { id, nom, ville };
    }
    const PROS = { xa: ['X', 'STRUCTURE_ADMIN'], x1: ['X', 'PRO'], y1: ['Y', 'STRUCTURE_ADMIN'], z1: ['Z', 'STRUCTURE_ADMIN'], m1: ['M', 'STRUCTURE_ADMIN'] };
    for (const [k, [org, role]] of Object.entries(PROS)) {
      const p = { id: `fa1-pro-${k}`, email: `fa1-pro-${k}@pros.example.test`, structureId: out.structures[org].id, role };
      await c.query(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES ($1, $2, 'x', $3, 'active', $4, false, NOW())`, [p.id, p.email, p.role, p.structureId]);
      out.pros[k] = p;
    }
    // ── LAB guides standing for official sheets (the orientation resolves a published sheet to its page on the site); the text only points at the sheet
    for (const sheet of ['F10009', 'F31272', 'F24610', 'F33865']) {
      const g = { id: `fa1-guide-${sheet.toLowerCase()}`, slug: `fa1-guide-lab-${sheet.toLowerCase()}`, sheet };
      await c.query(`INSERT INTO "Guide" (id, slug, titre, resume_falc, statut, publics, contexte, mots_cles, sources_urls, published_at, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, 'publie', '{}', '{}', '{}', $5::text[], NOW(), NOW(), NOW())`,
      [g.id, g.slug, `Fiche LAB synthétique liée à la fiche officielle ${sheet}`, `Page de test LAB_SYNTHETIC. Lisez la fiche officielle ${sheet} sur service-public.gouv.fr.`, `{${SP(sheet)}}`]);
      out.guides.push(g);
    }
    // ── the same official right, verified 3, 120 and 200 days ago
    for (const [k, days] of [['fresh', 3], ['aging', 120], ['stale', 200]]) {
      const a = { id: `fa1-aide-${k}`, slug: `fa1-aide-lab-${k}` };
      await c.query(`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, ou_demander, "updatedAt")
        VALUES ($1, $2, $3, 'publie', true, 'VERIFIED', 'rev@example.test', true, 'official', NOW() - make_interval(days => $4), $5, 'Auprès de la Caf', NOW())`,
      [a.id, a.slug, `Aide LAB synthétique (${k}) — fiche F12006`, days, SP('F12006')]);
      out.aides[k] = a;
    }
    // ── institutions (signed agreement: synthetic) and administrators
    await c.query(`INSERT INTO "PartnerAgreement" (id, "partnerName", kind, status, "recordedBy", "signedAt", "documentRef", "signedByPartner") VALUES ('fa1-ag', 'Partenaire synthétique FA1', 'CONVENTION', 'SIGNED', $1, CURRENT_DATE - 1, 'SYNTHETIC-TEST-ONLY-FA1', 'Signataire synthétique')`, [out.admins.a]);
    for (const [k, terr] of [['bas_rhin', 'Bas-Rhin'], ['haut_rhin', 'Haut-Rhin']]) {
      const i = { id: `fa1-inst-${k}`, email: `fa1-inst-${k}@example.test`, passwordHash: `synthetic-not-a-hash-${k}` };
      await c.query(`INSERT INTO "InstitutionAccount" (id, email, "passwordHash", "organisationName", territory, status, "agreementId", "createdBy") VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'fa1-ag', $6)`,
        [i.id, i.email, i.passwordHash, `Institution synthétique ${terr}`, terr, out.admins.a]);
      out.institutions[k] = i;
    }
    for (const [k, email] of Object.entries(out.admins)) {
      await c.query(`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES ($1, $2, 'x', 'superadmin', NOW(), NOW(), 0, true)`, [`fa1-adm-${k}`, email]);
    }
    return out;
  } finally { await c.end(); }
}
