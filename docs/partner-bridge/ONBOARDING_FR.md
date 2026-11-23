# Pont d’orientation partenaires — kit d’intégration (`ada.partner-referral/1`)

Destinataires : l’équipe technique d’une **structure partenaire** qui veut recevoir dans **son propre outil** les orientations qu’une personne a
autorisées vers elle sur Accès Direct Aide (ADA), et y répondre depuis cet outil. Version du contrat : `ada.partner-referral/1` (24/11/2026).

> Le pont n’est **pas** une API publique. Il est ouvert structure par structure, après une convention signée (voir § 8). Tant qu’il n’est pas ouvert,
> votre structure reçoit et traite ses orientations dans **ADA Pro**, comme toutes les structures : rien ne change pour elle.

## 1. Ce qui circule — et ce qui ne circule jamais

| Sens | Quoi | Données |
|---|---|---|
| ADA → vous | un **événement** quand une orientation adressée à votre structure change d’état : `referral.received`, `referral.cancelled`, `referral.expired`, `referral.closed` | identifiant de l’orientation, état, motif codé, date limite de réponse, lien vers l’orientation dans ADA Pro |
| vous → ADA | une **réponse** : `acknowledge`, `accept`, `decline` (+ motif codé), `needs_info` (+ message), `start`, `complete` (+ résultat codé, résumé facultatif pour la personne) | les mêmes champs qu’un professionnel saisit dans ADA Pro |

Ne circulent **jamais** : le nom, l’adresse, l’e-mail, le téléphone ou un identifiant de la personne ; le contenu du dossier ; un document ; un
message de l’orienteur. Vos professionnels ouvrent le dossier **dans ADA Pro**, avec leur propre compte (double authentification) et l’autorisation
que la personne a donnée — exactement comme sans le pont.

Aucun événement n’est émis avant que la personne ait autorisé l’orientation ; une proposition refusée ou retirée avant son accord n’est jamais
communiquée. Le motif codé peut être `HEALTH` : votre outil doit être traité comme recevant une information potentiellement sensible (voir § 8).

## 2. Signature (les deux sens)

En-tête `ADA-Signature: t=<secondes Unix>,v1=<hex HMAC-SHA256(secret, "<t>.<JSON canonique>")>`

- **JSON canonique** : le corps re-sérialisé avec les clés d’objet **triées à tous les niveaux**, sans espace (`JSON.stringify` d’une copie triée).
  La signature porte sur cette forme canonique, pas sur les octets bruts : réordonner les clés ne change pas la signature.
- **Secret** : un secret partagé par structure (≥ 32 caractères), remis par ADA par un canal séparé (§ 7). Le même secret signe les deux sens.
- **Fenêtre** : un horodatage à plus de **300 secondes** de l’heure d’ADA est refusé (`401`, `reason: "STALE"`). Synchronisez l’horloge (NTP).
- **Comparaison** à temps constant de votre côté également.

**Vecteur de test fixe** (votre implémentation doit le reproduire à l’identique) :

| secret | t | corps | JSON canonique | v1 |
|---|---|---|---|---|
| `kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk` (32 × `k`) | `1700000000` | `{"b":2,"a":"x"}` | `{"a":"x","b":2}` | `436e556ec7c122d742f5c848ab0f4c9e63d0e82206cf30c675a9382607b9d7a6` |

Vérification : `node scripts/partner-bridge-kit.mjs vector` (dépôt ADA).

## 3. Événements ADA → vous

`POST <votre point d’accès https>` — `Content-Type: application/json`, `Idempotency-Key: <eventId>`, `ADA-Contract: ada.partner-referral/1`,
`ADA-Signature: …`. Exemple (identifiants de bac à sable, secret d’exemple `exemple-secret-partenaire-NE-PAS-UTILISER-0001`, `t=1795511700`) :

