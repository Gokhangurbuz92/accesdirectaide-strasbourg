// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { ITEM_KINDS } from '@/config/orientationNeeds';
import { useOrientationLabels } from '@/lib/orientationNeedsI18n';
import { formatDate, useT } from '@/i18n';

const msgOf = (e, fallback) => e?.payload?.message || fallback;
const day = (d, t) => (d ? formatDate(new Date(d), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: undefined }) : t('pro:selections.unknown_date', 'date inconnue'));
const API = '/api/pro/selections';
const host = (u) => { try { return new URL(u).hostname; } catch { return u; } };
/** same wording as the text the person receives (api/_services/orientation-basket.js personWhy): catalogue facts only, never the working label or reasons */
const personWhy = (i, needCodes, t, needLabel) => { const m = (i.needs || []).filter((n) => needCodes.includes(n)); return m.length ? t('pro:selections.why_need', 'En lien avec votre besoin {{needs}}.', { needs: m.map((n) => `« ${needLabel(n)} »`).join(t('pro:selections.why_and', ' et ')) }) : t('pro:selections.why_default', 'Proposé par la personne qui vous accompagne.'); };

/**
 * R18 (R31) — Sélections d'orientation (/pro/selections, /pro/selections/:id): a professional gathers VERIFIED aides, démarches and lieux around a person's
 * needs, sees why each one is suggested with its official source, marks the follow-up, prints the summary, and — only through a case the person shared with
 * the organization — sends it to the person's space. Every rule is enforced by /api/pro/selections; this screen shows what the server returns.
 */
export default function ProSelections() {
  const { id } = useParams();
  return id ? <SelectionDetail id={id} /> : <SelectionList />;
}

function Notice() {
  const { t } = useT('pro');
  return (
    <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950" data-testid="selection-notice">
      {t('pro:selections.notice', 'Une sélection aide à préparer une orientation : elle ne dit pas si une personne a droit à une aide, seul l’organisme concerné le décide.')}
      {' '}{t('pro:selections.notice_no_name', 'N’écrivez ni nom ni information permettant de reconnaître la personne dans le nom de la sélection.')}
    </p>
  );
}

