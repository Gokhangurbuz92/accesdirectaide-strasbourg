// @ts-nocheck
import { useEffect } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router-dom';
import {
    Rocket, Building2, ListChecks, Clock3, Globe, CalendarDays, CalendarOff, MessageCircle, Users, ShieldCheck, Shield, BarChart3, Map as MapIcon,
    Settings, Lock, CircleHelp, TriangleAlert, BookOpen, ArrowRight, LogIn, UserPlus,
} from 'lucide-react';
import SEO from '@/components/SEO';
import ContactLink from '@/components/ContactLink';
import { useT } from '@/i18n';
import { sectionTone } from '@/design/categoryTone';
import { ToneBar, ToneChip, ToneIcon } from '@/components/ui/Tone';
import { PAGE } from '@/design/layout';
import { MAX_NEEDS } from '@/lib/socialNeeds';
import { isBetaRestrictedPath } from '@/lib/publicBeta';
import { cn } from '@/lib/utils';

/**
 * Guide ADA Pro (24/11/2026) — how the professional space works, screen by screen, in the words and labels of the real screens.
 *   - /pro/guide (inside ProLayout, ProGuard): each step links to its screen;
 *   - /pro/guide-public (no account, outside ProLayout): the same guide for a structure that has not registered yet; the steps that need an open space
 *     are marked « après activation » and carry no link (the screens would send to the sign-in).
 * Every statement mirrors a screen or a server rule (sources in the comments); the modules the public beta keeps closed are said « pas encore ouvert » with
 * the reason the console itself gives (src/components/pro/NotYetOpen.jsx) — never as usable. No delay is promised for the verification: the app gives none.
 */
export const GUIDE_PATH = '/pro/guide';
export const GUIDE_PUBLIC_PATH = '/pro/guide-public';

/** @param {(k: string, d?: any, o?: any) => string} t */
function screenNames(t) {
    return {
        register: t('proguide:screen.register', 'Demande d’ouverture'),
        login: t('proguide:screen.login', 'Connexion'),
        mfa: t('pro:breadcrumb.mfa_settings', 'Double authentification'),
        dashboard: t('pro:layout.tableau_bord', 'Tableau de bord'),
        structure: t('pro:layout.structure', 'Ma structure'),
        team: t('pro:layout.mon_equipe', 'Mon équipe'),
        services: t('pro:layout.services_rdv', 'Services RDV'),
        hours: t('pro:layout.disponibilites', 'Disponibilités'),
        absences: t('pro:layout.absences', 'Absences'),
        agenda: t('pro:layout.agenda_rdv', 'Agenda RDV'),
        newRdv: t('pro:layout.nouveau_rdv', 'Nouveau RDV'),
        messages: t('pro:layout.messages', 'Messages'),
        impact: t('pro:layout.impact', 'Impact'),
        audit: t('pro:layout.journal_audit', 'Journal d\'audit'),
        regional: t('pro:layout.observatoire_territorial', 'Observatoire territorial'),
        settings: t('pro:layout.parametres', 'Paramètres'),
    };
}

/**
 * The sections of the guide. `who`: 'all' | 'admin' | 'planning' | 'visitor'; `account`: the step needs an open space (marked « après activation » on the
 * public page); `to`: the screen it happens on (a link in the console only).
 * @param {(k: string, d?: any, o?: any) => string} t
 */
