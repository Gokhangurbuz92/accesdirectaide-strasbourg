/**
 * Seed script for Citizen Search MVP taxonomy tables
 * 
 * Run with: npx tsx scripts/seed-taxonomy.ts
 * 
 * Seeds: NeedCategory (12), AudienceCategory (10), ModalityType (5)
 */
import * as dotenv from 'dotenv';

// Load env vars BEFORE any dynamic import touches db/index.ts
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const NEEDS = [
  { slug: 'acces_droits', label: 'Accès aux droits', description: 'RSA, AAH, APL, CMU, démarches administratives', icon: 'FileCheck', color: 'bg-emerald-100 text-emerald-800', keywords: ['droits', 'rsa', 'aah', 'apl', 'cmu', 'css', 'administratif', 'démarches', 'papiers'], sortOrder: 1 },
  { slug: 'logement', label: 'Logement', description: 'Hébergement, expulsion, insalubrité, sans-domicile', icon: 'Home', color: 'bg-orange-100 text-orange-800', keywords: ['logement', 'hébergement', 'loyer', 'expulsion', 'hlm', 'maison', 'appartement', 'sans-abri', 'sdf'], sortOrder: 2 },
  { slug: 'emploi', label: 'Emploi / Insertion', description: 'Recherche emploi, formation, reconversion', icon: 'Briefcase', color: 'bg-blue-100 text-blue-800', keywords: ['emploi', 'travail', 'formation', 'chômage', 'insertion', 'cv', 'entretien', 'reconversion'], sortOrder: 3 },
  { slug: 'mobilite', label: 'Mobilité', description: 'Permis, transport, déplacements', icon: 'Car', color: 'bg-cyan-100 text-cyan-800', keywords: ['mobilité', 'transport', 'permis', 'voiture', 'bus', 'déplacement', 'conduire'], sortOrder: 4 },
  { slug: 'famille', label: 'Famille / Parentalité', description: 'Séparation, garde enfants, parentalité', icon: 'Users', color: 'bg-pink-100 text-pink-800', keywords: ['famille', 'enfant', 'parent', 'séparation', 'garde', 'naissance', 'grossesse', 'parentalité'], sortOrder: 5 },
  { slug: 'handicap', label: 'Handicap', description: 'Mental, cognitif, moteur, sensoriel', icon: 'Accessibility', color: 'bg-purple-100 text-purple-800', keywords: ['handicap', 'mdph', 'aah', 'pch', 'rqth', 'invalidité', 'mental', 'cognitif', 'moteur'], sortOrder: 6 },
  { slug: 'sante_mentale', label: 'Santé mentale / Addictions', description: 'Dépression, addictions, soutien psychologique', icon: 'Brain', color: 'bg-violet-100 text-violet-800', keywords: ['santé mentale', 'dépression', 'addiction', 'alcool', 'drogue', 'psychologue', 'anxiété', 'stress'], sortOrder: 7 },
  { slug: 'violences', label: 'Violences', description: 'Conjugales, intrafamiliales, harcèlement', icon: 'ShieldAlert', color: 'bg-red-100 text-red-800', keywords: ['violence', 'conjugale', 'harcèlement', 'agression', 'danger', 'protection', 'femme battue'], sortOrder: 8 },
  { slug: 'budget', label: 'Budget / Surendettement', description: 'Dettes, gestion budget, surendettement', icon: 'Wallet', color: 'bg-yellow-100 text-yellow-800', keywords: ['budget', 'dette', 'surendettement', 'argent', 'crédit', 'banque', 'impayé'], sortOrder: 9 },
  { slug: 'urgence', label: 'Urgence sociale', description: 'Sans-abri, rupture, danger immédiat', icon: 'Siren', color: 'bg-red-200 text-red-900', keywords: ['urgence', 'danger', 'sans-abri', 'rue', 'crise', 'immédiat', 'secours'], sortOrder: 10 },
  { slug: 'isolement', label: 'Isolement / Lien social', description: 'Solitude, exclusion, lien social', icon: 'HeartHandshake', color: 'bg-amber-100 text-amber-800', keywords: ['isolement', 'solitude', 'seul', 'lien social', 'exclusion', 'communauté'], sortOrder: 11 },
  { slug: 'numerique', label: 'Numérique', description: 'Fracture numérique, démarches en ligne', icon: 'Monitor', color: 'bg-indigo-100 text-indigo-800', keywords: ['numérique', 'internet', 'ordinateur', 'en ligne', 'informatique', 'digital'], sortOrder: 12 },
];

