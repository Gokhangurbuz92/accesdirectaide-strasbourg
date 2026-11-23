/**
 * G14 (owner decisions 23/11/2026) — the public moderation charter (/charte-de-moderation) of the content people publish (X02 testimonials, X01 community
 * stories) and of the notices (DSA art. 14, 16, 17, 20, 23). Always public (not a beta-restricted path): the citizen terms § 7 bis, the privacy notice § 13
 * and every statement of reasons (api/_services/moderation-dsa.js TERMS_CLAUSE → #contenus-refuses) point to it. French is the legal reference (namespace
 * « legal », keys « charter.* »; master CONTROL/master/completion/G14_LEGAL_V12_V13_FR.md). The figures are the code's: one named moderator (the operator),
 * safety notices within 24 hours, other notices within 7 days, appeal six months (APPEAL_MONTHS), sole-moderator review after 24 hours
 * (SOLE_REVIEW_DELAY_MS), warning then 1 to 180 days within 12 months (SUSPENSION_MIN_DAYS / MAX_DAYS, WARNING_WINDOW_DAYS), unread text withdrawn after
 * 60 days (TESTIMONIAL_PENDING_DAYS / STORY_PENDING_DAYS). No certified out-of-court body (art. 21) is offered.
 */
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import LegalTranslationNotice from '@/components/legal/LegalTranslationNotice';
import { Card, CardContent } from '@/components/ui/card';
import { useT } from '@/i18n';

export const CHARTER_VERSION = '2026-11-23';

/** the sections, in order; the ids are the anchors the statements of reasons cite (#contenus-refuses) @param {(k: string, fr: string) => string} t */
const sections = (t) => [
  { id: 'moderateur', title: t('legal:charter.who.title', '1. Qui modère'), paras: [
    t('legal:charter.who.p1', "La modération est assurée par une seule personne : l'exploitant d'AccesDirectAide, personne physique, qui est aussi le responsable du traitement. Il utilise un compte d'administration à son nom, protégé par une double authentification."),
  ] },
  { id: 'principes', title: t('legal:charter.principles.title', '2. Principes'), items: [
    t('legal:charter.principles.i1', "Une personne décide, jamais un automate : aucune décision de modération n'est automatisée."),
    t('legal:charter.principles.i2', "Rien n'est publié sans relecture."),
    t('legal:charter.principles.i3', "Le modérateur ne réécrit jamais un texte : il le publie, le refuse ou le retire."),
    t('legal:charter.principles.i4', "Dans l'outil de modération, le modérateur ne voit ni le compte ni l'adresse électronique de l'auteur, ni qui a signalé un contenu."),
    t('legal:charter.principles.i5', 'Un signalement ne retire rien à lui seul.'),
    t('legal:charter.principles.i6', 'Les décisions sont prises avec diligence, de manière objective et non arbitraire, avec la même règle pour tous.'),
  ] },
  { id: 'contenus-refuses', title: t('legal:charter.refused.title', '3. Contenus refusés'), paras: [
    t('legal:charter.refused.p1', "Sont refusés ou retirés : une information sur la santé ou un handicap ; des coordonnées ou des détails qui permettent de reconnaître une personne ; des propos injurieux, menaçants ou discriminatoires ; de la publicité ; une information trompeuse ou une promesse de droit ; un texte hors sujet ; et tout contenu illicite."),
    t('legal:charter.refused.p2', "En cas de doute sur la santé ou la reconnaissance d'une autre personne, le texte est refusé et son auteur peut le réécrire."),
  ] },
  { id: 'signaler', title: t('legal:charter.notice.title', '4. Signaler un contenu'), paras: [
    t('legal:charter.notice.p1', "Toute personne peut signaler un contenu qu'elle estime illicite ou contraire à cette charte : avec un compte, depuis la page du contenu ; sans compte, depuis la page « Signaler un contenu » (pourquoi le contenu pose problème, son adresse exacte, votre nom et votre adresse électronique — facultatifs pour un contenu qui met en danger un enfant —, et une déclaration de bonne foi) ; ou en écrivant au point de contact indiqué dans les mentions légales."),
    t('legal:charter.notice.p2', "Les signalements urgents (menace pour la vie ou la sécurité d'une personne, enfant en danger) sont traités en premier."),
  ] },
  { id: 'delais', title: t('legal:charter.delays.title', '5. Délais'), items: [
    t('legal:charter.delays.i1', "Signalement urgent (menace pour la vie ou la sécurité d'une personne, enfant en danger) : traité dans les 24 heures, avec une mesure conservatoire possible."),
    t('legal:charter.delays.i2', 'Autres signalements : décision dans les 7 jours.'),
    t('legal:charter.delays.i3', "Accusé de réception : envoyé dès la réception d'un signalement fait avec une adresse électronique ; sous 2 jours ouvrés pour un signalement reçu par e-mail."),
    t('legal:charter.delays.i4', "Relecture d'un texte en attente : 5 jours ouvrés ; un texte qui n'a pas été relu dans les 60 jours est retiré automatiquement."),
    t('legal:charter.delays.i5', 'Réponse à une contestation : 15 jours ouvrés.'),
  ] },
  { id: 'motifs', title: t('legal:charter.reasons.title', '6. Exposé des motifs'), paras: [
    t('legal:charter.reasons.p1', "Toute restriction (texte refusé ou retiré, participation suspendue) est accompagnée d'un exposé des motifs : la mesure, sa portée et sa durée ; les faits et ce qui a conduit à la décision (relecture, signalement ou initiative du modérateur) ; la règle de cette charte appliquée ; pour un contenu jugé illicite, le texte de loi en cause ; l'absence de moyen automatisé ; les recours. Il est envoyé par e-mail et reste dans l'espace de la personne (« Décisions de modération »). La personne qui a signalé le contenu reçoit aussi la décision."),
  ] },
  { id: 'contestation', title: t('legal:charter.appeal.title', '7. Contestation'), paras: [
    t('legal:charter.appeal.p1', "L'auteur du contenu et la personne qui l'a signalé peuvent contester une décision, gratuitement, pendant six mois : avec un compte, depuis leur espace ; sans compte, avec la référence et le code de l'accusé de réception."),
    t('legal:charter.appeal.p2', "La modération étant assurée par une seule personne, c'est elle qui réexamine la décision, au plus tôt 24 heures après la contestation, et la réponse le dit. La réponse est motivée : la décision est maintenue, annulée ou modifiée."),
  ] },
  { id: 'recours-externes', title: t('legal:charter.outside.title', '8. Recours en dehors du service'), paras: [
    t('legal:charter.outside.p1', "Aucun organe certifié de règlement extrajudiciaire des litiges (article 21 du règlement (UE) 2022/2065 sur les services numériques) n'est proposé. Vous pouvez toujours saisir le juge compétent."),
  ] },
  { id: 'abus', title: t('legal:charter.misuse.title', '9. Abus répétés'), paras: [
    t('legal:charter.misuse.p1', "Une personne qui publie à plusieurs reprises des contenus manifestement illicites, ou qui envoie à plusieurs reprises des signalements ou contestations manifestement infondés, reçoit d'abord un avertissement ; si cela se reproduit dans les 12 mois, la publication, ou le traitement de ses signalements, peut être suspendu pour une durée de 1 à 180 jours, fixée au cas par cas (nombre, proportion, gravité, intention). La personne en reçoit les motifs et peut contester."),
  ] },
  { id: 'securite', title: t('legal:charter.safety.title', '10. Danger pour une personne et âge'), paras: [
    t('legal:charter.safety.p1', "Si un contenu laisse penser qu'une infraction menaçant la vie ou la sécurité d'une personne a été commise ou risque de l'être, l'exploitant en informe les autorités. En cas de danger immédiat, appelez le 112 (ou le 15, le 17) : AccesDirectAide n'est pas un service d'urgence."),
    t('legal:charter.safety.p2', "Ces fonctions sont réservées aux personnes qui déclarent avoir 18 ans ou plus. Un contenu qui laisse penser que son auteur est mineur est retiré à titre conservatoire ; si un enfant est en danger, appelez le 119."),
  ] },
  { id: 'transparence', title: t('legal:charter.transparency.title', '11. Bilan annuel'), paras: [
    t('legal:charter.transparency.p1', "Un bilan annuel en nombres est publié : décisions par type et par origine, signalements et leurs suites, contestations et leurs issues, avertissements et suspensions, délai médian de traitement. Il ne contient ni nom ni pseudonyme."),
  ] },
];

