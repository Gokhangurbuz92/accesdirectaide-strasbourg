
import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import BetaProcessingNotice from '@/components/beta/BetaProcessingNotice';
import LegalTranslationNotice from '@/components/legal/LegalTranslationNotice';
import { ShieldCheck, Lock, Trash2, EyeOff, Database, UserCheck, ExternalLink } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
import i18n, { formatDate, useLanguage, useT } from '@/i18n';

// R32: translated (namespace « legal »); the French text stays the reference (the contact address of the configuration is shown as written).
export default function Security() {
    const { t } = useT('legal');
    const { isSource } = useLanguage();
    const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
    const privacyLink = (/** @type {string} */ className) => <a key="privacy" href="/politique-confidentialite" className={className}>politique de confidentialité</a>;
    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <SEO
                title={t('legal:security.seo.title', 'Sécurité et Données Personnelles (RGPD)')}
                description={t('legal:security.seo.description', 'Comment nous protégeons vos données. Stockage minimal et chiffré.')}
                path="/securite-et-rgpd"
            />

            {/* Hero Section */}
            <PageHeader width="reading" title={t('legal:security.title', 'Sécurité et vie privée')} description={t('legal:security.intro', "Nous collectons le minimum possible d'informations vous concernant. Et nous les protégeons comme un trésor.")} />

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
              <LegalTranslationNotice />
              <BetaProcessingNotice />

                {/* Piliers Sécurité */}
                <Card className="border-green-200 bg-green-50/50 shadow-sm overflow-hidden">
                    <CardContent className="p-6 md:p-8">
                        <div className="grid sm:grid-cols-3 gap-6 text-center">
                            <div className="p-4">
                                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Lock className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-green-900 mb-2">{t('legal:security.pillars.encrypted.title', 'Données Chiffrées')}</h3>
                                <p className="text-sm text-green-800">{t('legal:security.pillars.encrypted.text', "Les messages, les documents et les réponses des dossiers partagés sont chiffrés à l'enregistrement (AES-256-GCM), en plus du chiffrement du transport (HTTPS). Ce n'est pas un chiffrement de bout en bout : nos serveurs détiennent les clés.")}</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Trash2 className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-green-900 mb-2">{t('legal:security.pillars.limited.title', 'Durées limitées')}</h3>
                                <p className="text-sm text-green-800">{t('legal:security.pillars.limited.text', "Chaque type de donnée a une durée de conservation. Une partie est appliquée automatiquement ; le reste attend une décision et n'est pas encore supprimé automatiquement. Le détail est dans la politique de confidentialité.")}</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <EyeOff className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-green-900 mb-2">{t('legal:security.pillars.noSale.title', 'Pas de Vente')}</h3>
                                <p className="text-sm text-green-800">{t('legal:security.pillars.noSale.text', "Vos données ne servent qu'à vous aider. Jamais vendues.")}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Détails */}
                <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-6 md:p-8 space-y-8">

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <Database className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">{t('legal:security.stored.title', 'Ce que nous stockons')}</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc ps-5 space-y-2 text-sm">
                                    <li><Trans i18n={i18n} i18nKey="legal:security.stored.accounts" defaults="<strong>Comptes</strong> : e-mail et mot de passe (haché, jamais en clair) des particuliers et des professionnels ; les codes de double authentification sont chiffrés." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.stored.shared" defaults="<strong>Dossiers partagés</strong> : les réponses du questionnaire que vous choisissez de partager (chiffrées) et les autorisations que vous donnez." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.stored.vault" defaults="<strong>Mon Coffre</strong> : les documents que vous déposez vous-même (chiffrés)." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.stored.log" defaults="<strong>Journal de sécurité</strong> : connexions et accès aux dossiers, avec une empreinte de l'adresse IP (pas l'adresse elle-même)." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.stored.appointments" defaults="<strong>Rendez-vous</strong> : Date, heure, lieu." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.stored.messages" defaults="<strong>Messages</strong> : Contenu chiffré, pièces jointes." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.stored.bookings" defaults="<strong>Rendez-vous des personnes</strong> : nom (chiffré) et téléphone (non chiffré) indiqués lors de la prise de rendez-vous, consultables par la structure concernée." /></li>
                                </ul>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-red-50 rounded-lg">
                                    <EyeOff className="w-5 h-5 text-red-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">{t('legal:security.notStored.title', 'Ce que nous NE stockons PAS')}</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc ps-5 space-y-2 text-sm">
                                    <li>{t('legal:security.notStored.ssn', 'Votre numéro de sécurité sociale complet.')}</li>
                                    <li>{t('legal:security.notStored.bank', 'Vos données bancaires.')}</li>
                                    <li>{t('legal:security.notStored.medical', 'Votre dossier médical (nous ne le demandons jamais ; ne déposez dans Mon Coffre que ce qui est utile à votre démarche).')}</li>
                                    <li>{t('legal:security.notStored.private', 'Des informations sur votre vie privée (religion, orientation, etc.).')}</li>
                                </ul>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <Trash2 className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">{t('legal:security.purge.title', 'Règles de Suppression (Purge)')}</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc ps-5 space-y-2 text-sm">
                                    {/* PKG-11 audit: the former list (messages 60 days, attachments 30 days, appointments 1 year, inactive accounts 2 years) was not what the
                                        purge job does; these are the rules it applies (api/_handlers/cron/gdpr-purge.js), the same as the privacy policy */}
                                    <li><Trans i18n={i18n} i18nKey="legal:security.purge.appointments" defaults="<strong>Rendez-vous passés</strong> : anonymisés après 2 ans (730 jours)." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.purge.sharedCopy" defaults="<strong>Copie partagée du questionnaire</strong> : effacée à l’expiration du lien, au plus 90 jours." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.purge.conversations" defaults="<strong>Conversations avec l’assistant</strong> : 90 jours." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.purge.logs" defaults="<strong>Journaux de sécurité</strong> : 365 jours ; preuves de consentement : 3 ans." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.purge.table" defaults="Le tableau complet est dans la <0>politique de confidentialité</0>." components={[privacyLink('text-blue-800 underline')]} /></li>
                                </ul>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <UserCheck className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">{t('legal:security.rights.title', 'Vos Droits (RGPD)')}</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <p className="text-sm">
                                    <Trans i18n={i18n} i18nKey="legal:security.rights.text" defaults="Conformément au RGPD, vous pouvez demander à voir, modifier ou supprimer vos données. Pour cela, utilisez le formulaire de contact ou écrivez à <0/>."
                                        components={[<span key="contact" {...fr}>{LEGAL_PLACEHOLDERS.dataProtectionContact}</span>]} />
                                </p>
                                <p className="mt-4">
                                    <a href="/contact" className="text-blue-600 font-medium hover:text-blue-700 hover:underline inline-flex items-center gap-1">
                                        {t('legal:security.rights.form', 'Formulaire de contact')} <ExternalLink className="w-4 h-4 rtl-flip" />
                                    </a>
                                </p>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <Lock className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">{t('legal:security.technical.title', 'Technique')}</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc ps-5 space-y-2 text-sm">
                                    <li><Trans i18n={i18n} i18nKey="legal:security.technical.hosting" defaults="<strong>Hébergement</strong> : Vercel, fonctions exécutées à Francfort (UE) ; Vercel Inc. est une société américaine (voir la <0>politique de confidentialité</0>)." components={[privacyLink('underline')]} /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.technical.database" defaults="<strong>Base de Données</strong> : Neon Postgres (Francfort, Allemagne — UE)." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.technical.atRest" defaults="<strong>Chiffrement au repos</strong> : AES-256-GCM pour les données sensibles." /></li>
                                    <li><Trans i18n={i18n} i18nKey="legal:security.technical.inTransit" defaults="<strong>Chiffrement en transit</strong> : HTTPS (TLS) pour tous les échanges." /></li>
                                </ul>
                                <p className="text-sm mt-8 text-slate-500 border-t border-slate-100 pt-4">
                                    {t('legal:security.updated', 'Dernière mise à jour : {{date}}', { date: formatDate('2026-10-23') })}
                                </p>
                            </div>
                        </section>

                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
