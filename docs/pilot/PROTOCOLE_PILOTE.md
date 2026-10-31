# Protocole du pilote de Strasbourg — `pilote-strasbourg-v1`

Ce protocole dit comment mesurer, avec de vraies personnes, si AccesDirectAide les aide à trouver une aide, une démarche ou un lieu d'accueil. Il est prêt à
être utilisé ; **aucune séance n'a encore eu lieu** et aucun résultat n'existe. Il ne remplace ni l'avis du délégué à la protection des données (DPO), ni la
décision de l'éditeur de lancer le pilote.

## 1. Ce que l'on mesure, et ce que l'on ne mesure pas

| Mesure | D'où elle vient | Quand elle existe |
|---|---|---|
| Fraîcheur des fiches publiées (part vérifiée depuis moins de 90 jours, vérification la plus ancienne) | le produit, à tout moment (`/admin/pilote`, « Indicateurs techniques ») | déjà |
| Fiches publiées mais retenues par la règle de publication (D-5) | le produit, à tout moment | déjà |
| Actualités et guides publiés après vérification | le produit, à tout moment | déjà |
| Parcours au clavier sur le site public (Q01) | `node scripts/q01-keyboard-journey.mjs` | déjà (15/15 le 31/10/2026) |
| Réussite d'un parcours sans aide, avec aide, échec ou abandon | séances observées | après les séances |
| Durée et nombre d'erreurs ou de retours en arrière | séances observées | après les séances |
| Clarté ressentie (1 à 5), si la personne accepte de répondre | séances observées | après les séances |
| Difficultés d'accessibilité observées (liste fermée) | séances observées | après les séances |

Il n'y a **aucune mesure d'audience** (ADR-022) : rien n'est collecté auprès des visiteurs du site. Les résultats viennent seulement des séances.

## 2. Les parcours (tâches données aux participants)

| Code | Tâche lue à la personne | Réussite si |
|---|---|---|
| J1_AIDE_LOGEMENT | « Vous avez du mal à payer votre loyer. Trouvez une aide qui pourrait vous concerner et ouvrez la page officielle qui en parle. » | la personne ouvre une fiche d'aide au logement puis sa source officielle |
| J2_DEMARCHE | « Vous voulez faire une démarche (par exemple demander la complémentaire santé solidaire). Trouvez ce qu'il faut préparer. » | la personne trouve la fiche démarche et sa liste de pièces ou d'étapes |
| J3_LIEU | « Trouvez un lieu d'accueil près de chez vous qui peut vous aider, et ses horaires. » | la personne ouvre la fiche d'un lieu et lit ses horaires ou son contact |
| J4_GUIDE | « Lisez un guide, puis suivez ce qui est proposé ensuite. » | la personne ouvre un guide et suit un lien « Et ensuite ? » |
| J5_ACTUALITE | « Trouvez une information récente et l'organisme qui l'a publiée. » | la personne ouvre une actualité et dit qui l'a publiée |
| J6_ORIENTATION_PRO | Professionnel·le seulement, dans l'espace de test : « Préparez une sélection d'orientation pour un besoin de logement et imprimez-la. » | la sélection contient au moins une piste et le récapitulatif est imprimé |

J1 à J5 se font sur le site public. J6 se fait dans l'espace de test (comptes professionnels fictifs) tant que les comptes sont fermés en bêta.

## 3. Participants

- 5 personnes au moins par parcours pour qu'un résultat soit affiché (en dessous, le produit n'affiche que le nombre de séances) ; viser 8 à 12 personnes
  au total, avec une diversité réelle : âge, aisance avec le numérique, téléphone ou ordinateur, personnes utilisant un lecteur d'écran ou une loupe.
- Recrutement par des structures partenaires réelles (accueil social, association), sur la base du volontariat. Aucune contrepartie financière n'est prévue
  par ce protocole : en ajouter une est une décision de l'éditeur.
- Une personne mineure ne participe qu'avec l'accord écrit de son représentant légal et dans les conditions que fixera le DPO.

## 4. Consentement et données

- Avant la séance, l'animateur lit et remet le **formulaire de consentement** (`FORMULAIRE_CONSENTEMENT.md`) ; la personne le signe. Le formulaire porte le
  **code participant** tiré dans `/admin/pilote` (« Tirer un nouveau code », format `P-XXXXXX`). Le formulaire papier est gardé par l'éditeur, hors du produit.
- Dans le produit, une séance ne contient **ni nom, ni contact, ni identifiant** : seulement le code, le parcours, l'appareil, l'aide technique éventuelle, le
  résultat, l'aide apportée, la durée, le nombre d'erreurs, la clarté si la personne répond, les difficultés (liste fermée) et une observation courte.
  Le serveur refuse une séance sans consentement coché (la base de données le refuse aussi) et une observation contenant une adresse e-mail, un numéro de
  téléphone ou un numéro d'identification.
- Pas d'enregistrement audio, vidéo ou d'écran dans ce protocole. En ajouter un demande une nouvelle version du protocole et l'avis du DPO.
- Retrait : à tout moment, sans justification. L'animateur supprime les séances du code concerné (« Retrait du consentement » dans `/admin/pilote`) et
  détruit le formulaire papier.
- Durée de conservation proposée (à valider par le DPO) : séances conservées jusqu'au rapport du pilote, puis 12 mois ; formulaires papier : même durée.
- Base légale proposée : consentement de la personne (à confirmer par le DPO dans le registre des traitements).

## 5. Déroulé d'une séance (30 minutes environ)

1. Accueil, lecture du formulaire, questions, signature. Tirer le code, l'écrire sur le formulaire.
2. Rappeler : « On teste le site, pas vous. Vous pouvez arrêter quand vous voulez. »
3. Pour chaque parcours retenu : lire la tâche (tableau du § 2), lancer le chronomètre, observer **sans aider**. Si la personne bloque plus d'une minute,
   proposer un indice (« Aide apportée : un indice ») ; si elle bloque encore, guider pas à pas (« Guidage pas à pas »). Arrêter le chronomètre quand le
   critère de réussite est atteint ou quand la personne abandonne.
4. Après chaque parcours, demander seulement : « Sur une échelle de 1 à 5, était-ce clair ? » (facultatif).
5. Noter la séance dans `/admin/pilote` (une ligne par parcours) avec la fiche animateur (`FICHE_ANIMATEUR.md`).

## 6. Analyse et rapport

- Le produit calcule, par parcours, au-delà de 5 séances : part de réussite sans aide, avec aide, d'échec ou d'abandon, durée et erreurs médianes, clarté
  moyenne (si 5 réponses au moins) et difficultés observées. Les agrégats se téléchargent en CSV ; aucune ligne de séance ne sort du produit.
- Le rapport du pilote ne cite **que** ces chiffres mesurés, avec leur nombre de séances et la version du protocole. Chaque défaut observé devient une entrée
  du registre des défauts, corrigée puis vérifiée lors d'une nouvelle séance.
- Un changement de tâche, de critère ou de seuil crée une nouvelle version du protocole (les résultats de versions différentes ne s'additionnent pas).

## 7. Ce qui reste à décider (hors ingénierie)

- Lancement du pilote, structures partenaires et animateurs : éditeur.
- Base légale, durée de conservation, conditions pour les personnes mineures : DPO.
- Lieu des séances : voir l'exigence Q15 (local professionnel) — à défaut, dans les locaux d'une structure partenaire, avec son accord.
