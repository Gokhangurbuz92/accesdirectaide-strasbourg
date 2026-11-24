# Runbook opérateur — espace institutionnel (collectivité, partenaire institutionnel)

Pour : le responsable / l’opérateur d’ADA. L’espace `/institution` montre **uniquement des statistiques agrégées** du territoire autorisé du compte
(observatoire du dernier trimestre gelé, export CSV si ouvert) — jamais une personne, un dossier ou une structure nommée. Code : `api/_handlers/institution.js`,
`api/_services/institutions.js`, `api/_handlers/admin/institutions.js` ; écrans : `src/pages/institution/*`, `/admin/institutions`.

## 0. Préalables (décisions du responsable)

| # | Préalable |
|---|---|
| 0.1 | Ligne de l’AIPD « institution » signée (capacité `institution.portal`, hors AIPD initiale) et mention dans la notice d’information |
| 0.2 | Convention signée avec l’organisme (objet, territoire, usage des statistiques, interdiction de réidentification, durée) |
| 0.3 | E-mail transactionnel réel (lien « mot de passe oublié ») : `MAILER_PROVIDER` ≠ `noop`, `mail.deliverable` = PASS au contrôle de publication |
| 0.4 | Trimestres gelés : la tâche `observatory-freeze` ouverte (`ADA_BETA_OPEN_JOBS`) — sans elle toutes les cellules restent masquées |
| 0.5 | Export CSV (facultatif) : licence de réutilisation décidée, puis interrupteur `OPEN_DATA_EXPORT` dans Administration → Fonctions |

## 1. Ouvrir la fonction (variables Production, puis redéploiement)

| Variable | Valeur |
|---|---|
| `ADA_BETA_OPEN_SURFACES` | ajouter `institution` |
| `ADA_CAPABILITIES_OPEN` | ajouter `institution.portal` |
| `ADA_BETA_OPEN_JOBS` | contient `observatory-freeze` (catégorie A, aucune approbation supplémentaire) |
| `VITE_PUBLIC_BETA_OPEN_SURFACES` | ajouter `institution` (affiche les écrans `/institution` ; nouvelle construction) |

Contrôle de publication : `institution.statistics` doit être `PASS` (`WARN` = tâche de gel fermée), `capabilities.out_of_aipd` cite
`institution.portal` (rappel AIPD), `mail.deliverable` = `PASS`.

## 2. Créer un compte (Administration → Partenaires institutionnels, `/admin/institutions`, session MFA)

1. **Convention** : « Nouvelle convention » (nom, type, objet) → brouillon. À réception du document signé : référence, date, signataire →
   « Enregistrer la signature ». Rien n’est pré-rempli ; une convention non signée n’active aucun compte.
2. **Compte** : adresse e-mail nominative de la personne de l’organisme, nom de l’organisme, **territoire autorisé** (région, département,
   intercommunalité ou commune, par son nom ou son **code INSEE** ; un nom ambigu est refusé avec les codes possibles), convention.
   Action « élevée » (MFA + élévation). Le **mot de passe provisoire** s’affiche **une seule fois** : le transmettre par un canal séparé (téléphone,
   courrier), jamais dans le même e-mail que l’adresse de connexion.
3. **Activer** le compte (possible seulement sous une convention signée et en cours).
4. La personne se connecte sur `/institution`, **doit** choisir son propre mot de passe (le provisoire n’ouvre que la page de changement),
   puis voit les statistiques de son territoire.

## 3. Exploitation

| Situation | Action |
|---|---|
| Mot de passe oublié | la personne utilise « Mot de passe oublié » (lien de 30 minutes, une fois) ; à défaut, « Nouveau mot de passe provisoire » (MFA + élévation ; toutes ses sessions sont fermées) |
| 5 échecs de connexion | verrou de 15 minutes, levé par un lien de réinitialisation |
| Départ de la personne / incident | « Suspendre » (immédiat) ; un nouveau compte nominatif pour son successeur |
| Fin de convention | « Terminer la convention » : tous ses comptes sont suspendus en une fois |
| « Territoire non défini » côté institution | le compte a été créé avant R20 ou porte un libellé non officiel : recréer le compte avec un territoire officiel |
| « Trop de consultations » (429) | normal : les lectures de statistiques sont limitées par compte (anti-différenciation) |

Traçabilité (journal d’audit `/admin/audit`) : `PARTNER_AGREEMENT_*`, `INSTITUTION_ACCOUNT_CREATED|ACTIVATED|SUSPENDED`, `INSTITUTION_LOGIN`,
`INSTITUTION_PASSWORD_*`, `INSTITUTION_RESET_*`, une lecture d’observatoire par compte et par jour, chaque téléchargement CSV (empreinte du fichier).

## 4. Ce qui reste à décider (hors ingénierie)

- Durée de conservation des comptes institutionnels suspendus et des conventions terminées (aucune étape de purge n’existe : la politique de
  conservation ne prévoit pas encore cette durée).
- Licence de l’export CSV (`OPEN_DATA_EXPORT` reste fermé).
