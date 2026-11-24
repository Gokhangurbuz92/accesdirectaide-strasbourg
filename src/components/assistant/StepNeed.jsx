// @ts-nocheck
import { Home, Heart, Briefcase, FileText, AlertTriangle } from 'lucide-react';
import { useT } from '@/i18n';
import { topicTone } from '@/design/categoryTone';
import { ToneIcon } from '@/components/ui/Tone';

// R40: the labels are in the interface language (namespace `diagnostic`); the keys are the values the wizard stores.
// Colours: the topic colour of the platform (src/design/categoryTone.js) as an accent; « urgence » keeps its full rose (danger) look.
const NEEDS = [
    { key: 'logement', icon: Home },
    { key: 'sante', icon: Heart },
    { key: 'travail', icon: Briefcase },
    { key: 'papiers', icon: FileText },
    { key: 'urgence', icon: AlertTriangle, urgent: 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100' },
];

export default function StepNeed({ onNext }) {
    const { t } = useT('diagnostic');
    const LABELS = {
        logement: t('diagnostic:wizard.need.logement', 'Logement'),
        sante: t('diagnostic:wizard.need.sante', 'Santé'),
        travail: t('diagnostic:wizard.need.travail', 'Travail / Emploi'),
        papiers: t('diagnostic:wizard.need.papiers', 'Papiers / Droits'),
        urgence: t('diagnostic:wizard.need.urgence', 'Urgence'),
    };
    return (
        <div>
            <h2 className="text-xl font-black text-slate-900 mb-2">{t('diagnostic:wizard.need.title', 'Quel est votre besoin principal ?')}</h2>
            <p className="mb-8 text-sm text-slate-700 font-medium">{t('diagnostic:wizard.need.intro', 'Choisissez la catégorie qui correspond le mieux.')}</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="group" aria-label={t('diagnostic:wizard.need.group', 'Catégorie de besoin')}>
                {NEEDS.map(({ key, icon: Icon, urgent }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onNext({ need: key })}
                        className={`flex items-center gap-4 p-5 rounded-xl border transition-all font-bold text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${urgent || `border-slate-200 bg-white text-slate-900 hover:bg-slate-50 ${topicTone(key).hover}`}`}
                    >
                        {urgent ? <Icon className="h-6 w-6 shrink-0" aria-hidden="true" /> : <ToneIcon tone={topicTone(key)} icon={Icon} />}
                        <span>{LABELS[key]}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
