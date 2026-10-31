# Kit de test FALC avec des lecteurs — `falc-lecteurs-v1`

**Aucun test avec des lecteurs n’a encore eu lieu.** Les textes « faciles à lire » du site sont écrits par un modèle local puis contrôlés automatiquement ; le site les présente comme tels (« Version simplifiée (contrôlée automatiquement) » ou « (IA, non relue) »). Ce kit prépare le test qui permettra, texte par texte, de dire « relu et compris par des lecteurs ». Il ne remplace pas ce test.

## 1. Ce qui est testé

Neuf textes publiés, de deux types (aides, démarches), figés au 31/10/2026. Chaque texte porte son empreinte (SHA-256 du texte simplifié) : un résultat ne vaut que pour cette version exacte. Si le texte change, il faut le tester à nouveau.

| N° | Fiche | Type | Mis à jour | Empreinte du texte simplifié (12 premiers caractères) |
|---|---|---|---|---|
| T1 | Aide personnalisée au logement (APL) (`apl`) | aide | 2026-10-30 | `b0ba592d62d2` |
| T2 | Complémentaire santé solidaire (C2S) (`c2s`) | aide | 2026-10-30 | `7b1295505434` |
| T3 | Allocation aux adultes handicapés (AAH) (`aah`) | aide | 2026-10-30 | `3be537c96494` |
| T4 | Prime d'activité (`prime-activite`) | aide | 2026-10-30 | `c0f983d86272` |
| T5 | Aides au permis de conduire (`permis`) | aide | 2026-10-30 | `3c4d42fd90b0` |
| T6 | FAJ'EMS Strasbourg / Eurométropole (`faj-strasbourg`) | aide | 2026-10-30 | `a552fc2b8c30` |
| T7 | Demande de Complémentaire santé solidaire (C2S) (`demande-c2s`) | démarche | 2026-10-30 | `dc6277311e7f` |
| T8 | Demande de logement social - Bas-Rhin (`demande-hlm-67-68`) | démarche | 2026-10-30 | `354f2203a5b8` |
| T9 | Actualisation France Travail (`actualisation-france-travail`) | démarche | 2026-10-30 | `119afeab02ee` |

Les deux résumés qui affirmaient un droit (RSA, ALS) ne sont pas dans le corpus : depuis R31, le site ne les montre plus et la vérification automatique les fait réécrire.

## 2. Participants

- 5 lecteurs au moins par texte, parmi les publics du FALC : personnes avec une déficience intellectuelle (selon les règles européennes du FALC, la relecture par ces personnes est la condition d’un texte « facile à lire »), personnes qui lisent difficilement, personnes qui apprennent le français.
- Recrutement par une structure partenaire réelle (association, ESAT, centre social, organisme de formation linguistique), avec son animateur ou animatrice habituel.
- Consentement écrit : le formulaire du pilote (`docs/pilot/FORMULAIRE_CONSENTEMENT.md`) adapté au test de lecture. Aucun nom n’entre dans le site.

## 3. Déroulé (20 à 40 minutes par personne)

1. Présenter le test : « On teste les textes, pas vous. »
2. Pour chaque texte (3 ou 4 textes par personne au plus) : la personne lit le texte simplifié imprimé (gros caractères, interligne 1,5) ou sur l’écran de son choix. Elle peut le lire à voix haute ou se le faire lire si c’est son habitude.
3. L’animateur pose les 3 questions du texte (§ 5), sans montrer les réponses. La personne peut relire le texte.
4. La personne entoure les mots difficiles et dit si le texte était facile (😀), moyen (😐) ou difficile (🙁).
5. L’animateur note sur la fiche de résultats (§ 6) : réponse juste, partielle ou fausse ; mots difficiles ; besoin d’aide.

## 4. Critères proposés (à confirmer par la structure partenaire)

Un texte est **compris** quand au moins 4 lecteurs sur 5 répondent juste aux 3 questions sans aide. Un mot est **à changer** quand au moins 2 lecteurs l’entourent. Un texte compris, sans mot à changer, peut être marqué « relu » dans l’outil de relecture FALC des administrateurs (D19), avec la date du test : c’est le seul chemin vers ce libellé.

## 5. Les textes et leurs questions

### T1 — Aide personnalisée au logement (APL)

**Texte simplifié publié :**