```json
{
  "contract": "ada.partner-referral/1",
  "eventId": "sandbox-0d4f7c2a-6a43-4c1e-9f0b-2b8e1f3a9c11",
  "type": "referral.received",
  "occurredAt": "2026-11-24T09:15:00.000Z",
  "referral": {
    "id": "sandbox-5e2b9d10-77aa-4f3e-8c21-0a6d4b1e2f33",
    "status": "SENT",
    "reasonCode": "ACCESS_TO_RIGHTS",
    "dueAt": "2026-11-29T09:15:00.000Z",
    "proUrl": "https://accesdirectaide.fr/pro/orientations/sandbox-5e2b9d10-77aa-4f3e-8c21-0a6d4b1e2f33"
  }
}
```

`ADA-Signature: t=1795511700,v1=ad97316356b6a534da4ea16daa66730bf5cbe0f6415081501ef9848471171e5d`

| `type` | `referral.status` | Sens pour vous |
|---|---|---|
| `referral.received` | `SENT` | la personne a autorisé l’orientation (ou l’orienteur a répondu à votre demande de précisions) : à traiter |
| `referral.cancelled` | `CANCELLED` | l’orienteur a annulé, ou la personne a retiré l’accès : arrêter |
| `referral.expired` | `EXPIRED` | pas de réponse dans le délai : l’accès est retiré |
| `referral.closed` | `CLOSED` | l’orienteur a clôturé |

Motifs (`reasonCode`) : `SPECIALISED_SUPPORT`, `ACCESS_TO_RIGHTS`, `HOUSING`, `EMPLOYMENT`, `HEALTH`, `FOOD_AID`, `DIGITAL_SUPPORT`, `LEGAL`, `OTHER`.
Le contrat est **fermé** : aucune autre clé n’apparaîtra en version 1 (une évolution incompatible sera `ada.partner-referral/2`, servie en parallèle).

**Vos réponses HTTP** (elles décident de la suite) :

| Vous répondez | ADA fait |
|---|---|
| `2xx` (dès que l’événement est enregistré chez vous) | livré, plus rien n’est renvoyé |
| `408`, `425`, `429`, `5xx`, délai > 8 s, erreur réseau | nouvel essai : 3 tentatives par passage (0,5 s puis 2 s ; `Retry-After` respecté jusqu’à 10 s), puis au passage suivant (toutes les heures), abandon après 6 passages en échec |
| autre `4xx` | refus définitif : pas de nouvel essai |
| une redirection | échec (les redirections ne sont pas suivies) |

**Idempotence** : `Idempotency-Key` = `eventId`, identique à chaque nouvel essai. Un même `eventId` peut donc arriver plusieurs fois : dédupliquez sur
cette clé et répondez `2xx` à un doublon. L’abandon d’un événement ne fait rien perdre à la personne : l’orientation reste dans ADA Pro.

## 4. Réponses vous → ADA

`POST https://accesdirectaide.fr/api/monitor/partner/referral-events?partner=<votre identifiant>` — `Content-Type: application/json`, `ADA-Signature`
calculée avec **votre** secret. Corps (clés autorisées seulement, toute autre clé est refusée) :

| Champ | Obligatoire | Règle |
|---|---|---|
| `contract` | oui | `"ada.partner-referral/1"` |
| `idempotencyKey` | oui | 16 à 128 caractères `A-Z a-z 0-9 . _ : -`, **unique par commande** dans votre outil |
| `referralId` | oui | l’`id` reçu dans l’événement |
| `action` | oui | `acknowledge`, `accept`, `decline`, `needs_info`, `start`, `complete` |
| `responseCode` | pour `decline` seulement | `OUT_OF_SCOPE`, `NO_CAPACITY`, `ALREADY_SUPPORTED`, `OTHER` |
| `message` | obligatoire pour `needs_info` (5 à 1 500 caractères) ; facultatif sinon | question à l’orienteur ; ne mettez **aucune** donnée de santé inutile |
| `outcome` | pour `complete` seulement | `SUPPORT_COMPLETED`, `APPLICATION_FILED`, `INFORMATION_PROVIDED`, `REFERRED_ELSEWHERE`, `CITIZEN_WITHDREW`, `NO_RESPONSE`, `OTHER` |
| `citizenSummary` | facultatif, `complete` seulement | ≤ 1 000 caractères, lisible par la personne |
| `occurredAt` | oui | date ISO 8601 de l’action dans votre outil |

