/**
 * FA-CAP — the public catalogue of the capability suite (LAB_SYNTHETIC), on top of the e2e-fa1 fixture and the LAB pilot. Every id starts with « fab- »,
 * every text says it is a test record. Records follow the public visibility rule (api/lib/publicVisibility.js): published, VERIFIED, official source,
 * launch-eligible, territory verified, current date — EXCEPT the deliberate negatives that the D02 / D03 / D08 tests assert stay hidden or « unknown ».
 * The source address is the generic Service-Public sheet the fa1 fixture already uses; no legal content is written.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../api/_utils/password-hash.js';

const SP = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006';
const COLS = 'launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url';
const V = (days = 3) => `true, 'VERIFIED', 'verification-automatique', true, 'official_source', NOW() - interval '${days} days', '${SP}'`;

/** @param {string} url */
export async function seedCatalogue(url) {
  const u = new URL(url); if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) throw new Error('local *_test database only');
  const c = new pg.Client({ connectionString: url }); await c.connect();
  const q = (/** @type {string} */ s, /** @type {any[]} */ p = []) => c.query(s, p);
  try {
    await q('BEGIN');
    // ── aides: two themes, plus the deliberate negatives
    const aides = [
      ['fab-aide-logement', 'Aide FAB logement (test)', 'logement', V()], ['fab-aide-emploi', 'Aide FAB emploi (test)', 'emploi', V()],
      ['fab-aide-famille', 'Aide FAB famille (test)', 'famille', V()], ['fab-aide-logement-fr', 'Aide FAB logement minuscules (test)', 'logement', V()],
    ];
    for (const [slug, titre, cat, v] of aides) {
      await q(`INSERT INTO "Aide" (id, slug, titre, cest_quoi, categorie, statut, published_at, ${COLS}, "updatedAt") VALUES ($1, $1, $2, $3, $4, 'publie', NOW() - interval '3 days', ${v}, NOW())`,
        [slug, titre, `Fiche de test : ${titre}. Lisez la fiche officielle sur service-public.gouv.fr.`, cat]);
    }
    // D02: published but NOT launch-eligible → never public; D02: a privacy hold → never public
    await q(`INSERT INTO "Aide" (id, slug, titre, categorie, statut, published_at, ${COLS}, "updatedAt") VALUES ('fab-aide-not-eligible', 'fab-aide-not-eligible', 'Aide FAB non éligible au lancement (test)', 'logement', 'publie', NOW(), false, 'VERIFIED', 'rev@example.test', true, 'official_source', NOW() - interval '3 days', $1, NOW())`, [SP]);
    await q(`INSERT INTO "Aide" (id, slug, titre, categorie, statut, published_at, publication_hold, ${COLS}, "updatedAt") VALUES ('fab-aide-held', 'fab-aide-held', 'Aide FAB retenue (test)', 'logement', 'publie', NOW(), 'privacy_review', ${V()}, NOW())`);
    // D03: published, verified status but NO verification date → hidden (unknown stays unknown, never synthesised)
    await q(`INSERT INTO "Aide" (id, slug, titre, categorie, statut, published_at, ${COLS}, "updatedAt") VALUES ('fab-aide-no-date', 'fab-aide-no-date', 'Aide FAB sans date de vérification (test)', 'logement', 'publie', NOW(), true, 'VERIFIED', 'rev@example.test', true, 'official_source', NULL, $1, NOW())`, [SP]);
    // D08: an Aides-territoires record (institution funding) → never a citizen aide, whatever its verification state
    await q(`INSERT INTO "Aide" (id, slug, titre, categorie, statut, published_at, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, "updatedAt")
      VALUES ('fab-aide-at', 'fab-aide-at', 'Financement FAB collectivités (test Aides-territoires)', 'logement', 'publie', NOW(), true, 'VERIFIED', 'rev@example.test', true, 'official_source', NOW() - interval '3 days', 'https://aides-territoires.beta.gouv.fr/aides/fab-test/', NOW())`);
    // ── démarches, dispositifs, guides, news
    await q(`INSERT INTO "Demarche" (id, slug, titre, description_courte, categorie, statut, published_at, ${COLS}, "updatedAt") VALUES ('fab-dem-1', 'fab-demarche-logement', 'Démarche FAB logement (test)', 'Fiche de test : démarche FAB.', 'logement', 'publie', NOW() - interval '3 days', ${V()}, NOW())`);
    await q(`INSERT INTO "Dispositif" (id, slug, titre, description_falc, public, statut, status, published_at, ${COLS}, "updatedAt") VALUES ('fab-disp-1', 'fab-dispositif-accueil', 'Dispositif FAB accueil (test)', 'Fiche de test : dispositif FAB.', ARRAY['tout_public'], 'publie', 'publie', NOW() - interval '3 days', ${V()}, NOW())`);
    await q(`INSERT INTO "Guide" (id, slug, titre, resume_falc, categorie, publics, contexte, mots_cles, sources_urls, statut, published_at, "updatedAt") VALUES ('fab-guide-1', 'fab-guide-logement', 'Guide FAB logement (test)', 'Fiche de test : guide FAB.', 'logement', ARRAY['tout_public'], ARRAY['test'], ARRAY['synthétique'], ARRAY[$1], 'publie', NOW() - interval '3 days', NOW())`, [SP]);
    for (let g = 1; g <= 3; g += 1) {
      await q(`INSERT INTO "Actualite" (id, slug, titre, resume, contenu, statut, published_at, date_publication, source_name, source_url, url, key_points_falc, departements, score_fiabilite, tags, "updatedAt")
        VALUES ($1, $1, $2, $3, $4, 'publie', NOW() - $5 * interval '1 day', NOW() - $5 * interval '1 day', 'Service-Public.fr', 'https://www.service-public.gouv.fr/particuliers/actualites', $6, ARRAY['Point de test'], ARRAY['67'], 90, ARRAY['test'], NOW())`,
      [`fab-actualite-${g}`, `Actualité FAB ${['alpha logement', 'beta emploi', 'gamma famille'][g - 1]} (test)`, `Résumé de test FAB numéro ${g} sur un sujet ${['logement', 'emploi', 'famille'][g - 1]}.`, `Texte de test FAB ${g}.`, g, `https://www.service-public.gouv.fr/particuliers/actualites/A${9000 + g}`]);
    }
    // ── official structures: Strasbourg (67482) and Mulhouse (68224) for the territorial views
    const S = [['fab-str-sxb', 'Centre FAB Strasbourg (test)', 'Strasbourg', '67000', '{67482}', 48.58, 7.75], ['fab-str-mul', 'Centre FAB Mulhouse (test)', 'Mulhouse', '68100', '{68224}', 47.75, 7.34]];
    for (const [id, nom, ville, cp, insee, lat, lon] of S) {
      await q(`INSERT INTO "Structure" (id, slug, nom, type_structure, description_courte, adresse, ville, code_postal, departement, insee_codes, services, publics_accueillis, categories_aidees, statut, status, latitude, longitude, ${COLS}, "updatedAt", "createdAt")
        VALUES ($1, $1, $2, 'association', 'Fiche de test FAB.', '1 rue de Test', $3, $4, $5, $6::text[], ARRAY['Accueil'], ARRAY['tout_public'], ARRAY['logement'], 'actif', 'actif', $7, $8, ${V()}, NOW(), NOW())`,
      [id, nom, ville, cp, cp.slice(0, 2), insee, lat, lon]);
    }
    // territoires as the project catalogue writes them (data/aides-alsace.csv: a commune name or « France entière »)
    await q(`UPDATE "Aide" SET territoires = ARRAY['Strasbourg'], departements = ARRAY['67'] WHERE id = 'fab-aide-logement'`);
    await q(`UPDATE "Aide" SET territoires = ARRAY['France entière'] WHERE id IN ('fab-aide-emploi', 'fab-aide-famille')`);
    // the same commune stored in its lower-case form, as other writers (and the native QA fixture DTA-B85) store it
    await q(`UPDATE "Aide" SET territoires = ARRAY['strasbourg'] WHERE id = 'fab-aide-logement-fr'`);
    await q(`UPDATE "Aide" SET summary_falc = 'Texte FALC FAB : une aide pour payer le logement (test).' WHERE id = 'fab-aide-logement'`);
    await q('COMMIT');
    // ── this suite's own adult people (one per test that needs a fresh account): verified address, adult statement in the append-only ledger
    const citizens = {};
    for (let i = 1; i <= 24; i += 1) {
      const p = { id: `fab-cit-${i}`, email: `fab-cit-${i}@usagers.example.test`, password: `Lab-${crypto.randomBytes(9).toString('base64url')}-9a` };
      await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "notificationEmailEnabled", "updatedAt", "createdAt") VALUES ($1, $2, $3, NOW(), true, NOW(), NOW())`, [p.id, p.email, await hashPassword(p.password)]);
      await q(`INSERT INTO "CitizenProfile" ("userId", "displayName", "ageBand", "updatedAt") VALUES ($1, $2, '25-59', NOW())`, [p.id, `Personne FAB ${i} (fictive)`]);
      await q(`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level)
        VALUES (gen_random_uuid()::text, 'CITIZEN_USER', $1, 'AGE_DECLARATION_ADULT', true, 'r42-a07-2026-11-04', 'r42-a07-2026-11-04:AGE_DECLARATION_ADULT', 'lab_fixture', false, 'SELF_DECLARATION')`, [p.id]);
      citizens[i] = p;
    }
    const counts = (await q(`SELECT (SELECT count(*) FROM "Aide" WHERE id LIKE 'fab-%')::int aides, (SELECT count(*) FROM "Structure" WHERE id LIKE 'fab-%')::int structures,
      (SELECT count(*) FROM "Actualite" WHERE id LIKE 'fab-%')::int news`)).rows[0];
    return { counts, citizens, aide: 'fab-aide-logement', demarche: 'fab-demarche-logement', dispositif: 'fab-dispositif-accueil', guide: 'fab-guide-logement', structure: 'fab-str-sxb', structureMul: 'fab-str-mul', actualite: 'fab-actualite-1' };
  } catch (e) { await q('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}
