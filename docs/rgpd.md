# RGPD — Conformité

> Dernière revue : 2026-09-02

## Données collectées

| Donnée | Base légale | Durée conservation | Purge auto |
|--------|-----------|-------------------|:---:|
| Email citoyen | Consentement | Jusqu'à suppression | ❌ |
| Conversations chat | Intérêt légitime | 90 jours | ✅ |
| Logs d'audit (AuditLog) | Obligation légale (Art 6.1.c) | 365 jours | ✅ |
| Logs d'audit pro (ProAuditLog) | Obligation légale (Art 6.1.c) | 365 jours | ✅ |
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
| Tokens OAuth | AES-256-GCM (`vault-crypto.js`) |
| Tokens MFA | AES-256-GCM |

## Cookie banner

Implémenté dans `src/components/CookieBanner.jsx` (bandeau d'information, option A de `LEGAL_FR/03_COOKIES_TRACEURS.md`).
- Un seul bouton « Accepter » : il mémorise seulement que l'information a été vue (`ada_cookie_consent` en localStorage, sans expiration aujourd'hui).
- Le choix **ne commande aucun chargement** : Vercel Analytics et Speed Insights se chargent dans tous les cas ; Sentry (erreurs) aussi si un DSN est configuré.
- Sentry Session Replay est **désactivé par défaut** (`VITE_SENTRY_REPLAY` ≠ `true`) ; l'activer exige un vrai recueil de consentement.
- Le bandeau **n'écrit pas** dans `ConsentLog`.

## PII Detection

Le `prompt-sanitizer.js` détecte et bloque :
- Numéros de sécurité sociale (NIR)
- IBAN
- Numéros de carte bancaire

## Contact protection des données
Contact protection des données : [À COMPLÉTER : adresse de contact protection des données]. Aucun DPO désigné (décision ouverte).
