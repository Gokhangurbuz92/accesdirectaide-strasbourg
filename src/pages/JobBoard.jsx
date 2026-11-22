// @ts-nocheck
/**
 * X05 (expansion) — /offres-emploi: the inclusive job board (GET /api/employment). Published listings of employers verified by ADA, until their end date.
 * Each listing shows the post, the contract, the place, the inclusive accommodations the employer states, the description and the EMPLOYER'S OWN way to apply
 * (a web address or an e-mail): the person applies there directly. ADA receives and keeps nothing about applicants — the page says so, and that no detail
 * about health or a disability is needed to apply. The employer's texts stay in French (lang="fr" outside French, R47). Nothing here is a sample: an empty
 * list says so. Closed by default: the API answers 503 and the page says the function is not open yet.
 */
import { useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { formatDate, useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { accommodationLabel, contractLabel } from '@/lib/jobBoard';
import ReportContentLink from '@/components/moderation/ReportContentLink';

/** the employer's channel: an https address opens in a new tab without referrer; an e-mail opens the person's own mail program */
function ApplyLink({ item }) {
  const { t } = useT('employment');
  const fr = useFrAttrs();
  const label = t('employment:list.apply', 'Postuler auprès de l’employeur');
  if (item.applyMethod === 'email') {
    return <p className="text-sm text-slate-900">{label} : <a className="font-medium text-blue-800 underline" href={`mailto:${item.applyTarget}`} {...fr}>{item.applyTarget}</a></p>;
  }
  return (
    <p className="text-sm">
      <a className="font-medium text-blue-800 underline" href={item.applyTarget} target="_blank" rel="noopener noreferrer nofollow">
        {label}<span className="sr-only"> ({t('employment:list.new_tab', 'site de l’employeur, nouvel onglet')})</span>
      </a>
    </p>
  );
}

export default function JobBoard() {
  const { t } = useT('employment');
  const fr = useFrAttrs();
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/employment').then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (res.ok) setState({ loading: false, items: body.items || [], error: null });
      else setState({ loading: false, items: [], error: res.status === 503 ? 'closed' : 'failed' });
    }).catch(() => { if (alive) setState({ loading: false, items: [], error: 'failed' }); });
    return () => { alive = false; };
  }, [attempt]);

  const title = t('employment:list.title', 'Offres d’emploi inclusives');
  const intro = t('employment:list.intro', 'Des offres d’emploi publiées par des structures vérifiées par l’équipe ADA, après relecture. Chaque offre indique les aménagements que l’employeur propose.');
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="jobs-page">
      <SEO title={title} description={intro} path="/offres-emploi" />
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        <p className="text-slate-700">{intro}</p>
        <div className="space-y-1 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800" data-testid="jobs-privacy-notice">
          <p>{t('employment:list.privacy', 'ADA ne reçoit pas votre candidature et ne garde rien à votre sujet : vous postulez directement auprès de l’employeur, par le moyen qu’il indique.')}</p>
          <p>{t('employment:list.health', 'Pour postuler, aucune information sur votre santé ou un handicap n’est nécessaire. Si vous avez besoin d’un aménagement, c’est vous qui choisissez si et quand vous en parlez.')}</p>
          <p>{t('employment:list.no_promise', 'Une offre ne garantit pas une embauche : l’employeur choisit seul.')}</p>
        </div>
      </header>
      {state.loading && <p role="status">{t('employment:loading', 'Chargement…')}</p>}
      {state.error === 'closed' && <p role="status" data-testid="jobs-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{t('employment:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error === 'failed' && (
        <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
          <p>{t('employment:failed', 'Les offres n’ont pas pu être chargées.')}</p>
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('employment:retry', 'Réessayer')}</Button>
        </div>
      )}
      {!state.loading && !state.error && state.items.length === 0 && <p data-testid="jobs-empty" className="text-slate-700">{t('employment:list.empty', 'Aucune offre publiée pour le moment.')}</p>}
      {state.items.length > 0 && (
        <ul className="space-y-4" data-testid="jobs-list">
          {state.items.map((x) => (
            <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <article aria-labelledby={`job-title-${x.id}`} className="space-y-2">
                <h2 id={`job-title-${x.id}`} className="text-lg font-semibold text-slate-900" {...fr}>{x.title}</h2>
                <p className="text-sm text-slate-800"><span {...fr}>{x.employerName}</span> — <span {...fr}>{x.city}</span> ({x.postalCode})</p>
                <p className="text-sm text-slate-800">{contractLabel(x.contractType, t)}</p>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{t('employment:list.accommodations', 'Aménagements proposés par l’employeur')}</h3>
                  <ul className="list-disc ps-5 text-sm text-slate-800">{x.accommodations.map((a) => <li key={a}>{accommodationLabel(a, t)}</li>)}</ul>
                </div>
                <div className="whitespace-pre-line leading-relaxed text-slate-900" {...fr}>{x.description}</div>
                <ApplyLink item={x} />
                <p className="text-xs text-slate-700">{t('employment:list.until', 'Offre visible jusqu’au')} <time dateTime={x.expiresOn}>{formatDate(x.expiresOn, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
              </article>
            </li>
          ))}
        </ul>
      )}
      <ReportContentLink />
    </div>
  );
}
