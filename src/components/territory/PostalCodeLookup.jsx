import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';

import { useLanguage, useT } from '@/i18n';

/**
 * R46 / P07 — « Trouver ma commune par code postal »: GET /api/territory/postal (La Poste « Base officielle des codes postaux », matched to the INSEE COG,
 * and the ANCT list of the 2024 quartiers prioritaires). A postal code covering several communes lists them all and the person chooses — never the first
 * one; a commune outside the Eurométropole is said to be outside; the QPV list says which quartiers the commune COUNTS, never that the person's address is
 * in one (the official address lookup is sig.ville.gouv.fr). Every state is said: invalid, unknown, outage with retry, loading. The page keeps nothing (the
 * router's request log records the query string like any GET, api/index.js), so the page makes no « not recorded » promise.
 */
/** @typedef {{ code: string, nom: string, departement: string | null, inServiceTerritory: boolean, quartiersPrioritaires: { code: string, libelle: string }[] }} Candidate */

export default function PostalCodeLookup() {
  const { t } = useT('home');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  const [code, setCode] = useState('');
  const [state, setState] = useState(/** @type {'idle' | 'loading' | 'invalid' | 'unknown' | 'error' | 'done'} */ ('idle'));
  const [result, setResult] = useState(/** @type {{ status: string, postalCode: string, candidates: Candidate[], officialQpvLookup: string, source: any, qpvSource: any } | null} */ (null));
  const statusRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  const lookup = async (/** @type {string} */ value) => {
    const cp = value.replace(/\s+/g, '');
    if (!/^\d{5}$/.test(cp)) { setResult(null); setState('invalid'); return; }
    setState('loading');
    try {
      const res = await fetch(`/api/territory/postal?code=${encodeURIComponent(cp)}`, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => null);
      if (res.status === 400) { setResult(null); setState('invalid'); return; }
      if (!res.ok || !data) { setResult(null); setState('error'); return; }
      if (data.status === 'UNKNOWN_POSTAL_CODE') { setResult(null); setState('unknown'); return; }
      if ((data.status === 'SINGLE' || data.status === 'MULTIPLE') && Array.isArray(data.candidates)) { setResult(data); setState('done'); return; }
      setResult(null); setState('error');
    } catch {
      setResult(null); setState('error');
    } finally {
      requestAnimationFrame(() => statusRef.current?.focus());
    }
  };

  const readAt = result?.source?.readAt ? new Date(`${result.source.readAt}T00:00:00Z`).toLocaleDateString(isSource ? 'fr-FR' : undefined, { timeZone: 'UTC' }) : '';

  return (
    <section aria-labelledby="territoire-postal-title" className="rounded-lg border border-slate-300 bg-white p-4" data-testid="territoire-postal">
      <h2 id="territoire-postal-title" className="mb-2 text-xl font-semibold text-slate-900">{t('home:territory.postal.title', 'Trouver ma commune par code postal')}</h2>
      <p className="mb-3 text-sm text-slate-700">{t('home:territory.postal.text', 'Un code postal peut couvrir plusieurs communes : vous choisissez toujours la vôtre.')}</p>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
        <div className="flex-1">
          <label htmlFor="territoire-postal-code" className="mb-1 block text-sm font-medium text-slate-900">{t('home:territory.postal.label', 'Code postal (5 chiffres)')}</label>
          <input
            id="territoire-postal-code"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            dir="ltr"
            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-900"
            value={code}
            onChange={(e) => { setCode(e.target.value); if (state === 'invalid') setState('idle'); }}
            aria-invalid={state === 'invalid' ? 'true' : undefined}
            aria-describedby={state === 'invalid' ? 'territoire-postal-invalid' : undefined}
            data-testid="territoire-postal-input"
          />
        </div>
        <button type="submit" disabled={state === 'loading'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-800 px-4 font-medium text-white hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-70" data-testid="territoire-postal-submit">
          <Search className="h-4 w-4" aria-hidden="true" /> {t('home:territory.postal.submit', 'Chercher')}
        </button>
      </form>

      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="mt-3 outline-none" data-testid="territoire-postal-status" data-state={state}>
        {state === 'loading' && <p className="text-slate-700">{t('home:territory.postal.loading', 'Recherche en cours…')}</p>}
        {state === 'invalid' && <p id="territoire-postal-invalid" className="font-medium text-red-800">{t('home:territory.postal.invalid', 'Saisissez un code postal de 5 chiffres, par exemple 67000.')}</p>}
        {state === 'unknown' && <p className="text-slate-900">{t('home:territory.postal.unknown', 'Ce code postal ne figure pas dans la base officielle de La Poste. Vérifiez-le, ou cherchez votre commune dans la liste ci-dessous.')}</p>}
        {state === 'error' && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="text-slate-900">{t('home:territory.postal.error', 'La recherche n\'a pas pu aboutir. Vous pouvez réessayer, ou choisir votre commune dans la liste ci-dessous.')}</p>
            <button type="button" onClick={() => lookup(code)} className="min-h-11 rounded-md border border-slate-400 bg-white px-3 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700" data-testid="territoire-postal-retry">
              {t('home:territory.postal.retry', 'Réessayer')}
            </button>
          </div>
        )}
        {state === 'done' && result && (
          <div className="space-y-3">
            <p className="font-medium text-slate-900" data-testid="territoire-postal-summary">
              {result.status === 'MULTIPLE'
                ? t('home:territory.postal.multiple', 'Le code postal {{code}} couvre plusieurs communes. Choisissez la vôtre :', { code: result.postalCode })
                : t('home:territory.postal.single', 'Le code postal {{code}} correspond à une seule commune :', { code: result.postalCode })}
            </p>
            <ul className="space-y-2" data-testid="territoire-postal-candidates">
              {result.candidates.map((c) => (
                <li key={c.code} className="rounded-md border border-slate-300 p-3" data-commune={c.code} data-in-territory={c.inServiceTerritory ? 'yes' : 'no'}>
                  <p className="font-semibold text-slate-900"><span {...fr}>{c.nom}</span>{c.departement ? <span className="font-normal text-slate-700"> ({c.departement})</span> : null}</p>
                  {c.inServiceTerritory ? (
                    <p className="mt-1 text-slate-800">
                      {t('home:territory.postal.inside', 'Cette commune fait partie du territoire couvert.')}{' '}
                      <Link to={`/structures?city=${encodeURIComponent(c.nom)}`} className="font-medium text-teal-800 underline">{t('home:territory.postal.open-directory', 'Voir les structures situées dans cette commune')}</Link>
                    </p>
                  ) : (
                    <p className="mt-1 text-slate-800">{t('home:territory.postal.outside', 'Cette commune n\'est pas dans le territoire couvert pour l\'instant : AccesDirectAide n\'y a pas d\'informations locales vérifiées. Renseignez-vous auprès de votre mairie ou de votre CCAS ; les aides nationales restent consultables.')}</p>
                  )}
                  {c.quartiersPrioritaires.length > 0 ? (
                    <div className="mt-2 text-sm text-slate-800">
                      <p>{t('home:territory.postal.qpv-list', 'Quartiers prioritaires de la politique de la ville listés pour cette commune (liste officielle 2024) :')}</p>
                      <ul className="ms-5 list-disc" {...fr}>
                        {c.quartiersPrioritaires.map((q) => <li key={q.code}>{q.libelle}</li>)}
                      </ul>
                      <p className="mt-1">
                        {t('home:territory.postal.qpv-address', 'Ce site ne sait pas si votre adresse se trouve dans l\'un de ces quartiers. Pour le vérifier, utilisez la recherche par adresse du site officiel :')}{' '}
                        <a href={result.officialQpvLookup} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-800 underline" dir="ltr">{result.officialQpvLookup.replace(/^https?:\/\//, "")}</a>
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-700">{t('home:territory.postal.qpv-none', 'Aucun quartier prioritaire de la politique de la ville n\'est listé pour cette commune (liste officielle 2024).')}</p>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-700" data-testid="territoire-postal-source">
              {t('home:territory.postal.source', 'Sources : La Poste, « Base officielle des codes postaux » ; Agence nationale de la cohésion des territoires, liste des quartiers prioritaires 2024 (Licence Ouverte). Données lues le {{date}}.', { date: readAt })}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
