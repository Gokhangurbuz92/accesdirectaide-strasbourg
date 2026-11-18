import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import SEO from '@/components/SEO';
import HumanHelpBlock from '@/components/HumanHelpBlock';
import { FileQuestion } from 'lucide-react';
import { useT } from '@/i18n';
import FalcPageDraft from '@/components/FalcPageDraft';

/**
 * « Not found » of a page or of a record (aide, démarche, lieu, dispositif, ressource).
 * VIS: the API answers ONE 404 for an unknown record and for a record that exists but is not public right now (awaiting re-verification, on hold,
 * withdrawn) — telling them apart would reveal that a hidden record exists. The record variant therefore says both honestly (« elle n’existe pas, ou
 * elle est en cours de vérification ») and never leaves the person without a next step: search, the list by need, and a person to ask (HumanHelpBlock).
 * @param {{ kind?: 'page' | 'record' }} props
 */
export default function NotFound({ kind = 'page' }) {
  const { t } = useT('layout');
  const record = kind === 'record';
  const title = record ? t('layout:notFound.record.title', 'Fiche non disponible') : t('layout:notFound.title', 'Page introuvable');
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4" data-testid={record ? 'record-not-available' : 'not-found'}>
      <SEO
        title={title}
        description={record
          ? t('layout:notFound.record.description', "Cette fiche n'est pas disponible pour le moment.")
          : t('layout:notFound.description', "La page que vous recherchez n'existe pas.")}
        noindex={true}
      />

      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileQuestion className="h-8 w-8 text-slate-500" aria-hidden="true" />
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>

          <p className="text-slate-600 mb-8">
            {record
              ? t('layout:notFound.record.text', "Cette fiche n'est pas disponible pour le moment. Elle n'existe pas, ou elle est en cours de vérification.")
              : t('layout:notFound.text', "Désolé, la page que vous recherchez n'existe pas ou a été déplacée.")}
          </p>
          {/* FA-D4: simplified provisional draft, when « Facile à lire » is on */}
          {record ? null : <FalcPageDraft id="notFound" />}

          <div className="space-y-3">
            <Button asChild className="w-full">
              <Link to="/recherche">{t('layout:notFound.search', 'Chercher sur le site')}</Link>
            </Button>

            <Button asChild variant="outline" className="w-full">
              <Link to="/besoins">{t('layout:notFound.themes', 'Voir la liste par besoin')}</Link>
            </Button>

            <Button asChild variant="ghost" className="w-full">
              <Link to={createPageUrl('Aides')}>
                {t('layout:seeAides', 'Voir les aides')}
              </Link>
            </Button>

            <Button asChild variant="ghost" className="w-full">
              <Link to={createPageUrl('Home')}>
                {t('layout:backHome', "Retour à l'accueil")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <HumanHelpBlock className="w-full" />
    </div>
  );
}
NotFound.propTypes = { kind: PropTypes.oneOf(['page', 'record']) };
