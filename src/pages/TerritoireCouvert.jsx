import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Info, MapPin } from 'lucide-react';

import SEO from '@/components/SEO';
import serviceTerritory from '../../data/geography/service-territory.v1.json';

/**
 * PKG-11 / P28 · P07 — the territorial entry point: the communes the local catalogue serves, as INSEE lists them for the Eurométropole de Strasbourg
 * (data/geography/service-territory.v1.json, derived from the official reference without editing a value). The list says where it comes from and that it
 * still awaits a person's validation; each commune opens the directory filtered on the structures LOCATED there (a location, never a claim that they serve
 * the person). Outside these communes the assistant says it has no verified local information.
 * PKG-11 / E05: a separate picker opens the directory on the places that SERVE a commune (reviewed service area, `serves=` INSEE code).
 */
const communes = /** @type {[string, string][]} */ (serviceTerritory.communes);
const validated = serviceTerritory.validation?.status === 'VALIDATED';

export default function TerritoireCouvert() {
  const navigate = useNavigate();
  const [serves, setServes] = useState('');
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <SEO title="Territoire couvert — AccesDirectAide" description={`Les ${communes.length} communes de l'${serviceTerritory.libelle} couvertes par AccesDirectAide.`} />
      <h1 className="text-3xl font-bold text-slate-900">Territoire couvert</h1>
      <p className="text-lg text-slate-800">
        AccesDirectAide présente pour l'instant des informations locales pour les {communes.length} communes de l'{serviceTerritory.libelle}.
        Pour une autre commune, renseignez-vous auprès de votre mairie ou de votre CCAS.
      </p>

      <section aria-labelledby="territoire-source" className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-slate-900" data-testid="territoire-source">
        <h2 id="territoire-source" className="mb-2 flex items-center gap-2 text-base font-semibold">
          <Info className="h-5 w-5" aria-hidden="true" /> D'où vient cette liste ?
        </h2>
        <p>
          Liste établie à partir des données publiées par l'Insee (Code officiel géographique et composition des intercommunalités au 1er janvier {serviceTerritory.derivedFrom.cogVersion}).
        </p>
        <p className="mt-2 font-medium" data-testid="territoire-validation">
          {validated ? 'Cette liste a été vérifiée par une personne.' : "Cette liste n'a pas encore été vérifiée par une personne de l'équipe."}
        </p>
      </section>

      <section aria-labelledby="territoire-communes">
        <h2 id="territoire-communes" className="mb-3 text-xl font-semibold text-slate-900">Les communes</h2>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="territoire-communes">
          {communes.map(([code, nom]) => (
            <li key={code}>
              <Link
                to={`/structures?city=${encodeURIComponent(nom)}`}
                className="flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                data-commune={code}
              >
                <MapPin className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                <span>{nom}</span>
                <span className="sr-only"> : structures situées dans cette commune</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-slate-700">
          Le nom de la commune ouvre l'annuaire des structures situées dans la commune. Être situé dans une commune ne veut pas dire servir toutes ses habitantes et tous ses habitants : vérifiez auprès de la structure.
        </p>
      </section>

      {/* PKG-11 / E05: the places that SERVE a commune (service area declared by the structure and reviewed by ADA) — a different fact from being located there */}
      <section aria-labelledby="territoire-serves-title" className="rounded-lg border border-slate-300 bg-white p-4" data-testid="territoire-serves">
        <h2 id="territoire-serves-title" className="mb-2 text-xl font-semibold text-slate-900">Lieux qui desservent une commune</h2>
        <p className="mb-3 text-sm text-slate-700">
          Ne montre que les structures dont la zone d'intervention, déclarée par la structure, a été vérifiée par ADA. Une structure peut desservir une commune sans y être située.
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (serves) navigate(`/structures?serves=${encodeURIComponent(serves)}`); }}
        >
          <div className="flex-1">
            <label htmlFor="territoire-serves-commune" className="mb-1 block text-sm font-medium text-slate-900">Commune</label>
            <select id="territoire-serves-commune" className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-900" value={serves} onChange={(e) => setServes(e.target.value)} required>
              <option value="">Choisissez une commune</option>
              {communes.map(([code, nom]) => <option key={code} value={code}>{nom}</option>)}
            </select>
          </div>
          <button type="submit" className="min-h-11 rounded-md bg-teal-800 px-4 font-medium text-white hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2">
            Voir les lieux qui la desservent
          </button>
        </form>
      </section>
    </div>
  );
}
