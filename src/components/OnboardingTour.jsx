// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    ChevronRight,
    ChevronLeft,
    Rocket,
    Calendar,
    Video,
    ShieldCheck,
    MessageCircle,
    BarChart3,
} from 'lucide-react';

const STEPS = [
    {
        title: 'Bienvenue sur ADA Pro',
        description:
            'Vous rejoignez votre structure sur ADA, l\'outil souverain pour l\'accompagnement social. Ce guide rapide vous aidera à configurer votre espace de travail.',
        icon: Rocket,
        color: 'text-indigo-600 bg-indigo-50',
    },
    {
        title: 'Votre Agenda Outlook',
        description:
            'Quand Outlook sera activé sur ADA, vous pourrez connecter votre calendrier Microsoft depuis le tableau de bord. En attendant, vos créneaux se gèrent dans « Disponibilités ».',
        icon: Calendar,
        color: 'text-blue-600 bg-blue-50',
    },
    {
        title: 'Visioconférence',
        description:
            'La visioconférence sera proposée quand le service sera activé par ADA ; la section « Visioconférence » l’indiquera. En attendant, les rendez-vous se tiennent en présentiel.',
        icon: Video,
        color: 'text-emerald-600 bg-emerald-50',
    },
    {
        title: 'Messagerie chiffrée',
        description:
            'Vos échanges avec les usagers sont chiffrés avant l\'envoi et stockés sous forme chiffrée. Ce n\'est pas encore un chiffrement de bout en bout : la plateforme n\'est pas techniquement dans l\'impossibilité de les déchiffrer.',
        icon: MessageCircle,
        color: 'text-purple-600 bg-purple-50',
    },
    {
        title: 'Votre Impact',
        description:
            'Votre responsable de structure suit l\'activité collective dans des rapports agrégés, où les petits effectifs sont masqués ; aucun nom, message ou diagnostic n\'y figure.',
        icon: BarChart3,
        color: 'text-amber-600 bg-amber-50',
    },
    {
        title: 'Souveraineté des Données',
        description:
            'ADA chiffre les messages et justificatifs avant stockage et restreint l\'accès aux données. Le chiffrement de bout en bout (clé détenue uniquement par les participants) n\'est pas encore en place.',
        icon: ShieldCheck,
        color: 'text-emerald-600 bg-emerald-50',
    },
];

/**
 * OnboardingTour — Guide interactif première connexion
 *
 * Displays a modal wizard on first Pro login. Completion is
 * persisted to localStorage so it only appears once.
 *
 * Props:
 * - onComplete: called when the user finishes or skips the tour
 */
export default function OnboardingTour({ onComplete }) {
    const [step, setStep] = useState(0);
    const current = STEPS[step];
    const IconComp = current.icon;
    const isLast = step === STEPS.length - 1;

    const handleNext = () => {
        if (isLast) {
            finish();
        } else {
            setStep((s) => s + 1);
        }
    };

    const handlePrev = () => {
        if (step > 0) setStep((s) => s - 1);
    };

    const finish = () => {
        try {
            localStorage.setItem('ada_onboarding_done', 'true');
        } catch {
            // Quota exceeded
        }
        onComplete?.();
    };

    return (
        <div
            className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Guide de bienvenue"
        >
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                {/* Progress bar */}
                <div className="flex h-1 bg-slate-100">
                    {STEPS.map((_, i) => (
                        <div
                            key={i}
                            className={`flex-1 transition-all duration-300 ${i <= step ? 'bg-indigo-600' : ''
                                }`}
                        />
                    ))}
                </div>

                {/* Content */}
                <div className="p-8 text-center">
                    <div
                        className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-6 ${current.color.split(' ')[1]
                            }`}
                    >
                        <IconComp
                            size={28}
                            className={current.color.split(' ')[0]}
                        />
                    </div>

                    <h2 className="text-lg font-bold text-slate-900 mb-3">
                        {current.title}
                    </h2>

                    <p className="text-sm text-slate-500 leading-relaxed mb-8">
                        {current.description}
                    </p>

                    {/* Navigation */}
                    <div className="flex items-center justify-between">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handlePrev}
                            disabled={step === 0}
                            className={step === 0 ? 'invisible' : ''}
                            aria-label="Étape précédente"
                        >
                            <ChevronLeft size={18} aria-hidden="true" />
                        </Button>

                        {/* Dots */}
                        <div className="flex gap-1.5">
                            {STEPS.map((_, i) => (
                                <div
                                    key={i}
                                    className={`h-1.5 rounded-full transition-all ${i === step
                                            ? 'w-4 bg-indigo-600'
                                            : 'w-1.5 bg-slate-200'
                                        }`}
                                />
                            ))}
                        </div>

                        <Button onClick={handleNext} size="sm">
                            {isLast ? 'Commencer' : 'Suivant'}
                            <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Skip footer */}
                <div className="bg-slate-50 px-8 py-3 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">
                        Étape {step + 1} / {STEPS.length}
                    </span>
                    <button
                        onClick={finish}
                        className="text-[10px] font-medium text-slate-400 hover:text-slate-600"
                    >
                        Passer le guide
                    </button>
                </div>
            </div>
        </div>
    );
}
