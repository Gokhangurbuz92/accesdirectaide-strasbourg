# Runbook opérateur — ouvrir le pont d’orientation pour UN partenaire (sans modifier le code)

Pour : le responsable / l’opérateur d’ADA. Tout se fait par des **variables d’environnement** Vercel (Production) et par l’administration ADA ;
aucune ligne de code ni migration. Contrat et kit du partenaire : `docs/partner-bridge/ONBOARDING_FR.md`.

## 0. Ce qui doit exister AVANT (décisions du responsable, pas de l’ingénierie)

| # | Préalable | Preuve à conserver |
|---|---|---|
| 0.1 | Convention signée avec la structure (art. 26 ou 28, annexe sécurité, violations, durées) | référence du document, date, signataire |
| 0.2 | Ligne de l’AIPD « orientations / pont partenaire » (P8) signée, information des personnes publiée | version de l’AIPD, version de la notice |
| 0.3 | Hébergement certifié HDS attesté (`ADA_HDS_CERTIFIED_HOSTING`, format `HDS1:…`) — la capacité exige l’HDS | certificat, date de fin |
| 0.4 | Les orientations natives ouvertes : surface `pro`, capacité `pro.referrals` (HDS) | `npm run readiness` |
| 0.5 | La structure existe dans ADA, vérifiée ; un **membre délégué** actif (invitation + MFA) | identifiants `Structure.id`, `ProUser.id` |
| 0.6 | Essais LAB réussis avec le point d’accès de **test** du partenaire (§ 5 du kit) | sortie du kit, journal LAB |

## 1. Générer et remettre le secret

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```
Remettre le secret au contact technique du partenaire par un canal **séparé** (pas l’e-mail qui porte l’identifiant). Ne jamais le coller dans un
ticket, un document, un dépôt ou un journal.

## 2. Variables Production (Vercel → Settings → Environment Variables → Production)

| Variable | Valeur | Note |
|---|---|---|
| `ADA_PARTNER_ADAPTERS` | `[{"id":"<id>","structureId":"<Structure.id>","endpoint":"https://<partenaire>/<chemin>","delegateProUserId":"<ProUser.id>"}]` | JSON ; un objet par partenaire (20 au plus) ; `id` : minuscules, chiffres, tirets (2–40) ; endpoint **https**, sans identifiants |
| `ADA_PARTNER_SECRET_<ID>` | le secret (≥ 32 caractères) | `<ID>` = `id` en majuscules, `-` → `_` (ex. `centre-social-x` → `ADA_PARTNER_SECRET_CENTRE_SOCIAL_X`) ; type « Sensitive » |
| `ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED` | `true` | décision du responsable (0.1–0.3) |
| `ADA_CAPABILITIES_OPEN` | ajouter `partner.referral_adapter` (et `pro.referrals` s’il n’y est pas) | liste à virgules, noms exacts |
| `ADA_BETA_OPEN_JOBS` | ajouter `partner-outbox` | la tâche est déjà planifiée chaque heure (minute 41) dans `vercel.json` |
| `ADA_JOBS_APPROVED` | ajouter `partner-outbox` | catégorie C : ouvrir ≠ approuver, les deux sont nécessaires |

Pendant la bêta restreinte, le point d’accès de réponse `monitor/partner/referral-events` est servi dès que `ADA_PARTNER_ADAPTERS` est non vide ;
la capacité, la configuration et la signature restent vérifiées à chaque appel.

Toute modification de variable exige un **redéploiement** de Production (sans changement de code).

## 3. Contrôles avant et après le redéploiement

1. `node scripts/release-preflight.mjs` avec l’environnement Production (ou le contrôle de publication habituel) : la ligne **`partner.bridge`** doit
   être `PASS` (elle échoue — `FAIL` — sur une configuration invalide, sans approbation, capacité ouverte sans partenaire, ou tâche fermée).
2. Administration → **Fournisseurs** (`/admin/fournisseurs`) : la ligne « Pont d’orientation partenaires » doit être « Configuré » (variables listées par leur nom).
3. Le partenaire envoie une réponse **signée** sur un identifiant inexistant : réponse attendue `404` (et non `401` ni `503`).
4. Première orientation réelle autorisée par une personne : au passage horaire suivant, l’Administration → **Exécutions** (`/admin/runs`) montre
   `partner-outbox` en succès (`delivered ≥ 1`) ; le journal d’audit contient `PARTNER_EVENT_DELIVERED` (identifiants seulement).

## 4. Exploitation courante

| Signal | Où | Action |
|---|---|---|
| `PARTNER_EVENT_FAILED` répétés, `partner-outbox` « partial » | journal d’audit (`/admin/audit`), exécutions (`/admin/runs`) | prévenir le contact technique ; après 6 passages l’événement est abandonné (`PARTNER_EVENT_ABANDONED`) — l’orientation reste traitable dans ADA Pro |
| `PARTNER_EVENT_REJECTED` | journal d’audit | le partenaire refuse (4xx) : vérifier son point d’accès / sa vérification de signature |
| `PARTNER_CALLBACK_REFUSED` `DELEGATE_NOT_ACTIVE` | journal d’audit | le membre délégué a quitté la structure : nommer un autre membre actif (`delegateProUserId`) et redéployer |
| `401` en série, `partner_callback.unauthorized` dans les journaux | journaux Vercel | horloge du partenaire, secret ou JSON canonique ; si suspicion de fuite : rotation immédiate (§ 5) |
| `429` | journaux | le partenaire dépasse 120 requêtes / minute : lui demander de lisser ses envois |

## 5. Rotation du secret

Planifiée : (1) nouveau secret (§ 1) ; (2) l’ancien → `ADA_PARTNER_SECRET_<ID>_PREVIOUS`, le nouveau → `ADA_PARTNER_SECRET_<ID>` ; redéployer ;
(3) le partenaire bascule (ADA signe déjà avec le nouveau et accepte ses réponses avec les deux) ; (4) supprimer `…_PREVIOUS` ; redéployer.
`partner.bridge` est `WARN` pendant la bascule (rappel de suppression).
Fuite : remplacer `ADA_PARTNER_SECRET_<ID>` **sans** `…_PREVIOUS`, redéployer, prévenir le partenaire et le DPO.

## 6. Suspendre / retirer un partenaire

- **Suspension immédiate** : retirer son objet de `ADA_PARTNER_ADAPTERS` (ou vider la variable) et redéployer. Ses réponses reçoivent `404`, plus
  aucun événement n’est envoyé ; ses orientations restent dans ADA Pro (circuit natif), rien n’est perdu.
- **Fermeture du pont pour tous** : retirer `partner.referral_adapter` de `ADA_CAPABILITIES_OPEN` (réponses `503`, tâche ignorée).
- **Fin de convention** : suspension, puis suppression de `ADA_PARTNER_SECRET_<ID>` ; les lignes d’audit suivent la durée du journal d’audit
  (365 jours, politique de conservation).

## 7. Ce qui reste hors de ce runbook

La signature de la convention, la ligne d’AIPD, l’information des personnes, le certificat HDS et le choix du partenaire sont des décisions du
responsable de traitement ; ce runbook ne les remplace pas et ne doit pas être exécuté sans elles.