function buildSections(t) {
    const s = screenNames(t);
    return [
        {
            id: 'demarrer', tone: 'dashboard', icon: Rocket,
            title: t('proguide:start.title', 'Démarrer : inscription, vérification, activation'),
            intro: t('proguide:start.intro', 'Un espace ADA Pro s’ouvre seulement après une vérification de la structure par l’équipe d’AccesDirectAide sur une source officielle.'),
            steps: [
                { who: 'visitor', to: '/pro/register', screen: s.register,
                    title: t('proguide:start.s1.title', 'Demander l’ouverture de l’espace'),
                    body: t('proguide:start.s1.body', 'Indiquez le nom de la structure, son numéro SIRET (14 chiffres), votre e-mail professionnel et un mot de passe, puis acceptez les conditions d’utilisation. Si la page indique que l’inscription n’est pas ouverte, les structures partenaires sont créées par l’équipe d’AccesDirectAide et leurs membres reçoivent une invitation nominative.') },
                { who: 'visitor',
                    title: t('proguide:start.s2.title', 'Attendre la vérification'),
                    body: t('proguide:start.s2.body', 'L’équipe d’AccesDirectAide vérifie la structure sur une source officielle. D’ici là, votre espace n’est pas ouvert : la connexion répond que votre demande a bien été reçue. L’application n’annonce pas de délai ; vous recevez un e-mail dès que la vérification est faite.') },
                { who: 'all', account: true, to: '/pro/mfa-settings', screen: s.mfa,
                    title: t('proguide:start.s3.title', 'Activer la double authentification'),
                    body: t('proguide:start.s3.body', 'L’e-mail d’ouverture contient un lien pour activer la double authentification. Ouvrez-le en étant connecté·e, ajoutez le secret dans une application d’authentification (Google Authenticator, Authy ou FreeOTP), puis saisissez le code à 6 chiffres. Le mot de passe seul ne suffit pas : là où elle est obligatoire, un compte sans double authentification ne peut ouvrir que cette page.') },
                { who: 'all', account: true, to: '/pro/login', screen: s.login,
                    title: t('proguide:start.s4.title', 'Se connecter chaque jour'),
                    body: t('proguide:start.s4.body', 'Saisissez votre identifiant professionnel et votre mot de passe, puis le code affiché par votre application. Si votre adresse est rattachée à plusieurs organisations, la page vous demande de choisir celle à ouvrir.') },
                { who: 'all', account: true,
                    title: t('proguide:start.s5.title', 'Rejoindre une structure sur invitation'),
                    body: t('proguide:start.s5.body', 'Un administrateur de la structure vous invite depuis « Mon équipe ». Le lien reçu par e-mail ouvre la page « Rejoindre l’équipe » : vous créez votre mot de passe et acceptez les conditions d’utilisation.') },
            ],
        },
        {
            id: 'structure', tone: 'structure', icon: Building2,
            title: t('proguide:structure.title', 'Configurer la fiche de la structure'),
            intro: t('proguide:structure.intro', 'La fiche publique est celle vérifiée par ADA. Une fiche pas encore vérifiée n’apparaît pas dans l’annuaire public.'),
            steps: [
                { who: 'admin', account: true, to: '/pro/structure', screen: s.structure,
                    title: t('proguide:structure.s1.title', 'Relire la fiche publique'),
                    body: t('proguide:structure.s1.body', '« Ma structure » montre la fiche telle que vérifiée par ADA, avec la date de vérification. Le tableau de bord indique aussi si la fiche est active, suspendue ou en attente d’activation.') },
                { who: 'admin', account: true, to: '/pro/structure', screen: s.structure,
                    title: t('proguide:structure.s2.title', 'Proposer une modification'),
                    body: t('proguide:structure.s2.body', 'Choisissez l’information à modifier, saisissez la nouvelle valeur et envoyez la proposition. Rien n’est publié directement : l’équipe ADA vérifie chaque proposition avant publication. Tant qu’elle est en attente, vous pouvez la retirer.') },
                { who: 'admin', account: true, to: '/pro/structure', screen: s.structure,
                    title: t('proguide:structure.s3.title', 'Exporter les données ou fermer l’espace'),
                    body: t('proguide:structure.s3.body', 'Le bas de la page permet d’exporter les données de la structure et de demander la fermeture de l’espace. La fermeture est examinée par l’équipe ADA ; exportez d’abord les données dont vous avez besoin.') },
            ],
        },
        {
            id: 'services', tone: 'services', icon: ListChecks,
            title: t('proguide:services.title', 'Créer les services et choisir les besoins'),
            intro: t('proguide:services.intro', 'Un service est un motif de rendez-vous : un nom, une durée et les modalités proposées. Seuls les administrateurs créent ou modifient les services ; les autres membres les consultent.'),
            steps: [
                { who: 'admin', account: true, to: '/pro/rdv/services', screen: s.services,
                    title: t('proguide:services.s1.title', 'Créer un service'),
                    body: t('proguide:services.s1.body', 'Dans « Services RDV », choisissez « Nouveau service » : nom, durée en minutes, temps de battement avant et après, « Service actif », et au moins une modalité (en présentiel ou à distance en visio).') },
                { who: 'admin', account: true, to: '/pro/rdv/services', screen: s.services,
                    title: t('proguide:services.s2.title', 'Choisir les besoins auxquels il répond'),
                    body: t('proguide:services.s2.body', 'Choisissez jusqu’à {{max}} besoins dans la liste commune d’AccesDirectAide (20 domaines, 86 sous-domaines). Ils décrivent votre service, jamais la personne. Sans besoin choisi, le lieu n’apparaît pas quand une personne cherche où prendre rendez-vous pour un besoin.', { max: MAX_NEEDS }) },
                { who: 'admin', account: true, to: '/pro/rdv/services', screen: s.services,
                    title: t('proguide:services.s3.title', 'Proposer la visio'),
                    body: t('proguide:services.s3.body', 'La visio n’est proposée aux personnes que si la structure l’accepte (mode de réservation « Visio » ou « Présentiel + visio ») et si le service vidéo est activé. La salle s’ouvre depuis la page de chaque rendez-vous en visio.') },
            ],
        },
        {
            id: 'disponibilites', tone: 'disponibilites', icon: Clock3,
            title: t('proguide:hours.title', 'Définir les disponibilités'),
            intro: t('proguide:hours.intro', 'Les disponibilités sont les horaires d’ouverture de la structure : les créneaux proposés en découlent.'),
            steps: [
                { who: 'planning', account: true, to: '/pro/rdv/disponibilites', screen: s.hours,
                    title: t('proguide:hours.s1.title', 'Ajouter des plages horaires'),
                    body: t('proguide:hours.s1.body', 'Pour chaque jour, ajoutez une ou plusieurs plages (HH:MM-HH:MM) ou laissez le jour fermé, puis enregistrez. Pour les autres membres, la page est en lecture seule.') },
                { who: 'admin', account: true, to: '/pro/team', screen: s.team,
                    title: t('proguide:hours.s2.title', 'Confier le planning à un membre'),
                    body: t('proguide:hours.s2.body', 'Dans « Mon équipe », l’option « Gère le planning » permet à un professionnel de modifier les horaires et les absences de l’équipe.') },
            ],
        },
        {
            id: 'publication', tone: 'rdv', icon: Globe,
            title: t('proguide:publish.title', 'Publier la prise de rendez-vous en ligne'),
            intro: t('proguide:publish.intro', 'La publication rend votre page de prise de rendez-vous visible aux personnes. Seuls les administrateurs peuvent publier ou dépublier.'),
            steps: [
                { who: 'admin', account: true, to: '/pro/rdv/services', screen: s.services,
                    title: t('proguide:publish.s1.title', 'Préparer avant de publier'),
                    body: t('proguide:publish.s1.body', 'Créez au moins un service actif et définissez les disponibilités : sans eux, aucun créneau ne peut être proposé. Le serveur vérifie seulement que les rendez-vous sont installés ; si ce n’est pas le cas, la case de publication est bloquée et l’écran l’explique.') },
                { who: 'admin', account: true, to: '/pro/rdv/services', screen: s.services,
                    title: t('proguide:publish.s2.title', 'Choisir les règles de confirmation'),
                    body: t('proguide:publish.s2.body', 'Confirmation directe (le créneau est confirmé dès la demande) ou validation par la structure (la demande attend votre accord), pour toute la structure ou par service. Vous pouvez aussi permettre de choisir un professionnel ; un membre sans double authentification ne peut pas recevoir de rendez-vous en ligne, et un membre sans nom public n’est jamais affiché.') },
                { who: 'admin', account: true, to: '/pro/rdv/services', screen: s.services,
                    title: t('proguide:publish.s3.title', 'Publier'),
                    body: t('proguide:publish.s3.body', 'Cochez « Publier la prise de RDV en ligne », choisissez le mode de réservation (présentiel, visio ou les deux), ajoutez si besoin un e-mail et un téléphone de contact, puis « Enregistrer les paramètres ». L’adresse de la page publique s’affiche ensuite. Publication et retrait sont inscrits au journal d’audit.') },
                { who: 'admin', account: true, to: '/pro/rdv/services', screen: s.services,
                    title: t('proguide:publish.s4.title', 'Vous avez déjà votre propre outil de rendez-vous'),
                    body: t('proguide:publish.s4.body', 'Indiquez l’adresse https de votre page de rendez-vous (votre site ou une plateforme publique comme RDV Solidarités). Après vérification par AccesDirectAide, votre fiche affiche un lien « Rendez-vous sur leur site ».') },
            ],
        },
        {
            id: 'agenda', tone: 'agenda', icon: CalendarDays,
            title: t('proguide:agenda.title', 'Au quotidien : agenda et prise de rendez-vous'),
            intro: t('proguide:agenda.intro', 'Tous les membres actifs utilisent l’agenda et créent des rendez-vous pour les personnes reçues.'),
            steps: [
                { who: 'all', account: true, to: '/pro/rdv/agenda', screen: s.agenda,
                    title: t('proguide:agenda.s1.title', 'Suivre l’agenda'),
                    body: t('proguide:agenda.s1.body', 'Filtrez par service, statut et période. Une demande en attente se traite par « Accepter la demande » ou « Refuser la demande » ; après le rendez-vous, marquez la personne présente ou absente. Une annulation prévient la personne. L’agenda s’exporte au format .ics.') },
                { who: 'all', account: true, to: '/pro/rdv/new', screen: s.newRdv,
                    title: t('proguide:agenda.s2.title', 'Créer un rendez-vous pour une personne'),
                    body: t('proguide:agenda.s2.body', 'Choisissez le service et une période, chargez les créneaux, sélectionnez-en un, puis indiquez le nom de la personne (téléphone facultatif). Cochez la case qui confirme son accord pour ce rendez-vous et pour l’enregistrement de ses coordonnées, puis « Confirmer le rendez-vous ».') },
                { who: 'all', account: true, to: '/pro/rdv/agenda', screen: s.agenda,
                    title: t('proguide:agenda.s3.title', 'Ouvrir un rendez-vous'),
                    body: t('proguide:agenda.s3.body', 'La page d’un rendez-vous montre ses détails, les déplacements éventuels et, si la personne a un compte, les messages liés. Pour un rendez-vous en visio, la salle s’ouvre depuis cette page.') },
            ],
        },
        {
            id: 'absences', tone: 'absences', icon: CalendarOff,
            title: t('proguide:absences.title', 'Absences et fermetures'),
            intro: t('proguide:absences.intro', 'L’absence d’un membre ne ferme pas la structure ; une fermeture de toute la structure retire les créneaux proposés au public.'),
            steps: [
                { who: 'all', account: true, to: '/pro/rdv/absences', screen: s.absences,
                    title: t('proguide:absences.s1.title', 'Déclarer votre absence'),
                    body: t('proguide:absences.s1.body', 'Choisissez « Moi-même », une date de début et de fin, et une raison si vous le souhaitez. La raison n’est montrée qu’à vous et aux responsables du planning.') },
                { who: 'planning', account: true, to: '/pro/rdv/absences', screen: s.absences,
                    title: t('proguide:absences.s2.title', 'Fermer toute la structure'),
                    body: t('proguide:absences.s2.body', 'Choisissez « Toute la structure » : plus aucun créneau en ligne sur la période. Seuls l’administrateur ou un membre qui gère le planning peuvent fermer la structure ou modifier l’absence d’un collègue.') },
            ],
        },
        {
            id: 'messages', tone: 'messages', icon: MessageCircle,
            title: t('proguide:messages.title', 'Messagerie sécurisée'),
            intro: t('proguide:messages.intro', 'Les messages sont chiffrés à l’enregistrement sur nos serveurs et chaque accès est journalisé. Ce n’est pas un chiffrement de bout en bout : nos serveurs détiennent les clés.'),
            steps: [
                { who: 'all', account: true, to: '/pro/messages', screen: s.messages,
                    title: t('proguide:messages.s1.title', 'Répondre aux personnes'),
                    body: t('proguide:messages.s1.body', 'Les conversations apparaissent quand une personne vous contacte via la prise de rendez-vous. Le menu peut indiquer le nombre de conversations non lues. Une personne sans compte ne peut pas recevoir de message.') },
                { who: 'all', account: true, to: '/pro/messages', screen: s.messages,
                    title: t('proguide:messages.s2.title', 'Écrire seulement l’utile'),
                    body: t('proguide:messages.s2.body', 'Pas d’information de santé ni de diagnostic : cette messagerie n’est pas un dossier de suivi. Les pièces jointes ne sont pas encore ouvertes, car un fichier peut contenir des informations de santé qui demandent un hébergement certifié.') },
            ],
        },
        {
            id: 'equipe', tone: 'equipe', icon: Users,
            title: t('proguide:team.title', 'Équipe et rôles'),
            intro: t('proguide:team.intro', 'Deux rôles : Administrateur de la structure (fiche, équipe, services, publication, impact, journal d’audit) et Professionnel (agenda, rendez-vous, messages, ses propres absences ; services et disponibilités en lecture).'),
            steps: [
                { who: 'admin', account: true, to: '/pro/team', screen: s.team,
                    title: t('proguide:team.s1.title', 'Inviter un collaborateur'),
                    body: t('proguide:team.s1.body', 'Saisissez son e-mail et son rôle, puis « Inviter ». Les invitations en attente peuvent être relancées ou annulées. Si l’e-mail n’a pas pu partir, l’écran le dit : relancez plus tard.') },
                { who: 'admin', account: true, to: '/pro/team', screen: s.team,
                    title: t('proguide:team.s2.title', 'Donner un nom public'),
                    body: t('proguide:team.s2.body', 'Le nom public permet aux personnes de choisir un professionnel quand la structure l’autorise ; l’adresse e-mail n’est jamais montrée. Chacun peut aussi le régler dans « Paramètres ».') },
                { who: 'admin', account: true, to: '/pro/team', screen: s.team,
                    title: t('proguide:team.s3.title', 'Retirer un collègue'),
                    body: t('proguide:team.s3.body', 'Choisissez « Désactiver », puis indiquez à qui vont ses dossiers ouverts (un successeur ou la file de l’équipe) et confirmez. Le compte peut être réactivé plus tard.') },
                { who: 'admin', account: true, to: '/pro/team', screen: s.team,
                    title: t('proguide:team.s4.title', 'Appareil perdu'),
                    body: t('proguide:team.s4.body', 'Vérifiez d’abord l’identité de la personne par un moyen sûr, puis « Appareil perdu » : son authentificateur cesse de fonctionner, ses sessions prennent fin et une nouvelle invitation, valable 72 heures, lui est envoyée.') },
            ],
        },
        {
            id: 'protection', tone: 'privacy', icon: ShieldCheck,
            title: t('proguide:privacy.title', 'Protéger les données des personnes'),
            intro: t('proguide:privacy.intro', 'Les règles ci-dessous reprennent les consignes affichées par l’application.'),
            steps: [
                { who: 'all', account: true,
                    title: t('proguide:privacy.s1.title', 'Pas de données de santé dans les champs libres'),
                    body: t('proguide:privacy.s1.body', 'La messagerie interdit les informations de santé et les diagnostics. Par prudence, appliquez la même règle aux notes d’un rendez-vous et aux raisons d’absence : n’écrivez que ce qui est utile au rendez-vous.') },
                { who: 'all', account: true, to: '/pro/rdv/new', screen: s.newRdv,
                    title: t('proguide:privacy.s2.title', 'Recueillir l’accord de la personne'),
                    body: t('proguide:privacy.s2.body', 'Un rendez-vous créé par l’équipe demande de confirmer l’accord de la personne. Pour un service dont la nature peut révéler une information de santé ou un handicap, son accord explicite est demandé ; certains services sensibles ne sont pas ouverts à la prise de rendez-vous sur la plateforme.') },
                { who: 'all', account: true, to: '/pro/parametres', screen: s.settings,
                    title: t('proguide:privacy.s3.title', 'Sécuriser votre compte'),
                    body: t('proguide:privacy.s3.body', 'Gardez la double authentification active et déconnectez-vous sur un poste partagé. Les e-mails de notification ne contiennent ni nom ni contenu de dossier ; tout reste visible dans l’application.') },
            ],
        },
        {
            id: 'audit', tone: 'audit', icon: Shield,
            title: t('proguide:audit.title', 'Journal d’audit'),
            intro: t('proguide:audit.intro', 'Le journal trace les actions et les accès de la structure (connexions, invitations, dossiers consultés, publication…). Il est réservé aux administrateurs.'),
            steps: [
                { who: 'admin', account: true, to: '/pro/audit', screen: s.audit,
                    title: t('proguide:audit.s1.title', 'Lire et exporter le journal'),
                    body: t('proguide:audit.s1.body', 'Filtrez par action, parcourez les pages et exportez au format CSV. L’adresse IP n’apparaît que sous une forme abrégée et transformée. Si le chargement échoue, l’écran précise que ce n’est pas un journal vide.') },
            ],
        },
        {
            id: 'impact', tone: 'impact', icon: BarChart3,
            title: t('proguide:impact.title', 'Lire l’impact de la structure'),
            intro: t('proguide:impact.intro', 'Des indicateurs mesurés, sans estimation, réservés aux administrateurs.'),
            steps: [
                { who: 'admin', account: true, to: '/pro/reports', screen: s.impact,
                    title: t('proguide:impact.s1.title', 'Choisir la période'),
                    body: t('proguide:impact.s1.body', 'Mois, trimestre ou année : rendez-vous honorés, conversations, absences constatées, équipe active, répartition par service et par statut. Les petits effectifs sont masqués. Un rappel SMS « accepté par l’opérateur » ne veut pas dire reçu. Une fonction non ouverte est indiquée « non mesuré ».') },
            ],
        },
        {
            id: 'observatoire', tone: 'observatoire', icon: MapIcon,
            title: t('proguide:regional.title', 'Lire l’observatoire territorial'),
            intro: t('proguide:regional.intro', 'Des agrégats des structures vérifiées, sans aucun accès aux dossiers nominatifs. Il est réservé aux structures actives vérifiées par ADA.'),
            steps: [
                { who: 'all', account: true, to: '/pro/regional', screen: s.regional,
                    title: t('proguide:regional.s1.title', 'Comprendre les chiffres'),
                    body: t('proguide:regional.s1.body', 'Une commune n’est affichée qu’à partir de 3 structures et les valeurs inférieures à 5 sont masquées. Le dernier trimestre n’est publié qu’une fois figé.') },
            ],
        },
        {
            id: 'parametres', tone: 'parametres', icon: Settings,
            title: t('proguide:settings.title', 'Paramètres'),
            intro: t('proguide:settings.intro', 'Notifications, nom public, mot de passe et double authentification.'),
            steps: [
                { who: 'all', account: true, to: '/pro/parametres', screen: s.settings,
                    title: t('proguide:settings.s1.title', 'Régler vos notifications'),
                    body: t('proguide:settings.s1.body', 'Toutes les notifications restent visibles dans l’application ; vous choisissez celles qui vous sont aussi envoyées par e-mail.') },
                { who: 'all', account: true, to: '/pro/parametres', screen: s.settings,
                    title: t('proguide:settings.s2.title', 'Changer de mot de passe'),
                    body: t('proguide:settings.s2.body', 'Le changement se fait par un lien envoyé à votre adresse e-mail (« Recevoir le lien »). Aucune intégration avec un outil extérieur n’est disponible pour le moment.') },
            ],
        },
    ];
}

