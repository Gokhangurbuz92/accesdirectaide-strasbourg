
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import i18n, { useT } from '@/i18n';

export default function Mission() {
    const { t } = useT('about');
    return (
        <div className="min-h-screen bg-slate-50">
            <SEO
                title={t('about:mission.seo_title', 'Notre Mission')}
                description={t('about:mission.seo_description', "Pourquoi ce site existe : simplifier l'accès aux droits pour tous.")}
                path="/notre-mission"
            />

            <PageHeader width="reading" title={t('about:mission.title', 'Notre mission')} description={t('about:mission.description', 'Pourquoi ce site existe : aider chacun à trouver ses droits et les bonnes personnes.')} />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            <div className="prose prose-lg max-w-none text-gray-700 bg-white p-8 rounded-lg shadow-sm border border-gray-100">
                <p className="text-xl font-medium text-gray-900 mb-6">
                    <Trans i18n={i18n} i18nKey="about:mission.intro" defaults="Ce site est fait pour <0>aider tout le monde</0> à trouver les bonnes aides et les bonnes personnes." components={[<strong key="all" />]} />
                </p>

                <h2 className="text-2xl font-bold text-gray-800 mt-8 mb-4">{t('about:mission.why.title', 'Pourquoi ce site existe ?')}</h2>
                <ul className="list-disc ps-6 space-y-2">
                    <li>{t('about:mission.why.papers', 'Parce que les papiers administratifs sont compliqués.')}</li>
                    <li>{t('about:mission.why.who', "Parce qu'on ne sait pas toujours qui aller voir.")}</li>
                    <li>{t('about:mission.why.everyone', "Parce que tout le monde a le droit d'être aidé.")}</li>
                </ul>

                <h2 className="text-2xl font-bold text-gray-800 mt-8 mb-4">{t('about:mission.for_whom.title', 'Pour qui ?')}</h2>
                <p>
                    <Trans i18n={i18n} i18nKey="about:mission.for_whom.you" defaults="<0>Pour vous :</0> Si vous cherchez une aide, un formulaire, ou un conseil." components={[<strong key="you" />]} /><br />
                    <Trans i18n={i18n} i18nKey="about:mission.for_whom.pros" defaults="<0>Pour les pros :</0> les travailleurs sociaux peuvent s’en servir pour orienter les personnes qu’ils accompagnent." components={[<strong key="pros" />]} />
                </p>

                <h2 className="text-2xl font-bold text-gray-800 mt-8 mb-4">{t('about:mission.not.title', 'Ce que le site ne fait pas')}</h2>
                <p>
                    {t('about:mission.not.text', "Nous donnons de l'information fiable. Mais nous ne remplaçons pas la CAF, la Sécu, ou France Travail. Nous vous aidons à les contacter.")}
                </p>

                <div className="bg-blue-50 p-6 rounded-lg mt-8 border-s-4 border-blue-600">
                    {/* R29: only commitments that are true today — no usage claim, no FALC claim before reader testing (Q02) */}
                    <h2 className="text-xl font-bold text-blue-900 mb-4">{t('about:mission.commitments.title', 'Nos engagements')}</h2>
                    <ol className="list-decimal ps-6 space-y-3 font-medium">
                        <li>{t('about:mission.commitments.free', 'Une information gratuite, sans compte.')}</li>
                        <li>{t('about:mission.commitments.simple', 'Des phrases simples. Les versions « faciles à lire » sont en préparation : elles n’ont pas encore été relues par des lecteurs.')}</li>
                        <li>{t('about:mission.commitments.no_ads', 'Pas de publicité, pas de vente de données, pas de mesure d’audience.')}</li>
                        <li>{t('about:mission.commitments.verified', 'Chaque fiche est vérifiée sur sa source officielle avant d’être publiée, et datée.')}</li>
                        <li>{t('about:mission.commitments.decides', 'Seul l’organisme concerné décide de vos droits : nous vous aidons à le trouver.')}</li>
                    </ol>
                </div>
            </div>

            <nav aria-labelledby="mission-next" className="mt-8" data-testid="mission-next-steps">
                <h2 id="mission-next" className="text-lg font-semibold text-slate-900">{t('about:mission.start.title', 'Commencer')}</h2>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {[['/aides', t('about:mission.start.aides', 'Trouver une aide')], ['/demarches', t('about:mission.start.demarches', 'Faire une démarche pas à pas')], ['/structures', t('about:mission.start.structures', 'Trouver un lieu d’accueil près de chez vous')], ['/sourcesmethode', t('about:mission.start.method', 'Comment nous vérifions les fiches')]].map(([to, label]) => (
                        <li key={to}><Link to={to} className="block rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-blue-700 shadow-sm hover:border-blue-300 hover:underline">{label}</Link></li>
                    ))}
                </ul>
            </nav>
            </div>
        </div>
    );
}
