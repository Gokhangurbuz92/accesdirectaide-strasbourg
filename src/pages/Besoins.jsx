import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Phone } from 'lucide-react';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import { useT } from '@/i18n';
import reference from '../../data/reference/social-domains.v1.json';
import coverage from '../../data/reference/social-coverage.v1.json';

/**
 * Extension R32 — « Trouver de l'aide par besoin »: entry by need, built on the versioned social-sector reference (data/reference). Honest by
 * construction: the official emergency numbers first; then each need shows ONLY the sub-needs for which the verified catalogue has published
 * content or places (data/reference/social-coverage.v1.json, measured), each opening the ordinary search on its words. A need with nothing
 * published says so instead of looking served. Labels are translated (namespace « reference »); the search itself runs on the French catalogue.
 */
/** @type {(keyof typeof reference.emergency)[]} */
const EMERGENCY_ORDER = ['112', '15', '17', '115', '119', '3919', '3114', '3133', '114', '116006', '0800059595'];
const status = Object.fromEntries(coverage.rows.map((r) => [r.subdomain, r]));
const tel = (/** @type {string} */ n) => (n.length === 10 && n.startsWith('0') ? `${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : n.length === 6 ? `${n.slice(0, 3)} ${n.slice(3)}` : n);

export default function Besoins() {
  const { t } = useT('reference');
  const navigate = useNavigate();
  const [situation, setSituation] = useState('');
  const label = (/** @type {'domain' | 'sub'} */ kind, /** @type {string} */ id, /** @type {string} */ fr) => t(`reference:${kind}.${id}`, fr);   // keys required by scripts/i18n-check.mjs from the reference file
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <SEO title={t('reference:page.title', 'Trouver de l’aide par besoin')} description={t('reference:page.description', 'Les besoins sociaux et médico-sociaux, avec les fiches vérifiées et les lieux d’accueil publiés pour Strasbourg et le Bas-Rhin.')} path="/besoins" />
      <PageHeader title={t('reference:page.title', 'Trouver de l’aide par besoin')} description={t('reference:page.intro', 'Choisissez ce qui vous concerne. Seules les fiches vérifiées et les lieux publiés sont proposés : un besoin sans fiche le dit clairement.')} />

      {/* R37: several problems at once → the search reads every need of the sentence, most urgent first (api/lib/multi-need.js); nothing is stored */}
      <form role="search" className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="needs-situation-form"
        onSubmit={(e) => { e.preventDefault(); const q = situation.trim(); if (q.length >= 2) navigate(`/recherche?q=${encodeURIComponent(q)}`); }}>
        <label htmlFor="needs-situation" className="block text-base font-semibold text-slate-900">{t('reference:situation.label', 'Décrivez votre situation, avec vos mots')}</label>
        <p id="needs-situation-hint" className="mt-1 text-sm text-slate-700">{t('reference:situation.hint', 'Vous pouvez écrire plusieurs problèmes à la fois, par exemple : « loyer impayé, on va me couper l’électricité, j’ai deux enfants ». Ce que vous écrivez n’est pas enregistré.')}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <textarea id="needs-situation" aria-describedby="needs-situation-hint" rows={2} value={situation} onChange={(e) => setSituation(e.target.value)} maxLength={300}
            className="min-h-11 flex-1 rounded-md border border-slate-300 p-2 text-base focus:outline-none focus:ring-2 focus:ring-brand-primary" />
          <button type="submit" className="ada-target min-h-11 rounded-md bg-brand-primary px-5 font-semibold text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2">{t('reference:situation.submit', 'Voir les pistes')}</button>
        </div>
      </form>

      <section aria-labelledby="urgences" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
        <h2 id="urgences" className="text-lg font-semibold text-red-900">{t('reference:emergency.title', 'En cas d’urgence ou de danger')}</h2>
        <p className="mt-1 text-sm text-red-900">{t('reference:emergency.intro', 'Ces numéros officiels sont gratuits. AccesDirectAide ne peut pas intervenir lui-même en urgence.')}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {EMERGENCY_ORDER.map((n) => (
            <li key={n} className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 shrink-0 text-red-800" aria-hidden="true" />
              <a href={`tel:${n}`} className="ada-target font-semibold text-red-900 underline" dir="ltr">{tel(n)}</a>
              <span lang="fr">{reference.emergency[n]}</span>
            </li>
          ))}
        </ul>
      </section>

      <ul className="mt-8 space-y-3">
        {reference.domains.map((d) => {
          const shown = d.subdomains.filter((s) => status[s.id] && status[s.id].status !== 'TAXONOMY_ONLY');
          return (
            <li key={d.id}>
              <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`need-${d.id}`}>
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-base font-semibold text-slate-900">
                  <span>{label('domain', d.id, d.fr)}</span>
                  <span className="text-sm font-normal text-slate-600">{t('reference:count', { count: shown.length, defaultValue_one: '{{count}} sujet avec des fiches', defaultValue_other: '{{count}} sujets avec des fiches' })}</span>
                </summary>
                {shown.length ? (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {shown.map((s) => (
                      <li key={s.id}>
                        <Link to={`/recherche?q=${encodeURIComponent(s.keywords[0])}`} className="flex min-h-11 items-center justify-between gap-3 py-2 text-slate-900 hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary">
                          <span>{label('sub', s.id, s.fr)}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 rtl-flip" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-700">{t('reference:none', 'Pas encore de fiche vérifiée pour ce besoin. Un lieu d’accueil social (CCAS, Maison des solidarités, France Services) peut vous orienter.')}</p>
                )}
              </details>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm text-slate-600">{t('reference:note', 'Cette liste des besoins suit les classifications officielles du secteur social et médico-social. Elle ne dit pas qu’une aide vous est due : seul l’organisme concerné décide.')}</p>
    </div>
  );
}
