// @ts-nocheck
import { Home, Heart, Briefcase, FileText, AlertTriangle } from 'lucide-react';

const NEEDS = [
    { key: 'logement', label: 'Logement', icon: Home, color: 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100' },
    { key: 'sante', label: 'Santé', icon: Heart, color: 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100' },
    { key: 'travail', label: 'Travail / Emploi', icon: Briefcase, color: 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100' },
    { key: 'papiers', label: 'Papiers / Droits', icon: FileText, color: 'bg-indigo-50 text-indigo-900 border-indigo-200 hover:bg-indigo-100' },
    { key: 'urgence', label: 'Urgence', icon: AlertTriangle, color: 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100' },
];

export default function StepNeed({ onNext }) {
    return (
        <div>
            <h2 className="text-xl font-black text-slate-900 mb-2">Quel est votre besoin principal ?</h2>
            <p className="mb-8 text-sm text-slate-700 font-medium">Choisissez la catégorie qui correspond le mieux.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="group" aria-label="Catégorie de besoin">
                {NEEDS.map(({ key, label, icon: Icon, color }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onNext({ need: key })}
                        className={`flex items-center gap-4 p-5 rounded-xl border transition-all font-bold text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${color}`}
                    >
                        <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
                        <span>{label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
