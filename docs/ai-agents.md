# Agents IA

> **Statut (2026-10-26)** : ces agents sont **hérités et désactivés**. Il n'y a pas de Google Gemini en production : les fonctionnalités IA utilisent un modèle **local** (Ollama, `qwen3:8b`) sur le LAB du propriétaire ; en production elles sont coupées tant que le propriétaire n'a pas choisi un modèle hébergé dans l'UE. `GEMINI_API_KEY` est refusée en production par `scripts/release-preflight.mjs`. `hive-scan` n'est pas planifié.
>
> Les informations publiques (aides, démarches, dispositifs, structures) ne passent plus par ces agents : elles sont vérifiées et publiées **automatiquement** par la « veille automatique » (décision D-5 v2 du 2026-10-25 ; `api/_services/verification/chain.js`, relecteur système `ada-veille-automatique`, rôle `system`), jamais présentée comme la relecture d'une personne. Une personne peut toujours vérifier ou suspendre un contenu manuellement. Le modèle local ne fait que rédiger des textes ; il ne décide jamais d'une publication.

## Architecture

```
┌─────────────────────────────────────────────┐
│           ORCHESTRATEUR CENTRAL             │
│     POST /api/admin/orchestrator            │
│                                             │
│  6 étapes : Discovery → Enrichment →        │
│  Validation → Classification → FALC →       │
│  Alerting                                   │
└──────────────────┬──────────────────────────┘
                   │
    ┌──────┬───────┼───────┬──────┬──────┐
    │      │       │       │      │      │
    ▼      ▼       ▼       ▼      ▼      ▼
┌──────┐┌──────┐┌──────┐┌──────┐┌────┐┌──────┐
│Veill.││Enrich││Valid.││Class.││FALC││Alert.│
│      ││      ││      ││      ││    ││      │
│Trouv.││Ident.││Queue ││Catég.││Simp││Notif.│
│aides ││FALC  ││human.││+tague││lify││pros  │
└──────┘└──────┘└──────┘└──────┘└────┘└──────┘
                   │
                   ▼
          ReviewQueueItem
       (validation humaine)
```

## 6 Agents spécialisés

| # | Agent | Fichier | Mission |
|---|-------|---------|---------|
| 1 | Veilleur | `agent-discovery.js` | Trouver nouvelles aides (code Gemini hérité, désactivé) |
| 2 | Rédacteur FALC | `agents/falc-writer.js` | Simplifier en FALC (15 mots, pas de jargon) |
| 3 | Contrôleur | `hive-scan.js` | Scanner 12 catégories (non planifié) |
| 4 | Classeur | `agents/classifier.js` | Catégoriser (12 cat.) + audiences (8 types) |
| 5 | Réparateur | `hive-repair.js` | Corriger les ReviewQueueItems signalés |
| 6 | Alerteur | `agents/alerter.js` | Notifier les pros des changements |

## Endpoints

| Agent | Endpoint | Trigger | Auth |
|-------|----------|---------|------|
| Discovery | POST /api/pro/agent-discovery | Pro (manuel) | JWT Pro |
| Scheduler | POST /api/pro/agent-scheduler | Pro (manuel) | JWT Pro |
| Hive Scan | GET /api/cron/hive-scan | Non planifié (manuel) | CRON_SECRET |
| Hive Repair | POST /api/admin/hive-repair | Admin (manuel) | JWT admin nominatif + MFA |
| Orchestrateur | POST /api/admin/orchestrator | Admin (manuel) | JWT admin nominatif + MFA |

## Pipeline orchestrateur (6 étapes)

```
1. Discovery      → Chercher aides non vérifiées (>30 jours)
2. Enrichment     → Identifier celles sans description FALC
3. Validation     → Créer ReviewQueueItem (validation humaine)
4. Classification → Catégoriser (12 catégories + 8 audiences)
5. FALC           → Simplifier les descriptions (max 15 mots/phrase)
6. Alerting       → Notifier les pros concernés
```

## Feature Flag

Tous les agents nécessitent `ENABLE_AI_AGENT=true`.
Pour activer : Vercel → Settings → Environment Variables → Redeploy.

## Module partagé

`api/lib/ai-discovery-core.js` — logique partagée entre Discovery et Scheduler (appels Gemini hérités, désactivés).

## Catégories (12)

EMPLOI, LOGEMENT, SANTE, FAMILLE, HANDICAP, ETUDES, MOBILITE, ENERGIE, ALIMENTATION, NUMERIQUE, JUSTICE, SENIORS

## Sécurité

- Circuit breaker (opossum) sur tous les appels au fournisseur d'IA
- Feature flag `ENABLE_AI_AGENT` sur **tous** les agents
- Résultats des agents dans la ReviewQueue (aucune autorité de publication pour un modèle de langage)
- Métriques (AiMetric) + rate limiting + auth
- Input sanitization (strip HTML, max 100-255 chars)
- Ces agents ne publient rien ; la publication des informations publiques relève uniquement de la veille automatique (contrôles déterministes contre les sources officielles)

## Agent 7 — Curateur de Ressources

**Fichier :** `api/lib/agents/resource-curator.js`

Mission : Trouver et organiser des ressources fiables pour les pages du site.

### Sources autorisées (UNIQUEMENT)

`*.gouv.fr`, `service-public.fr`, `caf.fr`, `ameli.fr`, `francetravail.fr`

### 4 types de contenu

| Type | Description | Page |
|------|-------------|------|
| RESSOURCE | Guides, liens officiels | /ressources |
| BONNE_PRATIQUE | Conseils pour les pros | /bonnes-pratiques |
| OUTIL | Simulateurs, calculateurs | /outils |
| DISPOSITIF | Programmes gouvernementaux | /dispositifs |

### Contenu initial

12 ressources pré-configurées dans `api/lib/seed-resources.js` — toutes sources gouvernementales vérifiées.

## Activation en production

> Non applicable aujourd'hui : aucune IA en production tant que le propriétaire n'a pas choisi un modèle hébergé dans l'UE (et `GEMINI_API_KEY` est refusée). Procédure historique conservée ci-dessous.

### Étape 1 — Activer le feature flag
Vercel → Settings → Environment Variables → `ENABLE_AI_AGENT=true` → Redéployer.

### Étape 2 — Tester en dry-run
```bash
POST /api/admin/orchestrator
Body : { "dryRun": true }
```
Vérifie que le pipeline tourne sans erreur.

### Étape 3 — Lancer en réel
```bash
POST /api/admin/orchestrator
Body : { "dryRun": false }
```
Les agents appellent le fournisseur d'IA configuré → résultats dans ReviewQueue (rien n'est publié par les agents).

### Étape 4 — Vérifier
- `GET /api/admin/ai-metrics` → métriques par agent
- `GET /api/admin/dashboard` → review queue items
