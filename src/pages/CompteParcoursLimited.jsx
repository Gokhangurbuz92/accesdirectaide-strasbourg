// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { PARCOURS_DONE } from '@/lib/monEspace';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { formatDate, useT } from '@/i18n';
import { PLAN_CLOSURES } from '@/lib/parcoursPlan';

/** the longest personal note the server keeps (api/_services/mon-espace.js MAX_PARCOURS_NOTE) */
const NOTE_MAX = 500;
const FR = { lang: 'fr', dir: 'ltr' };

/**
 * G14 — the LIMITED Mon Parcours screen (the server says `contract: 'limited'`, api/_handlers/citizen/parcours.js). The person chooses a step in the
 * reviewed list of generic procedures (data/reference/parcours-step-types.v1.json) — there is no free title — and, if they wish, a published place of an
 * allowed kind found by name or town. A deadline is a date; its source is one of the step's official Service-Public fiches. The personal note exists only
 * where the server opens it (ADA_PARCOURS_NOTES=on). No consent dialog, no plan import, no « organise » form, no free organisation name. All controls
 * are native form elements with visible labels (keyboard and screen-reader use); messages go to a polite live region, refusals to an alert.
 * @param {{ data: any, reload: () => Promise<void> }} props
 */
export default function CompteParcoursLimited({ data, reload }) {
  const { t } = useT('compte');
  const { parcoursStatus: STATUS, parcoursClosure: CLOSURE } = useMonEspaceLabels();
  const types = data.stepTypes?.types || [];
  const domains = data.stepTypes?.domains || {};
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [choice, setChoice] = useState(''); const [query, setQuery] = useState(''); const [places, setPlaces] = useState(null); const [place, setPlace] = useState('');
  const [open, setOpen] = useState(null); const [history, setHistory] = useState({}); const [due, setDue] = useState({ date: '', source: '' });

  const typeOf = (code) => types.find((x) => x.code === code) || null;
  const typeLabel = (code, fallback) => { const ty = typeOf(code); return ty ? t(`compte:parcours.type.${code}`, ty.label) : fallback; };
  const domainLabel = (d) => t(`compte:parcours.domain.${d}`, domains[d] || d);
  const run = async (fn, ok) => {
    setMessage(''); setProblem('');
    try { const out = await fn(); if (ok) setMessage(typeof ok === 'function' ? ok(out) : ok); await reload(); return out; } catch (err) { setProblem(err.message); return null; }
  };
  const search = async (e) => {
    e.preventDefault(); setProblem(''); setPlace('');
    try { const out = await citizenApi.parcoursStructures(choice, query.trim()); setPlaces(out.structures || []); } catch (err) { setPlaces(null); setProblem(err.message); }
  };
  const add = (e) => {
    e.preventDefault();
    const body = { action: 'add', stepType: choice, ...(place ? { structureId: place } : {}) };
    // the form is emptied as soon as the server answers, BEFORE the list is reloaded: a choice made meanwhile is never wiped afterwards
    run(async () => { const out = await citizenApi.parcours(body); setChoice(''); setQuery(''); setPlaces(null); setPlace(''); return out; },
      (out) => (out && out.added === false ? t('compte:parcours.limited.already', 'Cette étape est déjà dans Mon Parcours.') : t('compte:parcours.step_added', 'Étape ajoutée.')));
  };
  const toggle = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDue({ date: '', source: '' });
    try { const h = await citizenApi.parcoursHistory(id); setHistory((x) => ({ ...x, [id]: h.events || [] })); } catch { setHistory((x) => ({ ...x, [id]: [] })); }
  };
  const stateOf = (i) => (i.closure && PLAN_CLOSURES.includes(i.closure) ? i.closure : i.status);
  const stateLabel = (i) => CLOSURE[stateOf(i)] || STATUS[i.status];
  const byDomain = Object.keys(domains).map((d) => ({ d, list: types.filter((x) => x.domain === d) })).filter((g) => g.list.length);
  const chosen = typeOf(choice);
  const newWindow = t('compte:parcours.link_new_window', ' (nouvelle fenêtre)');

  const renderItem = (i) => {
    const ty = typeOf(i.stepType);
    const where = (i.records || []).find((r) => r.type === 'structure');
    return (
      <li key={i.id} data-testid="parcours-item" className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-slate-900" data-testid="parcours-item-title">{typeLabel(i.stepType, i.title)}</p>
            {where ? (where.available
              ? <p className="text-sm text-slate-700" data-testid="parcours-item-place">{t('compte:parcours.limited.place', 'Lieu :')} <Link to={where.href} className="text-blue-800 underline" {...FR}>{where.title}</Link></p>
              : <p className="text-sm text-slate-700" data-testid="parcours-item-place-gone">{t('compte:parcours.limited.place_gone', 'Le lieu choisi n’est plus publié.')}</p>) : null}
            <p className="text-sm text-slate-700" data-testid="parcours-item-status">{stateLabel(i)}{i.dueDate ? ` — ${t('compte:parcours.due_on', 'échéance le {{date}}', { date: formatDate(i.dueDate) })}` : ''}</p>
          </div>
          <Button type="button" size="sm" variant="outline" aria-expanded={open === i.id} aria-controls={`parcours-detail-${i.id}`} onClick={() => toggle(i.id)}>{open === i.id ? t('compte:parcours.close', 'Fermer') : t('compte:parcours.update', 'Mettre à jour')}</Button>
        </div>
        {ty ? (
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm" data-testid="parcours-official-sources">
            {ty.sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-800 underline"><span {...FR}>{`${s.title} — Service-Public`}</span><span className="sr-only">{newWindow}</span></a></li>)}
          </ul>
        ) : null}
        {open === i.id ? (
          <div id={`parcours-detail-${i.id}`} className="mt-3 space-y-3 border-t border-slate-200 pt-3" data-testid="parcours-detail">
            <div>
              <label htmlFor={`st-${i.id}`} className="block text-sm font-medium text-slate-800">{t('compte:parcours.etes_vous', 'Où en êtes-vous ?')}</label>
              <select id={`st-${i.id}`} data-testid="parcours-status-select" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={stateOf(i)}
                onChange={(e) => run(() => citizenApi.parcours({ action: 'status', id: i.id, status: e.target.value }), t('compte:parcours.step_updated', 'Étape mise à jour.'))}>
                {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {data.planSteps ? Object.entries(CLOSURE).map(([v, l]) => <option key={v} value={v}>{l}</option>) : null}
              </select>
            </div>
            {ty ? (
              <form className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]" data-testid="parcours-deadline" onSubmit={(e) => { e.preventDefault(); run(() => citizenApi.parcours({ action: 'deadline', id: i.id, dueDate: due.date, ...(due.source ? { dueSourceUrl: due.source } : {}) }), t('compte:parcours.due_saved', 'Échéance enregistrée.')); }}>
                <div><label htmlFor={`dd-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.echeance', 'Échéance')}</label><input id={`dd-${i.id}`} data-testid="parcours-due-date" type="date" required className="mt-1 w-full rounded-md border border-slate-300 p-2" value={due.date} onChange={(e) => setDue({ ...due, date: e.target.value })} /></div>
                <div>
                  <label htmlFor={`ds-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.limited.due_source', 'Fiche officielle de référence')}</label>
                  <select id={`ds-${i.id}`} data-testid="parcours-due-source" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={due.source || ty.sources[0].url} onChange={(e) => setDue({ ...due, source: e.target.value })}>
                    {ty.sources.map((s) => <option key={s.id} value={s.url} {...FR}>{s.title}</option>)}
                  </select>
                </div>
                <div className="flex items-end"><Button type="submit" size="sm" data-testid="parcours-due-save">{t('compte:parcours.enregistrer', 'Enregistrer')}</Button></div>
              </form>
            ) : null}
            <p className="text-xs text-slate-700" data-testid="parcours-reminder-channels">{data.emailReminders
              ? t('compte:parcours.reminder_channels', 'Rappel d’échéance : par e-mail, selon vos réglages de notification (page Mon profil). Aucun rappel d’échéance n’est envoyé par SMS.')
              : t('compte:parcours.reminder_channels_inapp', 'Rappel d’échéance : dans les notifications de Mon Espace, 7 jours avant. Aucun rappel n’est envoyé par e-mail ni par SMS pour le moment.')}</p>
            {i.dueDate ? <Button type="button" size="sm" variant="outline" onClick={() => run(() => citizenApi.parcours({ action: 'deadline', id: i.id, dueDate: null }), t('compte:parcours.due_removed', 'Échéance retirée.'))}>{t('compte:parcours.retirer_echeance', 'Retirer l’échéance')}</Button> : null}
            {data.notes ? (
              <div>
                <label htmlFor={`nt-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.note_personnelle_visible_par', 'Note personnelle (visible par vous seul)')}</label>
                <p id={`nt-hint-${i.id}`} className="mt-1 text-xs text-slate-700" data-testid="parcours-note-hint">{t('compte:parcours.note_no_health', 'N’écrivez pas d’informations sur votre santé (maladie, handicap, traitement…) : cette note sert seulement à suivre votre démarche. 500 caractères au plus.')}</p>
                <textarea id={`nt-${i.id}`} data-testid="parcours-note" maxLength={NOTE_MAX} aria-describedby={`nt-hint-${i.id}`} className="mt-1 w-full rounded-md border border-slate-300 p-2" defaultValue={i.note || ''}
                  onBlur={(e) => { if ((e.target.value || '') !== (i.note || '')) run(() => citizenApi.parcours({ action: 'note', id: i.id, note: e.target.value || null }), t('compte:parcours.note_saved', 'Note enregistrée.')); }} />
              </div>
            ) : null}
            <div>
              <h3 className="text-sm font-medium text-slate-800">{t('compte:parcours.historique_etape', 'Historique de l’étape')}</h3>
              <ol className="mt-1 space-y-1 text-sm text-slate-700" data-testid="parcours-history">
                {(history[i.id] || []).map((ev, n) => <li key={n}>{formatDate(ev.createdAt, { dateStyle: 'short', timeStyle: 'medium' })} — {ev.kind === 'STATUS' ? `${STATUS[ev.fromStatus] || ''} → ${STATUS[ev.toStatus] || ''}` : ev.kind === 'CREATED' ? t('compte:parcours.ev_created', 'Étape créée') : ev.kind === 'DEADLINE' ? t('compte:parcours.ev_deadline', 'Échéance modifiée') : t('compte:parcours.ev_note', 'Note modifiée')}</li>)}
              </ol>
            </div>
            <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" data-testid="parcours-remove" onClick={() => run(() => citizenApi.removeParcours(i.id), t('compte:parcours.step_removed', 'Étape supprimée.'))}>{t('compte:parcours.supprimer_cette_etape', 'Supprimer cette étape')}</Button>
          </div>
        ) : null}
      </li>
    );
  };
  const active = data.items.filter((i) => !PARCOURS_DONE.includes(i.status));
  const done = data.items.filter((i) => PARCOURS_DONE.includes(i.status));

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-parcours" data-contract="limited">
      <SEO title={t('compte:parcours.mon_parcours', 'Mon Parcours')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:parcours.mon_parcours', 'Mon Parcours')}</h1>
      <p className="text-sm text-slate-700">{t('compte:parcours.suivez_vos_demarches_etape', 'Suivez vos démarches étape par étape. Vous indiquez vous-même où vous en êtes : AccesDirectAide ne prend aucune décision sur vos droits.')}</p>
      <div aria-live="polite" role="status" data-testid="parcours-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="parcours-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <section className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800" data-testid="parcours-limited-notice" aria-labelledby="parcours-limited-notice-title">
        <h2 id="parcours-limited-notice-title" className="font-semibold text-slate-900">{t('compte:parcours.limited.notice_title', 'Ce que Mon Parcours enregistre')}</h2>
        <p className="mt-1">{t('compte:parcours.limited.notice_body', 'Vous choisissez une démarche dans une liste de démarches courantes et, si vous le souhaitez, un lieu public où la faire. Mon Parcours n’enregistre aucun texte libre et ne propose aucune démarche liée à la santé, au handicap, à la justice, au droit au séjour ou à une autre situation sensible : pour celles-ci, parlez-en à une personne qui vous accompagne.')}</p>
        <p className="mt-1">{t('compte:parcours.limited.notice_rights', 'Vos étapes ne sont visibles que par vous : ni une structure, ni un professionnel, ni une personne de confiance n’y a accès. Vous pouvez supprimer une étape à tout moment et télécharger vos données depuis Mon profil.')}</p>
        <p className="mt-1"><Link to="/politique-confidentialite" className="font-medium text-blue-800 underline">{t('compte:parcours.limited.privacy_link', 'En savoir plus sur vos données')}</Link></p>
      </section>

      <Card>
        <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.limited.add_title', 'Ajouter une démarche')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label htmlFor="pc-type" className="block text-sm font-medium text-slate-800">{t('compte:parcours.limited.type_label', 'Démarche')}</label>
            <select id="pc-type" data-testid="parcours-type-select" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={choice} onChange={(e) => { setChoice(e.target.value); setPlaces(null); setPlace(''); }}>
              <option value="">{t('compte:parcours.limited.type_none', 'Choisissez une démarche')}</option>
              {byDomain.map((g) => (
                <optgroup key={g.d} label={domainLabel(g.d)}>
                  {g.list.map((x) => <option key={x.code} value={x.code}>{t(`compte:parcours.type.${x.code}`, x.label)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {chosen ? (
            <form onSubmit={search} className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="parcours-place-search" aria-labelledby="pc-place-title">
              <h3 id="pc-place-title" className="text-sm font-medium text-slate-800">{t('compte:parcours.limited.place_title', 'Lieu (facultatif)')}</h3>
              <label htmlFor="pc-place-q" className="block text-sm text-slate-800">{t('compte:parcours.limited.place_query', 'Nom du lieu ou de la commune')}</label>
              <div className="flex flex-wrap gap-2">
                <input id="pc-place-q" data-testid="parcours-place-query" minLength={2} maxLength={60} className="min-w-[200px] flex-1 rounded-md border border-slate-300 p-2" value={query} onChange={(e) => setQuery(e.target.value)} />
                <Button type="submit" size="sm" variant="outline" data-testid="parcours-place-find" disabled={query.trim().length < 2}>{t('compte:parcours.limited.place_find', 'Chercher')}</Button>
              </div>
              {places ? (places.length ? (
                <fieldset data-testid="parcours-place-results">
                  <legend className="text-sm text-slate-800">{t('compte:parcours.limited.place_pick', 'Choisissez un lieu')}</legend>
                  <div className="mt-1 space-y-1">
                    <label className="flex items-center gap-2 text-sm"><input type="radio" name="pc-place" value="" checked={place === ''} onChange={() => setPlace('')} /> {t('compte:parcours.limited.place_none', 'Aucun lieu')}</label>
                    {places.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="radio" name="pc-place" value={p.id} checked={place === p.id} onChange={() => setPlace(p.id)} /> <span {...FR}>{p.name}{p.town ? ` (${p.town})` : ''}</span></label>)}
                  </div>
                </fieldset>
              ) : <p className="text-sm text-slate-700" data-testid="parcours-place-empty">{t('compte:parcours.limited.place_empty', 'Aucun lieu trouvé pour cette démarche.')}</p>) : null}
            </form>
          ) : null}
          <form onSubmit={add}><Button type="submit" data-testid="parcours-add" disabled={!chosen}>{t('compte:parcours.ajouter', 'Ajouter')}</Button></form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.etapes_cours', 'Étapes en cours')}</CardTitle></CardHeader>
        <CardContent>
          {active.length ? <ul className="space-y-3" data-testid="parcours-active">{active.map(renderItem)}</ul> : <p className="text-sm text-slate-700" data-testid="parcours-empty">{t('compte:parcours.aucune_etape_cours', 'Aucune étape en cours.')}</p>}
        </CardContent>
      </Card>
      {done.length ? (
        <Card><CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.etapes_terminees', 'Étapes terminées')}</CardTitle></CardHeader><CardContent><ul className="space-y-3" data-testid="parcours-done">{done.map(renderItem)}</ul></CardContent></Card>
      ) : null}
    </div>
  );
}
