import { Link } from 'react-router-dom';
import { HandHeart, FileText, MapPin, Bot, Calculator } from 'lucide-react';
import { frontendEnv } from '@/config/env';
import { openLinks } from '@/lib/publicBeta';

const items = [
  { label: 'Toutes les aides', to: '/aides', icon: HandHeart },
  { label: 'Démarches', to: '/demarches', icon: FileText },
  { label: 'Lieux d\'accueil', to: '/structures', icon: MapPin },
  { label: 'Mon Assistant', to: '/orientation', icon: Bot },
  { label: 'Simulateur', to: '/diagnostic', icon: Calculator },
];

export default function QuickAccessSection() {
  // public beta: the assistant and the simulator are closed, so they are not offered
  const shown = openLinks(items, frontendEnv.flags.publicBeta, (i) => i.to);
  return (
    <section className="border-y border-slate-200 bg-slate-50 py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className={`grid grid-cols-2 gap-4 ${shown.length === 5 ? 'md:grid-cols-5' : 'md:grid-cols-3'}`}>
          {shown.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <item.icon className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
