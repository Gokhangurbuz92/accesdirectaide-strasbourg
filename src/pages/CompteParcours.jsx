// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { PARCOURS_DONE } from '@/lib/monEspace';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { formatDate, useT } from '@/i18n';
import { frontendEnv } from '@/config/env';
import { openLinks } from '@/lib/publicBeta';
import HumanHelpBlock, { HUMAN_HELP_DIRECTORY } from '@/components/HumanHelpBlock';
import { PLAN_CLOSURES, groupByNeed, needsRecovery, nextActionOf } from '@/lib/parcoursPlan';

/** French text of the plan or of a record inside any interface language: marked French and left-to-right */
const FR = { lang: 'fr', dir: 'ltr' };
const searchFor = (/** @type {string} */ title) => `/recherche?q=${encodeURIComponent(String(title || '').slice(0, 100))}`;
/** where a record says whom to contact: « Où demander » of an aide (its heading has an anchor), the page itself otherwise */
const contactHref = (r) => (r.type === 'aide' ? `${r.href}#heading-ou-demander` : r.href);
/** the longest personal note the server keeps (api/_services/mon-espace.js setNote) */
const NOTE_MAX = 500;

/**
 * PKG-2 / C07 — Mon Parcours (/compte/parcours): the steps the person follows, kept across sessions. The plan d'action of a dossier attached to the account becomes tracked steps;
 * the person records where each step stands (never a decision by ADA), adds a deadline ONLY with its official source, keeps a private note, and sees the history of each step.
 * VIS-R: a plan step shows who does what next (read back from its dossier); a step whose record was withdrawn says so with a way to look for another one; after a
 * « réponse défavorable » the person indicated, a neutral « Que faire ensuite ? » block points to the record's contact information, the search and human help —
 * it never says what the organisation decided, nor that anything is due or possible.
 * M1 (the step's durable plan data, "ParcoursItem"."planStep"): the steps in progress are grouped by need; a step says who acts and the next action (what
 * follows from the state the person indicated, else the action planned for the step); a step that comes after an unfinished one is shown as waiting — a
 * notice, never a lock: its state can always be changed; a step whose record is no longer available also gets the « Parler à une personne » block; a step
 * the person gave up, or whose outcome they never learnt, is closed with that reason and gets the same « Que faire ensuite ? » block. A link is only a
 * link: following one never changes a step's state. Where the database does not store plan data yet (`planSteps: false`) the screen is the former one.
 */