- L’APL (aide personnalisée au logement) vous aide à payer votre loyer.
- Vous pouvez en bénéficier si vous résidez en établissement ou louez un logement.
- Le montant dépend de vos ressources (l'argent que vous recevez), de votre loyer et de vos charges.
- Demandez l’APL en ligne ou en créant un compte en ligne.

**Conditions (version simplifiée) :**

- Vous louez un logement.
- Vous résidez en établissement.
- Vous gagnez peu d’argent.
- Vous fournissez les justificatifs (papiers qui prouvent) nécessaires.

**Questions :**

1. À quoi sert l’APL ?
2. Où pouvez-vous faire la demande ?
3. Qui décide si vous recevez l’APL ?

### T2 — Complémentaire santé solidaire (C2S)

**Texte simplifié publié :**

- La complémentaire santé solidaire (C2S) vous aide à payer les dépenses de santé non remboursées.
- Elle est gratuite ou payante selon vos revenus.
- Vous devez avoir des revenus inférieurs à certains plafonds (montants maximum).
- Vous pouvez faire la demande en ligne ou par courrier.

**Conditions (version simplifiée) :**

- Vous recevez l'RSA (revenu de solidarité active), l'Aspa, l'Asi (Allocation supplémentaire d'invalidité) ou l'AAH (allocation aux adultes handicapés).
- Vous êtes hébergé gratuitement ou propriétaire de votre logement.
- Vous bénéficiez d'une aide au logement.
- Vous résidez en France, avec ou sans nationalité française.

**Questions :**

1. La C2S est-elle toujours gratuite ?
2. À quoi sert la C2S ?
3. Comment pouvez-vous faire la demande ?

**Point déjà repéré par l’ingénierie (à confirmer par les lecteurs) :** Conditions : « Vous recevez l’RSA » (lire « le RSA ») ; la liste mélange des situations d’attribution automatique et des conditions.

### T3 — Allocation aux adultes handicapés (AAH)

**Texte simplifié publié :**

- L'AAH (allocation aux adultes handicapés) vous aide à vivre.
- Vous avez un handicap et peu d'argent.
- L'AAH dépend de vos ressources (l'argent que vous recevez).
- Faites une demande en ligne ou par courrier.

**Conditions (version simplifiée) :**

- Vous avez un taux d'incapacité d'au moins 80 %.
- Vous êtes âgé de 20 ans au moins.
- Vous résidez en France ou en outre-mer.
- Vous êtes français ou résidez en France depuis plus de 3 mois.

**Questions :**

1. Pour qui est l’AAH ?
2. De quoi dépend l’AAH ?
3. Comment pouvez-vous faire la demande ?

**Point déjà repéré par l’ingénierie (à confirmer par les lecteurs) :** Conditions : « taux d’incapacité d’au moins 80 % » sans la voie 50 à 79 % prévue par la fiche officielle (à vérifier par l’expert D11).

### T4 — Prime d'activité

**Texte simplifié publié :**

