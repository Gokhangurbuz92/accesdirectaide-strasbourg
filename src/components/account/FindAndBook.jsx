// @ts-nocheck
import { useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TEXT_INPUT } from '@/components/layout/catalog';
import { useT } from '@/i18n';
import { frontendEnv } from '@/config/env';
import { bookingOpened, openLinks, parcoursOpened } from '@/lib/publicBeta';
import { COMMUNES, communeFromZip, parsePlace, searchTarget } from '@/lib/findPlace';

/**
 * G14-FIND (owner 23/11/2026) — the « find and book » entry at the top of Mon Espace: one search over the site's real search (aides, démarches, places,
 * ranked by the server: /recherche) with an optional place, then quick links to screens that are open in this build only (openLinks / the publicBeta
 * helpers): a closed screen is never offered. Routing of « Où ? »:
 *   - a commune of the covered territory (Eurométropole de Strasbourg, data/geography/service-territory.v1.json) → its INSEE code (`territoire=`), the
 *     pre-filter /recherche already applies; without words, the directory of that town (/structures?city=);
 *   - a postal code of the Bas-Rhin (67xxx) → the directory filtered on the places' recorded postal code (/structures?zip=). No postal code ↔ commune
 *     table is used: the Insee publishes none, and none is invented;
 *   - anything else → an error that says which places are covered, nothing is sent.
 */
