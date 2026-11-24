/**
 * « Guide d’utilisation » (/guide public, /compte/guide in the account area, 24/11/2026) — how to use each part of the site, step by step. Same rules
 * as the FAQ (src/components/help/faqContent.js): every step was checked against its screen, nothing decides or promises a right, and the steps of a
 * function that needs an account are marked `account` (the public page shows them as « après connexion »).
 * Literal t() calls only: scripts/i18n-check.mjs reads the keys and French defaults from this file.
 */
import {
  Accessibility, CalendarDays, Compass, Download, EyeOff, FileText, HandHelping, Languages, Lock, MessageSquare, PhoneCall, Route, Search, Share2,
  SlidersHorizontal, Star, Users,
} from 'lucide-react';
import { TONES, contentTone, sectionTone, topicTone } from '@/design/categoryTone';

/**
 * @typedef {{ id: string, title: string, tone: typeof TONES.slate, icon: import('react').ElementType, account?: boolean, steps: string[], where?: string[], emergency?: boolean }} GuideSection
 */

/** @param {(key: string, fallback: string) => string} t @returns {GuideSection[]} */
export function buildGuide(t) {
  return [
    {
      id: 'chercher', title: t('help:guide.search.title', 'Chercher une information'), tone: contentTone('aide'), icon: Search,
      steps: [
        t('help:guide.search.s1', 'Écrivez quelques mots dans la recherche de l’accueil ou de la page Recherche, par exemple « loyer étudiant ».'),
        t('help:guide.search.s2', 'Choisissez votre commune pour voir d’abord ce qui existe près de chez vous.'),
        t('help:guide.search.s3', 'Si vous ne savez pas quoi chercher, partez de « Trouver par besoin » ou de « Ma situation ».'),
      ],
      where: ['/recherche', '/besoins', '/situation'],
    },
    {
      id: 'filtrer', title: t('help:guide.filter.title', 'Filtrer les résultats'), tone: contentTone('structure'), icon: SlidersHorizontal,
      steps: [
        t('help:guide.filter.s1', 'Sur la page Aides, filtrez par catégorie, par situation et par territoire ; « Réinitialiser les filtres » efface vos choix.'),
        t('help:guide.filter.s2', 'Dans l’annuaire, filtrez par type de structure et par ville, et gardez si besoin les lieux accessibles aux personnes à mobilité réduite ou ceux qui proposent un rendez-vous en ligne.'),
        t('help:guide.filter.s3', 'Dans l’annuaire, passez de la liste à la carte avec le choix « Affichage ».'),
      ],
      where: ['/aides', '/structures'],
    },
    {
      id: 'fiche', title: t('help:guide.record.title', 'Lire une fiche'), tone: contentTone('guide'), icon: FileText,
      steps: [
        t('help:guide.record.s1', 'En haut de la fiche, « Vérifié le … » donne la date du dernier contrôle sur la source officielle.'),
        t('help:guide.record.s2', 'Le bloc « Provenance et fraîcheur » donne le lien vers la source officielle : c’est elle qui fait foi.'),
        t('help:guide.record.s3', 'Les conditions décrites vous aident à savoir quoi vérifier ; seul l’organisme concerné décide.'),
        t('help:guide.record.s4', 'Vous pouvez imprimer la fiche ou l’enregistrer en PDF, et signaler une erreur en bas de la page.'),
      ],
      where: ['/aides', '/demarches', '/sourcesmethode'],
    },
    {
      id: 'favoris', account: true, title: t('help:guide.favorites.title', 'Garder des fiches en favoris'), tone: sectionTone('favoris'), icon: Star,
      steps: [
        t('help:guide.favorites.s1', 'Connectez-vous, puis ouvrez une fiche d’aide, de démarche ou de structure.'),
        t('help:guide.favorites.s2', 'Choisissez « Ajouter à mes favoris ».'),
        t('help:guide.favorites.s3', 'Retrouvez vos fiches dans Mes favoris ; « Retirer » les enlève de la liste.'),
      ],
      where: ['/compte/favoris'],
    },
    {
      id: 'parcours', account: true, title: t('help:guide.parcours.title', 'Suivre mes démarches avec Mon Parcours'), tone: sectionTone('parcours'), icon: Route,
      steps: [
        t('help:guide.parcours.s1', 'Sur une fiche, choisissez « Ajouter à mon parcours » : la démarche devient une étape.'),
        t('help:guide.parcours.s2', 'Pour chaque étape, indiquez où vous en êtes et, si besoin, une échéance avec sa source.'),
        t('help:guide.parcours.s3', 'Les étapes sensibles (santé, handicap, séjour, justice…) demandent votre accord explicite.'),
      ],
      where: ['/compte/parcours'],
    },
    {
      id: 'coffre', account: true, title: t('help:guide.vault.title', 'Ranger mes documents dans Mon Coffre'), tone: sectionTone('coffre'), icon: Lock,
      steps: [
        t('help:guide.vault.s1', 'Ajoutez un document PDF, PNG ou JPEG de 3 Mo au plus, avec si besoin sa date de fin de validité.'),
        t('help:guide.vault.s2', 'Téléchargez-le ou supprimez-le quand vous le souhaitez.'),
        t('help:guide.vault.s3', 'N’y déposez pas de document médical tant que la page ne le propose pas.'),
      ],
      where: ['/compte/coffre'],
    },
    {
      id: 'rendez-vous', account: true, title: t('help:guide.rdv.title', 'Prendre et gérer un rendez-vous'), tone: sectionTone('rendez-vous'), icon: CalendarDays,
      steps: [
        t('help:guide.rdv.s1', 'Sur la fiche d’une structure qui a ouvert la prise de rendez-vous en ligne, choisissez « Voir les créneaux disponibles ».'),
        t('help:guide.rdv.s2', 'Choisissez un créneau et confirmez ; certaines structures valident chaque demande avant de la confirmer.'),
        t('help:guide.rdv.s3', 'Dans Mes rendez-vous, déplacez le rendez-vous (jusqu’à 24 heures avant, deux fois au plus), annulez-le ou ajoutez-le à votre agenda.'),
      ],
      where: ['/structures', '/compte/rendez-vous'],
    },
    {
      id: 'messages', account: true, title: t('help:guide.messages.title', 'Échanger avec une structure'), tone: sectionTone('messages'), icon: MessageSquare,
      steps: [
        t('help:guide.messages.s1', 'Ouvrez Mes messages : chaque conversation est liée à un rendez-vous.'),
        t('help:guide.messages.s2', 'Écrivez votre message, relisez-le, puis envoyez-le.'),
        t('help:guide.messages.s3', 'N’écrivez pas d’informations de santé ni de numéros d’identité : les messages ne sont pas chiffrés de bout en bout.'),
      ],
      where: ['/compte/messages'],
    },
    {
      id: 'partages', account: true, title: t('help:guide.share.title', 'Partager un dossier'), tone: sectionTone('partages'), icon: Share2,
      steps: [
        t('help:guide.share.s1', 'Dans Mon profil, à la rubrique de vos dossiers, choisissez « Gérer ».'),
        t('help:guide.share.s2', 'Cherchez une structure vérifiée et envoyez-lui l’invitation : elle ne fonctionne qu’une fois, pendant 72 heures.'),
        t('help:guide.share.s3', '« Arrêter de partager » retire l’accès quand vous le souhaitez.'),
      ],
      where: ['/compte/profil', '/compte/orientations'],
    },
    {
      id: 'confiance', account: true, title: t('help:guide.trusted.title', 'Inviter une personne de confiance'), tone: sectionTone('confiance'), icon: Users,
      steps: [
        t('help:guide.trusted.s1', 'Dans Personnes de confiance, invitez un proche par e-mail et choisissez son rôle.'),
        t('help:guide.trusted.s2', 'Cochez ce que cette personne peut voir et pour combien de temps (de 30 jours à 1 an).'),
        t('help:guide.trusted.s3', 'Vous voyez ce qu’elle a consulté ; « Arrêter l’accès » y met fin à tout moment.'),
      ],
      where: ['/compte/delegations'],
    },
    {
      id: 'accompagnant', account: true, title: t('help:guide.helper.title', 'Se faire aider avec le mode accompagnant'), tone: sectionTone('accompagnant'), icon: HandHelping,
      steps: [
        t('help:guide.helper.s1', 'Ouvrez Mode accompagnant, indiquez le nom de la personne qui vous aide et les rubriques que vous lui ouvrez.'),
        t('help:guide.helper.s2', 'Choisissez la durée (2 heures au plus), cochez votre accord et confirmez avec votre mot de passe.'),
        t('help:guide.helper.s3', 'Pour finir, choisissez « Arrêter maintenant » ou « Continuer seul ou seule ».'),
      ],
      where: ['/compte/accompagnement'],
    },
    {
      id: 'accessibilite', title: t('help:guide.a11y.title', 'Adapter l’affichage'), tone: topicTone('accessibilite'), icon: Accessibility,
      steps: [
        t('help:guide.a11y.s1', 'Le bouton « Accessibilité », en haut de la page, règle la taille du texte, le contraste et l’espacement des lignes.'),
        t('help:guide.a11y.s2', 'Activez la version « Facile à lire » (FALC) quand elle est proposée.'),
        t('help:guide.a11y.s3', '« Écouter la page » lit le texte à voix haute ; le bouton de thème passe en mode sombre ou clair.'),
      ],
      where: ['/accessibilite'],
    },
    {
      id: 'langues', title: t('help:guide.languages.title', 'Changer de langue'), tone: TONES.sky, icon: Languages,
      steps: [
        t('help:guide.languages.s1', 'Choisissez la langue en haut de la page : français, anglais, turc, arabe, allemand ou ukrainien.'),
        t('help:guide.languages.s2', 'Une fiche pas encore traduite reste en français ; une traduction automatique est signalée.'),
        t('help:guide.languages.s3', 'Le texte français et la source officielle font foi.'),
      ],
    },
    {
      id: 'masquer', title: t('help:guide.hide.title', 'Masquer l’écran rapidement'), tone: TONES.slate, icon: EyeOff,
      steps: [
        t('help:guide.hide.s1', 'Appuyez sur le bouton « Masquer l’écran », ou trois fois sur la touche Échap.'),
        t('help:guide.hide.s2', 'Un écran sombre couvre la page ; cliquez ou appuyez sur Entrée pour la retrouver.'),
        t('help:guide.hide.s3', 'Cela n’efface pas l’historique de votre navigateur : utilisez si besoin la navigation privée.'),
      ],
    },
    {
      id: 'boussole', title: t('help:guide.compass.title', 'Poser une question à la Boussole sociale'), tone: contentTone('assistant'), icon: Compass,
      steps: [
        t('help:guide.compass.s1', 'Quand l’assistant est ouvert, ouvrez-le avec son bouton et écrivez votre question en français.'),
        t('help:guide.compass.s2', 'Donnez votre code postal pour choisir votre commune : les réponses dépendent souvent du territoire.'),
        t('help:guide.compass.s3', 'Chaque réponse cite ses sources officielles. L’assistant peut se tromper : vérifiez sur la fiche officielle.'),
      ],
    },
    {
      id: 'donnees', account: true, title: t('help:guide.data.title', 'Exporter ou supprimer mes données'), tone: sectionTone('parametres'), icon: Download,
      steps: [
        t('help:guide.data.s1', 'Dans les paramètres du compte, « Télécharger (JSON) » produit un fichier avec vos données.'),
        t('help:guide.data.s2', 'Au même endroit, demandez la suppression du compte : il reste actif jusqu’au traitement de la demande.'),
        t('help:guide.data.s3', 'La politique de confidentialité explique l’utilisation de vos données et comment exercer vos droits sur elles.'),
      ],
      where: ['/compte/parametres', '/politique-confidentialite'],
    },
    {
      id: 'urgence', emergency: true, title: t('help:guide.urgent.title', 'En cas d’urgence'), tone: topicTone('urgence'), icon: PhoneCall,
      steps: [
        t('help:guide.urgent.s1', 'En cas de danger, appelez le 112 ou le numéro adapté : ils sont aussi en bas de chaque page.'),
        t('help:guide.urgent.s2', 'AccesDirectAide n’est pas un service d’urgence : il ne suit pas les demandes en temps réel.'),
      ],
      where: ['/besoins'],
    },
  ];
}
