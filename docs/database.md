# Base de données

## Schema
Le schema est dans `src/db/schema.ts` (Drizzle ORM, PostgreSQL via Neon).

## Migrations versionnées
Les migrations SQL sont dans le dossier `drizzle/` :

```
drizzle/
├── 0000_fuzzy_fallen_one.sql
├── 0001_organic_morlun.sql
├── 0002_thankful_sunspot.sql
├── 0003_free_crusher_hogan.sql
├── 0004_confused_korvac.sql
├── 0005_low_firebird.sql
├── 0006_citizen_lockout.sql
└── meta/
```

### Commandes

```bash
npx drizzle-kit generate   # Génère les migrations SQL à partir du schema
npx drizzle-kit migrate    # Applique les migrations de drizzle/ (= npm run db:migrate) — seule commande autorisée hors local
npx drizzle-kit studio     # UI pour explorer la DB
```

> `drizzle-kit push` (`npm run db:push`) n'est toléré que comme raccourci sur une base **locale jetable** : il modifie le schéma sans fichier de migration. Jamais dans un environnement déployé (staging, production) — là, uniquement `drizzle-kit migrate` avec les fichiers de `drizzle/`.

### Procédure de changement de schema

1. Modifier `src/db/schema.ts`
2. `npx drizzle-kit generate` — génère le fichier SQL de migration
3. Vérifier le SQL généré dans `drizzle/`
4. `npx drizzle-kit migrate` (`npm run db:migrate`) en local comme dans les environnements déployés
5. Commiter le fichier de migration

## Backup
Voir [docs/disaster-recovery.md](disaster-recovery.md).

## Connexions
- **Production** : Neon PostgreSQL (pooled via `DATABASE_URL`)
- **Test** : `DATABASE_URL_TEST` ou `DATABASE_URL`
- **pgvector** : Extension activée pour embeddings (768 dimensions)