/** @param {{ showGuide?: boolean }} props showGuide: Mon Espace has no tile to show (closed surfaces) — a « Pour commencer » card explains the first steps */
export default function FindAndBook({ showGuide = false }) {
  const { t } = useT('compte');
  const navigate = useNavigate();
  const ids = useId();
  const qRef = useRef(null);
  const whereRef = useRef(null);
  const [q, setQ] = useState('');
  const [where, setWhere] = useState('');
  const [error, setError] = useState(/** @type {'' | 'empty' | 'place'} */ (''));
  const beta = frontendEnv.flags.publicBeta;

  const [busy, setBusy] = useState(false);
  const onSubmit = async (/** @type {import('react').FormEvent} */ e) => {
    e.preventDefault();
    if (busy) return;
    let place = parsePlace(where);
    // a postal code with words: the commune the directory's own addresses give for it, so aides, démarches and places are all searched there
    if (place.kind === 'zip' && q.trim()) {
      setBusy(true);
      const commune = await communeFromZip(place.zip);
      setBusy(false);
      if (commune) place = commune;
    }
    if (place.kind === 'unknown') { setError('place'); whereRef.current?.focus(); return; }
    const target = searchTarget(q, place);
    if (!target) { setError('empty'); qRef.current?.focus(); return; }
    setError('');
    navigate(target);
  };

  // quick links: always-public screens, then Mon Parcours and the booking only when this build opens them; each one also passes openLinks
  const links = openLinks([
    { to: '/orientation', testid: 'find-link-orientation', label: t('compte:find.link.orientation', 'Vérifier mes droits'), hint: t('compte:find.link.orientation_hint', 'Quelques questions, sans compte') },
    { to: '/structures', testid: 'find-link-structures', label: t('compte:find.link.structures', 'Trouver une structure'), hint: t('compte:find.link.structures_hint', 'Lieux d’accueil et d’aide près de chez vous') },
    { to: '/demarches', testid: 'find-link-demarches', label: t('compte:find.link.demarches', 'Démarches'), hint: t('compte:find.link.demarches_hint', 'Comment faire, étape par étape') },
    ...(parcoursOpened(beta) ? [{ to: '/compte/parcours', testid: 'find-link-parcours', label: t('compte:find.link.parcours', 'Mon Parcours'), hint: t('compte:find.link.parcours_hint', 'Suivre mes étapes') }] : []),
    ...(bookingOpened(beta) ? [{ to: '/structures?rdv=1', testid: 'find-link-rdv', label: t('compte:find.link.rdv', 'Prendre rendez-vous'), hint: t('compte:find.link.rdv_hint', 'Lieux où demander un rendez-vous en ligne') }] : []),
  ], beta, (l) => l.to.split('?')[0]);

  const errorId = `${ids}-error`;
  const whereHintId = `${ids}-where-hint`;
  return (
    <section aria-labelledby={`${ids}-title`} className="space-y-4" data-testid="find-and-book">
      <div className="rounded-2xl border border-ada-line bg-ada-surface p-4 shadow-sm sm:p-6">
        <h2 id={`${ids}-title`} className="mb-3 text-xl font-bold text-slate-900">{t('compte:find.title', 'Que cherchez-vous ?')}</h2>
        <form role="search" aria-labelledby={`${ids}-title`} onSubmit={onSubmit} noValidate className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] md:items-start">
          <div>
            <label htmlFor={`${ids}-q`} className="mb-1 block text-sm font-semibold text-slate-900">{t('compte:find.what_label', 'Une aide, une démarche ou une structure')}</label>
            <input id={`${ids}-q`} ref={qRef} type="search" className={TEXT_INPUT} value={q} onChange={(e) => { setQ(e.target.value); if (error === 'empty') setError(''); }}
              placeholder={t('compte:find.what_placeholder', 'Ex. : CAF, logement, CCAS')} autoComplete="off" enterKeyHint="search" maxLength={200}
              aria-invalid={error === 'empty' || undefined} aria-describedby={error === 'empty' ? errorId : undefined} data-testid="find-q" />
          </div>
          <div>
            <label htmlFor={`${ids}-where`} className="mb-1 block text-sm font-semibold text-slate-900">{t('compte:find.where_label', 'Où ? (facultatif)')}</label>
            <input id={`${ids}-where`} ref={whereRef} type="text" className={TEXT_INPUT} value={where} onChange={(e) => { setWhere(e.target.value); if (error === 'place') setError(''); }}
              placeholder={t('compte:find.where_placeholder', 'Commune ou code postal')} autoComplete="off" list={`${ids}-communes`} maxLength={60}
              aria-invalid={error === 'place' || undefined} aria-describedby={[whereHintId, error === 'place' ? errorId : ''].filter(Boolean).join(' ')} data-testid="find-where" />
            <p id={whereHintId} className="mt-1 text-xs text-slate-700">
              {t('compte:find.where_hint', 'Une commune de l’Eurométropole de Strasbourg, ou un code postal du Bas-Rhin (67…).')}
            </p>
            <datalist id={`${ids}-communes`}>
              {COMMUNES.map(([code, name]) => <option key={code} value={name} />)}
            </datalist>
          </div>
          <Button type="submit" className="min-h-11 w-full md:col-span-2 md:w-auto md:justify-self-start xl:col-span-1 xl:mt-7" data-testid="find-submit" aria-busy={busy || undefined}>
            <Search className="me-2 h-4 w-4" aria-hidden="true" />
            {t('compte:find.submit', 'Rechercher')}
          </Button>
          {error ? (
            <p id={errorId} role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900 md:col-span-2 xl:col-span-3" data-testid="find-error">
              {error === 'place'
                ? t('compte:find.error_place', 'Nous ne reconnaissons pas ce lieu. Choisissez une commune de l’Eurométropole de Strasbourg dans la liste, ou un code postal du Bas-Rhin (67…).')
                : t('compte:find.error_empty', 'Écrivez ce que vous cherchez, ou un lieu.')}
            </p>
          ) : null}
        </form>
      </div>

      {links.length > 0 && (
        <nav aria-label={t('compte:find.links_label', 'Accès rapides')}>
          <ul className="grid auto-rows-fr gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {links.map((l) => (
              <li key={l.to}>
                <Link to={l.to} data-testid={l.testid}
                  className="ada-tile h-full min-h-11 items-center justify-between !p-4">
                  <span>
                    <span className="block font-semibold text-ada-ink">{l.label}</span>
                    <span className="block text-sm text-ada-ink-3">{l.hint}</span>
                  </span>
                  <ArrowRight className="rtl-flip h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {showGuide && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 sm:p-5" data-testid="find-guide">
          <h2 className="mb-2 text-lg font-bold text-slate-900">{t('compte:find.guide.title', 'Pour commencer')}</h2>
          <ol className="list-decimal space-y-2 ps-5 text-slate-900">
            <li>{t('compte:find.guide.step1', 'Écrivez ce que vous cherchez dans « Que cherchez-vous ? » : une aide, une démarche ou une structure.')}</li>
            <li>{t('compte:find.guide.step2', 'Ajoutez votre commune pour voir d’abord ce qui est près de chez vous.')}</li>
            <li>{t('compte:find.guide.step3', 'Ouvrez une fiche : elle indique la source officielle et comment contacter la structure.')}</li>
          </ol>
          <p className="mt-3 text-sm text-slate-800">
            {t('compte:find.guide.urgent', 'Besoin d’aide tout de suite ?')}{' '}
            <Link to="/ressources?emergency=1" className="inline-flex min-h-6 font-semibold text-blue-800 underline underline-offset-2" data-testid="find-guide-emergency">
              {t('compte:find.guide.emergency', 'Numéros d’urgence et d’écoute')}
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
