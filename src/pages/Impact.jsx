// @ts-nocheck

import { useState, useEffect } from 'react';
import SEO from '@/components/SEO';
import { BarChart, Users, FileText, CheckCircle } from 'lucide-react';

export default function Impact() {
    const [stats, setStats] = useState(null);
    const [, setLoading] = useState(true);

    // PKG-11 / P25: only measured figures — and none is shown when the service does not publish them (the public figures endpoint awaits an owner decision:
    // tests/unit/frontend-api-route-contract.test.js). The page used to show « - » under « les chiffres clés à ce jour ».
    useEffect(() => {
        fetch('/api/public/stats')
            .then(res => (res.ok ? res.json() : null))
            .then(data => setStats(data && typeof data === 'object' ? data : null))
            // @ts-ignore
            .catch(e => { if (import.meta.env.DEV) console.error(e); })
            .finally(() => setLoading(false));
    }, []);

    const metrics = [
        { label: "Guides publiés", value: stats?.guides || "-", icon: FileText, color: "text-blue-600" },
        { label: "Outils disponibles", value: stats?.tools || "-", icon: CheckCircle, color: "text-green-600" },
        { label: "Structures référencées", value: stats?.structures || "-", icon: Users, color: "text-purple-600" },
        { label: "Rendez-vous facilités", value: stats?.appointments || "-", icon: BarChart, color: "text-orange-600" },
    ];

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <SEO
                title="Impact & Transparence"
                description="Chiffres clés et impact d'Accès Direct Aide sur l'accès aux droits."
                path="/impact"
            />

            {/* Hero Section */}
            <div className="bg-slate-900 text-white pt-16 pb-24 border-b border-slate-800">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
                    <div className="inline-flex justify-center items-center w-16 h-16 rounded-2xl bg-blue-500/20 text-blue-400 mb-6 ring-1 ring-blue-500/30">
                        <BarChart className="w-8 h-8" />
                    </div>
                    <h1 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight text-slate-50">Notre Impact</h1>
                    <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
                        Nous mesurons l'utilité de notre plateforme par des indicateurs concrets, et nous ne publions que des chiffres mesurés.
                    </p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-10 relative z-10 space-y-8">
            {/* Counters */}
            {!stats ? (
                <p className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 text-center text-slate-700 mb-16" data-testid="impact-no-figures">
                    Les chiffres d’usage ne sont pas encore publiés : ils le seront lorsqu’ils seront mesurés sur un service ouvert au public.
                </p>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
                {metrics.map((m, i) => (
                    <div key={i} className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 text-center">
                        <m.icon className={`w-12 h-12 mx-auto mb-4 ${m.color}`} />
                        <div className="text-4xl font-bold text-gray-900 mb-2">{m.value}</div>
                        <div className="text-gray-600 font-medium">{m.label}</div>
                    </div>
                ))}
            </div>
            )}

            {/* Roadmap */}
            <div className="bg-white rounded-lg shadow-sm p-8 border border-gray-100">
                <h2 className="text-2xl font-bold mb-6">Ce que nous voulons améliorer</h2>
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="bg-blue-100 text-blue-800 font-bold px-3 py-1 rounded h-fit">1</div>
                        <div>
                            <h3 className="font-bold text-lg">Plus de couverture territoriale</h3>
                            <p className="text-gray-600">Référencer davantage de structures locales pour un maillage fin.</p>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <div className="bg-green-100 text-green-800 font-bold px-3 py-1 rounded h-fit">2</div>
                        <div>
                            <h3 className="font-bold text-lg">Accessibilité renforcée</h3>
                            <p className="text-gray-600">Aller plus loin que le FALC avec des versions audio et vidéo des guides.</p>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <div className="bg-purple-100 text-purple-800 font-bold px-3 py-1 rounded h-fit">3</div>
                        <div>
                            <h3 className="font-bold text-lg">Mesure d'impact qualitatif</h3>
                            <p className="text-gray-600">Lancer des enquêtes de satisfaction auprès des bénéficiaires.</p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t">
                    <h3 className="text-xl font-bold mb-4">Comment nous aider ?</h3>
                    <p className="text-gray-700 mb-4">
                        Vous êtes une structure d'aide ? Référencez-vous gratuitement.
                        Vous êtes un financeur ? Contactez-nous pour soutenir le projet.
                    </p>
                    <a href="/partenaires" className="inline-block bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700 transition">
                        Devenir partenaire
                    </a>
                </div>
            </div>
            </div>
        </div>
    );
}
