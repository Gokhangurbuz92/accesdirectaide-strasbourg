import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import BetaProcessingNotice from '@/components/beta/BetaProcessingNotice';
import { Lock, EyeOff, UserCheck, ShieldAlert, Database, HelpCircle, Bot, BarChart3 } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_DOCS_VERSION, LEGAL_DOCS_LABEL, LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
import ClearDeviceAnswers from '@/components/privacy/ClearDeviceAnswers';
import { frontendEnv } from "@/config/env";

// Draft text aligned on STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/02_POLITIQUE_CONFIDENTIALITE.md and FAITS_TECHNIQUES.md
// (status: LEGAL_DOCS_VERSION.status). Only describe what the code really does; "[À COMPLÉTER : …]" placeholders are intentional.

/** @param {{ icon: import('react').ElementType, children: import('react').ReactNode }} props */
const SectionTitle = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
    <div className="p-2 bg-blue-50 rounded-lg">
      <Icon className="w-5 h-5 text-blue-600" />
    </div>
    <h2 className="text-xl font-bold text-slate-900">{children}</h2>
  </div>
);

/** @param {{ title: import('react').ReactNode, children: import('react').ReactNode }} props */
const Item = ({ title, children }) => (
  <div>
    <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-blue-500"></span>{title}
    </h3>
    <p className="text-sm">{children}</p>
  </div>
);

const RETENTION_APPLIED = [
  ['Journal d\'audit (sécurité, contient l\'adresse IP)', '365 jours'],
  ['Journal des actions des professionnels', '365 jours'],
  ['Preuves de consentement', '1 095 jours (3 ans)'],
  ['Conversations avec l\'assistant', '90 jours'],
  ['Mesures de qualité de l\'IA', '90 jours'],
  ['Historique des versions d\'enregistrements', '90 jours'],
  ['Journal des mises à jour', '90 jours'],
  ['Copie partagée du questionnaire', 'à l\'expiration du lien (7 jours) ou au plus 90 jours, sauf conservation légale en cas de litige'],
  ['Jetons de connexion et consentements', 'à leur expiration'],
  ['Invitations, jetons d\'agenda', '30 jours après expiration'],
  ['Rendez-vous', 'anonymisés après 730 jours (2 ans)'],
];