- La prime d'activité est une aide financière.
- Elle sert à encourager les travailleurs.
- Elle est destinée aux personnes de plus de 18 ans.
- Vous pouvez la demander sur le site de la Caf (Caisse d'allocations familiales).

**Conditions (version simplifiée) :**

- Vous devez être travailleur (salarié ou non salarié).
- Vous devez avoir des ressources (l'argent que vous recevez) modestes.
- Vous devez avoir plus de 18 ans.
- Vous pouvez être seul ou en couple.
- Vous pouvez avoir des enfants à charge.
- Les parents isolés ont aussi le droit.

**Questions :**

1. Pour qui est la prime d’activité ?
2. À partir de quel âge ?
3. Où faire la demande ?

**Point déjà repéré par l’ingénierie (à confirmer par les lecteurs) :** « personnes de plus de 18 ans » alors que la fiche dit « 18 ans ou plus ».

### T5 — Aides au permis de conduire

**Texte simplifié publié :**

- Des aides existent pour payer le permis de conduire.
- Elles s'adressent aux jeunes, apprentis, chômeurs, handicapés et salariés.
- Le montant varie entre 300 € et 1 200 €.
- Pour demander une aide, contactez une école de conduite, une mairie, une mission locale ou le CPF (compte personnel de formation).

**Conditions (version simplifiée) :**

- Vous avez entre 15 et 25 ans.
- Vous préparez le permis B, A1 ou A2.
- Vous êtes apprenti, chômeur, en situation de handicap ou salarié.
- Vous êtes volontaire du SNU (service national universel).
- Vous avez un projet professionnel lié au permis de conduire.

**Questions :**

1. À quoi servent ces aides ?
2. Qui pouvez-vous contacter pour demander une aide ?
3. Faut-il remplir toutes les conditions de la liste, ou une seule ?

**Point déjà repéré par l’ingénierie (à confirmer par les lecteurs) :** Conditions écrites comme si toutes étaient nécessaires (« Vous avez entre 15 et 25 ans », « Vous êtes apprenti, chômeur… ») alors que ce sont des cas différents.

### T6 — FAJ'EMS Strasbourg / Eurométropole

**Texte simplifié publié :**

- Le FAJ’EMS (Fonds d’Aide aux Jeunes) vous aide si vous êtes jeune et en difficulté.
- Vous habitez l’Eurométropole de Strasbourg et avez entre 16 et 25 ans.
- L’aide vous soutient pour trouver un emploi ou un logement.
- Vous pouvez demander de l’aide si vous avez des problèmes.

**Conditions (version simplifiée) :**

- Vous avez entre 16 et 25 ans.
- Vous habitez l’Eurométropole de Strasbourg.
- Vous avez des difficultés pour trouver un emploi ou un logement.
- Vous avez besoin d’aide pour votre insertion sociale ou professionnelle.

**Questions :**

1. Pour qui est le FAJ’EMS ?
2. Faut-il habiter Strasbourg ou l’Eurométropole ?
3. À quoi sert l’aide ?

### T7 — Demande de Complémentaire santé solidaire (C2S)

**Texte simplifié publié :**

- La C2S (complémentaire santé solidaire) vous aide à payer les frais de santé non remboursés.
- Elle est gratuite ou payante selon vos revenus.
- Vous devez avoir des revenus inférieurs à des plafonds (montants maximum).
- Faites votre demande en ligne ou par courrier.

**Étapes (version simplifiée) :**

- Faites votre demande en ligne ou par courrier.
- Attendez la réponse de l'Assurance maladie.
- La réponse arrive en 2 mois maximum.
- Payer le montant si la C2S (complémentaire santé solidaire) est payante.
- Renouvelez automatiquement si vous avez l'RSA (revenu de solidarité active), l'Aspa, l'Asi (Allocation supplémentaire d'invalidité) ou l'AAH (allocation aux adultes handicapés).

**Questions :**

1. Comment faire la demande ?
2. Combien de temps faut-il attendre la réponse ?
3. Que faut-il faire si la C2S est payante ?

**Point déjà repéré par l’ingénierie (à confirmer par les lecteurs) :** Étapes : « Payer le montant… » (infinitif au lieu de « Payez ») ; « l’RSA ».

### T8 — Demande de logement social - Bas-Rhin

**Texte simplifié publié :**

- Pour obtenir un logement social, faites une demande en ligne ou sur place.
- Vous devez indiquer toutes les personnes qui vont vivre avec vous.
- Le montant maximum dépend de la commune où vous voulez habiter.
- Le délai d'attente varie selon le lieu et votre situation.

**Étapes (version simplifiée) :**

- Faites votre demande en ligne ou sur place (au guichet).
- Fournissez un justificatif (papier qui prouve) d'identité.
- Indiquez toutes les personnes qui vont vivre dans le logement.
- Attendez la réponse sur l'acceptation ou le rejet de votre dossier.

**Questions :**

1. Où pouvez-vous faire la demande de logement social ?
2. Quelles personnes faut-il indiquer ?
3. Le délai d’attente est-il le même pour tout le monde ?

**Point déjà repéré par l’ingénierie (à confirmer par les lecteurs) :** « Le montant maximum dépend de la commune » : on ne sait pas de quel montant il s’agit (plafond de ressources).

### T9 — Actualisation France Travail

**Texte simplifié publié :**

- France Travail vous demande d'actualiser votre situation chaque mois.
- Cela assure le versement de l'ARE (allocation chômage de France Travail) et la mise à jour de vos droits.
- Vous pouvez faire cela en ligne, par téléphone ou sur place.
- Vous devez respecter un calendrier officiel.

**Étapes (version simplifiée) :**

- Actualisez votre inscription chaque mois selon le calendrier.
- Dites à France Travail si vous cherchez toujours un emploi.
- Déclarez tout changement de situation qui affecte vos droits.
- Si vous avez travaillé, envoyez la copie de votre fiche de paie.
- Si vous n'avez pas reçu de fiche de paie, déclarez le montant reçu.

**Questions :**

1. Tous les combien faut-il s’actualiser ?
2. Comment pouvez-vous le faire ?
3. Que faut-il envoyer si vous avez travaillé ?

## 6. Fiche de résultats et suivi des corrections

- Résultats : `docs/falc/RESULTATS_TEST_LECTEURS_MODELE.csv` (une ligne par lecteur et par texte, sans nom : un code lecteur de la structure).
- Corrections : chaque texte modifié après le test reçoit une ligne dans le journal (`docs/falc/JOURNAL_REVISIONS.csv`) : texte, empreinte avant, problème trouvé par les lecteurs, changement, empreinte après, date du nouveau test.
- Un texte corrigé est testé à nouveau avant d’être marqué « relu ».

## 7. Preuves attendues pour dire qu’un texte est validé

- La fiche de résultats remplie (codes lecteurs, sans nom), datée.
- Une attestation de la structure partenaire : nombre de lecteurs, publics, dates, nom et fonction de l’animateur.
- Le journal des corrections, et l’empreinte de la version validée.
- Dans le site : la relecture enregistrée champ par champ (outil FALC des administrateurs), qui fait passer le libellé à « Version simplifiée (relue) ». Sans ces preuves, le libellé reste « contrôlée automatiquement » ou « IA, non relue ».
