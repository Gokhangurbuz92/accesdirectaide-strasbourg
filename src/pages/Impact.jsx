import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import VerifiedCatalogue from '@/components/layout/VerifiedCatalogue';
import i18n, { useT } from '@/i18n';

/**
 * PKG-11 / P25: only measured figures. R26: what is measured today is what is published — the live counts of verified records, read from the public
 * lists themselves. Usage figures (visits, people helped, appointments) are not measured during the public beta, and the page says so instead of
 * showing empty counters (it used to call a figures endpoint the beta refuses).
 */
export default function Impact() {
    const { t } = useT('about');
    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <SEO
                title={t('about:impact.seo_title', 'Notre impact')}
                description={t('about:impact.seo_description', 'Ce qu’AccesDirectAide publie aujourd’hui, ce qui est mesuré et ce qui ne l’est pas encore.')}
                path="/impact"
            />
            <PageHeader title={t('about:impact.title', 'Notre impact')} description={t('about:impact.description', 'Nous ne publions que des chiffres mesurés. Voici ce qui l’est aujourd’hui, et ce qui ne l’est pas encore.')} />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
                <VerifiedCatalogue heading={t('about:impact.published_today', 'Publié aujourd’hui (chiffres en direct)')} />

                <section aria-labelledby="impact-not-measured" className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="impact-no-figures">
                        <h2 id="impact-not-measured" className="text-lg font-semibold text-slate-900">{t('about:impact.not_measured.title', 'Ce que nous ne mesurons pas encore')}</h2>
                        <p className="mt-2 text-slate-700">
                            {t('about:impact.not_measured.text', 'Pendant la bêta publique, nous ne mesurons pas l’audience et aucun compte n’est ouvert : nous ne connaissons ni le nombre de visites, ni le nombre de personnes aidées. Ces chiffres seront publiés lorsqu’ils seront mesurés, avec leur méthode.')}
                        </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-900">{t('about:impact.how.title', 'Comment ces chiffres sont obtenus')}</h2>
                        <p className="mt-2 text-slate-700">
                            {t('about:impact.how.text', 'Ils comptent les fiches visibles sur le site : chaque aide, démarche ou lieu d’accueil n’est publié qu’après une vérification automatique et datée sur sa source officielle (Service-Public, répertoire FINESS, Annuaire de l’administration…).')}
                        </p>
                        <Link to="/sourcesmethode" className="mt-3 inline-block font-semibold text-blue-700 hover:underline">{t('about:impact.how.link', 'Notre méthode de vérification')}</Link>
                    </div>
                </section>

                <section aria-labelledby="impact-goals" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                    <h2 id="impact-goals" className="text-lg font-semibold text-slate-900">{t('about:impact.goals.title', 'Ce que nous voulons améliorer')}</h2>
                    <ol className="mt-4 grid gap-4 md:grid-cols-3">
                        <li className="rounded-xl bg-slate-50 p-4"><p className="font-semibold text-slate-900">{t('about:impact.goals.local.title', 'Plus de lieux et de dispositifs locaux')}</p><p className="mt-1 text-sm text-slate-600">{t('about:impact.goals.local.text', 'Vérifier davantage de structures et les programmes de Strasbourg et de l’Eurométropole.')}</p></li>
                        <li className="rounded-xl bg-slate-50 p-4"><p className="font-semibold text-slate-900">{t('about:impact.goals.readers.title', 'Des textes relus par des lecteurs')}</p><p className="mt-1 text-sm text-slate-600">{t('about:impact.goals.readers.text', 'Faire relire les versions simplifiées par des personnes concernées.')}</p></li>
                        <li className="rounded-xl bg-slate-50 p-4"><p className="font-semibold text-slate-900">{t('about:impact.goals.usefulness.title', 'Mesurer l’utilité réelle')}</p><p className="mt-1 text-sm text-slate-600">{t('about:impact.goals.usefulness.text', 'Définir avec des partenaires une mesure respectueuse de la vie privée.')}</p></li>
                    </ol>
                    <p className="mt-6 text-slate-700">
                        <Trans i18n={i18n} i18nKey="about:impact.partners" defaults="Vous êtes une structure d’aide ou un financeur ? <0>Découvrez l’espace partenaires</0>."
                            components={[<Link key="partners" to="/partenaires" className="font-semibold text-blue-700 hover:underline" />]} />
                    </p>
                </section>
            </div>
        </div>
    );
}
