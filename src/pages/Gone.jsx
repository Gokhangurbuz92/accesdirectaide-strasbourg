import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import SEO from '@/components/SEO';
import { FileX2 } from 'lucide-react';

export default function Gone() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title="Contenu retire"
        description="Ce contenu a ete retire et n'est plus disponible."
        noindex={true}
      />

      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileX2 className="h-8 w-8 text-slate-500" />
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Contenu retire
          </h1>

          <p className="text-slate-600 mb-8">
            Cette page n&apos;est plus disponible.
          </p>

          <div className="space-y-3">
            <Link
              to={createPageUrl('Home')}
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Retour a l&apos;accueil
            </Link>

            <Link
              to={createPageUrl('Aides')}
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Voir les aides
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
