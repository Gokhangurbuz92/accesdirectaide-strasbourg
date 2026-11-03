
import SEO from '@/components/SEO';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Wizard from '@/components/assistant/Wizard';

import { useT } from '@/i18n';
export default function Orientation() {
  const { t } = useT('diagnostic');
  return (
    <div className="min-h-screen bg-slate-50">
      <SEO
        title={t('diagnostic:orientation.mon_assistant', "Mon Assistant")}
        description={t('diagnostic:orientation.assistant_d_orientation_pour_trouver', "Assistant d'orientation pour trouver les aides et démarches adaptées à votre situation.")}
        path="/orientation"
        noindex
      />
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="mb-2 text-3xl font-black text-slate-900 uppercase italic">{t('diagnostic:orientation.mon_assistant', "Mon Assistant")}</h1>
        <p className="mb-6 text-slate-700 font-medium">
          {t('diagnostic:orientation.repondez_a_quelques_questions_pour', "Répondez à quelques questions pour recevoir des recommandations personnalisées.")}
        </p>

        <Wizard />

        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/aides">
            <Button variant="outline">{t('diagnostic:orientation.voir_toutes_les_aides', "Voir toutes les aides")}</Button>
          </Link>
          <Link to="/demarches">
            <Button variant="outline">{t('diagnostic:orientation.voir_les_demarches', "Voir les demarches")}</Button>
          </Link>
          <Link to="/annuaire">
            <Button variant="outline" className="gap-2">
              {t('diagnostic:orientation.voir_l_annuaire', "Voir l'annuaire")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