Exemple (`decline`, même secret d’exemple, `t=1795511760`) — JSON canonique signé :

```
{"action":"decline","contract":"ada.partner-referral/1","idempotencyKey":"outil-partenaire-2026-11-24-000042","occurredAt":"2026-11-24T10:02:00.000Z","referralId":"sandbox-5e2b9d10-77aa-4f3e-8c21-0a6d4b1e2f33","responseCode":"NO_CAPACITY"}
```

`ADA-Signature: t=1795511760,v1=4da0bc70beca14db718706e5daab6a0abc4bc5feb702e56e4ebdcad54da59e6c`

Enchaînements permis (mêmes règles que dans ADA Pro) : `acknowledge` depuis `SENT` ; `accept` depuis `SENT`, `ACKNOWLEDGED` ou `NEEDS_INFO` ;
`decline` / `needs_info` depuis `SENT` ou `ACKNOWLEDGED` ; `start` après `accept` ; `complete` après `accept` ou `start`.

**Réponses d’ADA** :

| Code | Sens | Que faire |
|---|---|---|
| `200` `{ ok: true, referral: { id, status } }` | appliqué | — |
| `200` `{ …, replay: true }` | même `idempotencyKey`, même commande : réponse de la première fois, rien n’est rejoué | — |
| `400` `{ error: "INVALID_BODY", problems: [...] }` | corps invalide (codes des champs, jamais de valeur) | corriger, ne pas renvoyer tel quel |
| `401` `{ error: "UNAUTHORIZED", reason }` | `MISSING_SIGNATURE`, `BAD_SIGNATURE`, `STALE` | vérifier secret, JSON canonique, horloge |
| `404` | partenaire non ouvert, ou orientation inconnue / adressée à une autre structure (même réponse) | vérifier l’identifiant |
| `409` | refus des règles de l’orientation (`INVALID_TRANSITION`, accès retiré, délégué inactif `DELEGATE_NOT_ACTIVE`) ou `IDEMPOTENCY_KEY_REUSED` (même clé, autre commande) | ne pas réessayer à l’identique |
| `413` | corps > 16 Kio | — |
| `429` | plus de 120 requêtes par minute pour votre structure | réessayer plus tard, avec la **même** `idempotencyKey` |
| `500` `NOT_APPLIED` | erreur passagère | réessayer avec la **même** `idempotencyKey` (jamais appliqué deux fois) |
| `503` `CAPABILITY_NOT_OPEN` | le pont n’est pas ouvert sur ce service | contacter ADA |

Chaque réponse appliquée est enregistrée **au nom du membre délégué** de votre structure (§ 7) : il en est responsable comme d’un clic dans ADA Pro.

## 5. Mode test / bac à sable

Aucune donnée réelle n’est utilisée pour les essais. Trois niveaux, dans l’ordre :

1. **Hors ligne, chez vous** (dépôt ADA, Node ≥ 22) — le kit utilise le même module de contrat que le serveur :
   ```
   node scripts/partner-bridge-kit.mjs vector                         # vecteur fixe
   node scripts/partner-bridge-kit.mjs sample-event received          # événement synthétique (identifiants « sandbox- »)
   node scripts/partner-bridge-kit.mjs sample-callback decline        # réponse synthétique
   export PARTNER_TEST_SECRET='<au moins 32 caractères>'
   node scripts/partner-bridge-kit.mjs sign --secret-env PARTNER_TEST_SECRET body.json
   node scripts/partner-bridge-kit.mjs verify --secret-env PARTNER_TEST_SECRET --header 't=…,v1=…' body.json
   node scripts/partner-bridge-kit.mjs validate-callback body.json
   ```
   Le secret est toujours lu dans une variable d’environnement **nommée**, jamais en argument.
