// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

// R40: the labels are in the interface language (namespace `diagnostic`); the keys are the values the wizard stores
const SITUATIONS = ['seul', 'couple', 'famille'];

const STATUTS = ['emploi', 'chomage', 'etudiant', 'retraite', 'hebergement'];

// @ts-ignore
export default function StepProfile({ onNext, onBack }) {
    const { t } = useT('diagnostic');
    const LABELS = {
        seul: t('diagnostic:wizard.profile.alone', 'Seul(e)'),
        couple: t('diagnostic:wizard.profile.couple', 'En couple'),
        famille: t('diagnostic:wizard.profile.children', 'Avec enfant(s)'),
        emploi: t('diagnostic:wizard.profile.employed', 'En emploi'),
        chomage: t('diagnostic:wizard.profile.unemployed', 'Sans emploi'),
        etudiant: t('diagnostic:wizard.profile.student', 'Étudiant(e)'),
        retraite: t('diagnostic:wizard.profile.retired', 'Retraité(e)'),
        hebergement: t('diagnostic:wizard.profile.no_housing', 'Sans hébergement'),
    };
    const [situation, setSituation] = useState('');
    const [statut, setStatut] = useState('');

    const canContinue = situation && statut;

    return (
        <div>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">{t('diagnostic:wizard.profile.title', 'Votre situation')}</h2>
            <p className="mb-4 text-sm text-slate-600">{t('diagnostic:wizard.profile.intro', 'Ces informations ne sont pas conservées sur nos serveurs ; elles restent 24 heures au plus sur cet appareil (« {{restart}} » les efface).', { restart: t('diagnostic:wizard.restart', 'Recommencer') })}</p>

            <fieldset className="mb-4">
                <legend className="mb-2 text-sm font-medium text-slate-700">{t('diagnostic:wizard.profile.family', 'Situation familiale')}</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('diagnostic:wizard.profile.family', 'Situation familiale')}>
                    {SITUATIONS.map((key) => (
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
                            {LABELS[key]}
                        </button>
                    ))}
                </div>
            </fieldset>

            <fieldset className="mb-5">
                <legend className="mb-2 text-sm font-medium text-slate-700">{t('diagnostic:wizard.profile.status', 'Statut actuel')}</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('diagnostic:wizard.profile.status', 'Statut actuel')}>
                    {STATUTS.map((key) => (
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
                            {LABELS[key]}
                        </button>
                    ))}
                </div>
            </fieldset>

            <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={onBack}>{t('diagnostic:wizard.back', 'Retour')}</Button>
                <Button type="button" size="sm" disabled={!canContinue} onClick={() => onNext({ situation, statut })}>
                    {t('diagnostic:wizard.continue', 'Continuer')}
                </Button>
            </div>
        </div>
    );
}
