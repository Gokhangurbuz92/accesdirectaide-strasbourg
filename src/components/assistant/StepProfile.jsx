// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const SITUATIONS = [
    { key: 'seul', label: 'Seul(e)' },
    { key: 'couple', label: 'En couple' },
    { key: 'famille', label: 'Avec enfant(s)' },
];

const STATUTS = [
    { key: 'emploi', label: 'En emploi' },
    { key: 'chomage', label: 'Sans emploi' },
    { key: 'etudiant', label: 'Étudiant(e)' },
    { key: 'retraite', label: 'Retraité(e)' },
    { key: 'hebergement', label: 'Sans hébergement' },
];

// @ts-ignore
export default function StepProfile({ onNext, onBack }) {
    const [situation, setSituation] = useState('');
    const [statut, setStatut] = useState('');

    const canContinue = situation && statut;

    return (
        <div>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Votre situation</h2>
            <p className="mb-4 text-sm text-slate-600">Ces informations ne sont pas conservées sur nos serveurs ; elles restent 24 heures au plus sur cet appareil (« Recommencer » les efface).</p>

            <fieldset className="mb-4">
                <legend className="mb-2 text-sm font-medium text-slate-700">Situation familiale</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Situation familiale">
                    {SITUATIONS.map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={situation === key}
                            onClick={() => setSituation(key)}
                            className={`rounded-lg border px-3 py-2 min-h-[2.75rem] text-base sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${situation === key
                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </fieldset>

            <fieldset className="mb-5">
                <legend className="mb-2 text-sm font-medium text-slate-700">Statut actuel</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Statut actuel">
                    {STATUTS.map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={statut === key}
                            onClick={() => setStatut(key)}
                            className={`rounded-lg border px-3 py-2 min-h-[2.75rem] text-base sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${statut === key
                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </fieldset>

            <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={onBack}>Retour</Button>
                <Button type="button" size="sm" disabled={!canContinue} onClick={() => onNext({ situation, statut })}>
                    Continuer
                </Button>
            </div>
        </div>
    );
}
