import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import { ShieldCheck, ExternalLink } from 'lucide-react';
import { useT } from '@/i18n';

// R35: the page was French-only (owner decision update §7: the six-language interface); the names of the official sites stay as they are written
export default function Sources() {
    const { t } = useT('about');
    const officialSources = [
        { name: "Service-Public.fr", url: "https://www.service-public.fr" },
        { name: "CAF.fr", url: "https://www.caf.fr" },
        { name: t('about:sourcespage.ameli', 'Ameli.fr (Assurance Maladie)'), url: "https://www.ameli.fr" },
        { name: "France Travail", url: "https://www.francetravail.fr" },
        { name: t('about:sourcespage.annuaire', "Annuaire de l'administration (adresses et horaires des services publics)"), url: "https://lannuaire.service-public.gouv.fr" },
        { name: t('about:sourcespage.entreprises', 'Annuaire des entreprises (associations et organismes)'), url: "https://annuaire-entreprises.data.gouv.fr" },
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            <SEO
                title={t('about:sourcespage.seo_title', 'Nos sources')}
                description={t('about:sourcespage.seo_description', 'Liste des sources officielles que nous utilisons.')}
                path="/sources"
            />

            <PageHeader width="reading" title={t('about:sourcespage.title', 'Nos sources')} description={t('about:sourcespage.description', 'Les sites officiels d’où viennent les informations publiées sur AccesDirectAide.')} />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100 mb-8">
                <div className="flex items-center gap-4 mb-6">
                    <ShieldCheck className="w-12 h-12 text-green-600" aria-hidden="true" />
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{t('about:sourcespage.principle.title', 'Principe de fiabilité')}</h2>
                        <p className="text-gray-600">{t('about:sourcespage.principle.text', "Nous utilisons uniquement des informations qui viennent de l'État ou d'organismes reconnus.")}</p>
                    </div>
                </div>

                <h3 className="font-bold text-lg mb-4">{t('about:sourcespage.used', 'Ce que nous utilisons :')}</h3>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    {officialSources.map((s, i) => (
                        <li key={i} className="flex items-center gap-2 bg-gray-50 p-3 rounded border">
                            <ExternalLink className="w-4 h-4 text-gray-400" aria-hidden="true" />
                            <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-blue-700 hover:underline">
                                {s.name}
                            </a>
                        </li>
                    ))}
                </ul>

                <h3 className="font-bold text-lg mb-4 text-red-700">{t('about:sourcespage.refused', "Ce que nous REFUSONS d'utiliser :")}</h3>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                    <li>{t('about:sourcespage.refused.forums', 'Les forums de discussion (avis personnels).')}</li>
                    <li>{t('about:sourcespage.refused.social', 'Les réseaux sociaux (sauf comptes certifiés officiels).')}</li>
                    <li>{t('about:sourcespage.refused.blogs', 'Les blogs sans auteur expert identifié.')}</li>
                    <li>{t('about:sourcespage.refused.rumours', 'Les rumeurs ou les « on-dit ».')}</li>
                </ul>
            </div>

            <div className="bg-blue-50 p-6 rounded-lg border-l-4 border-blue-600 text-sm">
                <strong>{t('about:sourcespage.important', 'Important :')}</strong>{' '}
                {t('about:sourcespage.notice', "Nous ne sommes pas l'administration. Nous travaillons dur pour ne pas faire d'erreur, mais vérifiez toujours auprès de l'organisme officiel pour votre dossier personnel. Chaque fiche vérifiée indique sa source officielle (« Consulter la source ») et la date de sa dernière vérification.")}
            </div>
            </div>
        </div>
    );
}
