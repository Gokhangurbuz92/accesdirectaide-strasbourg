/**
 * Seed script for test ProProfiles
 * 
 * Run with: npx tsx scripts/seed-test-pro-profiles.ts
 * 
 * Creates 5 test ProUsers + ProProfiles linked to existing structures
 * and taxonomy entries. Also creates a test structure if none exist.
 * 
 * Idempotent: skips existing profiles, safe to run multiple times.
 */
import * as dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const TEST_PROS = [
  {
    email: 'marie.dupont@test.ada.fr',
    displayName: 'Marie D.',
    jobTitle: 'Assistante sociale',
    descriptionPublic: 'Accompagnement des familles en difficulté. Aide aux démarches administratives, accès aux droits sociaux et recherche de logement.',
    needs: ['acces_droits', 'logement', 'famille'],
    audiences: ['adultes', 'familles', 'precarite'],
    modalities: ['presentiel', 'telephone'],
  },
  {
    email: 'thomas.martin@test.ada.fr',
    displayName: 'Thomas M.',
    jobTitle: 'Éducateur spécialisé',
    descriptionPublic: 'Accompagnement éducatif des jeunes en situation de handicap. Soutien psychologique et aide à l\'insertion sociale.',
    needs: ['handicap', 'sante_mentale', 'isolement'],
    audiences: ['jeunes', 'handicap'],
    modalities: ['presentiel', 'domicile'],
  },
  {
    email: 'fatima.benali@test.ada.fr',
    displayName: 'Fatima B.',
    jobTitle: 'Conseillère en insertion professionnelle',
    descriptionPublic: 'Aide à la recherche d\'emploi, formation, mobilité et accompagnement numérique. Spécialisée dans l\'insertion des publics éloignés de l\'emploi.',
    needs: ['emploi', 'mobilite', 'numerique'],
    audiences: ['jeunes', 'migrants', 'precarite'],
    modalities: ['presentiel', 'visio', 'telephone'],
  },
  {
    email: 'sophie.leclerc@test.ada.fr',
    displayName: 'Sophie L.',
    jobTitle: 'Référente sociale urgences',
    descriptionPublic: 'Prise en charge des situations d\'urgence sociale : violences, hébergement, mise en sécurité. Accueil sans rendez-vous.',
    needs: ['violences', 'urgence', 'logement'],
    audiences: ['adultes', 'familles'],
    modalities: ['presentiel', 'telephone', 'permanence'],
  },
  {
    email: 'karim.hadj@test.ada.fr',
    displayName: 'Karim H.',
    jobTitle: 'Coordinateur social',
    descriptionPublic: 'Accompagnement budgétaire, aide aux droits et lutte contre l\'isolement des personnes âgées et des aidants.',
    needs: ['budget', 'acces_droits', 'isolement'],
    audiences: ['seniors', 'aidants'],
    modalities: ['domicile', 'telephone'],
  },
];

