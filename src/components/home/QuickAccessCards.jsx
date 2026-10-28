import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { 
  HandHeart, 
  FileText, 
  MapPin,
  ArrowRight
} from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";

const QUICK_ACCESS = [
  {
    id: 'aides',
    title: 'Je cherche une aide',
    description: 'Aides financières, allocations, accompagnement, soutien...',
    icon: HandHeart,
    color: 'bg-blue-500',
    hoverColor: 'hover:bg-blue-600',
    lightColor: 'bg-blue-50',
    page: 'Aides'
  },
  {
    id: 'demarches',
    title: 'Je dois faire une démarche',
    description: 'Démarches administratives expliquées pas à pas',
    icon: FileText,
    color: 'bg-emerald-500',
    hoverColor: 'hover:bg-emerald-600',
    lightColor: 'bg-emerald-50',
    page: 'Demarches'
  },
  {
    id: 'structures',
    title: 'Je cherche une structure près de chez moi',
    description: 'Associations, services publics, lieux d\'accueil',
    icon: MapPin,
    color: 'bg-amber-500',
    hoverColor: 'hover:bg-amber-600',
    lightColor: 'bg-amber-50',
    page: 'Annuaire'
  }
];

export default function QuickAccessCards() {
  return (
    <div className="grid md:grid-cols-3 gap-6">
      {QUICK_ACCESS.map((item) => {
        const Icon = item.icon;
        return (
          <Link 
            key={item.id} 
            to={createPageUrl(item.page)}
            className="group"
          >
            <Card className={`h-full border-2 border-transparent hover:border-slate-200 transition-all duration-300 hover:shadow-xl ${item.lightColor}`}>
              <CardContent className="p-6 flex flex-col h-full">
                <div className={`w-14 h-14 rounded-2xl ${item.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-blue-700 transition-colors">
                  {item.title}
                </h3>
                <p className="text-slate-600 text-sm flex-grow">
                  {item.description}
                </p>
                <div className="flex items-center gap-2 mt-4 text-blue-600 font-medium">
                  <span>Explorer</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-2" />
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
