
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import SEO from '@/components/SEO';
import { FileQuestion } from 'lucide-react';
import { useT } from '@/i18n';

export default function NotFound() {
  const { t } = useT('layout');
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO
        title={t('layout:notFound.title', 'Page introuvable')}
        description={t('layout:notFound.description', "La page que vous recherchez n'existe pas.")}
        noindex={true}
      />

      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileQuestion className="h-8 w-8 text-slate-500" />
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {t('layout:notFound.title', 'Page introuvable')}
          </h1>

          <p className="text-slate-600 mb-8">
            {t('layout:notFound.text', "Désolé, la page que vous recherchez n'existe pas ou a été déplacée.")}
          </p>

          <div className="space-y-3">
            <Button asChild className="w-full">
              <Link to={createPageUrl('Home')}>
                {t('layout:backHome', "Retour à l'accueil")}
              </Link>
            </Button>

            <Button asChild variant="ghost" className="w-full">
              <Link to={createPageUrl('Aides')}>
                {t('layout:seeAides', 'Voir les aides')}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
