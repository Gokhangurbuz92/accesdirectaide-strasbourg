import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import { Lightbulb, Target, CheckCircle2, History, Globe2, HeartHandshake } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

export default function APropos() {
  const { t } = useT('about');
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title={t('about:apropos.seo_title', 'À Propos & Notre Histoire')}
        description={t('about:apropos.seo_description', "Découvrez l'origine, la mission et les engagements d'Accès Direct Aide pour lutter contre le non-recours aux droits.")}
        path="/a-propos"
      />

      {/* Hero Section */}
      <PageHeader width="reading" title={t('about:apropos.title', 'Notre histoire et notre mission')} description={t('about:apropos.description', "Née face à la complexité administrative, Accès Direct Aide s'engage pour garantir l'accès au bout des doigts, pour tous.")} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Le Constat */}
        <Card className="border-orange-200 bg-orange-50/50 shadow-sm overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-orange-100 text-orange-700 rounded-full mt-1">
                <History className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-orange-900 mb-2">
                  {t('about:apropos.origin.title', "Le Constat Initial (L'Étincelle)")}
                </h2>
                <p className="text-orange-900/80 leading-relaxed">
                  {t('about:apropos.origin.text', "L'idée d'Accès Direct Aide est née d'un constat frappant de notre fondateur, travailleur social dans le Bas-Rhin depuis plusieurs années au sein des chantiers d'insertion et diverses autres associations de réinsertion et d'hébergement. Face à l'inflation des démarches dématérialisées et au jargon institutionnel, il a vu la fracture numérique aggraver la précarité.")}
                  <br /><br />
                  {/* PKG-11 audit pass 2: the former one-in-three figure had no source; the non-take-up of rights is described without an unsourced number */}
                  <Trans i18n={i18n} i18nKey="about:apropos.origin.non_take_up" defaults="<0>Beaucoup de personnes renoncent à des droits</0> simplement parce que l'information n'est pas trouvée ou qu'elle est « trop dure à lire »." components={[<strong key="many" />]} />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Le Projet */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6 md:p-8 space-y-8">

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Target className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">{t('about:apropos.mission.title', 'Notre Mission Civique')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  <Trans i18n={i18n} i18nKey="about:apropos.mission.text" defaults="Rompre &quot;l'effet silo&quot; et utiliser le numérique (données publiques ouvertes de l'État, un modèle d'intelligence artificielle installé sur nos propres machines pour écrire les versions faciles à lire, sans service d'IA extérieur) non pas pour vendre, mais pour <0>traduire l'État aux citoyens et pour accompagner les professionnels de l'Action Sociale de &quot;1er ligne&quot;</0>." components={[<strong key="translate" />]} />
                </p>
                <div className="bg-slate-50 border-s-4 border-blue-500 p-4 mt-4">
                  <blockquote className="italic text-slate-600 font-medium">
                    {t('about:apropos.mission.quote', '« Un droit qui n\'est pas compris est un droit qui n\'est pas utilisé. Traduire l\'administration en français "de tous les jours", c\'est la première étape de l\'égalité. »')}
                  </blockquote>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">{t('about:apropos.pillars.title', 'Nos 4 piliers inébranlables')}</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 px-2">
                <div className="border border-slate-100 rounded-lg p-4 bg-white">
                  <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <span className="text-green-700">1.</span> {t('about:apropos.pillars.free.title', 'Gratuité absolue')}
                  </h3>
                  <p className="text-sm text-slate-600">{t('about:apropos.pillars.free.text', "L'information sociale ne s'achète pas : l'accès est gratuit pour les personnes, sans publicité ni classement payant.")}</p>
                </div>
                <div className="border border-slate-100 rounded-lg p-4 bg-white">
                  <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <span className="text-blue-700">2.</span> {t('about:apropos.pillars.falc.title', 'FALC')}
                  </h3>
                  <p className="text-sm text-slate-600">{t('about:apropos.pillars.falc.text', "Des textes Facile À Lire et à Comprendre : un modèle exécuté par AccesDirectAide les rédige à partir de la source officielle ; ils sont contrôlés automatiquement avant publication et indiqués comme tels (ils n'ont pas été testés avec des lecteurs).")}</p>
                </div>
                <div className="border border-slate-100 rounded-lg p-4 bg-white">
                  <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <span className="text-purple-700">3.</span> {t('about:apropos.pillars.neutral.title', 'Neutralité')}
                  </h3>
                  <p className="text-sm text-slate-600">{t('about:apropos.pillars.neutral.text', 'Aucun parti pris politique, philosophique ou religieux. Juste le droit pour tous.')}</p>
                </div>
                <div className="border border-slate-100 rounded-lg p-4 bg-white">
                  <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <span className="text-red-700">4.</span> {t('about:apropos.pillars.security.title', 'Sécurité by Design')}
                  </h3>
                  <p className="text-sm text-slate-600">{t('about:apropos.pillars.security.text', "Messages, notes et documents chiffrés à l'enregistrement ; chaque accès à un dossier est journalisé et soumis à l'accord de la personne.")}</p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Globe2 className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">{t('about:apropos.deployment.title', 'Le Déploiement : Vision Locale et Nationale')}</h2>
              </div>
              <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                <p>
                  {t('about:apropos.deployment.text', 'Un socle national permet de présenter les aides communes à toute la France (France Travail, CAF, Assurance retraite). Cependant, la vraie force de la solidarité se vit au maillage local.')}
                </p>
                <div className="relative border-s border-slate-200 ms-3 ps-6 mt-6 space-y-8">
                  <div className="relative">
                    <div className="absolute -start-[31px] bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ring-4 ring-white">1</div>
                    <h4 className="font-bold text-slate-900">{t('about:apropos.deployment.pilot.title', 'Phase pilote (Strasbourg)')}</h4>
                    <p className="text-sm text-slate-600 mt-1">{t('about:apropos.deployment.pilot.text', "Lancement à Strasbourg et dans l'Eurométropole (Bas-Rhin) pour éprouver la précision des données associatives locales pour une utilité immédiate pour les travailleurs sociaux alsaciens.")}</p>
                  </div>
                  <div className="relative">
                    <div className="absolute -start-[31px] bg-slate-200 text-slate-600 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ring-4 ring-white">2</div>
                    <h4 className="font-bold text-slate-900">{t('about:apropos.deployment.region.title', 'Étape Grand-Est')}</h4>
                    <p className="text-sm text-slate-600 mt-1">{t('about:apropos.deployment.region.text', "Projet : étendre le service à la région Grand-Est. Aucun partenariat n'est conclu à ce jour.")}</p>
                  </div>
                  <div className="relative">
                    <div className="absolute -start-[31px] bg-slate-200 text-slate-600 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ring-4 ring-white">3</div>
                    <h4 className="font-bold text-slate-900">{t('about:apropos.deployment.national.title', 'France Entière')}</h4>
                    <p className="text-sm text-slate-600 mt-1">{t('about:apropos.deployment.national.text', "Objectif long terme : une cartographie sociale exhaustive et ouverte sur tout l'hexagone.")}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* CTA */}
            <div className="mt-8 pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50 p-6 rounded-xl">
              <div>
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <HeartHandshake className="w-5 h-5 text-blue-600" />
                  {t('about:apropos.cta.title', 'Vous êtes un acteur du social ?')}
                </h3>
                <p className="text-sm text-slate-600 mt-1">{t('about:apropos.cta.text', 'Rencontrons-nous pour construire la suite, ou référencez directement votre structure.')}</p>
              </div>
              <Link to="/partenaires" className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition w-full sm:w-auto text-center shrink-0 shadow-sm">
                {t('about:apropos.cta.link', 'Espace Partenaires')}
              </Link>
            </div>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}