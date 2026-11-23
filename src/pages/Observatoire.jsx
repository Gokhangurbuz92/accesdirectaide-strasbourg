import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import ObservatoireData from '@/components/observatoire/ObservatoireData';
import { useT } from '@/i18n';
import { OBSERVATOIRE_API, OBSERVATOIRE_CSV, loadObservatoire, observatoireOpened } from '@/lib/observatoire';

/**
 * G14-OBS — /observatoire: « which rights are searched for in Strasbourg and the Eurométropole, and where published services are missing », from anonymous
 * aggregated signals only (GET /api/public/observatoire). FALC French first (short sentences, one idea each); the method and its limits are always shown,
 * even before the opening; the data only when the build sets VITE_OBSERVATOIRE=open. Never a non-take-up rate, never « people helped ».
 * @param {{ load?: () => Promise<any>, opened?: boolean }} props (tests inject both)
 */
export default function Observatoire({ load = loadObservatoire, opened = observatoireOpened() }) {
  const { t } = useT('observatory');
  const [data, setData] = useState(/** @type {any} */ (opened ? undefined : null));
  useEffect(() => { if (!opened) return undefined; let live = true; load().then((d) => { if (live) setData(d); }); return () => { live = false; }; }, [load, opened]);

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO title={t('observatory:seo_title', 'Observatoire des droits et des services')}
        description={t('observatory:seo_description', 'Les droits recherchés à Strasbourg et dans l’Eurométropole, et les lieux publiés : des signaux anonymes du site, pas une mesure officielle du non-recours.')}
        path="/observatoire" />
      <PageHeader title={t('observatory:title', 'Observatoire des droits et des services')}
        description={t('observatory:description', 'Quels droits les personnes cherchent-elles à Strasbourg et dans l’Eurométropole ? Où manque-t-il des lieux d’aide publiés ?')} />

      <div className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
        <section aria-labelledby="obs-brief" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 id="obs-brief" className="text-xl font-bold text-slate-900">{t('observatory:brief.title', 'En bref')}</h2>
          <ul className="mt-3 list-disc space-y-2 ps-5 text-slate-800">
            <li>{t('observatory:brief.1', 'Nous comptons ce que les personnes cherchent sur le site.')}</li>
            <li>{t('observatory:brief.2', 'Nous ne gardons aucun nom, aucun texte écrit, aucune adresse IP.')}</li>
            <li>{t('observatory:brief.3', 'Nous comparons ces recherches avec les lieux d’aide publiés.')}</li>
            <li>{t('observatory:brief.4', 'Les petits nombres sont cachés pour protéger les personnes.')}</li>
          </ul>
          <div role="note" className="mt-4 rounded-xl border-s-4 border-amber-600 bg-amber-50 p-4 text-slate-900" data-testid="obs-caveat">
            <p className="font-semibold">{t('observatory:caveat.title', 'Attention')}</p>
            <p className="mt-1">{t('observatory:caveat.text', 'Ce sont des signaux d’usage du site, pas une mesure du non-recours officiel. Ce ne sont pas des statistiques officielles. Une recherche n’est pas une personne, et la plupart des personnes ne passent pas par le site.')}</p>
          </div>
        </section>

        {!opened && (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 shadow-sm" data-testid="obs-closed">
            {t('observatory:closed', 'L’Observatoire n’est pas encore ouvert : aucun chiffre n’est publié pour l’instant.')}{' '}
            <Link to="/impact" className="font-semibold text-blue-700 underline">{t('observatory:closed_link', 'Voir ce que nous publions aujourd’hui')}</Link>
          </p>
        )}
        {opened && data === undefined && <p role="status" className="text-slate-700">{t('observatory:loading', 'Chargement de l’Observatoire…')}</p>}
        {opened && data === null && <p role="status" className="text-slate-800" data-testid="obs-unavailable">{t('observatory:unavailable', 'L’Observatoire ne peut pas être lu pour le moment. Réessayez plus tard.')}</p>}
        {opened && data && <ObservatoireData data={data} />}

        {opened && (
          <section aria-labelledby="obs-open-data" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="obs-open-data">
            <h2 id="obs-open-data" className="text-xl font-bold text-slate-900">{t('observatory:open_data.title', 'Télécharger les données')}</h2>
            <p className="mt-2 text-slate-700">{t('observatory:open_data.text', 'Les mêmes chiffres, sans les valeurs masquées, sont libres de réutilisation sous la Licence Ouverte 2.0 (Etalab). Citez « AccesDirectAide, Observatoire » et la date de gel.')}</p>
            <ul className="mt-3 space-y-2">
              <li><a href={OBSERVATOIRE_CSV} download className="font-semibold text-blue-700 underline">{t('observatory:open_data.csv', 'Fichier CSV (tableur)')}</a></li>
              <li><a href={OBSERVATOIRE_API} className="font-semibold text-blue-700 underline">{t('observatory:open_data.json', 'Données JSON (pour les services informatiques)')}</a></li>
              <li><a href="/api/docs/openapi.json" className="font-semibold text-blue-700 underline">{t('observatory:open_data.api', 'Description de l’API (OpenAPI)')}</a></li>
              <li><a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/" rel="noopener noreferrer" target="_blank" className="font-semibold text-blue-700 underline">{t('observatory:open_data.licence', 'Licence Ouverte 2.0 (nouvelle fenêtre)')}</a></li>
            </ul>
          </section>
        )}

        <section aria-labelledby="methode" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="obs-method">
          <h2 id="methode" className="text-xl font-bold text-slate-900">{t('observatory:method.title', 'Méthode et limites')}</h2>
          <dl className="mt-3 space-y-3 text-slate-800">
            <div><dt className="font-semibold">{t('observatory:method.nature_title', 'Ce que c’est')}</dt><dd>{t('observatory:method.nature', 'Ce sont des signaux d’usage du site AccesDirectAide, pas une mesure du non-recours officiel. Ce ne sont pas des statistiques officielles.')}</dd></div>
            <div><dt className="font-semibold">{t('observatory:method.count_title', 'Ce qui est compté')}</dt><dd>{t('observatory:method.count', 'Chaque signal compte un événement (une recherche, un choix de situation, une étape ajoutée), pas une personne : une même personne peut en produire plusieurs, et la plupart des personnes ne passent pas par le site.')}</dd></div>
            <div><dt className="font-semibold">{t('observatory:method.privacy_title', 'Ce qui n’est jamais gardé')}</dt><dd>{t('observatory:method.privacy', 'Aucun texte saisi, aucun identifiant, aucune adresse IP, aucune heure ne sont enregistrés : seulement un code de liste fermée, un jour et, pour les recherches, une commune de l’Eurométropole (jamais pour un sujet sensible). Les comptes du jour sont supprimés dès que le trimestre est figé.')}</dd></div>
            <div><dt className="font-semibold">{t('observatory:method.situation_title', 'Les situations choisies')}</dt><dd>{t('observatory:method.situation', 'La page « Ma situation » n’envoie rien, sauf si la personne coche la case pour aider l’Observatoire. Seul le nom de la situation est alors envoyé, sans rien d’autre.')}</dd></div>
            <div><dt className="font-semibold">{t('observatory:method.suppression_title', 'Les petits nombres')}</dt><dd>{t('observatory:method.suppression', 'Une valeur inférieure à 5 (zéro compris) est « masquée » ; quand une seule valeur est masquée dans un tableau, une autre l’est aussi, pour qu’on ne puisse pas la retrouver par soustraction ; une commune n’est détaillée que pour un domaine d’au moins 20 recherches dans le trimestre ; les totaux sont des sommes de valeurs publiées.')}</dd></div>
            <div><dt className="font-semibold">{t('observatory:method.supply_title', 'Les lieux publiés')}</dt><dd>{t('observatory:method.supply', 'L’offre compte les lieux d’accueil publiés dans l’annuaire du site (vérifiés sur une source officielle), classés par domaine d’après leur type et les services qu’ils déclarent. Un lieu non publié n’est pas compté ; un lieu peut servir plusieurs communes et plusieurs domaines.')}</dd></div>
            <div><dt className="font-semibold">{t('observatory:method.gaps_title', 'Les pistes')}</dt><dd>{t('observatory:method.gaps', 'Un « écart » rapproche les recherches d’un domaine et les lieux publiés de ce domaine. C’est une piste à vérifier sur le terrain, pas un besoin non couvert : l’annuaire est incomplet et une recherche n’est pas un besoin.')}</dd></div>
            <div><dt className="font-semibold">{t('observatory:method.freeze_title', 'Les trimestres')}</dt><dd>{t('observatory:method.freeze', 'Seuls les trimestres civils terminés sont publiés, une seule fois, à leur date de gel ; ils ne changent plus ensuite.')}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
Observatoire.propTypes = { load: PropTypes.func, opened: PropTypes.bool };