function NeedPicker({ value, onChange, idPrefix }) {
  const { t } = useT('pro');
  const { needs: ORIENTATION_NEEDS } = useOrientationLabels();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-900">{t('pro:selections.needs_legend', 'Besoins de la personne')}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {ORIENTATION_NEEDS.map((n) => (
          <label key={n.code} className="flex min-h-11 items-center gap-2 text-sm" htmlFor={`${idPrefix}-${n.code}`}>
            <input id={`${idPrefix}-${n.code}`} type="checkbox" className="h-5 w-5" checked={value.includes(n.code)}
              onChange={(e) => onChange(e.target.checked ? [...value, n.code] : value.filter((c) => c !== n.code))} />
            {n.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SelectionList() {
  const { t } = useT('pro');
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', baskets: [] });
  const [archived, setArchived] = useState(false);
  const [form, setForm] = useState({ label: '', needCodes: [] });
  const [problem, setProblem] = useState('');
  const load = useCallback(async () => {
    try { const out = await proRdvRequest(API, { query: { status: archived ? 'ARCHIVED' : 'ACTIVE' } }); setState({ loading: false, error: '', baskets: out.baskets || [] }); }
    catch (e) { setState({ loading: false, error: msgOf(e, t('pro:selections.load_list_error', 'Impossible de charger les sélections.')), baskets: [] }); }
  }, [archived]);   // eslint-disable-line react-hooks/exhaustive-deps -- t only changes the message language
  useEffect(() => { load(); }, [load]);
  const create = async (e) => {
    e.preventDefault(); setProblem('');
    try { const out = await proRdvRequest(API, { method: 'POST', body: { action: 'create', ...form } }); navigate(`/pro/selections/${out.basket.id}`); }
    catch (err) { setProblem(msgOf(err, t('pro:selections.create_error', 'Création impossible.'))); }
  };
  return (
    <div className="space-y-4" data-testid="pro-selections">
      <SEO title={t('pro:selections.title', 'Sélections d’orientation')} noindex />
      <h1 className="text-xl font-bold text-slate-900">{t('pro:selections.title', 'Sélections d’orientation')}</h1>
      <Notice />
      <form onSubmit={create} className="space-y-3 rounded-md border border-slate-200 bg-white p-4" data-testid="selection-create">
        <h2 className="font-semibold text-slate-900">{t('pro:selections.new', 'Nouvelle sélection')}</h2>
        <label className="block space-y-1 text-sm" htmlFor="sel-label">
          <span>{t('pro:selections.label_field', 'Nom de la sélection (par exemple « Jeune sans logement, premier entretien »)')}</span>
          <input id="sel-label" className="min-h-11 w-full rounded-md border border-slate-300 px-3" maxLength={80} required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </label>
        <NeedPicker idPrefix="new-need" value={form.needCodes} onChange={(needCodes) => setForm({ ...form, needCodes })} />
        {problem ? <p role="alert" className="text-sm text-red-800">{problem}</p> : null}
        <Button type="submit">{t('pro:selections.create', 'Créer la sélection')}</Button>
      </form>
      <div className="flex flex-wrap gap-2" role="tablist">
        <Button type="button" role="tab" aria-selected={!archived} variant={archived ? 'outline' : 'default'} onClick={() => setArchived(false)}>{t('pro:selections.tab_active', 'En cours')}</Button>
        <Button type="button" role="tab" aria-selected={archived} variant={archived ? 'default' : 'outline'} onClick={() => setArchived(true)}>{t('pro:selections.tab_archived', 'Archivées')}</Button>
      </div>
      {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p> : null}
      {state.loading ? <p role="status">{t('pro:selections.loading', 'Chargement…')}</p> : state.baskets.length ? (
        <ul className="space-y-2">
          {state.baskets.map((b) => (
            <li key={b.id} data-testid="selection-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
              <span><strong>{b.label}</strong> — {t('pro:selections.item_count', { count: b.itemCount, defaultValue_one: '{{count}} élément(s)', defaultValue_other: '{{count}} élément(s)' })}{b.caseId ? t('pro:selections.linked_case', ' — reliée à un dossier suivi') : ''}{b.sharedAt ? t('pro:selections.shared_on', ' — transmise le {{date}}', { date: day(b.sharedAt, t) }) : ''}{b.mine ? '' : t('pro:selections.team_member', ' — sélection d’un membre de l’équipe')}</span>
              <Button asChild size="sm" variant="outline"><Link to={`/pro/selections/${encodeURIComponent(b.id)}`}>{t('pro:selections.open', 'Ouvrir')}</Link></Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-700" data-testid="selections-empty">{archived ? t('pro:selections.empty_archived', 'Aucune sélection archivée.') : t('pro:selections.empty_active', 'Aucune sélection en cours. Créez-en une pour commencer.')}</p>}
    </div>
  );
}

function SelectionDetail({ id }) {
  const { t } = useT('pro');
  const { needLabel, followUps: FOLLOW_UPS, itemKinds } = useOrientationLabels();
  const [basket, setBasket] = useState(null); const [error, setError] = useState('');
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState({ q: '', kinds: Object.keys(ITEM_KINDS), results: null });
  const [reasons, setReasons] = useState({});
  const [cases, setCases] = useState([]);
  const load = useCallback(async () => {
    try { const out = await proRdvRequest(API, { query: { id } }); setBasket(out.basket); setError(''); }
    catch (e) { setError(e?.status === 404 ? t('pro:selections.not_found', 'Cette sélection n’existe pas ou ne vous est pas ouverte.') : msgOf(e, t('pro:selections.load_error', 'Impossible de charger la sélection.'))); }
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps -- t only changes the message language
  useEffect(() => { load(); }, [load]);
  useEffect(() => { proRdvRequest('/api/pro/cases', { query: { scope: 'mine' } }).then((out) => setCases(out.cases || [])).catch(() => setCases([])); }, []);
  const run = async (body, ok) => {
    setBusy(true); setMessage(''); setProblem('');
    try { const out = await proRdvRequest(API, { method: 'POST', body: { id, ...body } }); if (out.basket) setBasket(out.basket); setMessage(ok); return true; }
    catch (e) { setProblem(msgOf(e, t('pro:selections.action_error', 'Action impossible.'))); if (e?.status === 409) await load(); return false; }
    finally { setBusy(false); }
  };
  const find = async (e) => {
    e.preventDefault(); setProblem('');
    try { const out = await proRdvRequest(API, { query: { q: search.q, kinds: search.kinds.join(','), needs: (basket?.needCodes || []).join(',') } }); setSearch((s) => ({ ...s, results: out.results || [] })); }
    catch (err) { setProblem(msgOf(err, t('pro:selections.search_error', 'Recherche impossible.'))); }
  };
  if (error) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{error}</p>;
  if (!basket) return <p role="status">{t('pro:selections.loading', 'Chargement…')}</p>;
  const inBasket = new Set(basket.items.map((i) => `${i.kind}:${i.refId}`));
  const shown = basket.items.filter((i) => i.stillPublic && i.followUp !== 'SANS_SUITE');
  return (
    <div className="space-y-5" data-testid="pro-selection-detail">
      <SEO title={t('pro:selections.detail_title', 'Sélection — {{label}}', { label: basket.label })} noindex />
      <div className="print:hidden space-y-4">
        <p><Link to="/pro/selections" className="text-sm text-sky-800 underline">{t('pro:selections.back', '← Toutes les sélections')}</Link></p>
        <h1 className="text-xl font-bold text-slate-900">{basket.label}</h1>
        <Notice />
        <div role="status" aria-live="polite" data-testid="selection-status">{message}</div>
        {problem ? <p role="alert" className="text-sm text-red-800" data-testid="selection-problem">{problem}</p> : null}

        <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4" aria-labelledby="sel-needs">
          <h2 id="sel-needs" className="font-semibold text-slate-900">{t('pro:selections.needs', 'Besoins')}</h2>
          <NeedPicker idPrefix="need" value={basket.needCodes} onChange={(needCodes) => run({ action: 'update', needCodes }, t('pro:selections.needs_updated', 'Besoins mis à jour.'))} />
        </section>

        <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4" aria-labelledby="sel-search">
          <h2 id="sel-search" className="font-semibold text-slate-900">{t('pro:selections.search_title', 'Chercher une aide, une démarche ou un lieu vérifié')}</h2>
          <form onSubmit={find} className="flex flex-wrap items-end gap-2" role="search">
            <label className="flex flex-col gap-1 text-sm" htmlFor="sel-q"><span>{t('pro:selections.keywords', 'Mots-clés')}</span>
              <input id="sel-q" type="search" className="min-h-11 rounded-md border border-slate-300 px-3" value={search.q} onChange={(e) => setSearch({ ...search, q: e.target.value })} /></label>
            {Object.entries(itemKinds).map(([k, l]) => (
              <label key={k} className="flex min-h-11 items-center gap-2 text-sm" htmlFor={`kind-${k}`}>
                <input id={`kind-${k}`} type="checkbox" className="h-5 w-5" checked={search.kinds.includes(k)} onChange={(e) => setSearch({ ...search, kinds: e.target.checked ? [...search.kinds, k] : search.kinds.filter((x) => x !== k) })} />{l}
              </label>
            ))}
            <Button type="submit">{t('pro:selections.search', 'Chercher')}</Button>
          </form>
          {search.results ? (search.results.length ? (
            <ul className="space-y-2" data-testid="selection-results">
              {search.results.map((r) => {
                const key = `${r.kind}:${r.refId}`;
                return (
                  <li key={key} className="space-y-2 rounded-md border border-slate-200 p-3 text-sm" data-testid="selection-result">
                    <p><strong>{r.title}</strong> — {itemKinds[r.kind] || r.kind}{r.place ? `, ${r.place}` : ''} — {t('pro:selections.verified_on', 'vérifiée le {{date}}', { date: day(r.verifiedAt, t) })}</p>
                    {r.summary ? <p className="text-slate-700">{r.summary}</p> : null}
                    {inBasket.has(key) ? <p className="text-emerald-800">{t('pro:selections.already_in', 'Déjà dans la sélection.')}</p> : (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1" htmlFor={`why-${key}`}><span>{t('pro:selections.reason_field', 'Motif (facultatif, sans nom ; reste dans votre espace)')}</span>
                          <input id={`why-${key}`} className="min-h-11 rounded-md border border-slate-300 px-3" maxLength={280} value={reasons[key] || ''} onChange={(e) => setReasons({ ...reasons, [key]: e.target.value })} /></label>
                        <Button type="button" size="sm" disabled={busy} onClick={() => run({ action: 'add', kind: r.kind, refId: r.refId, reason: reasons[key] || '' }, t('pro:selections.added', 'Ajouté à la sélection.'))}>{t('pro:selections.add', 'Ajouter')}</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-slate-700">{t('pro:selections.no_results', 'Aucune fiche vérifiée ne correspond. Essayez un autre mot.')}</p>) : null}
        </section>

        <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4" aria-labelledby="sel-items">
          <h2 id="sel-items" className="font-semibold text-slate-900">{t('pro:selections.items_title', 'Pistes retenues ({{n}})', { n: basket.items.length })}</h2>
          {basket.items.length ? (
            <ul className="space-y-2">
              {basket.items.map((i) => (
                <li key={i.key} className={`space-y-2 rounded-md border p-3 text-sm ${i.stillPublic ? 'border-slate-200' : 'border-amber-300 bg-amber-50'}`} data-testid="selection-entry">
                  <p><strong>{i.title || t('pro:selections.withdrawn', 'Fiche retirée')}</strong> — {itemKinds[i.kind] || i.kindLabel}{i.place ? `, ${i.place}` : ''}</p>
                  <p data-testid="selection-why">{i.why}</p>
                  {i.stillPublic ? <p>{t('pro:selections.official_source', 'Source officielle :')} {i.sourceUrl ? <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sky-800 underline">{host(i.sourceUrl)}</a> : '—'} — {t('pro:selections.verified_on', 'vérifiée le {{date}}', { date: day(i.verifiedAt, t) })} — <Link to={i.path} className="text-sky-800 underline">{t('pro:selections.see_record', 'voir la fiche')}</Link></p> : null}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1" htmlFor={`fu-${i.key}`}><span>{t('pro:selections.follow_up', 'Suivi')}</span>
                      <select id={`fu-${i.key}`} className="min-h-11 rounded-md border border-slate-300 px-2" value={i.followUp} disabled={busy} onChange={(e) => run({ action: 'item', key: i.key, followUp: e.target.value }, t('pro:selections.follow_up_saved', 'Suivi enregistré.'))}>
                        {Object.entries(FOLLOW_UPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select></label>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run({ action: 'remove', key: i.key }, t('pro:selections.removed', 'Retiré de la sélection.'))}>{t('pro:selections.remove', 'Retirer')}</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-700">{t('pro:selections.no_items', 'Aucune piste pour le moment : cherchez une fiche ci-dessus.')}</p>}
        </section>

        <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4" aria-labelledby="sel-share">
          <h2 id="sel-share" className="font-semibold text-slate-900">{t('pro:selections.summary', 'Récapitulatif')}</h2>
          <p className="text-sm text-slate-700">{t('pro:selections.summary_help', 'Le récapitulatif reprend les pistes publiées (sauf « Sans suite »), avec leur source officielle ; le nom de la sélection et vos motifs n’y figurent pas. Pour le transmettre à la personne, reliez la sélection à un dossier qu’elle a partagé avec votre structure : il apparaîtra dans son espace comme une note de suivi.')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm" htmlFor="sel-case"><span>{t('pro:selections.case', 'Dossier suivi')}</span>
              <select id="sel-case" className="min-h-11 rounded-md border border-slate-300 px-2" value={basket.caseId || ''} disabled={busy} onChange={(e) => run({ action: 'link_case', caseId: e.target.value || null }, e.target.value ? t('pro:selections.case_linked', 'Sélection reliée au dossier.') : t('pro:selections.case_unlinked', 'Sélection détachée du dossier.'))}>
                <option value="">{t('pro:selections.case_none', 'Aucun')}</option>
                {cases.filter((c) => c.status !== 'CLOSED').map((c) => <option key={c.id} value={c.id}>{t('pro:selections.case_option', 'Dossier {{id}}', { id: c.dossierId.slice(0, 8) })}</option>)}
                {basket.caseId && !cases.some((c) => c.id === basket.caseId) ? <option value={basket.caseId}>{t('pro:selections.case_linked_option', 'Dossier relié')}</option> : null}
              </select></label>
            <Button type="button" variant="outline" onClick={() => window.print()} disabled={!shown.length}>{t('pro:selections.print', 'Imprimer ou enregistrer en PDF')}</Button>
            <Button type="button" disabled={busy || !basket.caseId || !shown.length} onClick={() => run({ action: 'share' }, t('pro:selections.shared', 'Récapitulatif transmis : la personne le voit dans son espace.'))} data-testid="selection-share">{t('pro:selections.share', 'Transmettre à la personne')}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => run({ action: 'update', status: basket.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }, basket.status === 'ACTIVE' ? t('pro:selections.archived', 'Sélection archivée.') : t('pro:selections.reopened', 'Sélection rouverte.'))}>{basket.status === 'ACTIVE' ? t('pro:selections.archive', 'Archiver') : t('pro:selections.reopen', 'Rouvrir')}</Button>
          </div>
          {basket.sharedAt ? <p className="text-sm text-slate-700">{t('pro:selections.last_shared', 'Dernière transmission le {{date}}.', { date: day(basket.sharedAt, t) })}</p> : null}
        </section>
      </div>

      <article className="hidden space-y-3 text-sm print:block" data-testid="selection-print">
        <h1 className="text-lg font-bold">{t('pro:selections.print_title', 'Pistes d’orientation préparées pour vous')}</h1>
        {basket.needs.length ? <p>{t('pro:selections.print_needs', 'Besoins pris en compte : {{needs}}.', { needs: basket.needs.map((n) => needLabel(n.code) || n.label).join(', ') })}</p> : null}
        <p>{t('pro:selections.print_disclaimer', 'Ces pistes sont une orientation, pas une décision : seul l’organisme concerné décide de vos droits, après examen de votre situation.')}</p>
        <ol className="list-decimal space-y-2 pl-5">
          {shown.map((i) => (
            <li key={i.key}><strong>{i.title}</strong> ({itemKinds[i.kind] || i.kindLabel}{i.place ? `, ${i.place}` : ''})<br />{t('pro:selections.print_why', 'Pourquoi : {{why}}', { why: personWhy(i, basket.needCodes, t, needLabel) })}<br />{t('pro:selections.print_source', 'Source officielle : {{url}} (vérifiée le {{date}})', { url: i.sourceUrl, date: day(i.verifiedAt, t) })}</li>
          ))}
        </ol>
        <p>{t('pro:selections.printed_on', 'Imprimé le {{date}} depuis AccesDirectAide.', { date: day(new Date(), t) })}</p>
      </article>
    </div>
  );
}
