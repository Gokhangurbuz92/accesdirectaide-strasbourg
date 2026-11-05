#!/usr/bin/env node
/**
 * R46 finish — seeds a LOCAL disposable LAB database (synthetic data only, every identifier « r46f- », every address …@example.test):
 *  - C05: three minor ↔ guardian links — two waiting for the strong check (STRONGER_VERIFICATION_REQUIRED), one only e-mail confirmed (must NOT be listed);
 *  - Q01 / Q05: a small published catalogue (structures, aides, démarches) so the keyboard journey and the load budget have pages to read.
 * Prints nothing personal; writes the link identifiers to --out (outside the repository).   node --import tsx e2e-r46/finish/seed.mjs --out <file>
 */
import fs from 'node:fs';
import pg from 'pg';

const out = process.argv[process.argv.indexOf('--out') + 1];
const u = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) { console.error('refusing: local *_test database only'); process.exit(3); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const ts = Date.now().toString(36);
const q = (s, p = []) => c.query(s, p);

// C05 links (the people are synthetic accounts with no password)
const people = [['g1', '25-59'], ['g2', '25-59'], ['m1', 'moins-de-18'], ['m2', 'moins-de-18'], ['m3', 'moins-de-18']].map(([k, band]) => ({ id: `r46f-${k}-${ts}`, email: `r46f-${k}-${ts}@example.test`, band }));
for (const p of people) {
  await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, 'unset:x', NOW(), NOW())`, [p.id, p.email]);
  await q(`INSERT INTO "CitizenProfile" ("userId", "ageBand", "displayName", "updatedAt") VALUES ($1, $2, 'Personne synthétique', NOW())`, [p.id, p.band]);
}
const [g1, g2, m1, m2, m3] = people;
const links = { strong1: `r46f-l1-${ts}`, strong2: `r46f-l2-${ts}`, emailOnly: `r46f-l3-${ts}` };
await q(`INSERT INTO "GuardianRelationship" (id, "minorId", "guardianId", status, scopes, "createdAt", "updatedAt") VALUES
  ($1, $2, $3, 'STRONGER_VERIFICATION_REQUIRED', '[]'::jsonb, NOW() - interval '3 days', NOW()),
  ($4, $5, $6, 'STRONGER_VERIFICATION_REQUIRED', '[]'::jsonb, NOW() - interval '1 day', NOW()),
  ($7, $8, $3, 'EMAIL_VERIFIED', '[]'::jsonb, NOW(), NOW())`, [links.strong1, m1.id, g1.id, links.strong2, m2.id, g2.id, links.emailOnly, m3.id]);

// Q01 / Q05 catalogue: published, verified, official-source records (the public visibility rules of api/lib/publicVisibility.js)
const V = `'publie', true, 'VERIFIED', 'verification-automatique', true, 'official_source', NOW() - interval '3 days', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006'`;
const COLS = 'statut, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url';
for (let i = 1; i <= 12; i += 1) {
  await q(`INSERT INTO "Structure" (id, slug, nom, ville, code_postal, services, publics_accueillis, categories_aidees, ${COLS}, "updatedAt", "createdAt")
    VALUES ($1, $1, $2, 'Strasbourg', '67000', ARRAY[]::text[], ARRAY[]::text[], ARRAY['Accès aux droits'], ${V.replace("'publie'", "'actif'")}, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [`r46f-structure-${i}`, `Structure synthétique ${i}`]);
}
const AIDES = [['aide-synthetique-loyer', 'Aide synthétique pour payer le loyer', 'Fiche de test : aide synthétique pour réduire le loyer.', 'logement'],
  ['aide-synthetique-energie', 'Aide synthétique pour les factures d’énergie', 'Fiche de test : aide synthétique pour payer l’énergie du logement.', 'logement'],
  ['aide-synthetique-sante', 'Aide synthétique pour les frais de santé', 'Fiche de test : aide synthétique pour les frais de santé.', 'santé']];
for (const [slug, titre, quoi, cat] of AIDES) {
  await q(`INSERT INTO "Aide" (id, slug, titre, cest_quoi, categorie, ${COLS}, "updatedAt", published_at) VALUES ($1, $2, $3, $4, $5, ${V}, NOW(), NOW() - interval '3 days') ON CONFLICT DO NOTHING`, [`r46f-${slug}`, slug, titre, quoi, cat]);
}
await q(`INSERT INTO "Demarche" (id, slug, titre, description_courte, categorie, ${COLS}, "updatedAt", published_at) VALUES ($1, $2, $3, $4, 'logement', ${V}, NOW(), NOW() - interval '3 days') ON CONFLICT DO NOTHING`,
  ['r46f-demarche-logement', 'demarche-synthetique-logement-social', 'Démarche synthétique : demander un logement social', 'Fiche de test : démarche synthétique de logement social.']);
await c.end();
fs.writeFileSync(out, JSON.stringify({ links }), { mode: 0o600 });
console.log('seeded');
