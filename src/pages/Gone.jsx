import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import SEO from '@/components/SEO';
import HumanHelpBlock from '@/components/HumanHelpBlock';
import { FileX2 } from 'lucide-react';
import { useT } from '@/i18n';

const SECONDARY = 'inline-flex w-full items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100';

/** Withdrawn content (HTTP 410). VIS: French defaults with their accents; next steps (search, list by need) and a person to ask (HumanHelpBlock). */
export default function Gone() {
  const { t } = useT('layout');
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4" data-testid="gone">
      <SEO
        title={t('layout:gone.title', 'Contenu retiré')}
        description={t('layout:gone.description', "Ce contenu a été retiré et n'est plus disponible.")}
        noindex={true}
      />

      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileX2 className="h-8 w-8 text-slate-500" aria-hidden="true" />
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {t('layout:gone.title', 'Contenu retiré')}
          </h1>

          <p className="text-slate-600 mb-8">
            {t('layout:gone.text', "Cette page n'est plus disponible.")}
          </p>

          <div className="space-y-3">
            <Link
              to="/recherche"
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              {t('layout:notFound.search', 'Chercher sur le site')}
            </Link>

            <Link to="/besoins" className={SECONDARY}>{t('layout:notFound.themes', 'Voir la liste par besoin')}</Link>

            <Link to={createPageUrl('Aides')} className={SECONDARY}>
              {t('layout:seeAides', 'Voir les aides')}
            </Link>

            <Link to={createPageUrl('Home')} className={SECONDARY}>
              {t('layout:backHome', "Retour à l'accueil")}
            </Link>
          </div>
        </div>
      </div>
      <HumanHelpBlock className="w-full" />
    </div>
  );
}
