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

- Avant la séance, l'animateur lit et remet le **formulaire de consentement** (`FORMULAIRE_CONSENTEMENT.md`, version 2) ; la personne le signe. Le
  formulaire porte le **code participant** tiré dans `/admin/pilote` (« Tirer un nouveau code », format `P-XXXXXX`). Le formulaire papier est gardé par
  l'éditeur, sous clé, hors du produit.
- **Les séances ne sont pas anonymes.** Elles ne contiennent ni nom ni contact, mais le code renvoie au formulaire qui porte le nom : ce sont des **données
  personnelles pseudonymisées** (RGPD, art. 4(5)). Elles suivent toutes les règles des données personnelles (information, droits, durée, sécurité).
- Dans le produit, une séance contient : le code, le parcours, l'appareil, l'aide technique (voir ci-dessous), le résultat, l'aide apportée, la durée, le
  nombre d'erreurs, la clarté si la personne répond, les difficultés (liste fermée), une observation courte et **le jour** de la séance (l'heure n'est pas
  gardée : elle permettrait de rapprocher la séance des journaux du serveur ou d'un planning).
- **Aide technique utilisée** (lecteur d'écran, loupe, clavier seul, commande vocale, autre) : elle peut révéler un handicap, donc une donnée de santé
  (art. 9). Elle n'est notée que si la personne a coché la **case 3** du formulaire (consentement explicite, art. 9(2)(a)) ; le serveur refuse sinon, de
  même qu'une difficulté « lecteur d'écran ». Sans la case 3, l'animateur choisit « Aucune ». Refuser la case 3 n'empêche pas de participer.
- **Observation** : ce qui s'est passé à l'écran, jamais la personne. Le serveur refuse une adresse e-mail, un numéro de téléphone, un numéro
  d'identification et les mots qui décrivent la santé ou le handicap d'une personne (par exemple « malvoyant », « malade », « AAH »).
- Le serveur refuse une séance sans consentement coché (la base de données le refuse aussi).
- **Accès** : seuls les administrateurs de l'éditeur (mot de passe et double authentification) voient les séances ; elles ne sortent du produit que sous
  forme d'agrégats, chaque nombre inférieur à 5 étant masqué, y compris le nombre de séances par difficulté.
- **Risque de ré-identification** : avec 8 à 12 personnes, l'animateur sait qui est venu quel jour. C'est pourquoi les lignes de séance ne sortent jamais du
  produit, que les petits nombres sont masqués et que le rapport ne cite que des agrégats. Le formulaire papier et les séances sont gardés séparément.
- Pas d'enregistrement audio, vidéo ou d'écran dans ce protocole. En ajouter un demande une nouvelle version du protocole et une nouvelle analyse.
- **Retrait** : à tout moment, sans justification, en donnant le code ou le nom (l'éditeur retrouve le code sur le formulaire). L'animateur supprime les
  séances du code (« Retrait du consentement » dans `/admin/pilote`) et détruit le formulaire papier. Retrait de la seule case 3 : supprimer les séances du
  code puis les enregistrer de nouveau avec « Aucune ».
- **Durée de conservation** (valeur par défaut, à revoir et à approuver) : séances jusqu'au rapport du pilote, puis 12 mois ; formulaires papier : même
  durée. Aucune suppression automatique n'est programmée : la suppression se fait à la main, à l'échéance, par l'administrateur.
- **Base légale** proposée : consentement (art. 6(1)(a)) ; pour l'aide technique, consentement explicite (art. 9(2)(a)). À confirmer lors de la revue
  juridique, dans le registre des traitements (T18).

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
- Base légale, durée de conservation, conditions pour les personnes mineures : revue juridique (et DPO s'il en est désigné un).
- Lieu des séances : voir l'exigence Q15 (local professionnel) — à défaut, dans les locaux d'une structure partenaire, avec son accord.
