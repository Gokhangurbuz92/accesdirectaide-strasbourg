/**
 * « Questions fréquentes » (/questions-frequentes, 24/11/2026) — the questions and answers, grouped in sections. Every statement was checked against
 * the screens it describes (routes in src/pages/index.jsx, beta switches in src/lib/publicBeta.js, legal pages). Rules: the site never decides
 * (« seul l’organisme concerné décide »), never says that someone is entitled to or will receive something (api/lib/entitlementWording.js), and a
 * function that a beta build may keep closed is described as opening progressively.
 * Literal t() calls only: scripts/i18n-check.mjs reads the keys and French defaults from this file.
 */
import {
  Accessibility, BadgeCheck, Building2, CalendarDays, Clock, Compass, Flag, Info, PhoneCall, Scale, Search, ShieldCheck, UserRound,
} from 'lucide-react';
import { TONES, contentTone, sectionTone, topicTone } from '@/design/categoryTone';

/**
 * @typedef {{ id: string, q: string, a: string, links?: string[], emergency?: boolean }} FaqItem
 * @typedef {{ id: string, title: string, tone: typeof TONES.slate, icon: import('react').ElementType, items: FaqItem[] }} FaqSection
 */

/** @param {(key: string, fallback: string) => string} t @returns {FaqSection[]} */
export function buildFaq(t) {
  return [
    {
      id: 'site', title: t('help:faq.site.title', 'Le site'), tone: TONES.sky, icon: Info,
      items: [
        { id: 'what', q: t('help:faq.site.what.q', 'Qu’est-ce qu’AccesDirectAide ?'), a: t('help:faq.site.what.a', 'Un site d’information sociale gratuit. Il rassemble des aides, des démarches, des lieux d’accueil et des guides vérifiés sur des sources officielles, pour vous aider à savoir quoi vérifier et à qui vous adresser. Ce n’est pas un site de l’administration : il ne remplace ni la CAF, ni l’Assurance maladie, ni France Travail.'), links: ['/a-propos'] },
        { id: 'free', q: t('help:faq.site.free.q', 'Est-ce gratuit ?'), a: t('help:faq.site.free.a', 'Oui. L’accès est gratuit pour les personnes, sans publicité ni classement payant, et sans vente de données.') },
        { id: 'who', q: t('help:faq.site.who.q', 'Qui gère le site ?'), a: t('help:faq.site.who.a', 'AccesDirectAide est un projet à but non lucratif porté par une personne physique. L’association de droit local d’Alsace-Moselle envisagée n’est pas encore créée. Les informations sur l’éditeur sont dans les mentions légales.'), links: ['/mentions-legales', '/a-propos'] },
        { id: 'territory', q: t('help:faq.site.territory.q', 'Quel territoire est couvert ?'), a: t('help:faq.site.territory.a', 'Les aides locales, l’assistant et le calcul indicatif concernent l’Eurométropole de Strasbourg ; l’annuaire des lieux d’accueil couvre tout le Bas-Rhin ; les aides nationales valent partout en France. La page « Territoire couvert » détaille ce qui est disponible.'), links: ['/territoire'] },
        { id: 'account', q: t('help:faq.site.account.q', 'Faut-il un compte pour utiliser le site ?'), a: t('help:faq.site.account.a', 'Non. Les aides, les démarches, les lieux et les guides se consultent sans compte. Un compte sert seulement aux fonctions personnelles (favoris, Mon Parcours, rendez-vous…), quand elles sont ouvertes.') },
      ],
    },
    {
      id: 'trouver', title: t('help:faq.find.title', 'Trouver une aide, une démarche ou un lieu'), tone: contentTone('structure'), icon: Search,
      items: [
        { id: 'search', q: t('help:faq.find.search.q', 'Comment chercher une aide ?'), a: t('help:faq.find.search.a', 'Écrivez quelques mots dans la recherche, par exemple « loyer étudiant », ou ouvrez la page Aides. Vous pouvez filtrer par catégorie, par situation et par territoire.'), links: ['/recherche', '/aides'] },
        { id: 'near', q: t('help:faq.find.near.q', 'Puis-je voir ce qui existe près de chez moi ?'), a: t('help:faq.find.near.a', 'Oui. Dans la recherche, choisissez votre commune : les aides réservées à un autre territoire ne sont plus affichées et les lieux de cette commune sont proposés en premier. Dans l’annuaire, vous pouvez filtrer par ville et par type de structure, et afficher une carte.'), links: ['/recherche', '/structures'] },
        { id: 'demarche', q: t('help:faq.find.demarche.q', 'Où trouver les étapes d’une démarche ?'), a: t('help:faq.find.demarche.a', 'La page Démarches explique les démarches administratives étape par étape (par exemple un passeport), avec le lien vers la source officielle.'), links: ['/demarches'] },
        { id: 'place', q: t('help:faq.find.place.q', 'Comment trouver un lieu d’accueil ?'), a: t('help:faq.find.place.a', 'L’annuaire présente des lieux : mairies, CCAS, CAF, France Services, associations… Vous pouvez garder seulement les lieux accessibles aux personnes à mobilité réduite ou ceux qui proposent un rendez-vous en ligne.'), links: ['/structures'] },
        { id: 'start', q: t('help:faq.find.start.q', 'Je ne sais pas par où commencer.'), a: t('help:faq.find.start.a', 'Partez de « Trouver par besoin » : décrivez votre situation avec vos mots ou choisissez un domaine. La page « Ma situation » propose aussi, selon ce qui vous arrive, les aides à vérifier, les démarches et les lieux à contacter.'), links: ['/besoins', '/situation'] },
        { id: 'tools', q: t('help:faq.find.tools.q', 'À quoi servent les guides, les outils et le glossaire ?'), a: t('help:faq.find.tools.a', 'Les Bonnes pratiques sont des guides en langage simple pour préparer vos démarches et vos rendez-vous. Les Outils renvoient vers des simulateurs et des services en ligne choisis sur les sites des organismes publics. Le Glossaire explique les sigles et les mots difficiles.'), links: ['/bonnes-pratiques', '/outils', '/glossaire'] },
      ],
    },
    {
      id: 'droits', title: t('help:faq.rights.title', 'Mes droits'), tone: topicTone('droits'), icon: Scale,
      items: [
        { id: 'decide', q: t('help:faq.rights.decide.q', 'Le site peut-il me dire si une aide est pour moi ?'), a: t('help:faq.rights.decide.a', 'Non. Le site vous aide à repérer les aides qui peuvent vous concerner et à savoir quoi vérifier. Seul l’organisme concerné (CAF, département, mairie…) décide, après l’étude de votre demande.') },
        { id: 'conditions', q: t('help:faq.rights.conditions.q', 'Que veulent dire les conditions écrites sur une fiche ?'), a: t('help:faq.rights.conditions.a', 'Ce sont les conditions publiées par la source officielle. Elles vous aident à savoir s’il vaut la peine de vérifier, mais elles ne suffisent pas : l’organisme examine votre situation complète et décide.') },
        { id: 'page', q: t('help:faq.rights.page.q', 'À quoi sert la page « Droits » ?'), a: t('help:faq.rights.page.a', 'Elle présente, besoin par besoin, les fiches officielles de Service-Public, l’organisme qui décide et les étapes possibles, sans question et sans compte.'), links: ['/droits'] },
        { id: 'amount', q: t('help:faq.rights.amount.q', 'Le site calcule-t-il le montant d’une aide ?'), a: t('help:faq.rights.amount.a', 'Non. Pour une estimation, utilisez les simulateurs officiels de la page Outils. Seul l’organisme fixe le montant.'), links: ['/outils'] },
        { id: 'refused', q: t('help:faq.rights.refused.q', 'Ma demande a été refusée : que faire ?'), a: t('help:faq.rights.refused.a', 'La décision appartient à l’organisme. Le courrier de réponse indique en général les recours possibles et leurs délais : lisez-le attentivement. Un lieu d’accueil (CCAS, France Services, association) peut vous aider : cherchez-en un dans l’annuaire.'), links: ['/structures'] },
      ],
    },
    {
      id: 'sources', title: t('help:faq.sources.title', 'Sources et vérification'), tone: contentTone('guide'), icon: BadgeCheck,
      items: [
        { id: 'where', q: t('help:faq.sources.where.q', 'D’où viennent les informations ?'), a: t('help:faq.sources.where.a', 'Chaque fiche part d’une source publique : Service-Public, répertoire FINESS, Annuaire de l’administration, sites des collectivités. La source est indiquée sur la fiche.'), links: ['/sourcesmethode'] },
        { id: 'date', q: t('help:faq.sources.date.q', 'Que veut dire « Vérifié le … » ?'), a: t('help:faq.sources.date.a', 'C’est la date du dernier contrôle automatique de la fiche sur sa source officielle. Une fiche n’est publiée qu’après ce contrôle. Si la source disparaît ou ne confirme plus l’information, la fiche est retirée jusqu’à la prochaine vérification.') },
        { id: 'conflict', q: t('help:faq.sources.conflict.q', 'La fiche et le site officiel ne disent pas la même chose : qui a raison ?'), a: t('help:faq.sources.conflict.a', 'Le site officiel fait foi. Suivez le lien vers la source officielle et signalez-nous l’écart pour que la fiche soit corrigée.') },
      ],
    },
    {
      id: 'compte', title: t('help:faq.account.title', 'Mon compte et Mon Espace'), tone: sectionTone('parcours'), icon: UserRound,
      items: [
        { id: 'create', q: t('help:faq.account.create.q', 'Comment créer un compte ?'), a: t('help:faq.account.create.a', 'Choisissez « Créer un compte », indiquez votre adresse e-mail et un mot de passe (au moins 8 caractères, dont une majuscule, une minuscule et un chiffre), confirmez que vous avez 18 ans ou plus, puis ouvrez le lien de vérification envoyé par e-mail. Pendant la bêta publique, la création de compte ouvre progressivement.'), links: ['/auth/signup'] },
        { id: 'forgot', q: t('help:faq.account.forgot.q', 'J’ai oublié mon mot de passe.'), a: t('help:faq.account.forgot.a', 'Utilisez « Mot de passe oublié » : si l’adresse est connue, un lien de réinitialisation lui est envoyé. Si vous n’avez plus accès à votre adresse e-mail, une aide à la récupération est proposée sur la même page.'), links: ['/auth/forgot'] },
        { id: 'space', q: t('help:faq.account.space.q', 'Que trouve-t-on dans Mon Espace ?'), a: t('help:faq.account.space.a', 'Mon Espace rassemble vos rubriques : Mon Parcours, Mon Coffre, favoris, rendez-vous, messages, dossiers partagés, orientations, personnes de confiance, mode accompagnant, historique, profil et paramètres. Seules les rubriques ouvertes sont affichées. Pour garder une fiche, utilisez « Ajouter à mes favoris » sur la fiche une fois connecté.'), links: ['/compte', '/compte/favoris'] },
        { id: 'parcours', q: t('help:faq.account.parcours.q', 'À quoi sert Mon Parcours ?'), a: t('help:faq.account.parcours.a', 'À suivre vos démarches étape par étape : ajoutez une fiche avec « Ajouter à mon parcours », indiquez où vous en êtes et, si besoin, une échéance. Les étapes sensibles (santé, handicap, séjour, justice…) demandent votre accord explicite. AccesDirectAide ne prend aucune décision sur vos droits.'), links: ['/compte/parcours'] },
        { id: 'coffre', q: t('help:faq.account.coffre.q', 'Qu’est-ce que Mon Coffre ?'), a: t('help:faq.account.coffre.a', 'Un espace pour garder vos documents (PDF, PNG ou JPEG, 3 Mo au plus), chiffrés sur nos serveurs. Vous choisissez qui peut les voir (une structure ou une personne de confiance). N’y déposez pas de document médical tant que la page ne le propose pas. Les fichiers ne sont pas encore analysés par un antivirus.'), links: ['/compte/coffre'] },
        { id: 'trusted', q: t('help:faq.account.trusted.q', 'Qu’est-ce qu’une personne de confiance ?'), a: t('help:faq.account.trusted.a', 'Un proche ou un représentant que vous invitez par e-mail. Vous choisissez ce qu’il peut voir (Mon Parcours sans vos notes, la liste de Mon Coffre sans ouvrir les documents, vos prochains rendez-vous) et pour combien de temps, de 30 jours à 1 an. Vous pouvez arrêter l’accès à tout moment.'), links: ['/compte/delegations'] },
        { id: 'helper', q: t('help:faq.account.helper.q', 'Qu’est-ce que le mode accompagnant ?'), a: t('help:faq.account.helper.a', 'Il permet à une personne assise à côté de vous de vous aider sur votre compte, pendant 2 heures au plus. Vous choisissez les rubriques ouvertes et vous confirmez avec votre mot de passe. Cette personne ne peut jamais changer votre mot de passe ou votre e-mail, ni supprimer votre compte.'), links: ['/compte/accompagnement'] },
        { id: 'history', q: t('help:faq.account.history.q', 'Le site garde-t-il ce que je consulte ?'), a: t('help:faq.account.history.a', 'Seulement si vous activez « Mon historique », qui est facultatif. Vous pouvez effacer une entrée ou tout l’historique ; le désactiver efface tout.'), links: ['/compte/historique'] },
      ],
    },
    {
      id: 'rendez-vous', title: t('help:faq.rdv.title', 'Rendez-vous et messages'), tone: sectionTone('rendez-vous'), icon: CalendarDays,
      items: [
        { id: 'book', q: t('help:faq.rdv.book.q', 'Puis-je prendre rendez-vous en ligne ?'), a: t('help:faq.rdv.book.a', 'Seulement avec les structures qui ont ouvert la prise de rendez-vous en ligne : leur fiche propose alors « Voir les créneaux disponibles ». Sinon, contactez la structure directement. Il faut un compte avec une adresse e-mail vérifiée. Certaines structures valident chaque demande avant de la confirmer. Pendant la bêta publique, la prise de rendez-vous ouvre progressivement.'), links: ['/structures'] },
        { id: 'change', q: t('help:faq.rdv.change.q', 'Comment déplacer ou annuler un rendez-vous ?'), a: t('help:faq.rdv.change.a', 'Dans Mes rendez-vous. Un rendez-vous peut être déplacé jusqu’à 24 heures avant, deux fois au plus. L’annulation prévient la structure et ne peut pas être reprise. Vous pouvez aussi ajouter le rendez-vous à votre agenda.'), links: ['/compte/rendez-vous'] },
        { id: 'messages', q: t('help:faq.rdv.messages.q', 'À qui puis-je écrire ?'), a: t('help:faq.rdv.messages.a', 'La messagerie sert aux échanges liés à vos rendez-vous avec une structure. Les messages sont chiffrés sur nos serveurs, mais pas de bout en bout : n’y écrivez pas d’informations de santé ni de numéros d’identité. Les pièces jointes ne sont pas encore ouvertes.'), links: ['/compte/messages'] },
        { id: 'share', q: t('help:faq.rdv.share.q', 'Comment partager un dossier avec une structure ?'), a: t('help:faq.rdv.share.a', 'Depuis vos dossiers (Mon profil), choisissez une structure vérifiée. Le lien d’invitation ne fonctionne qu’une fois, pendant 72 heures. Vous pouvez arrêter le partage à tout moment.'), links: ['/compte/profil'] },
        { id: 'orientation', q: t('help:faq.rdv.orientation.q', 'Une structure propose de transmettre mon dossier : que se passe-t-il ?'), a: t('help:faq.rdv.orientation.a', 'La proposition apparaît dans Mes orientations : vous l’acceptez ou vous la refusez. Rien n’est transmis sans votre accord, et les notes internes des structures ne sont jamais transmises.'), links: ['/compte/orientations'] },
      ],
    },
    {
      id: 'donnees', title: t('help:faq.data.title', 'Données personnelles et sécurité'), tone: sectionTone('parametres'), icon: ShieldCheck,
      items: [
        { id: 'collected', q: t('help:faq.data.collected.q', 'Quelles données sont traitées ?'), a: t('help:faq.data.collected.a', 'Pour consulter le site, rien ne vous est demandé. Avec un compte, ce sont les informations que vous enregistrez vous-même. Le détail (finalités, durées, destinataires) est dans la politique de confidentialité.'), links: ['/politique-confidentialite'] },
        { id: 'cookies', q: t('help:faq.data.cookies.q', 'Le site utilise-t-il des cookies ?'), a: t('help:faq.data.cookies.a', 'Surtout pour vous garder connecté, sécuriser le site et garder vos réglages. Pas de publicité, pas de réseaux sociaux, pas de suivi d’un site à l’autre. La page Cookies donne la liste complète.'), links: ['/cookies'] },
        { id: 'security', q: t('help:faq.data.security.q', 'Où sont hébergées les données et comment sont-elles protégées ?'), a: t('help:faq.data.security.a', 'La page « Sécurité et RGPD » présente l’hébergement et les mesures de protection.'), links: ['/securite-et-rgpd'] },
        { id: 'export', q: t('help:faq.data.export.q', 'Comment télécharger mes données ?'), a: t('help:faq.data.export.a', 'Dans les paramètres du compte, « Télécharger (JSON) » produit un fichier avec vos données. Vous pouvez aussi y demander la limitation de l’utilisation de vos données ou vous y opposer.'), links: ['/compte/parametres'] },
        { id: 'delete', q: t('help:faq.data.delete.q', 'Comment supprimer mon compte ?'), a: t('help:faq.data.delete.a', 'Demandez la suppression dans les paramètres du compte. Le compte reste actif jusqu’au traitement de la demande ; la suppression est ensuite définitive, sauf les données que la loi oblige à conserver.'), links: ['/compte/parametres'] },
        { id: 'sensitive', q: t('help:faq.data.sensitive.q', 'Que faut-il éviter d’écrire sur le site ?'), a: t('help:faq.data.sensitive.a', 'N’écrivez pas d’informations sensibles (santé, numéro de sécurité sociale, documents d’identité) dans un message, un signalement ou un e-mail.') },
      ],
    },
    {
      id: 'accessibilite', title: t('help:faq.a11y.title', 'Accessibilité et langues'), tone: topicTone('accessibilite'), icon: Accessibility,
      items: [
        { id: 'display', q: t('help:faq.a11y.display.q', 'Comment agrandir le texte ou changer les couleurs ?'), a: t('help:faq.a11y.display.a', 'Le bouton « Accessibilité » en haut de page règle la taille du texte (de 80 % à 150 %), le contraste, l’espacement des lignes et un mode de lecture facile. Un autre bouton passe en mode sombre ou clair. Les réglages restent sur votre appareil.'), links: ['/accessibilite'] },
        { id: 'falc', q: t('help:faq.a11y.falc.q', 'Existe-t-il une version facile à lire ?'), a: t('help:faq.a11y.falc.a', 'Oui, pour certaines pages : activez la version « Facile à lire » (FALC). Un texte simplifié encore provisoire est signalé comme tel.') },
        { id: 'listen', q: t('help:faq.a11y.listen.q', 'Le site peut-il lire la page à voix haute ?'), a: t('help:faq.a11y.listen.a', 'Oui : « Écouter la page » utilise la synthèse vocale de votre appareil. Vous pouvez lire la page, une section ou un texte sélectionné, et régler la vitesse.') },
        { id: 'languages', q: t('help:faq.a11y.languages.q', 'Dans quelles langues le site est-il disponible ?'), a: t('help:faq.a11y.languages.a', 'Français, anglais, turc, arabe (lu de droite à gauche), allemand et ukrainien. L’interface est traduite ; une fiche est traduite automatiquement quand la traduction a passé les contrôles, sinon elle reste en français. Le texte français et la source officielle font foi.') },
        { id: 'hide', q: t('help:faq.a11y.hide.q', 'Comment cacher l’écran rapidement ?'), a: t('help:faq.a11y.hide.a', 'Utilisez le bouton « Masquer l’écran » ou appuyez trois fois sur Échap : un écran sombre couvre la page. Cliquez pour la retrouver. Attention : cela n’efface pas l’historique de votre navigateur.') },
      ],
    },
    {
      id: 'boussole', title: t('help:faq.compass.title', 'Boussole sociale'), tone: contentTone('assistant'), icon: Compass,
      items: [
        { id: 'what', q: t('help:faq.compass.what.q', 'Qu’est-ce que la Boussole sociale ?'), a: t('help:faq.compass.what.a', 'Un assistant automatique qui répond à vos questions en s’appuyant uniquement sur des sources officielles vérifiées : sans source vérifiée, il ne répond pas. Il répond en français. Il peut se tromper : vérifiez toujours sur la fiche officielle.') },
        { id: 'decide', q: t('help:faq.compass.decide.q', 'La Boussole décide-t-elle à la place de l’organisme ?'), a: t('help:faq.compass.decide.a', 'Non. Ses réponses ne sont pas une décision : seul l’organisme concerné décide.') },
        { id: 'commune', q: t('help:faq.compass.commune.q', 'Pourquoi la Boussole demande-t-elle ma commune ?'), a: t('help:faq.compass.commune.a', 'Les aides et les lieux dépendent souvent du territoire. Quand votre question en a besoin, la Boussole vous demande votre commune : écrivez son nom (par exemple « Strasbourg ») ou une phrase comme « J’habite à Schiltigheim ». Avec un code postal, elle vous propose de choisir la commune.') },
        { id: 'missing', q: t('help:faq.compass.missing.q', 'Je ne vois pas la Boussole : pourquoi ?'), a: t('help:faq.compass.missing.a', 'Pendant la bêta publique, l’assistant ouvre progressivement : s’il n’est pas affiché, il n’est pas encore ouvert. Les fiches, la recherche et « Trouver par besoin » restent disponibles.'), links: ['/besoins'] },
      ],
    },
    {
      id: 'urgence', title: t('help:faq.urgent.title', 'Urgence'), tone: topicTone('urgence'), icon: PhoneCall,
      items: [
        { id: 'numbers', emergency: true, q: t('help:faq.urgent.numbers.q', 'Qui appeler en cas d’urgence ?'), a: t('help:faq.urgent.numbers.a', 'En cas de danger, appelez le 112 ou le numéro adapté ci-dessous. Ces numéros sont aussi en bas de chaque page.') },
        { id: 'service', q: t('help:faq.urgent.service.q', 'AccesDirectAide est-il un service d’urgence ?'), a: t('help:faq.urgent.service.a', 'Non. Le site ne suit pas les demandes en temps réel. Pour une urgence, appelez directement le bon numéro. D’autres numéros utiles sont sur la page « Trouver par besoin ».'), links: ['/besoins'] },
      ],
    },
    {
      id: 'pro', title: t('help:faq.pro.title', 'Professionnels'), tone: TONES.emerald, icon: Building2,
      items: [
        { id: 'join', q: t('help:faq.pro.join.q', 'Je représente une structure : comment rejoindre ADA Pro ?'), a: t('help:faq.pro.join.a', 'Une structure demande son inscription avec son nom, son numéro SIRET et une adresse e-mail professionnelle. L’équipe d’AccesDirectAide vérifie la structure sur une source officielle avant d’ouvrir son espace. Quand l’inscription libre n’est pas ouverte, les structures partenaires sont créées par l’équipe et leurs membres reçoivent une invitation nominative.'), links: ['/pro/register'] },
        { id: 'record', q: t('help:faq.pro.record.q', 'La fiche de notre structure contient une erreur.'), a: t('help:faq.pro.record.a', 'Signalez-la depuis la fiche, en indiquant la source officielle qui donne la bonne information. La fiche est corrigée après vérification sur cette source.') },
      ],
    },
    {
      id: 'beta', title: t('help:faq.beta.title', 'Bêta publique'), tone: TONES.amber, icon: Clock,
      items: [
        { id: 'what', q: t('help:faq.beta.what.q', 'Que veut dire « bêta publique » ?'), a: t('help:faq.beta.what.a', 'Le site est ouvert au public et certaines fonctions ouvrent progressivement. Les aides, les démarches et les lieux vérifiés se consultent dès maintenant ; les fonctions personnelles (compte, rendez-vous, messages, documents) ouvrent quand les garanties de protection des données sont en place.') },
        { id: 'closed', q: t('help:faq.beta.closed.q', 'Une page affiche « Cette fonction n’est pas encore ouverte ».'), a: t('help:faq.beta.closed.a', 'Elle fait partie des fonctions qui ouvriront plus tard. Rien ne vous est demandé sur cette page. Vous pouvez continuer à consulter les aides, les démarches et les structures.') },
      ],
    },
    {
      id: 'contact', title: t('help:faq.contact.title', 'Signaler une erreur, nous contacter'), tone: TONES.rose, icon: Flag,
      items: [
        { id: 'report', q: t('help:faq.contact.report.q', 'Comment signaler une erreur sur une fiche ?'), a: t('help:faq.contact.report.a', 'Utilisez le bouton de signalement en bas de la fiche (pendant la bêta, il ouvre un e-mail). Dites ce qui est faux et, si possible, donnez la source officielle correcte.') },
        { id: 'write', q: t('help:faq.contact.write.q', 'Comment vous contacter ?'), a: t('help:faq.contact.write.a', 'Par la page Contact quand le formulaire est ouvert. Pendant la bêta publique, écrivez à l’adresse indiquée dans les mentions légales. N’envoyez pas d’informations personnelles sensibles.'), links: ['/contact', '/mentions-legales'] },
        { id: 'case', q: t('help:faq.contact.case.q', 'Pouvez-vous vous occuper de mon dossier ?'), a: t('help:faq.contact.case.a', 'AccesDirectAide informe et oriente, mais ne décide pas de votre dossier. Pour être accompagné dans une démarche, adressez-vous à un lieu d’accueil (CCAS, France Services, association) : l’annuaire vous aide à le trouver.'), links: ['/structures'] },
      ],
    },
  ];
}