2. **Votre outil contre un faux ADA** : `node scripts/partner-bridge-kit.mjs mock-ada --secret-env PARTNER_TEST_SECRET --port 8790 --partner sandbox-partner`
   démarre sur `127.0.0.1` un point d’accès qui se comporte comme celui d’ADA (signature, contrat, rejeu, réutilisation de clé, réponses ci-dessus).
   Seuls les identifiants commençant par `sandbox-` sont « trouvés ». Rien n’est écrit sur disque.
3. **ADA contre votre point d’accès de test** : `node scripts/partner-bridge-kit.mjs send-event --endpoint https://<votre-test>/ada --secret-env PARTNER_TEST_SECRET --type received`
   envoie un événement synthétique signé et affiche ce qu’ADA ferait de votre code HTTP (`--dry-run` pour voir la requête sans l’envoyer).
   Puis, sur demande, l’équipe ADA raccorde votre point d’accès de **test** à son environnement **LAB** (base jetable, comptes synthétiques)
   pour un parcours complet : orientation autorisée → événement → vos réponses → états visibles dans ADA Pro.

La production n’a pas de « mode test » : un partenaire n’y est raccordé qu’une fois les essais LAB réussis et la convention signée.

## 6. Rotation du secret

1. ADA génère un nouveau secret et vous le remet (canal séparé) ; côté ADA l’ancien devient `ADA_PARTNER_SECRET_<ID>_PREVIOUS`, le nouveau
   `ADA_PARTNER_SECRET_<ID>` (redéploiement).
2. Dès ce moment : ADA **signe ses événements avec le nouveau** ; ADA **accepte vos réponses signées avec l’un ou l’autre**.
3. Vous vérifiez les événements avec le nouveau secret (acceptez les deux pendant la bascule si votre outil le permet), puis signez vos réponses
   avec le nouveau.
4. Vous confirmez ; ADA supprime `…_PREVIOUS` (redéploiement). Une réponse signée avec l’ancien secret est alors refusée `401`.

Rotation immédiate en cas de fuite : ADA remplace le secret **sans** période de recouvrement (pas de `…_PREVIOUS`) et vous prévient.

## 7. Ce qu’ADA vous demande pour l’ouverture

- un point d’accès **https** (certificat valide, pas de redirection, réponse < 8 s), et son équivalent de test ;
- un **membre délégué** : un professionnel de votre structure, avec un compte ADA Pro actif (invitation + double authentification), au nom duquel
  vos réponses sont enregistrées ;
- un contact technique et un contact sécurité (incident, rotation) ;
- la confirmation que les essais des niveaux 1 à 3 (§ 5) passent.

ADA vous remet : votre identifiant de partenaire (ex. `centre-social-x`, minuscules, chiffres, tirets), le secret (canal séparé), l’adresse de
réponse, et l’identifiant de votre structure dans ADA.

## 8. Préalables non techniques (ADA et votre structure)

- **Convention écrite** : rôles au sens du RGPD (sous-traitance art. 28 ou responsabilité conjointe art. 26), annexe sécurité, durées de
  conservation de votre côté, notification des violations.
- **Analyse d’impact (AIPD)** d’ADA étendue à ce traitement, et information des personnes.
- **Hébergement de données de santé (HDS)** : une orientation peut révéler une information de santé (motif `HEALTH`, structure médico-sociale). Le pont
  reste fermé chez ADA tant qu’un hébergement certifié n’est pas attesté ; de votre côté, recevoir ces événements peut aussi relever de l’HDS — à
  vérifier avec votre DPO.

Fiche technique de référence : `docs/vision/FA_D7_PARTNER_REFERRAL_ADAPTER.md` ; OpenAPI : `docs/openapi.json` (`/monitor/partner/referral-events`,
`x-webhooks.partnerReferralEvent`).
