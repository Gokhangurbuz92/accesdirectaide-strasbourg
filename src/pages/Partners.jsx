import SEO from '@/components/SEO';
import { Link } from 'react-router-dom';
import { Handshake, MapPin, Users, HeartHandshake, CheckCircle2, ArrowRight } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Partners() {
    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <SEO
                title="Partenaires & Collectivités"
                description="Espace dédié aux collectivités, associations et acteurs sociaux qui souhaitent rejoindre l'écosystème Accès Direct Aide."
                path="/partenaires"
            />

            {/* Hero Section */}
            <div className="bg-slate-900 text-white pt-16 pb-32 border-b border-slate-800">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
                    <div className="inline-flex justify-center items-center w-16 h-16 rounded-2xl bg-purple-500/20 text-purple-400 mb-6 ring-1 ring-purple-500/30">
                        <HeartHandshake className="w-8 h-8" />
                    </div>
                    <h1 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight text-slate-50">Espace Partenaires</h1>
                    <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
                        Notre plateforme s'appuie sur la transparence de l'Open Data et l'intelligence collective locale. Vous aidez le public ? Rejoignez le réseau.
                    </p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-20 relative z-10 space-y-8">

                {/* Appel à partenaires (Puisque le projet démarre et n'a pas encore signé les acteurs) */}
                <Card className="border-slate-200 shadow-xl overflow-hidden">
                    <div className="bg-purple-600 h-2 w-full"></div>
                    <CardContent className="p-6 md:p-10 text-center space-y-8">

                        <div className="max-w-2xl mx-auto">
                            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
                                Associations, CCAS, Structures Solidaires : Ralliez L'initiative
                            </h2>
                            <p className="text-lg text-slate-600 leading-relaxed">
                                Accès Direct Aide est déployé pour simplifier la vie des demandeurs et soulager l'accueil des professionnels. <strong>Référencez votre structure</strong> dans notre annuaire pour bénéficier de la prise de RDV intégrée et d'une visibilité civique.
                            </p>
                        </div>

                        <div className="grid md:grid-cols-3 gap-6 pt-6 border-t border-slate-100">
                            <div className="p-4">
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Users className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-slate-900 mb-2">Visibilité Civique</h3>
                                <p className="text-sm text-slate-600">Apparaissez sur les cartes de diagnostic et touchez réellement le public que vous pouvez aider dans votre territoire.</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <MapPin className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-slate-900 mb-2">Orientations explicites</h3>
                                <p className="text-sm text-slate-600">Une orientation vous parvient avec le besoin indiqué et l&apos;accord de la personne ; vous pouvez l&apos;accepter, demander un complément ou la refuser (pas de capacité, hors de votre champ).</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <Handshake className="w-6 h-6" />
                                </div>
                                <h3 className="font-bold text-lg text-slate-900 mb-2">Sans publicité ni classement payant</h3>
                                <p className="text-sm text-slate-600">Aucune position payante dans l&apos;annuaire ou les résultats, et aucune donnée personnelle n&apos;est vendue. Les conditions pour les structures seront publiées par l&apos;association.</p>
                            </div>
                        </div>

                    </CardContent>
                </Card>

                {/* Engagements et CTA */}
                <div className="grid md:grid-cols-2 gap-6">

                    <Card className="border-slate-200 shadow-sm bg-white">
                        <CardContent className="p-8">
                            <h3 className="text-xl font-bold text-slate-900 mb-6">Nos engagements fermes</h3>
                            <ul className="space-y-4">
                                <li className="flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                    <span className="text-sm text-slate-700">Vous proposez vos horaires, vos services et vos créneaux ; une modification de votre fiche publique est relue par ADA avant publication.</span>
                                </li>
                                <li className="flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                    <span className="text-sm text-slate-700">Chaque modification de votre fiche par ADA est datée, attribuée et conservée dans l&apos;historique de la fiche.</span>
                                </li>
                                <li className="flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                    <span className="text-sm text-slate-700">Une erreur signalée sur votre fiche est examinée par ADA avant toute correction.</span>
                                </li>
                            </ul>
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-900 border-none text-white shadow-xl flex flex-col justify-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-10">
                            <HeartHandshake className="w-32 h-32" />
                        </div>
                        <CardContent className="p-8 relative z-10">
                            <h3 className="text-2xl font-bold mb-4">Proposer votre structure</h3>
                            <p className="text-slate-300 text-sm leading-relaxed mb-8">
                                Votre Espace Pro est ouvert dès l&apos;inscription. Votre fiche n&apos;apparaît dans l&apos;annuaire public, et ne peut recevoir de dossiers, qu&apos;après sa vérification par ADA.
                            </p>
                            <div className="flex flex-col gap-3">
                                <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-500 text-white border-0">
                                    <Link to="/pro/register">
                                        Créer mon Espace Pro
                                        <ArrowRight className="ml-2 w-4 h-4" />
                                    </Link>
                                </Button>
                                <Button asChild variant="outline" size="lg" className="bg-transparent border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white">
                                    <Link to="/contact?sujet=partenariat">
                                        Discuter d'un partenariat
                                    </Link>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                </div>

            </div>
        </div>
    );
}