/** @param {(k: string, d?: any, o?: any) => string} t */
function buildFaq(t) {
    return [
        [t('proguide:faq.q1', 'Combien de temps prend la vérification de la structure ?'), t('proguide:faq.a1', 'L’application n’annonce pas de délai. La vérification est faite par l’équipe d’AccesDirectAide sur une source officielle ; vous recevez un e-mail dès qu’elle est terminée.')],
        [t('proguide:faq.q2', 'La connexion répond que ma demande a bien été reçue. Pourquoi ?'), t('proguide:faq.a2', 'Votre structure n’est pas encore vérifiée : l’espace ne s’ouvre qu’après la vérification. Attendez l’e-mail d’ouverture.')],
        [t('proguide:faq.q3', 'Que voient les personnes ?'), t('proguide:faq.a3', 'La fiche publique vérifiée par ADA et, si vous l’avez publiée, la page de prise de rendez-vous avec vos services et les créneaux disponibles. Un professionnel n’est affiché que par son nom public, si la structure permet de le choisir ; son adresse e-mail n’est jamais montrée.')],
        [t('proguide:faq.q4', 'Faut-il un compte pour prendre rendez-vous ?'), t('proguide:faq.a4', 'Oui. Les personnes doivent avoir un compte particulier pour demander un rendez-vous ; la prise de rendez-vous sans compte n’existe plus.')],
        [t('proguide:faq.q5', 'Comment dépublier la prise de rendez-vous ?'), t('proguide:faq.a5', 'Dans « Services RDV », décochez « Publier la prise de RDV en ligne » puis « Enregistrer les paramètres ». Le retrait est inscrit au journal d’audit. Pour une fermeture temporaire, vous pouvez aussi fermer toute la structure dans « Absences ».')],
        [t('proguide:faq.q6', 'Comment retirer un collègue qui quitte la structure ?'), t('proguide:faq.a6', 'Un administrateur ouvre « Mon équipe », choisit « Désactiver », indique qui reprend ses dossiers ouverts (un successeur ou la file de l’équipe) et confirme.')],
        [t('proguide:faq.q7', 'J’ai perdu mon téléphone de double authentification.'), t('proguide:faq.a7', 'Demandez à un administrateur de votre structure d’utiliser « Appareil perdu » dans « Mon équipe », après avoir vérifié votre identité. Vous recevez une nouvelle invitation valable 72 heures. Si personne d’autre n’administre la structure, contactez le support d’AccesDirectAide.')],
        [t('proguide:faq.q8', 'Pourquoi ne puis-je pas activer la double authentification seul·e ?'), t('proguide:faq.a8', 'Pour protéger votre compte, elle s’active uniquement avec une invitation envoyée par un administrateur de votre structure. Ouvrez le lien reçu par e-mail en étant connecté·e.')],
        [t('proguide:faq.q9', 'J’ai oublié mon mot de passe.'), t('proguide:faq.a9', 'Sur la page de connexion, choisissez « Oublié ? » : vous recevez un lien de réinitialisation par e-mail.')],
        [t('proguide:faq.q10', 'Pourquoi un membre ne reçoit-il pas de rendez-vous en ligne ?'), t('proguide:faq.a10', 'Un membre dont la double authentification n’est pas activée ne peut pas recevoir de rendez-vous en ligne. Si le choix du professionnel est activé, vérifiez aussi qu’il est coché « Reçoit des rendez-vous » dans les règles de prise de rendez-vous.')],
        [t('proguide:faq.q11', 'Pourquoi mon lieu n’apparaît-il pas pour un besoin ?'), t('proguide:faq.a11', 'Le service doit avoir des besoins choisis, et la structure doit être vérifiée par ADA. Sans besoin choisi, le lieu n’apparaît pas quand on cherche où prendre rendez-vous pour ce besoin.')],
        [t('proguide:faq.q12', 'Un professionnel peut-il modifier les horaires ?'), t('proguide:faq.a12', 'Seulement si un administrateur lui a confié le planning (« Gère le planning »). Sinon, les disponibilités sont en lecture seule ; chacun peut déclarer ses propres absences.')],
        [t('proguide:faq.q13', 'Comment corriger l’adresse ou les horaires de la fiche publique ?'), t('proguide:faq.a13', 'Un administrateur envoie une proposition depuis « Ma structure ». Elle est publiée après vérification par l’équipe ADA.')],
        [t('proguide:faq.q14', 'Les messages sont-ils chiffrés de bout en bout ?'), t('proguide:faq.a14', 'Non. Ils sont chiffrés à l’enregistrement sur nos serveurs, qui détiennent les clés, et chaque accès est journalisé.')],
        [t('proguide:faq.q15', 'Peut-on envoyer une pièce jointe ?'), t('proguide:faq.a15', 'Pas encore : un fichier peut contenir des informations de santé, qui demandent un hébergement certifié. Écrivez votre message sans document.')],
        [t('proguide:faq.q16', 'Pourquoi « Dossiers suivis » ou « Orientations » sont-ils marqués « pas encore ouvert » ?'), t('proguide:faq.a16', 'Ces modules s’ouvriront lorsque leur cadre de protection des données (et un hébergement certifié des données de santé) sera en place. Ce n’est pas une panne.')],
        [t('proguide:faq.q17', 'Qui voit le journal d’audit et l’impact ?'), t('proguide:faq.a17', 'Les administrateurs de la structure seulement. Ces entrées n’apparaissent pas dans le menu d’un professionnel.')],
        [t('proguide:faq.q18', 'Pourquoi certains chiffres sont-ils masqués ?'), t('proguide:faq.a18', 'Pour qu’aucune personne ne puisse être reconnue : l’impact masque les petits effectifs et l’observatoire masque les valeurs inférieures à 5.')],
        [t('proguide:faq.q19', 'Peut-on relier l’agenda à Outlook ?'), t('proguide:faq.a19', 'Le tableau de bord propose « Connecter Outlook » quand ce lien est activé sur ADA ; sinon il affiche « Outlook (pas encore activé) ». L’agenda s’exporte aussi au format .ics.')],
        [t('proguide:faq.q20', 'Comment fermer l’espace de la structure ?'), t('proguide:faq.a20', 'Un administrateur choisit « Demander la fermeture » dans « Ma structure ». L’équipe ADA examine la demande ; exportez d’abord les données dont vous avez besoin.')],
        [t('proguide:faq.q21', 'Ma session s’est terminée sans raison apparente.'), t('proguide:faq.a21', 'Une session prend fin après une déconnexion, un nouveau mot de passe, un changement dans votre équipe ou quand sa durée est écoulée. Reconnectez-vous : la page demandée s’ouvre ensuite.')],
        [t('proguide:faq.q22', 'Comment contacter le support ?'), t('proguide:faq.a22', 'Utilisez le lien « Contacter le support » de la page de connexion, ou le lien ci-dessous.')],
    ];
}