export default function CharteModeration() {
  const { t } = useT('legal');
  const intro = t('legal:charter.intro', "Cette charte s'applique aux contenus que les personnes publient sur AccesDirectAide (témoignages, histoires de la communauté) et aux signalements. Elle complète les conditions d'utilisation des particuliers (section 7 bis) et la notice de confidentialité (section 13).");
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO title={t('legal:charter.title', 'Charte de modération')} description={intro} path="/charte-de-moderation" />
      <PageHeader width="reading" title={t('legal:charter.title', 'Charte de modération')} description={intro} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <LegalTranslationNotice />
        <Card className="border-slate-200 shadow-md">
          <CardContent className="p-6 md:p-10 space-y-10">
            {sections(t).map((s) => (
              <section key={s.id} id={s.id} className="space-y-3 scroll-mt-24" aria-labelledby={`${s.id}-h`} data-testid={`charter-${s.id}`}>
                <h2 id={`${s.id}-h`} className="text-xl md:text-2xl font-bold text-slate-900 border-b border-slate-100 pb-3">{s.title}</h2>
                {s.items && (
                  <ul className="list-disc ps-5 space-y-2 text-slate-700 leading-relaxed">
                    {s.items.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                )}
                {(s.paras || []).map((x) => <p key={x} className="text-slate-700 leading-relaxed">{x}</p>)}
              </section>
            ))}
            <p className="text-sm text-slate-500 border-t border-slate-100 pt-4" lang="fr" dir="ltr" data-charter-version={CHARTER_VERSION}>
              {t('legal:charter.version', 'Version du {{date}}', { date: '23/11/2026' })}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
