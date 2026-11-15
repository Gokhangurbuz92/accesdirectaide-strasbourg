# RGPD — Conformité

> Dernière revue : 2026-09-02

## Données collectées

> R44 : « Purge auto ✅ » = une étape existe dans `cron/gdpr-purge` ; elle ne s'exécute pas tant que la politique de conservation
> versionnée (`api/_services/retention-policy.js`) est « PROPOSED — NOT APPROVED » : le job ne fait qu'un essai à blanc (aucune suppression).
> Toutes les durées sont des propositions du dossier R43 § 3.1, à valider par le responsable de traitement.

| Donnée | Base légale | Durée conservation | Purge auto |
|--------|-----------|-------------------|:---:|
| Email citoyen | Consentement | Jusqu'à suppression | ❌ |
| Conversations chat | Intérêt légitime | 90 jours | ✅ |
| Logs d'audit (AuditLog) | À décider (RT) — aucune obligation légale identifiée ; repère : recommandation CNIL 2021-122 (6 mois à 1 an) | 365 jours (proposition) | ✅ |
| Logs d'audit pro (ProAuditLog) | À décider (RT) — aucune obligation légale identifiée ; repère : recommandation CNIL 2021-122 | 365 jours (proposition) | ✅ |
| Mesure d'audience Vercel (Web Analytics, Speed Insights — aucun cookie selon l'éditeur, NON VÉRIFIÉ) | Intérêt légitime si l'exemption CNIL est vérifiée | Durée chez Vercel à confirmer | ❌ |
| Consent log | Preuve légale | 3 ans (1095 jours) | ✅ |
| User consents | Consentement | Jusqu'à expiration | ✅ |
| Tokens auth expirés | — | Après expiration | ✅ |
| Invitations expirées | — | 30 jours après expiration | ✅ |
| Tokens Outlook expirés | — | 30 jours après expiration | ✅ |
| Diagnostics partagés | Consentement | Expiration ou 90 jours | ✅ |
| Versions d'entités | Intérêt légitime | 90 jours | ✅ |
| Métriques IA | — | 90 jours | ✅ |
| Rendez-vous (ProAppointment) | Intérêt légitime | 2 ans puis anonymisation | ✅ |

## Prestataires techniques : rôles, transferts, contact Mailjet (notice v5, 15/11/2026)

> Source : vérification des pages publiques des prestataires du 15/11/2026 (`CONTROL/v2/V4_SAGLAYICI_DOGRULAMA_2026-11-15.md`) ; détail par prestataire
> dans `REGISTRE_RGPD.json` (`sous_traitants`, généré par `scripts/gdpr-suite.mjs`). Aucun accord n'est signé : ils sont intégrés aux conditions de service.

- **Rôles.** Pour les données des personnes, Vercel, Neon (Databricks), Upstash et Mailjet (Sinch) sont sous-traitants (art. 28). Deux d'entre eux sont
  **aussi responsables de traitement** pour certaines données techniques : Vercel (données d'usage de son service, DPA § 4.b) et Sinch (acheminement des
  messages, lutte contre le spam et la fraude, sécurité du réseau, DPA § 3 a iv).
- **Transferts.** Clauses contractuelles types (UE) 2021/914 pour les quatre ; Vercel Inc., Upstash, Inc. et Databricks, Inc. sont en outre sur la liste
  officielle du Data Privacy Framework (lue le 15/11/2026 ; à relire à chaque version de la notice). Pas Mailjet : la société inscrite est Mailgun Technologies, Inc.
- **Durées chez les prestataires.** Vercel : journaux d'exécution 1 jour (offre Pro ; option Observability Plus non vérifiée). Mailjet : statistiques
  90 jours (offre gratuite) ou 13 mois (offre payante) — l'offre du compte n'est pas enregistrée ; aucune durée publiée pour le contenu des messages.
  Neon : historique de 6 heures sur l'offre gratuite (une offre payante l'allonge : la notice devrait alors changer).
