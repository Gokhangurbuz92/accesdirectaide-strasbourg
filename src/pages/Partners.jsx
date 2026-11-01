import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import { frontendEnv } from '@/config/env';
import { publicContactEmail, mailtoWithSubject } from '@/lib/contactEmail';
import { Link } from 'react-router-dom';
import { Handshake, MapPin, Users, HeartHandshake, CheckCircle2, ArrowRight } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

export default function Partners() {
    const { t } = useT('about');
    const beta = frontendEnv.flags.publicBeta;
    const email = publicContactEmail();
    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <SEO
                title={t('about:partners.seo_title', 'Partenaires & Collectivités')}
                description={t('about:partners.seo_description', "Espace dédié aux collectivités, associations et acteurs sociaux qui souhaitent rejoindre l'écosystème Accès Direct Aide.")}
                path="/partenaires"
            />

            <PageHeader title={t('about:partners.title', 'Espace partenaires')} description={t('about:partners.description', 'Associations, CCAS, structures solidaires et collectivités : comment votre structure apparaît sur AccesDirectAide, et comment nous joindre.')} />

            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                {beta && (
                    <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="partners-now" data-testid="partners-beta-now">
                        <h2 id="partners-now" className="text-xl font-bold text-slate-900">{t('about:partners.beta.title', 'Pendant la bêta publique')}</h2>
                        <p className="mt-2 text-slate-700">
                            {t('about:partners.beta.text', 'L’espace professionnel, les comptes de structure et la prise de rendez-vous ne sont pas encore ouverts. Votre structure figure peut-être déjà dans l’annuaire : les lieux d’accueil sont repris des registres officiels (FINESS, Annuaire de l’administration, SIRENE) et vérifiés avant publication.')}
                        </p>
                        <div className="mt-5 flex flex-wrap gap-3">
                            <Link to="/structures" className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-5 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
                                {t('about:partners.beta.search', 'Chercher ma structure dans l’annuaire')}
                            </Link>
                            {email && (
                                <a href={mailtoWithSubject(email, 'Partenariat AccesDirectAide')} data-testid="partners-mailto" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-5 font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
                                    {t('about:partners.beta.write', 'Nous écrire : {{email}}', { email })}
                                </a>
                            )}
                        </div>
                        <p className="mt-4 text-sm text-slate-600">{t('about:partners.beta.privacy', 'Pour corriger une fiche ou proposer un partenariat, écrivez-nous. N’envoyez pas d’informations personnelles sur les personnes que vous accompagnez.')}</p>
                    </section>
                )}

                {/* Appel à partenaires (Puisque le projet démarre et n'a pas encore signé les acteurs) */}
                <Card className="border-slate-200 shadow-xl overflow-hidden">
                    <div className="bg-purple-600 h-2 w-full"></div>
                    <CardContent className="p-6 md:p-10 text-center space-y-8">

                        <div className="max-w-2xl mx-auto">
                            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
                                {beta ? t('about:partners.offer.title_beta', 'Ce que l’espace partenaires permettra') : t('about:partners.offer.title_open', 'Associations, CCAS, structures solidaires : rejoignez l’initiative')}
                            </h2>
                            <p className="text-lg text-slate-600 leading-relaxed">
                                {t('about:partners.offer.text', "Accès Direct Aide est déployé pour simplifier la vie des demandeurs et soulager l'accueil des professionnels.")} {beta
                                    ? <Trans i18n={i18n} i18nKey="about:partners.offer.beta" defaults="À son ouverture, l’espace partenaires permettra de <0>tenir à jour la fiche de votre structure</0> et de recevoir des orientations." components={[<strong key="update" />]} />
                                    : <Trans i18n={i18n} i18nKey="about:partners.offer.open" defaults="<0>Référencez votre structure</0> dans notre annuaire pour bénéficier de la prise de RDV intégrée et d'une visibilité civique." components={[<strong key="list" />]} />}
                            </p>
                        </div>

                        <div className="grid md:grid-cols-3 gap-6 pt-6 border-t border-slate-100">
                            <div className="p-4">
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Users className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-slate-900 mb-2">{t('about:partners.features.visibility.title', 'Visibilité Civique')}</h3>
                                <p className="text-sm text-slate-600">{t('about:partners.features.visibility.text', 'Apparaissez sur les cartes de diagnostic et touchez réellement le public que vous pouvez aider dans votre territoire.')}</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <MapPin className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-slate-900 mb-2">{t('about:partners.features.referrals.title', 'Orientations explicites')}</h3>
                                <p className="text-sm text-slate-600">{t('about:partners.features.referrals.text', "Une orientation vous parvient avec le besoin indiqué et l'accord de la personne ; vous pouvez l'accepter, demander un complément ou la refuser (pas de capacité, hors de votre champ).")}</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Handshake className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-slate-900 mb-2">{t('about:partners.features.no_ads.title', 'Sans publicité ni classement payant')}</h3>
                                <p className="text-sm text-slate-600">{t('about:partners.features.no_ads.text', "Aucune position payante dans l'annuaire ou les résultats, et aucune donnée personnelle n'est vendue. Les conditions pour les structures seront publiées par l'association.")}</p>
                            </div>
                        </div>

                    </CardContent>
                </Card>

                {/* Engagements et CTA */}
                <div className={`grid gap-6 ${beta ? '' : 'md:grid-cols-2'}`}>

                    <Card className="border-slate-200 shadow-sm bg-white">
                        <CardContent className="p-8">
                            <h3 className="text-xl font-bold text-slate-900 mb-6">{t('about:partners.commitments.title', 'Nos engagements fermes')}</h3>
                            <ul className="space-y-4">
                                <li className="flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                    <span className="text-sm text-slate-700">{t('about:partners.commitments.review', 'Vous proposez vos horaires, vos services et vos créneaux ; une modification de votre fiche publique est relue par ADA avant publication.')}</span>
                                </li>
                                <li className="flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                    <span className="text-sm text-slate-700">{t('about:partners.commitments.history', "Chaque modification de votre fiche par ADA est datée, attribuée et conservée dans l'historique de la fiche.")}</span>
                                </li>
                                <li className="flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                    <span className="text-sm text-slate-700">{t('about:partners.commitments.errors', 'Une erreur signalée sur votre fiche est examinée par ADA avant toute correction.')}</span>
                                </li>
                            </ul>
                        </CardContent>
                    </Card>

                    {!beta && (
                    <Card className="bg-slate-900 border-none text-white shadow-xl flex flex-col justify-center relative overflow-hidden">
                        <div className="absolute top-0 end-0 p-8 opacity-10">
                            <HeartHandshake className="w-32 h-32" />
                        </div>
                        <CardContent className="p-8 relative z-10">
                            <h3 className="text-2xl font-bold mb-4">{t('about:partners.join.title', 'Proposer votre structure')}</h3>
                            <p className="text-slate-300 text-sm leading-relaxed mb-8">
                                {t('about:partners.join.text', "Votre Espace Pro est ouvert dès l'inscription. Votre fiche n'apparaît dans l'annuaire public, et ne peut recevoir de dossiers, qu'après sa vérification par ADA.")}
                            </p>
                            <div className="flex flex-col gap-3">
                                <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-500 text-white border-0">
                                    <Link to="/pro/register">
                                        {t('about:partners.join.create', 'Créer mon Espace Pro')}
                                        <ArrowRight className="ms-2 w-4 h-4 rtl-flip" />
                                    </Link>
                                </Button>
                                <Button asChild variant="outline" size="lg" className="bg-transparent border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white">
                                    <Link to="/contact?sujet=partenariat">
                                        {t('about:partners.join.discuss', "Discuter d'un partenariat")}
                                    </Link>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                    )}

                </div>

            </div>
        </div>
    );
}
