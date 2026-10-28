import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { 
  Home,
  Heart,
  Accessibility,
  Briefcase,
  Users,
  Wallet,
  Car,
  Scale,
  Laptop,
  Globe,
  Sparkles,
  Clock
} from 'lucide-react';

const CATEGORIES = [
  { id: 'logement', label: 'Logement', icon: Home, color: 'text-orange-600 bg-orange-100' },
  { id: 'sante', label: 'Santé', icon: Heart, color: 'text-green-600 bg-green-100' },
  { id: 'handicap', label: 'Handicap', icon: Accessibility, color: 'text-purple-600 bg-purple-100' },
  { id: 'emploi', label: 'Emploi / Formation', icon: Briefcase, color: 'text-blue-600 bg-blue-100' },
  { id: 'famille', label: 'Famille', icon: Users, color: 'text-pink-600 bg-pink-100' },
  { id: 'budget', label: 'Budget / Dettes', icon: Wallet, color: 'text-yellow-600 bg-yellow-100' },
  { id: 'mobilite', label: 'Mobilité', icon: Car, color: 'text-cyan-600 bg-cyan-100' },
  { id: 'justice', label: 'Justice / Droits', icon: Scale, color: 'text-red-600 bg-red-100' },
  { id: 'numerique', label: 'Numérique', icon: Laptop, color: 'text-indigo-600 bg-indigo-100' },
  { id: 'etrangers', label: 'Nouveaux arrivants', icon: Globe, color: 'text-teal-600 bg-teal-100' },
  { id: 'lgbtqia', label: 'LGBTQIA+', icon: Sparkles, color: 'text-violet-600 bg-violet-100' },
  { id: 'vieillissement', label: 'Autonomie / Âge', icon: Clock, color: 'text-amber-600 bg-amber-100' },
];

export default function CategoryGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {CATEGORIES.map((cat) => {
        const Icon = cat.icon;
        return (
          <Link
            key={cat.id}
            to={createPageUrl('Aides') + `?categorie=${cat.id}`}
            className="group flex flex-col items-center p-4 rounded-xl bg-white border border-slate-200 hover:border-slate-300 hover:shadow-lg transition-all duration-300"
          >
            <div className={`w-12 h-12 rounded-xl ${cat.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
              <Icon className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium text-slate-700 text-center group-hover:text-blue-700 transition-colors">
              {cat.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
