#!/usr/bin/env node
/**
 * R47 quality — a « production-like » SYNTHETIC catalogue and activity on a LOCAL disposable LAB database (schema 0042 columns only), for the whole-product
 * crawl (crawl.pw.mjs) and the load acceptance (load.mjs). Run AFTER `scripts/lab/seed-cdgg-conseil.mjs seed` (the fictional pilot organisation whose
 * agenda, team and booking pages are crawled). Every identifier starts with « r47q- », every address is …@example.test, every text is a placeholder.
 * Volumes (Production order of magnitude: 1,639 structures): 1,600 public structures, 40 aides, 20 démarches, 10 dispositifs, 6 guides, 12 news items,
 * 2,000 citizens, 6,000 appointments (2,000 of them in the pilot's agenda), 5,000 audit rows, one institutional account under a signed agreement.
 *   DATABASE_URL=postgres://…@127.0.0.1:55434/<…_test> node --import tsx e2e-r47/quality/seed.mjs --out <file outside the repository>
 * Writes the slugs the crawl visits to --out (no secret: the sessions are minted by mint.mjs).
 */
import fs from 'node:fs';
import pg from 'pg';

const out = process.argv[process.argv.indexOf('--out') + 1];
const u = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) { console.error('refusing: local *_test database only'); process.exit(3); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const q = (/** @type {string} */ s, /** @type {any[]} */ p = []) => c.query(s, p);
const N = { structures: 1600, aides: 40, demarches: 20, dispositifs: 10, guides: 6, news: 12, citizens: 2000, appointments: 4000, pilotAppointments: 2000, audit: 5000 };

// the public visibility rules of api/lib/publicVisibility.js: published, verified, official source
const V = `true, 'VERIFIED', 'verification-automatique', true, 'official_source', NOW() - interval '3 days', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006'`;
const COLS = 'launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url';
const CATS = ['logement', 'santé', 'emploi', 'famille', 'handicap', 'énergie', 'mobilité', 'alimentation'];

await q('BEGIN');
await q(`DELETE FROM "AuditLog" WHERE id LIKE 'r47q-%'`);
await q(`DELETE FROM "ProAppointment" WHERE id LIKE 'r47q-%'`);
for (const t of ['ProRdvService', 'ProAvailabilityRule', 'StructureRdvSettings']) await q(`DELETE FROM "${t}" WHERE id LIKE 'r47q-%'`);
await q(`DELETE FROM "CitizenProfile" WHERE "userId" LIKE 'r47q-%'`);
await q(`DELETE FROM "CitizenUser" WHERE id LIKE 'r47q-%'`);
for (const t of ['Structure', 'Aide', 'Demarche', 'Dispositif', 'Guide', 'Actualite']) await q(`DELETE FROM "${t}" WHERE id LIKE 'r47q-%'`);
await q(`DELETE FROM "InstitutionAccount" WHERE id LIKE 'r47q-%'`); await q(`DELETE FROM "PartnerAgreement" WHERE id LIKE 'r47q-%'`);

// 1,600 structures over the Bas-Rhin postcodes, 8 categories, a quarter with appointments (service + weekly hours + published booking)
await q(`INSERT INTO "Structure" (id, slug, nom, type_structure, description_courte, adresse, ville, code_postal, departement, telephone, horaires, services, publics_accueillis,
    categories_aidees, mots_cles, statut, status, is_pro_enabled, latitude, longitude, ${COLS}, "updatedAt", "createdAt")
  SELECT 'r47q-str-' || lpad(g::text, 4, '0'), 'r47q-structure-' || g,
    -- names as varied as a real directory (a kind, a place, a theme): identical names would make the duplicate scan of the administration see 160,000 pairs
    (ARRAY['Association', 'Centre social', 'Maison des solidarités', 'Point d’accueil', 'Permanence', 'Espace', 'Antenne', 'Service', 'Foyer', 'Bureau'])[1 + g % 10] || ' ' ||
    (ARRAY['Neudorf', 'Cronenbourg', 'Hautepierre', 'Koenigshoffen', 'Meinau', 'Esplanade', 'Robertsau', 'Elsau', 'Montagne Verte', 'Port du Rhin', 'Krutenau', 'Gare',
      'Neuhof', 'Bischheim', 'Hoenheim', 'Lingolsheim', 'Ostwald', 'Eckbolsheim', 'Wolfisheim', 'Vendenheim'])[1 + (g / 10) % 20] || ' ' ||
    (ARRAY['emploi', 'logement', 'familles', 'jeunesse', 'santé', 'seniors', 'numérique', 'droits', 'énergie', 'mobilité', 'alimentation', 'handicap', 'insertion'])[1 + (g / 200) % 13]
    || ' (synthétique ' || g || ')',
    (ARRAY['association', 'ccas', 'service_public', 'centre_social'])[1 + g % 4],
    'Fiche de test : structure synthétique ' || g || ' (accueil, orientation, accès aux droits).', g || ' rue Synthétique',
    (ARRAY['Strasbourg', 'Schiltigheim', 'Illkirch-Graffenstaden', 'Haguenau', 'Sélestat', 'Saverne', 'Obernai', 'Molsheim'])[1 + g % 8],
    (ARRAY['67000', '67100', '67200', '67300', '67400', '67500', '67600', '67700', '67210', '67120', '67800', '67380', '67540', '67450', '67118', '67150',
      '67230', '67240', '67250', '67260', '67270', '67280', '67290', '67310', '67320', '67330', '67340', '67350', '67360', '67370'])[1 + g % 30], '67', '03 00 00 00 00', 'Lundi au vendredi 9 h – 12 h (synthétique)',
    ARRAY['Accueil', 'Orientation'], ARRAY['tout_public'], ARRAY[($1::text[])[1 + g % 8], ($1::text[])[1 + (g + 3) % 8]], ARRAY['synthétique'], 'actif', 'actif', g % 4 = 0,
    48.58 + (g % 40) * 0.01, 7.75 + (g % 30) * 0.01, ${V}, NOW(), NOW() - interval '400 days'
  FROM generate_series(1, $2) g`, [CATS, N.structures]);
await q(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") SELECT 'r47q-svc-' || substr(id, 10), id, 'Permanence synthétique', 30, NOW() FROM "Structure" WHERE id LIKE 'r47q-str-%' AND is_pro_enabled`);
await q(`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "publishedAt", "updatedAt") SELECT 'r47q-set-' || substr(id, 10), id, true, 'IN_PERSON', NOW(), NOW() FROM "Structure" WHERE id LIKE 'r47q-str-%' AND is_pro_enabled`);
await q(`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt")
  SELECT 'r47q-rule-' || substr(s.id, 10) || '-' || wd, s.id, wd, '09:00', '17:00', 'Europe/Paris', true, NOW() FROM "Structure" s, generate_series(1, 5) wd WHERE s.id LIKE 'r47q-str-%' AND s.is_pro_enabled`);

await q(`INSERT INTO "Aide" (id, slug, titre, cest_quoi, categorie, statut, published_at, ${COLS}, "updatedAt")
  SELECT 'r47q-aide-' || g, 'r47q-aide-synthetique-' || g, 'Aide synthétique ' || g, 'Fiche de test : aide synthétique ' || g || '.', ($1::text[])[1 + g % 8], 'publie', NOW() - interval '3 days', ${V}, NOW()
  FROM generate_series(1, $2) g`, [CATS, N.aides]);
await q(`INSERT INTO "Demarche" (id, slug, titre, description_courte, categorie, statut, published_at, ${COLS}, "updatedAt")
  SELECT 'r47q-dem-' || g, 'r47q-demarche-synthetique-' || g, 'Démarche synthétique ' || g, 'Fiche de test : démarche synthétique ' || g || '.', ($1::text[])[1 + g % 8], 'publie', NOW() - interval '3 days', ${V}, NOW()
  FROM generate_series(1, $2) g`, [CATS, N.demarches]);
await q(`INSERT INTO "Dispositif" (id, slug, titre, description_falc, public, statut, status, published_at, ${COLS}, "updatedAt")
  SELECT 'r47q-disp-' || g, 'r47q-dispositif-synthetique-' || g, 'Dispositif synthétique ' || g, 'Fiche de test : dispositif synthétique ' || g || '.', ARRAY['tout_public'], 'publie', 'publie', NOW() - interval '3 days', ${V}, NOW()
  FROM generate_series(1, $1) g`, [N.dispositifs]);
await q(`INSERT INTO "Guide" (id, slug, titre, resume_falc, categorie, publics, contexte, mots_cles, sources_urls, statut, published_at, "updatedAt")
  SELECT 'r47q-guide-' || g, 'r47q-guide-synthetique-' || g, 'Guide synthétique ' || g, 'Fiche de test : guide synthétique ' || g || '.', 'logement', ARRAY['tout_public'], ARRAY['test'], ARRAY['synthétique'],
    ARRAY['https://www.service-public.gouv.fr/particuliers/vosdroits/F12006'], 'publie', NOW() - interval '3 days', NOW() FROM generate_series(1, $1) g`, [N.guides]);
await q(`INSERT INTO "Actualite" (id, slug, titre, resume, contenu, statut, published_at, date_publication, source_name, source_url, url, key_points_falc, departements, score_fiabilite, tags, "updatedAt")
  SELECT 'r47q-news-' || g, 'r47q-actualite-synthetique-' || g, 'Actualité synthétique ' || g, 'Résumé de test ' || g || '.', 'Texte de test ' || g || '.', 'publie', NOW() - g * interval '1 day', NOW() - g * interval '1 day',
    'Service-Public.fr', 'https://www.service-public.gouv.fr/particuliers/actualites', 'https://www.service-public.gouv.fr/particuliers/actualites/A' || g, ARRAY['Point de test'], ARRAY['67'], 90, ARRAY['test'], NOW()
  FROM generate_series(1, $1) g`, [N.news]);

// 2,000 citizens (no password: synthetic rows) and 6,000 appointments (2,000 in the pilot's agenda over ±120 days, the rest on bookable structures)
await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt", "lastSeenAt")
  SELECT 'r47q-c-' || lpad(g::text, 4, '0'), 'test.citizen+r47q-' || g || '@example.test', 'unset:x', NOW() - interval '300 days', NOW() - interval '300 days', NOW(), NOW() - (g % 90) * interval '1 day'
  FROM generate_series(1, $1) g`, [N.citizens]);
await q(`INSERT INTO "CitizenProfile" ("userId", "displayName", "ageBand", "updatedAt") SELECT id, 'Personne synthétique', '25-59', NOW() FROM "CitizenUser" WHERE id LIKE 'r47q-c-%'`);
const STATUSES = ['confirmed', 'done', 'no_show', 'cancelled', 'requested', 'booked'];
const pilot = (await q(`SELECT id FROM "Structure" WHERE id = 'lab-cdgg-conseil'`)).rowCount === 1;
if (pilot) {
  await q(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "citizenEmailSnapshot", "createdByProUserId", mode, "createdAt", "updatedAt")
    SELECT 'r47q-pa-' || g, 'lab-cdgg-conseil', 'lab-cdgg-svc-demarches',
      date_trunc('hour', NOW()) + ((g % 240) - 120) * interval '1 day' + (g % 8) * interval '1 hour', date_trunc('hour', NOW()) + ((g % 240) - 120) * interval '1 day' + (g % 8) * interval '1 hour' + interval '1 hour',
      ($2::text[])[1 + g % 6], 'Personne synthétique', 'r47q-c-' || lpad((1 + g % $3)::text, 4, '0'), 'test.citizen+r47q-' || (1 + g % $3) || '@example.test',
      (ARRAY['lab-cdgg-p1', 'lab-cdgg-p2', 'lab-cdgg-p3'])[1 + g % 3], 'IN_PERSON', NOW() - interval '30 days', NOW()
    FROM generate_series(1, $1) g`, [N.pilotAppointments, STATUSES, N.citizens]);
}
await q(`WITH s AS (SELECT row_number() OVER (ORDER BY id) - 1 AS k, id FROM "Structure" WHERE id LIKE 'r47q-str-%' AND is_pro_enabled), n AS (SELECT count(*) AS n FROM s)
  INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "citizenEmailSnapshot", mode, "createdAt", "updatedAt")
  SELECT 'r47q-a-' || g, s.id, 'r47q-svc-' || substr(s.id, 10), date_trunc('hour', NOW()) + ((g % 300) - 200) * interval '1 day', date_trunc('hour', NOW()) + ((g % 300) - 200) * interval '1 day' + interval '30 minutes',
    ($2::text[])[1 + g % 6], 'Personne synthétique', 'r47q-c-' || lpad((1 + g % $3)::text, 4, '0'), 'test.citizen+r47q-' || (1 + g % $3) || '@example.test', 'IN_PERSON', NOW() - interval '30 days', NOW()
  FROM generate_series(1, $1) g, n JOIN s ON true WHERE s.k = g % n.n`, [N.appointments, STATUSES, N.citizens]);
