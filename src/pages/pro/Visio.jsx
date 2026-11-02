import { useOutletContext, Link } from 'react-router-dom';
import { Video, ArrowLeft } from 'lucide-react';
import SEO from '@/components/SEO';
import i18n, { useT } from '@/i18n';
import { Trans } from 'react-i18next';

/**
 * ProVisio — what video consultation really is today (launch-readiness item 66). It used to say « Bientôt disponible / en cours de développement »:
 * the room actually opens from each VIDEO appointment, and only once a video provider has been chosen and approved (contract, EU hosting, data
 * protection, security — an owner decision, docs/pkg3-video-activation.md). Until then no video room exists; nothing here pretends otherwise.
 */
export default function ProVisio() {
    useOutletContext(); // Keep ProLayout context active
    const { t } = useT('pro');

    return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <SEO title={t('pro:visio.seo_title', 'Visioconférence')} description={t('pro:visio.seo_description', 'Comment se déroulent les rendez-vous en visio.')} path="/pro/visio" noindex={true} />
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8" data-testid="pro-visio-status">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Video className="w-8 h-8 text-slate-700" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-4 text-center">{t('pro:visio.title', 'Visioconférence')}</h1>
                <ul className="list-disc space-y-2 pl-5 text-slate-700">
                    <li><Trans i18n={i18n} i18nKey="pro:visio.opens_from" defaults="La visio s’ouvre depuis un <0>rendez-vous prévu en visio</0>, sur la page de ce rendez-vous." components={[<strong key="0" />]} /></li>
                    <li><Trans i18n={i18n} i18nKey="pro:visio.not_enabled" defaults="Elle n’est <0>pas activée</0> tant que le fournisseur de visio n’est pas choisi et validé (contrat, hébergement en Europe, protection des données, sécurité)." components={[<strong key="0" />]} /></li>
                    <li>{t('pro:visio.meanwhile', 'D’ici là, proposez un rendez-vous sur place ou par téléphone.')}</li>
                </ul>
                <Link to="/pro/dashboard" className="mt-6 inline-flex items-center gap-2 text-blue-700 hover:text-blue-900 font-medium">
                    <ArrowLeft className="w-4 h-4" />
                    {t('pro:visio.back', 'Retour au tableau de bord')}
                </Link>
            </div>
        </div>
    );
}