const AUDIENCES = [
  { slug: 'adultes', label: 'Adultes (18-65 ans)', sortOrder: 1 },
  { slug: 'jeunes', label: 'Jeunes (16-25 ans)', sortOrder: 2 },
  { slug: 'enfants', label: 'Enfants / Mineurs', sortOrder: 3 },
  { slug: 'familles', label: 'Familles', sortOrder: 4 },
  { slug: 'seniors', label: 'Seniors (65+)', sortOrder: 5 },
  { slug: 'handicap', label: 'Personnes en situation de handicap', sortOrder: 6 },
  { slug: 'aidants', label: 'Aidants', sortOrder: 7 },
  { slug: 'lgbtqia', label: 'Personnes LGBTQIA+', sortOrder: 8 },
  { slug: 'migrants', label: 'Personnes migrantes / réfugiées', sortOrder: 9 },
  { slug: 'precarite', label: 'Personnes en grande précarité', sortOrder: 10 },
];

const MODALITIES = [
  { slug: 'presentiel', label: 'Présentiel (dans la structure)', icon: 'Building2', sortOrder: 1 },
  { slug: 'telephone', label: 'Téléphone', icon: 'Phone', sortOrder: 2 },
  { slug: 'visio', label: 'Visioconférence', icon: 'Video', sortOrder: 3 },
  { slug: 'domicile', label: 'Domicile', icon: 'Home', sortOrder: 4 },
  { slug: 'permanence', label: 'Permanence (sans RDV)', icon: 'Clock', sortOrder: 5 },
];

async function seed() {
  // Dynamic import AFTER dotenv has loaded
  const { db } = await import('../src/db/index.js');
  const schema = await import('../src/db/schema.js');

  console.log('🌱 Seeding taxonomy tables...\n');

  // Seed NeedCategory (upsert by slug)
  console.log(`  📋 NeedCategory: ${NEEDS.length} entries`);
  for (const need of NEEDS) {
    await db.insert(schema.NeedCategory)
      .values(need)
      .onConflictDoUpdate({
        target: schema.NeedCategory.slug,
        set: {
          label: need.label,
          description: need.description,
          icon: need.icon,
          color: need.color,
          keywords: need.keywords,
          sortOrder: need.sortOrder,
        }
      });
  }

  // Seed AudienceCategory (upsert by slug)
  console.log(`  👥 AudienceCategory: ${AUDIENCES.length} entries`);
  for (const audience of AUDIENCES) {
    await db.insert(schema.AudienceCategory)
      .values(audience)
      .onConflictDoUpdate({
        target: schema.AudienceCategory.slug,
        set: {
          label: audience.label,
          sortOrder: audience.sortOrder,
        }
      });
  }

  // Seed ModalityType (upsert by slug)
  console.log(`  🏢 ModalityType: ${MODALITIES.length} entries`);
  for (const modality of MODALITIES) {
    await db.insert(schema.ModalityType)
      .values(modality)
      .onConflictDoUpdate({
        target: schema.ModalityType.slug,
        set: {
          label: modality.label,
          icon: modality.icon,
          sortOrder: modality.sortOrder,
        }
      });
  }

  console.log('\n✅ Taxonomy seed complete! (27 entries total)');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