/** the messages the screens really show (their own keys: the same words as on the screen, in every language), with what to do */
/** @param {(k: string, d?: any, o?: any) => string} t */
function buildTrouble(t) {
    return [
        [t('pro:login.registration_pending', 'Votre demande a bien été reçue : votre structure doit d’abord être vérifiée sur une source officielle. Vous recevrez un e-mail dès l’ouverture de votre espace.'), t('proguide:trouble.pending', 'Attendez l’e-mail d’ouverture : la vérification n’est pas encore faite.')],
        [t('pro:login.too_many', 'Trop de tentatives : patientez quelques minutes.'), t('proguide:trouble.too_many', 'Attendez quelques minutes avant de réessayer ; vérifiez l’identifiant et le mot de passe.')],
        [t('pro:login.bad_code', 'Code incorrect ou expiré : saisissez le code affiché maintenant par votre application.'), t('proguide:trouble.bad_code', 'Saisissez le code en cours (il change toutes les 30 secondes) et vérifiez que l’heure de votre téléphone est juste.')],
        [t('pro:login.disabled', 'Ce compte est désactivé : contactez l’administrateur de votre structure.'), t('proguide:trouble.disabled', 'Seul un administrateur de la structure peut réactiver le compte depuis « Mon équipe ».')],
        [t('pro:mfa.error.invitation_invalid', 'Ce lien d’activation n’est pas valable pour votre compte (déjà utilisé, expiré ou destiné à une autre personne). Demandez une nouvelle invitation à un administrateur de votre structure.'), t('proguide:trouble.invitation_invalid', 'Un administrateur peut relancer l’invitation depuis « Mon équipe ».')],
        [t('pro:services.not_installed', 'Publication impossible pour l’instant : les rendez-vous ne sont pas encore installés sur ce serveur.'), t('proguide:trouble.not_installed', 'Ce n’est pas une erreur de votre part : prévenez l’équipe d’ADA.')],
        [t('pro:rdv_new.no_slots', 'Aucun créneau disponible sur cette période.'), t('proguide:trouble.no_slots', 'Élargissez la période, puis vérifiez les disponibilités, les absences et la fermeture éventuelle de la structure.')],
        [t('pro:rdv_new.sensitive_not_open_r46', 'Ce service n’est pas ouvert à la prise de rendez-vous sur la plateforme (service sensible, ou classification pas encore revue par ADA). Notez ce rendez-vous dans votre outil habituel.'), t('proguide:trouble.sensitive', 'Notez ce rendez-vous dans votre outil habituel, comme l’indique l’écran.')],
        [t('pro:availability.too_many', 'Trop de demandes. Patientez un instant puis réessayez.'), t('proguide:trouble.too_many_requests', 'Patientez un instant, puis réessayez une seule fois.')],
        [t('pro:dashboard.queue_inactive', 'La file de travail s’ouvrira quand ADA aura activé votre structure (voir « Ma structure »).'), t('proguide:trouble.queue_inactive', 'Votre structure n’est pas encore activée par ADA : vérifiez son état dans « Ma structure ».')],
        [t('pro:regional.refused', 'L’observatoire est réservé aux structures actives vérifiées par ADA. Il s’ouvrira quand ADA aura activé votre structure.'), t('proguide:trouble.regional', 'L’observatoire s’ouvrira après l’activation de votre structure.')],
        [t('pro:audit_log.load_error', 'Le journal n’a pas pu être chargé. Ce n’est pas un journal vide : réessayez.'), t('proguide:trouble.audit', 'Réessayez ; si le problème continue, contactez le support.')],
    ];
}

