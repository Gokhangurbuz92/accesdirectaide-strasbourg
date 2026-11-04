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

### Retour arrière (`drizzle/rollback/NNNN_down.sql`)
Un fichier de retour arrière défait le schéma d'une migration ; il doit aussi supprimer la ligne de cette migration dans `drizzle.__drizzle_migrations`
(`created_at` = le `when` du journal `drizzle/meta/_journal.json`), sinon un `migrate` ultérieur croit la migration appliquée et l'ignore sans rien dire
(constaté lors de la répétition R39 de 0043). Les fichiers à partir de 0043 le font (test `tests/unit/r39-rollback-journal.test.js`) ; pour 0025 à 0042,
exécuter après le fichier : `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <when de la migration>;`. Toujours après une sauvegarde chiffrée
(`scripts/db-backup.mjs`) et avec le code de la version précédente.

### Production à 0042 : 0043 / 0044 obsolètes, 0045 seule (R43)
Le migrateur Drizzle applique toute entrée du journal dont le `when` est postérieur à la dernière ligne de `drizzle.__drizzle_migrations` : sur la
Production (0042) un `migrate` simple appliquerait 0043 et 0044 (réservation sans compte retirée), interdites. `scripts/db-deploy-migrate.mjs` refuse
donc ce cas (`OBSOLETE_MIGRATION_PENDING`) et applique une seule migration avec `--only <tag>` (`--dry-run` pour le plan). Procédure et retour arrière de
0045 : `STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r43/R43_NOTICE_LEDGER_MIGRATION.md`. Ne jamais lancer `npm run db:migrate` sur la Production.

## Backup
Voir [docs/disaster-recovery.md](disaster-recovery.md).

## Connexions
- **Production** : Neon PostgreSQL (pooled via `DATABASE_URL`)
- **Test** : `DATABASE_URL_TEST` ou `DATABASE_URL`
- **pgvector** : Extension activée pour embeddings (768 dimensions)