async function seed() {
  const { db } = await import('../src/db/index.js');
  const { eq, sql } = await import('drizzle-orm');
  const schema = await import('../src/db/schema.js');

  console.log('🧑‍⚕️ Seeding test ProProfiles...\n');

  // 1. Get existing structures (any status)
  let structures = await db.execute(
    sql`SELECT id, nom, statut, ville FROM "Structure" LIMIT 10`
  );
  let structureRows = structures.rows;

  if (structureRows.length === 0) {
    // Create a test structure
    console.log('  📍 No structures found. Creating test structures...\n');
    const testStructures = [
      { nom: 'CCAS de Strasbourg', ville: 'Strasbourg', code_postal: '67000', departement: '67', type_structure: 'CCAS', statut: 'actif' },
      { nom: 'Mission Locale du Bas-Rhin', ville: 'Strasbourg', code_postal: '67000', departement: '67', type_structure: 'Mission Locale', statut: 'actif' },
      { nom: 'Centre Social de Hautepierre', ville: 'Strasbourg', code_postal: '67200', departement: '67', type_structure: 'Centre Social', statut: 'actif' },
    ];
    for (const ts of testStructures) {
      const id = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO "Structure" (id, nom, ville, code_postal, departement, type_structure, statut, "createdAt", "updatedAt")
        VALUES (${id}, ${ts.nom}, ${ts.ville}, ${ts.code_postal}, ${ts.departement}, ${ts.type_structure}, ${ts.statut}, NOW(), NOW())
        ON CONFLICT DO NOTHING
      `);
    }
    structures = await db.execute(sql`SELECT id, nom, statut, ville FROM "Structure" LIMIT 10`);
    structureRows = structures.rows;
  }

  console.log(`  📍 Found ${structureRows.length} structures. Using them for test pros.\n`);

  // 2. Fetch all taxonomy entries for linking
  const [allNeeds, allAudiences, allModalities] = await Promise.all([
    db.query.NeedCategory.findMany(),
    db.query.AudienceCategory.findMany(),
    db.query.ModalityType.findMany(),
  ]);

  const needsBySlug = Object.fromEntries(allNeeds.map(n => [n.slug, n]));
  const audiencesBySlug = Object.fromEntries(allAudiences.map(a => [a.slug, a]));
  const modalitiesBySlug = Object.fromEntries(allModalities.map(m => [m.slug, m]));

  // 3. Create ProUsers + ProProfiles + junction links
  for (let i = 0; i < TEST_PROS.length; i++) {
    const pro = TEST_PROS[i];
    const structure = structureRows[i % structureRows.length];
    const structureId = structure.id as string;
    const structureName = structure.nom as string;

    // Check if ProUser already exists
    const existingUsers = await db.execute(
      sql`SELECT id FROM "ProUser" WHERE email = ${pro.email} LIMIT 1`
    );

    let proUserId: string;
    if (existingUsers.rows.length > 0) {
      proUserId = existingUsers.rows[0].id as string;
      console.log(`  ⏭️  ProUser ${pro.email} already exists`);
    } else {
      // Create ProUser — matching actual schema columns
      proUserId = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "createdAt", "updatedAt")
        VALUES (${proUserId}, ${pro.email}, ${'$2b$10$test.hash.not.for.login.placeholder'}, ${'member'}, ${'active'}, ${structureId}, NOW(), NOW())
      `);
      console.log(`  ✅ ProUser ${pro.displayName} created → ${structureName}`);
    }

    // Check if ProProfile already exists
    const existingProfiles = await db.execute(
      sql`SELECT id FROM "ProProfile" WHERE "proUserId" = ${proUserId} LIMIT 1`
    );

    let proProfileId: string;
    if (existingProfiles.rows.length > 0) {
      proProfileId = existingProfiles.rows[0].id as string;
      console.log(`  ⏭️  ProProfile already exists for ${pro.displayName}`);
    } else {
      proProfileId = crypto.randomUUID();
      await db.insert(schema.ProProfile).values({
        id: proProfileId,
        proUserId,
        displayName: pro.displayName,
        jobTitle: pro.jobTitle,
        descriptionPublic: pro.descriptionPublic,
        photoUrl: null,
        isPubliclyVisible: true,
        acceptsNewClients: true,
        contactMode: 'both',
      });
      console.log(`  ✅ ProProfile ${pro.displayName} — ${pro.jobTitle}`);
    }

    // Link needs (idempotent via onConflictDoNothing)
    for (const slug of pro.needs) {
      const need = needsBySlug[slug];
      if (!need) { console.log(`  ⚠️  Need "${slug}" not found`); continue; }
      try {
        await db.insert(schema.ProProfileNeed).values({
          proProfileId,
          needCategoryId: need.id,
        }).onConflictDoNothing();
      } catch { /* already exists */ }
    }

    // Link audiences
    for (const slug of pro.audiences) {
      const audience = audiencesBySlug[slug];
      if (!audience) { console.log(`  ⚠️  Audience "${slug}" not found`); continue; }
      try {
        await db.insert(schema.ProProfileAudience).values({
          proProfileId,
          audienceCategoryId: audience.id,
        }).onConflictDoNothing();
      } catch { /* already exists */ }
    }

    // Also link the STRUCTURE to the same needs/audiences/modalities
    for (const slug of pro.needs) {
      const need = needsBySlug[slug];
      if (!need) continue;
      try {
        await db.insert(schema.StructureNeed).values({
          structureId,
          needCategoryId: need.id,
        }).onConflictDoNothing();
      } catch { /* already exists */ }
    }

    for (const slug of pro.audiences) {
      const audience = audiencesBySlug[slug];
      if (!audience) continue;
      try {
        await db.insert(schema.StructureAudience).values({
          structureId,
          audienceCategoryId: audience.id,
        }).onConflictDoNothing();
      } catch { /* already exists */ }
    }

    for (const slug of pro.modalities) {
      const modality = modalitiesBySlug[slug];
      if (!modality) continue;
      try {
        await db.insert(schema.StructureModality).values({
          structureId,
          modalityTypeId: modality.id,
        }).onConflictDoNothing();
      } catch { /* already exists */ }
    }

    console.log(`     → Needs: ${pro.needs.join(', ')}`);
    console.log(`     → Audiences: ${pro.audiences.join(', ')}`);
    console.log(`     → Modalities: ${pro.modalities.join(', ')}\n`);
  }

  console.log('✅ Test ProProfiles seed complete! (5 professionals)');
  console.log('   Now test: /trouver-aide → select "Logement" → Rechercher');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