/** the modules of the console that the public beta keeps closed (src/lib/proModules.js; the menu lists them under « Pas encore ouvert ») */
/** @param {(k: string, d?: any, o?: any) => string} t */
function buildClosed(t) {
    return [
        t('pro:layout.dossiers_suivis', 'Dossiers suivis'),
        t('pro:layout.selections_orientation', 'Sélections d’orientation'),
        t('pro:layout.orientations', 'Orientations'),
        t('socialref:pro.title', 'Orientations sociales'),
    ];
}

/** @param {{ publicView?: boolean }} props */
export default function ProGuide({ publicView = false }) {
    const { t } = useT(['proguide', 'pro', 'socialref']);
    const ctx = useOutletContext();
    const { hash } = useLocation();
    // a link to a section (« /pro/guide#demarrer » from the dashboard) opens the page at that section
    useEffect(() => {
        if (!hash) return;
        let id = hash.slice(1);
        try { id = decodeURIComponent(id); } catch { /* a malformed address: look the raw text up */ }
        const el = globalThis.document?.getElementById(id);
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView();
    }, [hash]);
    const sections = buildSections(t);
    const faq = buildFaq(t);
    const trouble = buildTrouble(t);
    const closed = buildClosed(t);
    const whoLabel = {
        all: t('proguide:who.all', 'Tous les membres'),
        admin: t('proguide:who.admin', 'Administrateurs'),
        planning: t('proguide:who.planning', 'Administrateurs et membres qui gèrent le planning'),
        visitor: t('proguide:who.visitor', 'Avant l’inscription'),
    };
    const isAdmin = ['STRUCTURE_ADMIN', 'SUPERADMIN'].includes(ctx?.user?.role);
    const toc = [
        ...sections.map((s) => ({ id: s.id, title: s.title, tone: sectionTone(s.tone), icon: s.icon })),
        { id: 'pas-encore-ouvert', title: t('proguide:closed.title', 'Modules pas encore ouverts'), tone: sectionTone('journal'), icon: Lock },
        { id: 'questions', title: t('proguide:faq.title', 'Questions fréquentes'), tone: sectionTone('support'), icon: CircleHelp },
        { id: 'messages-ecran', title: t('proguide:trouble.title', 'Messages affichés et que faire'), tone: sectionTone('notifications'), icon: TriangleAlert },
    ];

    const content = (
        <div className="space-y-10" data-testid="pro-guide">
            <header className="space-y-3">
                <div className="flex items-start gap-3">
                    <ToneIcon tone={sectionTone('support')} icon={BookOpen} size="lg" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-ada-ink">{t('proguide:title', 'Guide ADA Pro')}</h1>
                        <p className="mt-1 text-sm text-ada-ink-2 sm:text-base">{t('proguide:intro', 'Comment fonctionne l’espace professionnel d’AccesDirectAide pour les structures sociales et médico-sociales : de la demande d’ouverture aux rendez-vous du quotidien.')}</p>
                    </div>
                </div>
                {publicView ? (
                    <div className="rounded-xl border border-ada-line bg-ada-sunken p-4 text-sm text-ada-ink-2" data-testid="pro-guide-public-note">
                        <p>{t('proguide:public.note', 'Ce guide se lit sans compte. Les étapes marquées « après activation » se font une fois l’espace de votre structure vérifié et ouvert.')}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {!isBetaRestrictedPath('/pro/register') && <Link to="/pro/register" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-ada-action px-4 py-2 font-semibold text-white hover:bg-ada-action-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600">
                                <UserPlus className="h-4 w-4" aria-hidden="true" />{t('proguide:public.register', 'Demander l’ouverture de l’espace')}
                            </Link>}
                            <Link to="/pro/login" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ada-line bg-ada-surface px-4 py-2 font-semibold text-ada-ink hover:bg-ada-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                                <LogIn className="h-4 w-4" aria-hidden="true" />{t('proguide:public.login', 'Se connecter')}
                            </Link>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-ada-ink-3">{isAdmin
                        ? t('proguide:role_admin', 'Vous êtes administrateur de la structure : toutes les étapes vous concernent.')
                        : t('proguide:role_pro', 'Les étapes marquées « Administrateurs » sont faites par un administrateur de votre structure.')}</p>
                )}
            </header>

            <nav aria-labelledby="pro-guide-toc-title" className="rounded-2xl border border-ada-line bg-ada-surface p-4 shadow-sm sm:p-5" data-testid="pro-guide-toc">
                <h2 id="pro-guide-toc-title" className="text-lg font-bold text-ada-ink">{t('proguide:toc', 'Sommaire')}</h2>
                <ol className="mt-3 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                    {toc.map((e) => (
                        <li key={e.id}>
                            <a href={`#${e.id}`} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium text-ada-ink-2 hover:bg-ada-sunken hover:text-ada-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                                <ToneIcon tone={e.tone} icon={e.icon} size="sm" />
                                <span className="min-w-0">{e.title}</span>
                            </a>
                        </li>
                    ))}
                </ol>
            </nav>

            {sections.map((sec) => {
                const tone = sectionTone(sec.tone);
                return (
                    <section key={sec.id} id={sec.id} aria-labelledby={`${sec.id}-title`} className="scroll-mt-24" data-testid={`pro-guide-section-${sec.id}`}>
                        <div className="flex items-start gap-3">
                            <ToneIcon tone={tone} icon={sec.icon} />
                            <div className="min-w-0">
                                <h2 id={`${sec.id}-title`} className="text-xl font-bold text-ada-ink">{sec.title}</h2>
                                <p className="mt-1 text-sm text-ada-ink-2">{sec.intro}</p>
                            </div>
                        </div>
                        <ol className="mt-4 grid gap-3 md:grid-cols-2">
                            {sec.steps.map((st, i) => (
                                <li key={st.title} className="relative overflow-hidden rounded-xl border border-ada-line bg-ada-surface p-4 ps-5 shadow-sm" data-testid="pro-guide-step">
                                    <ToneBar tone={tone} side="start" />
                                    <h3 className="flex items-start gap-2 text-base font-semibold text-ada-ink">
                                        <span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', tone.active)} aria-hidden="true">{i + 1}</span>
                                        <span className="min-w-0">{st.title}</span>
                                    </h3>
                                    <p className="mt-2 text-sm leading-relaxed text-ada-ink-2">{st.body}</p>
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <ToneChip tone={st.who === 'all' || st.who === 'visitor' ? sectionTone('profil') : tone}>{whoLabel[st.who]}</ToneChip>
                                        {publicView && st.account ? <ToneChip tone={sectionTone('notifications')}><span data-testid="pro-guide-after-activation">{t('proguide:after_activation', 'après activation')}</span></ToneChip> : null}
                                        {st.to && (!publicView || !st.account) ? (
                                            <Link to={st.to} className={cn('ms-auto inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600', tone.text)} data-testid="pro-guide-link">
                                                {t('proguide:open_screen', 'Ouvrir « {{screen}} »', { screen: st.screen })}
                                                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                                            </Link>
                                        ) : st.screen ? <span className="ms-auto text-xs text-ada-ink-3">{t('proguide:screen_label', 'Écran : {{screen}}', { screen: st.screen })}</span> : null}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </section>
                );
            })}

            <section id="pas-encore-ouvert" aria-labelledby="pas-encore-ouvert-title" className="scroll-mt-24" data-testid="pro-guide-closed">
                <div className="flex items-start gap-3">
                    <ToneIcon tone={sectionTone('journal')} icon={Lock} />
                    <div className="min-w-0">
                        <h2 id="pas-encore-ouvert-title" className="text-xl font-bold text-ada-ink">{t('proguide:closed.title', 'Modules pas encore ouverts')}</h2>
                        <p className="mt-1 text-sm text-ada-ink-2">{t('proguide:closed.intro', 'Dans la bêta publique, ces modules ne sont pas utilisables : le menu les range sous « Pas encore ouvert », sans lien. Le guide ne décrit donc pas leur fonctionnement.')}</p>
                    </div>
                </div>
                <ul className="mt-4 flex flex-wrap gap-2">
                    {closed.map((name) => (
                        <li key={name} className="inline-flex items-center gap-2 rounded-lg border border-ada-line bg-ada-surface px-3 py-2 text-sm font-medium text-ada-ink" data-testid="pro-guide-closed-module">
                            <Lock className="h-4 w-4 text-ada-ink-3" aria-hidden="true" />
                            <span>{name}</span>
                            <span className="rounded bg-ada-sunken px-1.5 py-0.5 text-xs font-medium text-ada-ink-2">{t('pro:not_open.badge', 'pas encore ouvert')}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3 rounded-xl border border-ada-line bg-ada-sunken p-4 text-sm text-ada-ink-2">{t('pro:not_open.body', 'Cette partie de l’espace professionnel n’est pas encore ouverte. Elle le sera lorsque son cadre de protection des données (et, si nécessaire, un hébergement certifié des données de santé) sera en place. Ce n’est pas une panne : aucune donnée n’a été lue.')}</p>
            </section>

            <section id="questions" aria-labelledby="questions-title" className="scroll-mt-24" data-testid="pro-guide-faq">
                <div className="flex items-start gap-3">
                    <ToneIcon tone={sectionTone('support')} icon={CircleHelp} />
                    <h2 id="questions-title" className="text-xl font-bold text-ada-ink">{t('proguide:faq.title', 'Questions fréquentes')}</h2>
                </div>
                <ul className="mt-4 space-y-2">
                    {faq.map(([q, a]) => (
                        <li key={q}>
                            <details className="group rounded-xl border border-ada-line bg-ada-surface shadow-sm" data-testid="pro-guide-faq-item">
                                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-ada-ink hover:bg-ada-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                                    <span className="min-w-0">{q}</span>
                                    <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90 rtl:-scale-x-100" aria-hidden="true" />
                                </summary>
                                <p className="px-4 pb-4 text-sm leading-relaxed text-ada-ink-2">{a}</p>
                            </details>
                        </li>
                    ))}
                </ul>
                <p className="mt-4 text-sm text-ada-ink-2">
                    <ContactLink className="font-semibold text-ada-action underline underline-offset-2">{t('pro:login.contacter_support', 'Contacter le support')}</ContactLink>
                </p>
            </section>

            <section id="messages-ecran" aria-labelledby="messages-ecran-title" className="scroll-mt-24" data-testid="pro-guide-trouble">
                <div className="flex items-start gap-3">
                    <ToneIcon tone={sectionTone('notifications')} icon={TriangleAlert} />
                    <div className="min-w-0">
                        <h2 id="messages-ecran-title" className="text-xl font-bold text-ada-ink">{t('proguide:trouble.title', 'Messages affichés et que faire')}</h2>
                        <p className="mt-1 text-sm text-ada-ink-2">{t('proguide:trouble.intro', 'Les messages ci-dessous sont ceux que l’espace professionnel affiche, mot pour mot.')}</p>
                    </div>
                </div>
                <dl className="mt-4 grid gap-3 md:grid-cols-2">
                    {trouble.map(([msg, todo]) => (
                        <div key={msg} className="relative overflow-hidden rounded-xl border border-ada-line bg-ada-surface p-4 ps-5 shadow-sm" data-testid="pro-guide-trouble-item">
                            <ToneBar tone={sectionTone('notifications')} side="start" />
                            <dt className="text-sm font-semibold text-ada-ink">{t('proguide:trouble.quoted', '« {{message}} »', { message: msg })}</dt>
                            <dd className="mt-1 text-sm text-ada-ink-2">{todo}</dd>
                        </div>
                    ))}
                </dl>
            </section>
        </div>
    );

    if (!publicView) return content;

    return (
        <div className="min-h-screen bg-ada-canvas">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:start-4 focus:z-50 focus:rounded focus:bg-ada-surface focus:px-4 focus:py-2 focus:text-ada-ink focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-700">
                {t('pro:layout.aller_contenu_principal', 'Aller au contenu principal')}
            </a>
            <SEO title={`${t('proguide:title', 'Guide ADA Pro')} — ${t('pro:layout.accesdirect_pro', 'AccesDirect Pro')}`} description={t('proguide:intro', 'Comment fonctionne l’espace professionnel d’AccesDirectAide pour les structures sociales et médico-sociales : de la demande d’ouverture aux rendez-vous du quotidien.')} path={GUIDE_PUBLIC_PATH} />
            <header className="border-b border-ada-line bg-ada-surface">
                <div className={cn(PAGE, 'flex min-h-16 flex-wrap items-center justify-between gap-3 py-2')}>
                    <Link to="/" className="rounded font-bold text-lg text-ada-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"><span className="ada-wordmark">{t('pro:layout.accesdirect_pro', 'AccesDirect Pro')}</span></Link>
                    <Link to="/pro/login" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ada-ink hover:bg-ada-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                        <LogIn className="h-4 w-4" aria-hidden="true" />{t('proguide:public.login', 'Se connecter')}
                    </Link>
                </div>
            </header>
            <main id="main-content" tabIndex={-1} className={cn(PAGE, 'py-8 outline-none sm:py-10')}>
                {content}
            </main>
        </div>
    );
}
