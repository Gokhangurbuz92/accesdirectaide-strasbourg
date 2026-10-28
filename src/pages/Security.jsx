
import SEO from '@/components/SEO';
import { ShieldCheck, Lock, Trash2, EyeOff, Database, UserCheck, ExternalLink } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_PLACEHOLDERS } from '@/config/legal-documents';

export default function Security() {
    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <SEO
                title="Sécurité et Données Personnelles (RGPD)"
                description="Comment nous protégeons vos données. Stockage minimal et chiffré."
                path="/securite-et-rgpd"
            />

            {/* Hero Section */}
            <div className="bg-slate-900 text-white pt-16 pb-24 border-b border-slate-800">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
                    <div className="inline-flex justify-center items-center w-16 h-16 rounded-2xl bg-green-500/20 text-green-400 mb-6 ring-1 ring-green-500/30">
                        <ShieldCheck className="w-8 h-8" />
                    </div>
                    <h1 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight text-slate-50">Sécurité et Vie Privée</h1>
                    <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
                        Nous collectons le minimum possible d'informations vous concernant. Et nous les protégeons comme un trésor.
                    </p>
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-4 sm:px-6 -mt-10 relative z-10 space-y-6">

                {/* Piliers Sécurité */}
                <Card className="border-green-200 bg-green-50/50 shadow-sm overflow-hidden">
                    <CardContent className="p-6 md:p-8">
                        <div className="grid sm:grid-cols-3 gap-6 text-center">
                            <div className="p-4">
                                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Lock className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-green-900 mb-2">Données Chiffrées</h3>
                                <p className="text-sm text-green-800">Les messages, les documents et les réponses des dossiers partagés sont chiffrés à l&apos;enregistrement (AES-256-GCM), en plus du chiffrement du transport (HTTPS). Ce n&apos;est pas un chiffrement de bout en bout : nos serveurs détiennent les clés.</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Trash2 className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-green-900 mb-2">Durées limitées</h3>
                                <p className="text-sm text-green-800">Chaque type de donnée a une durée de conservation. Une partie est appliquée automatiquement ; le reste attend une décision et n&apos;est pas encore supprimé automatiquement. Le détail est dans la politique de confidentialité.</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <EyeOff className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-green-900 mb-2">Pas de Vente</h3>
                                <p className="text-sm text-green-800">Vos données ne servent qu'à vous aider. Jamais vendues.</p>
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
                                <h2 className="text-xl font-bold text-slate-900">Ce que nous stockons</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc pl-5 space-y-2 text-sm">
                                    <li><strong>Comptes</strong> : e-mail et mot de passe (haché, jamais en clair) des particuliers et des professionnels ; les codes de double authentification sont chiffrés.</li>
                                    <li><strong>Dossiers partagés</strong> : les réponses du questionnaire que vous choisissez de partager (chiffrées) et les autorisations que vous donnez.</li>
                                    <li><strong>Mon Coffre</strong> : les documents que vous déposez vous-même (chiffrés).</li>
                                    <li><strong>Journal de sécurité</strong> : connexions et accès aux dossiers, avec une empreinte de l'adresse IP (pas l'adresse elle-même).</li>
                                    <li><strong>Rendez-vous</strong> : Date, heure, lieu.</li>
                                    <li><strong>Messages</strong> : Contenu chiffré, pièces jointes.</li>
                                    <li><strong>Rendez-vous des personnes</strong> : nom (chiffré) et téléphone (non chiffré) indiqués lors de la prise de rendez-vous, consultables par la structure concernée.</li>
                                </ul>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-red-50 rounded-lg">
                                    <EyeOff className="w-5 h-5 text-red-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">Ce que nous NE stockons PAS</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc pl-5 space-y-2 text-sm">
                                    <li>Votre numéro de sécurité sociale complet.</li>
                                    <li>Vos données bancaires.</li>
                                    <li>Votre dossier médical (nous ne le demandons jamais ; ne déposez dans Mon Coffre que ce qui est utile à votre démarche).</li>
                                    <li>Des informations sur votre vie privée (religion, orientation, etc.).</li>
                                </ul>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <Trash2 className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">Règles de Suppression (Purge)</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc pl-5 space-y-2 text-sm">
                                    {/* PKG-11 audit: the former list (messages 60 days, attachments 30 days, appointments 1 year, inactive accounts 2 years) was not what the
                                        purge job does; these are the rules it applies (api/_handlers/cron/gdpr-purge.js), the same as the privacy policy */}
                                    <li><strong>Rendez-vous passés</strong> : anonymisés après 2 ans (730 jours).</li>
                                    <li><strong>Copie partagée du questionnaire</strong> : effacée à l’expiration du lien, au plus 90 jours.</li>
                                    <li><strong>Conversations avec l’assistant</strong> : 90 jours.</li>
                                    <li><strong>Journaux de sécurité</strong> : 365 jours ; preuves de consentement : 3 ans.</li>
                                    <li>Le tableau complet est dans la <a href="/politique-confidentialite" className="text-blue-800 underline">politique de confidentialité</a>.</li>
                                </ul>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <UserCheck className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">Vos Droits (RGPD)</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <p className="text-sm">
                                    Conformément au RGPD, vous pouvez demander à voir, modifier ou supprimer vos données.
                                    Pour cela, utilisez le formulaire de contact ou écrivez à {LEGAL_PLACEHOLDERS.dataProtectionContact}.
                                </p>
                                <p className="mt-4">
                                    <a href="/contact" className="text-blue-600 font-medium hover:text-blue-700 hover:underline inline-flex items-center gap-1">
                                        Formulaire de contact <ExternalLink className="w-4 h-4" />
                                    </a>
                                </p>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <Lock className="w-5 h-5 text-blue-600" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900">Technique</h2>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed px-2">
                                <ul className="list-disc pl-5 space-y-2 text-sm">
                                    <li><strong>Hébergement</strong> : Vercel, fonctions exécutées à Francfort (UE) ; Vercel Inc. est une société américaine (voir la <a href="/politique-confidentialite" className="underline">politique de confidentialité</a>).</li>
                                    <li><strong>Base de Données</strong> : Neon Postgres (Francfort, Allemagne — UE).</li>
                                    <li><strong>Chiffrement au repos</strong> : AES-256-GCM pour les données sensibles.</li>
                                    <li><strong>Chiffrement en transit</strong> : HTTPS (TLS) pour tous les échanges.</li>
                                </ul>
                                <p className="text-sm mt-8 text-slate-500 border-t border-slate-100 pt-4">
                                    Dernière mise à jour : 23 octobre 2026
                                </p>
                            </div>
                        </section>

                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