export default function Confidentialite() {
  const contact = LEGAL_PLACEHOLDERS.dataProtectionContact;
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title="Politique de confidentialité"
        description="Quelles données nous traitons, pourquoi, combien de temps, et vos droits."
        path="/politique-confidentialite"
      />

      {/* Hero Section */}
      <PageHeader width="reading" title={<>Politique de confidentialité</>} description={<>Quelles données nous traitons, pourquoi, combien de temps, et vos droits.</>} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <BetaProcessingNotice />

        {/* En bref */}
        <Card className="border-indigo-200 bg-indigo-50/50 shadow-sm overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-indigo-100 text-indigo-700 rounded-full mt-1">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-indigo-900 mb-2">En bref</h2>
                <ul className="list-disc pl-5 space-y-1 text-indigo-900/90 leading-relaxed text-sm">
                  <li>Nous traitons seulement les données nécessaires au service. Nous ne les vendons pas et ne faisons pas de publicité.</li>
                  <li>Vous pouvez lire les fiches sans compte.</li>
                  <li>Vous choisissez avec quelle structure vous partagez votre dossier, et vous pouvez arrêter le partage quand vous voulez.</li>
                  <li>Les échanges avec le site sont chiffrés pendant le transport (HTTPS). Vos messages, notes et documents, les réponses de vos dossiers partagés et le nom et les notes d&apos;un rendez-vous sont en plus chiffrés à l&apos;enregistrement. Ce n&apos;est pas un chiffrement de bout en bout : nos serveurs détiennent les clés. Votre adresse e-mail et le numéro de téléphone d&apos;un rendez-vous ne sont pas chiffrés à l&apos;enregistrement : ils servent à vous reconnaître et à vous joindre. Les administrateurs n&apos;ont pas accès au contenu des dossiers ; un accès d&apos;urgence est limité, enregistré et revu par un autre administrateur.</li>
                  <li>L&apos;assistant est un programme informatique (IA), pas une personne. Il ne décide pas de vos droits.</li>
                  <li>Vous pouvez télécharger vos données, demander à les corriger ou à les effacer, et vous plaindre à la CNIL.</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Détails */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6 md:p-8 space-y-8">

            <section className="space-y-4">
              <SectionTitle icon={UserCheck}>Qui est responsable de vos données ?</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p><strong>Responsable de traitement :</strong> <em>{LEGAL_PLACEHOLDERS.publisherIdentity}</em></p>
                <p><strong>Contact protection des données :</strong> <em>{contact}</em></p>
                <p>Nous n&apos;avons pas désigné de délégué à la protection des données à ce jour.</p>
                <p>Les structures (CCAS, associations, professionnels) qui utilisent AccesDirectAide sont responsables de ce qu&apos;elles font des informations que vous leur partagez et de leurs notes de suivi.</p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={Database}>Données traitées et pourquoi</SectionTitle>
              <div className="space-y-5 text-slate-700 leading-relaxed px-2">
                <Item title="1. Lire le site sans compte">
                  Vous pouvez lire les fiches sans compte. {frontendEnv.flags.publicBeta ? <>Pendant la bêta publique, nous ne mesurons pas l&apos;audience et n&apos;enregistrons pas les erreurs chez un prestataire ; l&apos;hébergeur garde ses journaux techniques (dont l&apos;adresse IP) un jour, et la limitation de débit garde un compteur par adresse IP pendant quelques minutes.</> : !frontendEnv.flags.audienceMeasurement ? <>Nous ne mesurons pas l&apos;audience ; nous enregistrons les erreurs techniques.</> : <>Nous mesurons l&apos;audience pour notre seul usage (pages vues, actions principales) et enregistrons les erreurs techniques.</>} Les journaux de sécurité contiennent l&apos;adresse IP ; ils sont gardés 365 jours.
                </Item>
                <Item title="2. Le questionnaire">
                  Vos réponses sont envoyées à notre serveur pour le calcul, sans y être conservées. Votre appareil les garde 24 heures, puis les efface à votre visite suivante ; sur un appareil partagé, effacez-les tout de suite. Si vous partagez votre dossier avec une structure, une copie chiffrée de vos réponses est conservée pour ce partage.
                  <ClearDeviceAnswers />
                </Item>
                <Item title="3. Votre compte">
                  Les contenus sensibles (messages, notes, documents, réponses partagées) sont chiffrés à l&apos;enregistrement (pas de chiffrement de bout en bout). Votre compte est conservé tant que vous l&apos;utilisez. La suppression automatique des comptes inactifs n&apos;est pas encore en place.
                </Item>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={Bot}>L&apos;assistant d&apos;information (IA)</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p>L&apos;assistant est un programme informatique (intelligence artificielle), pas une personne. Il fonctionne sur nos serveurs : vos questions ne sont envoyées à aucun fournisseur d&apos;IA extérieur. Il répond seulement à partir de fiches vérifiées, cite ses sources et s&apos;abstient s&apos;il ne trouve pas de réponse fiable. Il ne décide pas de vos droits.</p>
                <p>Les conversations et les mesures de qualité sont gardées <strong>90 jours</strong>.</p>
                <p><strong>Ne lui transmettez jamais votre numéro de sécurité sociale, ni de données de santé ou bancaires.</strong></p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={BarChart3}>Mesure d&apos;audience et erreurs techniques</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p><strong>Vercel Web Analytics et Vercel Speed Insights</strong> (Vercel Inc., société américaine) : pages vues, actions principales et vitesse d&apos;affichage, pour notre seul compte. Nous n&apos;envoyons pas le texte de vos recherches. Base : intérêt légitime ; vous pouvez vous y opposer en nous écrivant.{!frontendEnv.flags.audienceMeasurement && <> <strong>Cette mesure n&apos;est pas activée</strong> : aucune donnée n&apos;est envoyée à Vercel Web Analytics ni à Speed Insights.</>}</p>
                <p><strong>Sentry</strong> (société américaine) : quand une erreur se produit, nous envoyons sa description après avoir retiré votre e-mail, votre adresse IP, les paramètres de l&apos;adresse de la page, les cookies et les en-têtes de connexion. Les traces de performance concernent 10 % des visites. <strong>L&apos;enregistrement des sessions (Session Replay) est désactivé par défaut.</strong></p>
                {frontendEnv.flags.publicBeta ? (
                  <p data-testid="beta-processors">Pendant la bêta publique, la mesure d&apos;audience et Sentry ne sont <strong>pas activés</strong>. Les seuls prestataires sont : Vercel Inc. (hébergement : fonctions exécutées à Francfort, pages publiques distribuées par son réseau mondial), qui adhère au Data Privacy Framework UE–États-Unis et prévoit des clauses contractuelles types ; Neon, LLC (groupe Databricks, base de données hébergée à Francfort), couvert par le Data Privacy Framework ; Upstash, Inc. (limitation de débit, données à Francfort), sous son accord de traitement des données — ses garanties de transfert restent à confirmer. Un accès depuis les États-Unis ne peut pas être exclu.</p>
                ) : (
                  <p>Un accès depuis les États-Unis ne peut pas être exclu. <em>[À COMPLÉTER : garanties de transfert (Data Privacy Framework ou clauses contractuelles types) vérifiées pour chaque prestataire]</em></p>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={UserCheck}>Vos droits</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p className="text-sm">
                  Pour toute question sur vos données, écrivez à : <em>{contact}</em>. Nous n&apos;avons pas désigné de délégué à la protection des données (DPO) à ce jour.
                </p>
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <div className="bg-slate-50 p-3 rounded border border-slate-100">
                    <strong className="text-slate-900 block mb-1">Droit d&apos;accès et portabilité</strong>
                    <span className="text-sm">Exportez vos données en un clic depuis les paramètres de votre compte. Pour les notes tenues par une structure : demande revue par deux personnes, extrait communiqué, informations sur d&apos;autres personnes masquées.</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded border border-slate-100">
                    <strong className="text-slate-900 block mb-1">Droit à l&apos;effacement</strong>
                    <span className="text-sm">Demandez la suppression depuis votre compte. La demande est enregistrée tout de suite, puis exécutée après une vérification humaine. Certaines données peuvent être conservées si la loi l&apos;impose.</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded border border-slate-100 sm:col-span-2">
                    <strong className="text-slate-900 block mb-1">Rectification, opposition, limitation</strong>
                    <span className="text-sm">Pour toute autre demande, écrivez à <em>{contact}</em> ou utilisez notre formulaire. Nous répondons dans un délai d&apos;un mois, prolongeable de deux mois si la demande est complexe (nous vous prévenons alors).</span>
                  </div>
                </div>
                <p className="text-sm">Si vous n&apos;êtes pas satisfait(e) de notre réponse, vous pouvez saisir la CNIL (www.cnil.fr).</p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={HelpCircle}>Cookies et stockage local</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p>
                  Pas de publicité ni de réseaux sociaux. {frontendEnv.flags.publicBeta ? <>Pendant la bêta publique, ni mesure d&apos;audience ni journal d&apos;erreurs chez un prestataire</> : frontendEnv.flags.audienceMeasurement ? <>Nous utilisons une mesure d&apos;audience et un journal d&apos;erreurs</> : <>Pas de mesure d&apos;audience ; un journal d&apos;erreurs technique</>} : détails et choix sur la page{' '}
                  <a href="/cookies" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">Cookies</a>.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={Database}>Durées de conservation</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2 text-sm">
                <p>Ce qui est appliqué automatiquement aujourd&apos;hui (purge hebdomadaire, chaque dimanche à 3 h, heure UTC) :</p>
                <div className="relative overflow-x-auto">
                  <table className="w-full text-sm text-left border border-slate-200 rounded-lg overflow-hidden">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">Données</th>
                        <th className="px-4 py-2 font-semibold text-slate-900 border-b border-slate-200">Durée appliquée</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700 divide-y divide-slate-100">
                      {RETENTION_APPLIED.map(([what, how]) => (
                        <tr key={what}><td className="px-4 py-2">{what}</td><td className="px-4 py-2">{how}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p><strong>Pas encore appliqué automatiquement :</strong> suppression des comptes inactifs ; durée des messages et documents du Coffre (conservés jusqu&apos;à leur suppression ou celle du compte) ; dossiers de suivi des structures ; demandes de contact.</p>
                <p>Pour supprimer votre compte : la demande est enregistrée tout de suite, puis exécutée après une vérification humaine.</p>
                <p>Contact protection des données : <em>{contact}</em>.</p>
              </div>
            </section>

            <section className="space-y-4">
              <SectionTitle icon={EyeOff}>Ce que nous ne faisons pas</SectionTitle>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <ul className="list-none space-y-3 text-sm">
                  <li className="flex gap-2 items-start"><span className="text-red-500 font-bold">✕</span> <span>Vendre vos données ou les utiliser pour de la publicité.</span></li>
                  <li className="flex gap-2 items-start"><span className="text-red-500 font-bold">✕</span> <span>Transmettre vos données à un organisme (France Travail, CAF…) sans votre accord, sauf si la loi nous y oblige — nous vérifions alors chaque demande.</span></li>
                  <li className="flex gap-2 items-start"><span className="text-red-500 font-bold">✕</span> <span>Envoyer vos questions ou vos dossiers à un fournisseur d&apos;IA extérieur.</span></li>
                </ul>

                <p className="text-sm mt-8 text-slate-500 border-t border-slate-100 pt-4" data-legal-version={LEGAL_DOCS_VERSION.version}>
                  {LEGAL_DOCS_LABEL}
                </p>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