await q(`INSERT INTO "AuditLog" (id, action, entity, entity_id, timestamp) SELECT 'r47q-audit-' || g, (ARRAY['STRUCTURE_UPDATE', 'AIDE_PUBLISH', 'ADMIN_LOGIN', 'CONTENT_REVIEW'])[1 + g % 4], 'Structure',
  'r47q-str-' || lpad((1 + g % $2)::text, 4, '0'), NOW() - (g % 365) * interval '1 day' FROM generate_series(1, $1) g`, [N.audit, N.structures]);

// one institutional account under a signed agreement (the session is minted by mint.mjs from this row's password hash fingerprint)
await q(`INSERT INTO "PartnerAgreement" (id, "partnerName", kind, status, scope, "documentRef", "signedAt", "signedByPartner", "recordedBy") VALUES ('r47q-agreement', 'Collectivité synthétique', 'CONVENTION', 'SIGNED', 'observatoire', 'r47q-convention-synthetique', NOW() - interval '30 days', 'Signataire synthétique', 'r47q-admin@example.test')`);
await q(`INSERT INTO "InstitutionAccount" (id, email, "passwordHash", "organisationName", territory, status, "agreementId", "createdBy") VALUES ('r47q-inst', 'r47q-institution@example.test', 'synthetic-not-a-hash-r47q', 'Collectivité synthétique', '67', 'ACTIVE', 'r47q-agreement', 'r47q-admin@example.test')`);
await q('COMMIT');

const counts = (await q(`SELECT (SELECT count(*) FROM "Structure")::int AS structures, (SELECT count(*) FROM "ProAppointment")::int AS appointments, (SELECT count(*) FROM "CitizenUser")::int AS citizens,
  (SELECT count(*) FROM "Aide")::int AS aides, (SELECT count(*) FROM "AuditLog")::int AS audit`)).rows[0];
await c.end();
fs.writeFileSync(out, JSON.stringify({ structure: 'r47q-structure-1', aide: 'r47q-aide-synthetique-1', demarche: 'r47q-demarche-synthetique-1', dispositif: 'r47q-dispositif-synthetique-1',
  guide: 'r47q-guide-synthetique-1', actualite: 'r47q-actualite-synthetique-1', bookable: 'r47q-structure-4', pilot: pilot ? 'cdgg-conseil' : null, counts }, null, 1));
console.log('seeded', JSON.stringify(counts));