- **Contact Mailjet.** L'API d'envoi enregistre l'adresse de chaque destinataire comme « contact » pour la durée du compte Mailjet. Ce contact est supprimé
  (`api/_services/mail-contact-erasure.js`, API Mailjet « GDPR Delete contacts ») : à l'effacement d'un compte, à la purge d'un compte jamais confirmé
  (étape 6c) et, pour l'ancienne adresse, à la confirmation d'un changement d'adresse. Après le commit, sans jamais bloquer l'effacement ; si la suppression
  échoue alors que l'identifiant du contact est connu, cet identifiant (jamais l'adresse) est réessayé à chaque purge ; si la recherche du contact échoue,
  l'échec est journalisé sans l'adresse et signalé (`mailContactUnresolved`, étape `mailContactErasure`) — il n'y a alors pas de nouvel essai automatique.
  Sans effet quand `MAILER_PROVIDER` n'est pas `mailjet`.

## Droits des utilisateurs

| Droit | Endpoint | Implémenté |
|-------|---------|:---:|
| **Accès** | `GET /api/auth/export-data` | ✅ |
| **Suppression** | `DELETE /api/auth/delete-account` | ✅ |
| **Portabilité** | `GET /api/auth/export-data` (JSON) | ✅ |
| **Rectification** | Via profil utilisateur | ✅ |
| **Opposition** | Via suppression de compte | ✅ |

## Purge automatique (GDPR Purge Cron)

Le cron `gdpr-purge` s'exécute hebdomadairement et supprime :

| Table | Condition | Délai |
|-------|-----------|-------|
| `ConversationLog` | `createdAt < 90j` | 90 jours |
| `AuditLog` | `timestamp < 365j` | 1 an |
| `ProAuditLog` | `createdAt < 365j` | 1 an |
| `ConsentLog` | `created_at < 3 ans` | 3 ans (1095 jours) |
| `UserConsent` | `expiresAt < NOW()` | Après expiration |
| `SharedDiagnostic` | Expirés OU `createdAt < 90j` | 90 jours |
| `AuthToken` | `expiresAt < NOW()` | Après expiration |
| `Invitation` | `expires_at < NOW() - 30j` | 30 jours après expiration |
| `ProOutlookToken` | `expiresAt < NOW() - 30j` | 30 jours après expiration |
| `EntityVersion` | `createdAt < 90j` | 90 jours |
| `AiMetric` | `createdAt < 90j` | 90 jours |
| `ProAppointment` | `createdAt < 730j` | 2 ans → anonymisation |

### Anonymisation ProAppointment

Les rendez-vous de plus de 2 ans sont anonymisés (pas supprimés) :
- `beneficiaryName` → `[anonymisé]`
- `beneficiaryPhone` → `NULL`
- `citizenEmailSnapshot` → `NULL`
- `notes` → `NULL`

## Chiffrement des données sensibles

| Donnée | Méthode |
|--------|---------|
| Mots de passe | scrypt (salt + 64 bytes) |
| NIR/IBAN/CB dans prompts | Bloqués par sanitizer |
| Tokens OAuth | AES-256-GCM (`api/_utils/outlook-token-crypto.js` pour Outlook, `api/_utils/vault.ts` pour les autres secrets) |
| Tokens MFA | AES-256-GCM |

## Cookie banner

Implémenté dans `src/components/CookieBanner.jsx` (bandeau d'information, option A de `LEGAL_FR/03_COOKIES_TRACEURS.md`).
- Un seul bouton « Accepter » : il mémorise seulement que l'information a été vue (`ada_cookie_consent` en localStorage, sans expiration aujourd'hui).
- Le choix **ne commande aucun chargement** : Vercel Analytics et Speed Insights se chargent dans tous les cas ; Sentry (erreurs) aussi si un DSN est configuré.
- Sentry Session Replay est **désactivé par défaut** (`VITE_SENTRY_REPLAY` ≠ `true`) ; l'activer exige un vrai recueil de consentement.
- Le bandeau **n'écrit pas** dans `ConsentLog`.

## PII Detection

Le `api/lib/prompt-sanitizer.js` détecte et bloque :
- Numéros de sécurité sociale (NIR)
- IBAN
- Numéros de carte bancaire

## Contact protection des données
Contact protection des données : [À COMPLÉTER : adresse de contact protection des données]. Aucun DPO désigné (décision ouverte).