export default function CompteParcours() {
  const { t } = useT('compte');
  const { parcoursStatus: PARCOURS_STATUS_LABELS, parcoursClosure: PARCOURS_CLOSURE_LABELS } = useMonEspaceLabels();
  const [state, setState] = useState({ loading: true, error: '', items: [], shares: [], planSteps: false });
  const [organise, setOrganise] = useState({ actor: '', name: '', dependsOn: '' });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [open, setOpen] = useState(null);   // id of the step whose details are shown
  const [history, setHistory] = useState({});
  const [due, setDue] = useState({ date: '', source: '' });

  const load = useCallback(async () => {
    try {
      const p = await citizenApi.listParcours();
      // G4: the dossiers are listed only where the server says the plan import is open (it belongs to the HDS-bound shared dossier); a refusal there never
      // hides Mon Parcours itself. A server without the flag (before G4) keeps the former behaviour.
      const importOpen = p.planImport !== false;
      const s = importOpen ? await citizenApi.listShares().catch(() => ({ shares: [] })) : { shares: [] };
      setState({ loading: false, error: '', items: p.items || [], shares: importOpen ? s.shares || [] : [], planSteps: p.planSteps === true, emailReminders: p.emailReminders !== false });
    } catch (err) { setState({ loading: false, unauth: err.status === 401, error: err.status === 401 ? t('compte:parcours.login_required', 'Connectez-vous pour accéder à Mon Parcours.') : err.message, items: [], shares: [] }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => { setMessage(''); setProblem(''); try { const out = await fn(); if (ok) setMessage(typeof ok === 'function' ? ok(out) : ok); await load(); return out; } catch (err) { setProblem(err.message); return null; } };
  const toggle = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDue({ date: '', source: '' });
    const it = state.items.find((x) => x.id === id);
    setOrganise({ actor: it?.step?.actor?.kind || '', name: it?.step?.actor?.name || '', dependsOn: it?.dependsOn?.id || '' });
    try { const h = await citizenApi.parcoursHistory(id); setHistory((x) => ({ ...x, [id]: h.events || [] })); } catch { setHistory((x) => ({ ...x, [id]: [] })); }
  };

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:parcours.chargement_mon_parcours', 'Chargement de Mon Parcours…')}</div>;
  if (state.error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8" data-testid="parcours-error">
        <SEO title={t('compte:parcours.mon_parcours', 'Mon Parcours')} noindex />
        <h1 className="mb-3 text-2xl font-bold text-slate-900">{t('compte:parcours.mon_parcours', 'Mon Parcours')}</h1>   {/* Q10 sweep: a heading in the failure state too */}
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>
        {/* R7: « Se connecter » only when the session is the problem; an outage offers to try again */}
        {state.unauth ? <Button asChild className="mt-4" variant="outline"><Link to="/auth/login?next=/compte/parcours">{t('compte:parcours.connecter', 'Se connecter')}</Link></Button>
          : <Button className="mt-4" variant="outline" onClick={() => { setState((x) => ({ ...x, loading: true, error: '' })); load(); }} data-testid="parcours-retry">{t('compte:parcours.reessayer', 'Réessayer')}</Button>}
      </div>
    );
  }
  const active = state.items.filter((i) => !PARCOURS_DONE.includes(i.status));
  const done = state.items.filter((i) => PARCOURS_DONE.includes(i.status));
  const helpLinks = openLinks([
    { to: '/structures', label: t('compte:parcours.next_structures', 'Trouver une structure qui peut vous accompagner'), testid: 'parcours-next-structures' },
    { to: '/demande-aide', label: t('compte:parcours.next_human', 'Demander de l’aide à une personne'), testid: 'parcours-next-human' },
  ], frontendEnv.flags.publicBeta, (l) => l.to);
  // the state as the person chose it: one of the ten states, or the reason a closed step ended (abandoned / outcome unknown)
  const stateOf = (i) => (i.closure && PLAN_CLOSURES.includes(i.closure) ? i.closure : i.status);
  const stateLabel = (i) => PARCOURS_CLOSURE_LABELS[stateOf(i)] || PARCOURS_STATUS_LABELS[i.status];
  const ACTION_LABELS = {
    read_record: t('compte:parcours.action.read_record', 'lire la fiche d’information'),
    complete_information: t('compte:parcours.action.complete_information', 'compléter les informations qui manquent'),
    gather_documents: t('compte:parcours.action.gather_documents', 'rassembler vos papiers'),
    contact_organisation: t('compte:parcours.action.contact_organisation', 'contacter l’organisme'),
    submit_request: t('compte:parcours.action.submit_request', 'envoyer votre demande'),
    wait_answer: t('compte:parcours.action.wait_answer', 'attendre la réponse de l’organisme ; sans nouvelles, vous pouvez le relancer'),
    answer_organisation: t('compte:parcours.action.answer_organisation', 'répondre à la demande d’informations de l’organisme'),
    ask_professional: t('compte:parcours.action.ask_professional', 'demander à un professionnel de vous accompagner'),
    share_dossier: t('compte:parcours.action.share_dossier', 'partager votre dossier avec une structure, si vous le souhaitez'),
    emergency_resources: t('compte:parcours.action.emergency_resources', 'consulter les ressources d’urgence'),
    after_refusal: t('compte:parcours.action.after_refusal', 'voir « Que faire ensuite ? » ci-dessous'),
    resume_or_search: t('compte:parcours.action.resume_or_search', 'reprendre cette étape quand vous le souhaitez, ou chercher une autre piste'),
    ask_outcome: t('compte:parcours.action.ask_outcome', 'demander à l’organisme où en est votre demande'),
  };
  const newWindow = t('compte:parcours.link_new_window', ' (nouvelle fenêtre)');
  const directoryOpen = openLinks([{ to: HUMAN_HELP_DIRECTORY }], frontendEnv.flags.publicBeta, (l) => l.to).length > 0;
  const savePlan = (i) => run(() => citizenApi.parcours({ action: 'plan', id: i.id, planStep: {
    actor: organise.actor === 'organisation' ? { kind: 'organisation', name: organise.name.trim() } : organise.actor ? { kind: organise.actor } : null,
    dependsOnItemId: organise.dependsOn || null,
  } }), t('compte:parcours.organise_saved', 'Organisation de l’étape enregistrée.'));
  const renderItem = (i) => {
    // who acts / the explanation / the links: the step's own durable plan data, else (a step imported before it existed) what is read back from its dossier
    const actor = i.step?.actor || (i.plan?.who ? { kind: 'organisation', name: i.plan.who } : null);
    const detail = i.step?.detail || i.plan?.detail || null;
    const links = i.step?.links?.length ? i.step.links : (i.plan?.links || []);
    const action = nextActionOf(i);
    const gone = (i.records || []).some((r) => !r.available);
    return (
    <li key={i.id} data-testid="parcours-item" className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{i.title}</p>
          <p className="text-sm text-slate-700" data-testid="parcours-item-status">{stateLabel(i)}{i.dueDate ? ` — ${t('compte:parcours.due_on', 'échéance le {{date}}', { date: formatDate(i.dueDate) })}` : ''}</p>
        </div>
        <Button type="button" size="sm" variant="outline" aria-expanded={open === i.id} aria-controls={`parcours-detail-${i.id}`} onClick={() => toggle(i.id)}>{open === i.id ? t('compte:parcours.close', 'Fermer') : t('compte:parcours.update', 'Mettre à jour')}</Button>
      </div>
      {i.waiting && i.dependsOn ? (
        <p className="mt-2 rounded-md border border-slate-300 bg-slate-50 p-2 text-sm text-slate-800" data-testid="parcours-waiting">
          {t('compte:parcours.waiting', 'En attente de l’étape « {{title}} » ({{status}}). Vous pouvez quand même mettre cette étape à jour.', { title: i.dependsOn.title, status: stateLabel(i.dependsOn) })}
        </p>
      ) : null}
      {actor || detail || links.length ? (
        <div className="mt-2 text-sm text-slate-800" data-testid="parcours-plan">
          {actor && actor.kind === 'organisation' ? <p><span className="font-medium">{t('compte:parcours.plan_who', 'Auprès de qui :')}</span> <span {...FR}>{actor.name}</span></p> : null}
          {actor && actor.kind !== 'organisation' ? (
            <p data-testid="parcours-actor"><span className="font-medium">{t('compte:parcours.actor_label', 'Qui agit :')}</span>{' '}
              {actor.kind === 'professional' ? t('compte:parcours.actor_professional', 'un professionnel qui vous accompagne') : t('compte:parcours.actor_citizen', 'vous')}</p>
          ) : null}
          {detail ? <p className="mt-1" {...FR}>{detail}</p> : null}
          {links.length ? (
            <ul className="mt-1 list-disc space-y-1 ps-5">
              {links.map((l) => (l.to
                ? <li key={l.to + l.label}><Link to={l.to} className="text-blue-800 underline" {...FR}>{l.label}</Link></li>
                : <li key={l.url + l.label}><a href={l.url} target="_blank" rel="noopener noreferrer" className="text-blue-800 underline" data-testid="parcours-official-link"><span {...FR}>{l.label}</span><span className="sr-only">{newWindow}</span></a></li>))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {action ? <p className="mt-2 text-sm text-slate-800" data-testid="parcours-next-action"><span className="font-medium">{t('compte:parcours.next_action', 'Prochaine action :')}</span> {ACTION_LABELS[action]}</p> : null}
      {(i.records || []).length ? (
        <ul className="mt-2 space-y-1 text-sm" data-testid="parcours-records">
          {i.records.map((r) => (r.available ? (
            <li key={r.code}><span className="text-slate-700">{t('compte:parcours.record', 'Fiche :')}</span> <Link to={r.href} className="font-medium text-blue-800 underline" {...FR}>{r.title}</Link></li>
          ) : (
            <li key={r.code} data-testid="parcours-record-unavailable" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950">
              {t('compte:parcours.record_unavailable', 'Cette fiche n’est plus disponible.')}{' '}
              <Link to={searchFor(i.title)} className="font-medium underline">{t('compte:parcours.record_search_other', 'Chercher une autre fiche')}</Link>
            </li>
          )))}
        </ul>
      ) : null}
      {/* a record that is gone is a dead end: the same human alternative as on the « record not available » page */}
      {gone ? <HumanHelpBlock headingLevel={3} id={`parcours-help-${i.id}`} className="!mx-0 !my-3" directoryLink={directoryOpen} /> : null}
      {needsRecovery(i) ? (
        <section className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800" data-testid="parcours-next" aria-labelledby={`parcours-next-${i.id}`}>
          <h3 id={`parcours-next-${i.id}`} className="font-semibold text-slate-900">{t('compte:parcours.next_title', 'Que faire ensuite ?')}</h3>
          <p className="mt-1">{i.closure === 'ABANDONED'
            ? t('compte:parcours.next_body_abandoned', 'Vous avez indiqué avoir abandonné cette étape. Vous pouvez la reprendre à tout moment en changeant son état, chercher une autre piste ou en parler à une personne.')
            : i.closure === 'OUTCOME_UNKNOWN'
              ? t('compte:parcours.next_body_unknown', 'Vous avez indiqué ne pas connaître la réponse. AccesDirectAide ne la connaît pas non plus. Vous pouvez demander à l’organisme où en est votre demande ou demander à un professionnel de vous aider.')
              : t('compte:parcours.next_body', 'Vous avez indiqué une réponse défavorable. AccesDirectAide ne connaît pas la décision de l’organisme et ne peut pas dire ce qui est possible dans votre situation. Vous pouvez relire le courrier de l’organisme, lui poser vos questions ou demander à un professionnel de le lire avec vous.')}</p>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {(i.records || []).filter((r) => r.available).map((r) => (
              <li key={r.code}><Link to={r.contact ? contactHref(r) : r.href} className="font-medium text-blue-800 underline" data-testid="parcours-next-record">{r.contact ? t('compte:parcours.next_contact', 'Où s’adresser, d’après la fiche') : t('compte:parcours.next_record', 'Relire la fiche')}</Link> <span {...FR}>({r.title})</span></li>
            ))}
            <li><Link to={searchFor(i.title)} className="font-medium text-blue-800 underline" data-testid="parcours-next-search">{t('compte:parcours.next_search', 'Chercher d’autres aides et démarches')}</Link></li>
            {helpLinks.map((l) => <li key={l.to}><Link to={l.to} className="font-medium text-blue-800 underline" data-testid={l.testid}>{l.label}</Link></li>)}
          </ul>
        </section>
      ) : null}
      {open === i.id ? (
        <div id={`parcours-detail-${i.id}`} className="mt-3 space-y-3 border-t border-slate-200 pt-3" data-testid="parcours-detail">
          <div>
            <label htmlFor={`st-${i.id}`} className="block text-sm font-medium text-slate-800">{t('compte:parcours.etes_vous', 'Où en êtes-vous ?')}</label>
            <select id={`st-${i.id}`} data-testid="parcours-status-select" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={stateOf(i)}
              onChange={(e) => run(() => citizenApi.parcours({ action: 'status', id: i.id, status: e.target.value }), t('compte:parcours.step_updated', 'Étape mise à jour.'))}>
              {Object.entries(PARCOURS_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {/* the two honest endings without an answer, where the database stores them */}
              {state.planSteps ? Object.entries(PARCOURS_CLOSURE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>) : null}
            </select>
          </div>
          {state.planSteps ? (
            <form className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="parcours-organise" aria-labelledby={`org-${i.id}`} onSubmit={(e) => { e.preventDefault(); savePlan(i); }}>
              <h3 id={`org-${i.id}`} className="text-sm font-medium text-slate-800">{t('compte:parcours.organise_title', 'Organiser cette étape')}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor={`ac-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.organise_actor', 'Qui agit pour cette étape ?')}</label>
                  <select id={`ac-${i.id}`} data-testid="parcours-actor-select" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={organise.actor} onChange={(e) => setOrganise({ ...organise, actor: e.target.value })}>
                    <option value="">{t('compte:parcours.organise_actor_none', 'Non précisé')}</option>
                    <option value="citizen">{t('compte:parcours.organise_actor_citizen', 'Moi')}</option>
                    <option value="organisation">{t('compte:parcours.organise_actor_organisation', 'Un organisme')}</option>
                    <option value="professional">{t('compte:parcours.organise_actor_professional', 'Un professionnel qui m’accompagne')}</option>
                  </select>
                </div>
                {organise.actor === 'organisation' ? (
                  <div>
                    <label htmlFor={`on-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.organise_org_name', 'Nom de l’organisme')}</label>
                    <input id={`on-${i.id}`} data-testid="parcours-actor-name" required minLength={2} maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={organise.name} onChange={(e) => setOrganise({ ...organise, name: e.target.value })} />
                  </div>
                ) : null}
                <div>
                  <label htmlFor={`dp-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.organise_depends', 'Cette étape vient après')}</label>
                  <select id={`dp-${i.id}`} data-testid="parcours-depends-select" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={organise.dependsOn} onChange={(e) => setOrganise({ ...organise, dependsOn: e.target.value })}>
                    <option value="">{t('compte:parcours.organise_depends_none', 'Aucune autre étape')}</option>
                    {state.items.filter((x) => x.id !== i.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </select>
                </div>
              </div>
              <Button type="submit" size="sm" variant="outline" data-testid="parcours-organise-save">{t('compte:parcours.organise_save', 'Enregistrer l’organisation')}</Button>
            </form>
          ) : null}
          <form className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]" onSubmit={(e) => { e.preventDefault(); run(() => citizenApi.parcours({ action: 'deadline', id: i.id, dueDate: due.date, dueSourceUrl: due.source }), t('compte:parcours.due_saved', 'Échéance enregistrée.')); }}>
            <div><label htmlFor={`dd-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.echeance', 'Échéance')}</label><input id={`dd-${i.id}`} data-testid="parcours-due-date" type="date" required className="mt-1 w-full rounded-md border border-slate-300 p-2" value={due.date} onChange={(e) => setDue({ ...due, date: e.target.value })} /></div>
            <div><label htmlFor={`ds-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.source_officielle_cette_echeance', 'Source officielle de cette échéance (adresse du site)')}</label><input id={`ds-${i.id}`} data-testid="parcours-due-source" type="url" required placeholder="https://www.service-public.fr/…" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={due.source} onChange={(e) => setDue({ ...due, source: e.target.value })} /></div>
            <div className="flex items-end"><Button type="submit" size="sm" data-testid="parcours-due-save">{t('compte:parcours.enregistrer', 'Enregistrer')}</Button></div>
          </form>
          {/* A-19: only the channels that can really carry this reminder are named */}
          <p className="text-xs text-slate-700" data-testid="parcours-reminder-channels">{state.emailReminders
            ? t('compte:parcours.reminder_channels', 'Rappel d’échéance : par e-mail, selon vos réglages de notification (page Mon profil). Aucun rappel d’échéance n’est envoyé par SMS.')
            : t('compte:parcours.reminder_channels_inapp', 'Rappel d’échéance : dans les notifications de Mon Espace, 7 jours avant. Aucun rappel n’est envoyé par e-mail ni par SMS pour le moment.')}</p>
          {i.dueDate ? <Button type="button" size="sm" variant="outline" onClick={() => run(() => citizenApi.parcours({ action: 'deadline', id: i.id, dueDate: null }), t('compte:parcours.due_removed', 'Échéance retirée.'))}>{t('compte:parcours.retirer_echeance', 'Retirer l’échéance')}</Button> : null}
          <div>
            <label htmlFor={`nt-${i.id}`} className="block text-sm text-slate-800">{t('compte:parcours.note_personnelle_visible_par', 'Note personnelle (visible par vous seul)')}</label>
            {/* G4 (data minimisation): the note is free text — the person is asked not to write health information there; nothing is checked or blocked */}
            <p id={`nt-hint-${i.id}`} className="mt-1 text-xs text-slate-700" data-testid="parcours-note-hint">{t('compte:parcours.note_no_health', 'N’écrivez pas d’informations sur votre santé (maladie, handicap, traitement…) : cette note sert seulement à suivre votre démarche. 500 caractères au plus.')}</p>
            <textarea id={`nt-${i.id}`} data-testid="parcours-note" maxLength={NOTE_MAX} aria-describedby={`nt-hint-${i.id}`} className="mt-1 w-full rounded-md border border-slate-300 p-2" defaultValue={i.note || ''}
              onBlur={(e) => { if ((e.target.value || '') !== (i.note || '')) run(() => citizenApi.parcours({ action: 'note', id: i.id, note: e.target.value }), t('compte:parcours.note_saved', 'Note enregistrée.')); }} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-800">{t('compte:parcours.historique_etape', 'Historique de l’étape')}</h3>
            <ol className="mt-1 space-y-1 text-sm text-slate-700" data-testid="parcours-history">
              {(history[i.id] || []).map((ev, n) => <li key={n}>{formatDate(ev.createdAt, { dateStyle: 'short', timeStyle: 'medium' })} — {ev.kind === 'STATUS' ? `${PARCOURS_STATUS_LABELS[ev.fromStatus] || ''} → ${PARCOURS_STATUS_LABELS[ev.toStatus] || ''}` : ev.kind === 'CREATED' ? t('compte:parcours.ev_created', 'Étape créée') : ev.kind === 'DEADLINE' ? t('compte:parcours.ev_deadline', 'Échéance modifiée') : t('compte:parcours.ev_note', 'Note modifiée')}</li>)}
            </ol>
          </div>
          <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" onClick={() => run(() => citizenApi.removeParcours(i.id), t('compte:parcours.step_removed', 'Étape supprimée.'))}>{t('compte:parcours.supprimer_cette_etape', 'Supprimer cette étape')}</Button>
        </div>
      ) : null}
    </li>
    );
  };
  // the steps in progress, by need (the taxonomy's French label); without any need on any step the list is the former flat one
  const groups = groupByNeed(active);
  const grouped = groups.some((g) => g.need);

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-parcours">
      <SEO title={t('compte:parcours.mon_parcours', 'Mon Parcours')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:parcours.mon_parcours', 'Mon Parcours')}</h1>
      <p className="text-sm text-slate-700">{t('compte:parcours.suivez_vos_demarches_etape', 'Suivez vos démarches étape par étape. Vous indiquez vous-même où vous en êtes : AccesDirectAide ne prend aucune décision sur vos droits.')}</p>
      <div aria-live="polite" role="status" data-testid="parcours-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="parcours-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}

      {state.shares.length ? (
        <Card>
          <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.suivre_plan_dossier', 'Suivre le plan d’un dossier')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {state.shares.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{t('compte:parcours.share_of', 'Dossier du {{date}}', { date: formatDate(s.createdAt) })}</span>
                  <Button type="button" size="sm" data-testid="parcours-import" onClick={() => run(() => citizenApi.parcours({ action: 'import', shareId: s.id }), (out) => (out && out.added ? t('compte:parcours.imported', '{{n}} étape(s) ajoutée(s) à Mon Parcours.', { n: out.added }) : t('compte:parcours.already_imported', 'Ce plan est déjà dans Mon Parcours.')))}>{t('compte:parcours.ajouter_son_plan_action', 'Ajouter son plan d’action')}</Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.etapes_cours', 'Étapes en cours')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {active.length && grouped ? (
            <div className="space-y-4" data-testid="parcours-active">
              {groups.map((g) => (
                <section key={g.need ? g.need.id : 'other'} data-testid="parcours-group" aria-labelledby={`parcours-group-${g.need ? g.need.id : 'other'}`}>
                  <h3 id={`parcours-group-${g.need ? g.need.id : 'other'}`} className="mb-2 text-base font-semibold text-slate-900">
                    {g.need ? <><span className="font-medium text-slate-700">{t('compte:parcours.group_need', 'Besoin :')}</span> <span {...FR}>{g.need.label}</span></> : t('compte:parcours.group_other', 'Autres étapes')}
                  </h3>
                  <ul className="space-y-3">{g.items.map(renderItem)}</ul>
                </section>
              ))}
            </div>
          ) : active.length ? <ul className="space-y-3" data-testid="parcours-active">{active.map(renderItem)}</ul> : <p className="text-sm text-slate-700" data-testid="parcours-empty">{t('compte:parcours.aucune_etape_cours', 'Aucune étape en cours.')}</p>}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await citizenApi.parcours({ action: 'add', title: newTitle }); setNewTitle(''); }, t('compte:parcours.step_added', 'Étape ajoutée.')); }}>
            <div className="min-w-[240px] flex-1"><label htmlFor="pc-new" className="block text-sm text-slate-800">{t('compte:parcours.ajouter_une_etape', 'Ajouter une étape')}</label><input id="pc-new" data-testid="parcours-new-title" maxLength={200} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></div>
            <Button type="submit" data-testid="parcours-add" disabled={newTitle.trim().length < 3}>{t('compte:parcours.ajouter', 'Ajouter')}</Button>
          </form>
        </CardContent>
      </Card>
      {done.length ? (
        <Card><CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.etapes_terminees', 'Étapes terminées')}</CardTitle></CardHeader><CardContent><ul className="space-y-3" data-testid="parcours-done">{done.map(renderItem)}</ul></CardContent></Card>
      ) : null}
    </div>
  );
}
