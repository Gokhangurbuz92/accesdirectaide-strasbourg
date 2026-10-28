# Plan de Nettoyage Schema DB

> **Date** : 2026-03-22
> **Auteur** : Audit automatique
> **Statut** : Documentation seulement — aucun champ supprimé

## Champs en double (FR vs EN)

| Champ FR | Champ EN | Refs FR | Refs EN | Tables | Recommandation |
|----------|----------|:-------:|:-------:|--------|----------------|
| `statut` | `status_code` | 122 | 9 | Aide, Demarche, Actualite, Structure, Dispositif | **Garder FR** — massivement utilisé |
| `titre` | `title` | 252 | 78 | Aide | **Garder FR** — usage majoritaire, `title` utilisé ponctuellement |
| `categorie` | `category_code` | 112 | 4 | Aide, Demarche | **Garder FR** — `category_code` quasi inutilisé |
| `cest_quoi` | `description` | 48 | 41 | Aide | **Décider** — les deux sont actifs, sémantique différente |
| `pour_qui` | `eligibility` (jsonb) | 36 | ~5 | Aide | **Garder FR** — eligibility est un JSON structuré différent |
| `lien_demande` | `apply_url` | 12 | ~3 | Aide | **Garder FR** — apply_url quasi inutilisé |
| `source_url` | `source_url_exact` | 124 | ~8 | Aide, Structure, Demarche | **Clarifier** — les deux servent, sémantique différente |
| `audiences` | `AudienceCategory` (table) | 21 | ~10 | Aide, Demarche | **Migrer** vers la table relationnelle à terme |

## Champs annotés [LEGACY] dans le schema

| Ligne | Annotation | Statut |
|-------|-----------|--------|
| L549 | `[LEGACY] Service table removed — replaced by ProRdvService` | ✅ Nettoyé |
| L801 | `[LEGACY] Availability, Beneficiary, Appointment, Message, Attachment tables removed` | ✅ Nettoyé |
| L1030 | `[LEGACY] ProMessage table removed — System C eradicated` | ✅ Nettoyé |
| L1418 | `[LEGACY] ServiceRelations removed` | ✅ Nettoyé |
| L1547 | `[LEGACY] AvailabilityRelations, BeneficiaryRelations, AppointmentRelations removed` | ✅ Nettoyé |

> Les tables legacy ont été supprimées du schema. Les annotations restent comme documentation.

## Champs redondants identifiés

### Table `Aide`
- `source_url` vs `source_url_exact` — les deux coexistent, vérifier lequel est canonical
- `departements` (text[]) vs `department_codes` (text[]) — doublon probable
- `territoires` (text[]) vs `territory_scope` (text) — échelle vs liste
- `source_name` vs `source_org` vs `providerName` — triple redondance sur la source

### Table `Structure`
- `departement` (text) vs `department_codes` (text[]) — singulier vs pluriel
- `status` vs `statut` — les deux existent sur la même table
- `source_id` vs `source_url` vs `source_annuaire` — triple source

### Table `Demarche`
- `ou_faire` vs `lien_officiel` vs `lien_teleservice` — 3 champs pour les liens

## Plan de migration recommandé

### Phase 1 — Inventaire (fait ✅)
Ce document.

### Phase 2 — Harmonisation progressive
1. Choisir le champ principal pour chaque doublon
2. Créer des alias SQL ou des vues pour lecture
3. Migrer le code progressivement vers le champ unique

### Phase 3 — Nettoyage final
1. Vérifier qu'aucun code ne référence l'ancien champ
2. Créer une migration Drizzle pour supprimer le champ
3. Backup PITR avant chaque suppression

> ⚠️ **NE JAMAIS supprimer un champ sans vérifier toutes les références.**
> Utiliser `grep -rn "champ" api/ src/ tests/` avant chaque suppression.
