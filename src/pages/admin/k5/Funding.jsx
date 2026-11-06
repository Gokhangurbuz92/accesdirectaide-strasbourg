// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { downloadText, explain, useK5 } from './helpers.js';
import { Field, Status } from './ui.jsx';
import { useT, DATE_SHORT, formatDate } from '@/i18n';
import RecordText from '@/components/i18n/RecordText';

const day = (d) => (d ? formatDate(d, DATE_SHORT) : '—');
const eur = (t, n) => (n === null || n === undefined || n === '' ? t('admin:k5.funding.to_fill', 'à renseigner') : `${Number(n).toFixed(2).replace('.', ',')} €`);
const blankLine = () => ({ id: Math.random().toString(36).slice(2, 10), poste: '', nature: 'CHARGE', montant: '', statut: 'PROVISOIRE', justification: '' });

/**
 * P27 (R31) — Dossiers de financement (/admin/financement, /admin/financement/:id): the publisher prepares a subsidy or funding application from validated
 * project facts. The server refuses what would be untrue (an award without the funder's decision, a confirmed amount without its document) and recomputes
 * the points to complete on every read; each save is a version. Nothing here submits anything to a funder.
 */
export default function AdminFunding() {
  const { id } = useParams();
  return id ? <FundingDetail id={id} /> : <FundingList />;
}

function FundingList() {
  const { t } = useT('admin');
  const k = useK5('funding'); const [f, setF] = useState({}); const set = (x, v) => setF((s) => ({ ...s, [x]: v }));
  return (
    <div className="space-y-6 p-4" data-testid="admin-funding">
      <h1 className="text-2xl font-bold">{t('admin:k5.funding.title', 'Dossiers de financement')}</h1>
      <p className="text-sm text-slate-700">{t('admin:k5.funding.intro', 'Préparation des demandes de subvention et de financement de l’association. Les montants restent provisoires tant qu’un justificatif ne les confirme pas ; une décision d’un financeur ne s’enregistre qu’avec sa référence.')}</p>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-funding" />
      <section className="space-y-2 rounded border p-3" aria-labelledby="fd-new">
        <h2 id="fd-new" className="font-semibold">{t('admin:k5.funding.new', 'Nouveau dossier')}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="fd-title" label={t('admin:k5.funding.dossier_title', 'Titre du dossier')} value={f.title || ''} onChange={(v) => set('title', v)} />
          <Field id="fd-funder" label={t('admin:k5.funding.funder_known', 'Financeur (s’il est connu)')} value={f.funderName || ''} onChange={(v) => set('funderName', v)} />
          <Field id="fd-prog" label={t('admin:k5.funding.programme_or_call', 'Programme ou appel à projets')} value={f.programmeName || ''} onChange={(v) => set('programmeName', v)} />
          <Field id="fd-url" label={t('admin:k5.funding.programme_url', 'Adresse officielle du programme')} value={f.programmeUrl || ''} onChange={(v) => set('programmeUrl', v)} />
          <Field id="fd-deadline" label={t('admin:k5.funding.deadline', 'Date limite')} type="date" value={f.deadline || ''} onChange={(v) => set('deadline', v)} />
        </div>
        <Button size="sm" disabled={k.busy} onClick={async () => { const out = await k.act({ action: 'create', ...f }, t('admin:k5.funding.created', 'Dossier créé et prérempli avec les informations validées du projet.')); if (out?.dossier) setF({}); }}>{t('admin:k5.funding.create', 'Créer le dossier')}</Button>
      </section>
      <ul className="space-y-2">
        {(k.data?.dossiers || []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm" data-testid="admin-funding-item">
            <span><RecordText as="strong">{d.title}</RecordText> — {t('admin:k5.funding.item_line', '{{funder}} — {{status}} — date limite {{deadline}} — version {{version}}', { funder: d.funderName || t('admin:k5.funding.funder_tbd', 'financeur à préciser'), status: d.statusLabel, deadline: day(d.deadline), version: d.version })}{d.blocking ? t('admin:k5.funding.blocking', ' — {{n}} point(s) bloquant(s)', { n: d.blocking }) : ''}</span>
            <Link className="text-sky-800 underline" to={`/admin/financement/${encodeURIComponent(d.id)}`}>{t('admin:k5.funding.open', 'Ouvrir')}</Link>
          </li>
        ))}
        {k.data && !(k.data.dossiers || []).length ? <li className="text-sm text-slate-700">{t('admin:k5.funding.none', 'Aucun dossier pour le moment.')}</li> : null}
      </ul>
    </div>
  );
}

function Rows({ title, rows, onChange, columns, add }) {
  const { t } = useT('admin');
  const upd = (i, key, v) => onChange(rows.map((r, n) => (n === i ? { ...r, [key]: v } : r)));
  return (
    <section className="space-y-2 rounded border p-3" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {rows.map((r, i) => (
        <div key={r.id || r.code || i} className="grid items-end gap-2 sm:grid-cols-6" data-testid="funding-row">
          {columns.map(([key, label, kind, options]) => (
            <div key={key} className={kind === 'wide' ? 'sm:col-span-2 space-y-1' : 'space-y-1'}>
              <label className="block text-xs" htmlFor={`${title}-${i}-${key}`}>{label}</label>
              {options ? (
                <select id={`${title}-${i}-${key}`} className="w-full rounded border p-2 text-sm" value={r[key] ?? ''} onChange={(e) => upd(i, key, e.target.value)}>
                  {Object.entries(options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : <input id={`${title}-${i}-${key}`} type={kind === 'date' ? 'date' : kind === 'amount' ? 'number' : 'text'} step={kind === 'amount' ? '0.01' : undefined} min={kind === 'amount' ? '0' : undefined}
                className="w-full rounded border p-2 text-sm" value={r[key] ?? ''} onChange={(e) => upd(i, key, e.target.value)} />}
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(rows.filter((_, n) => n !== i))}>{t('admin:k5.funding.remove', 'Retirer')}</Button>
        </div>
      ))}
      {add ? <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, add()])}>{t('admin:k5.funding.add_line', 'Ajouter une ligne')}</Button> : null}
    </section>
  );
}

function FundingDetail({ id }) {
  const { t } = useT('admin');
  const k = useK5(`funding?id=${encodeURIComponent(id)}`);
  const [draft, setDraft] = useState(null); const [note, setNote] = useState(''); const [decision, setDecision] = useState({ date: '', reference: '' });
  const d = k.data?.dossier; const [exportProblem, setExportProblem] = useState('');
  const lists = useK5('funding');
  useEffect(() => { if (d) setDraft({ title: d.title, funderName: d.funderName || '', programmeName: d.programmeName || '', programmeUrl: d.programmeUrl || '', deadline: d.deadline ? String(d.deadline).slice(0, 10) : '', content: d.content }); }, [d]);
  // R41 (DTA-B69): an unknown dossier, a refusal or an outage is still a real page — its level-1 heading, what happened and the way back to the list
  // (it used to be a lone alert, or « Chargement… », with no heading)
  if (k.error || !d || !draft) {
    return (
      <div className="space-y-4 p-4" data-testid="admin-funding-detail-state">
        <p><Link to="/admin/financement" className="text-sm text-sky-800 underline">{t('admin:k5.funding.all', '← Tous les dossiers')}</Link></p>
        <h1 className="text-2xl font-bold">{t('admin:k5.funding.title', 'Dossiers de financement')}</h1>
        {k.error ? <Status problem={k.error} id="admin-funding-detail" /> : <p role="status">{t('admin:k5.funding.loading', 'Chargement…')}</p>}
      </div>
    );
  }
  const v = lists.data?.vocab || {};
  const c = draft.content; const setC = (patch) => setDraft((s) => ({ ...s, content: { ...s.content, ...patch } }));
  const closed = ['ACCORDE', 'REFUSE', 'ABANDONNE'].includes(d.status);
  const next = { EN_PREPARATION: ['PRET_POUR_VALIDATION', 'ABANDONNE'], PRET_POUR_VALIDATION: ['EN_PREPARATION', 'DEPOSE', 'ABANDONNE'], DEPOSE: ['ACCORDE', 'REFUSE', 'ABANDONNE'], ABANDONNE: ['EN_PREPARATION'] }[d.status] || [];
  const exportMd = async () => {
    setExportProblem('');
    try { const out = await apiClient.admin.k5(`funding?export=${encodeURIComponent(d.id)}`); downloadText(out.markdown, out.filename, 'text/markdown'); } catch (e) { setExportProblem(explain(e)); }
  };
  return (
    <div className="space-y-4 p-4" data-testid="admin-funding-detail">
      <p><Link to="/admin/financement" className="text-sm text-sky-800 underline">{t('admin:k5.funding.all', '← Tous les dossiers')}</Link></p>
      <RecordText as="h1" className="text-2xl font-bold">{d.title}</RecordText>
      <p className="text-sm">{t('admin:k5.funding.status_prefix', 'Statut : ')}<strong>{d.statusLabel}</strong>{t('admin:k5.funding.version_suffix', ' — version {{version}}', { version: d.version })}{d.decisionRef ? t('admin:k5.funding.decision_suffix', ' — décision {{ref}} du {{date}}', { ref: d.decisionRef, date: day(d.decisionAt) }) : ''}{d.submittedAt ? t('admin:k5.funding.submitted_suffix', ' — déposé le {{date}}', { date: day(d.submittedAt) }) : ''}</p>
      <Status msg={k.msg} problem={k.problem || exportProblem} id="admin-funding-detail" />
      {d.warnings.length ? (
        <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm" aria-labelledby="fd-warn" data-testid="funding-warnings">
          <h2 id="fd-warn" className="font-semibold">{t('admin:k5.funding.warnings', 'Points à compléter ({{n}})', { n: d.warnings.length })}</h2>
          <ul className="list-disc pl-5">{d.warnings.map((w) => <li key={w.code + w.message}>{w.blocking ? <strong>{t('admin:k5.funding.blocking_prefix', 'Bloquant : ')}</strong> : null}{w.message}</li>)}</ul>
        </section>
      ) : <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">{t('admin:k5.funding.no_warning', 'Aucun point à compléter détecté. La relecture et la décision de déposer restent celles du porteur.')}</p>}

      <fieldset disabled={closed} className="space-y-4">
        <section className="grid gap-2 rounded border p-3 sm:grid-cols-2" aria-label={t('admin:k5.funding.identification', 'Identification du dossier')}>
          <Field id="fdd-title" label={t('admin:k5.funding.field_title', 'Titre')} value={draft.title} onChange={(x) => setDraft({ ...draft, title: x })} />
          <Field id="fdd-funder" label={t('admin:k5.funding.funder', 'Financeur')} value={draft.funderName} onChange={(x) => setDraft({ ...draft, funderName: x })} />
          <Field id="fdd-prog" label={t('admin:k5.funding.programme', 'Programme')} value={draft.programmeName} onChange={(x) => setDraft({ ...draft, programmeName: x })} />
          <Field id="fdd-url" label={t('admin:k5.funding.programme_url', 'Adresse officielle du programme')} value={draft.programmeUrl} onChange={(x) => setDraft({ ...draft, programmeUrl: x })} />
          <Field id="fdd-deadline" label={t('admin:k5.funding.deadline', 'Date limite')} type="date" value={draft.deadline} onChange={(x) => setDraft({ ...draft, deadline: x })} />
        </section>
        <section className="space-y-3 rounded border p-3" aria-label={t('admin:k5.funding.sections', 'Sections')}>
          {(v.sections || []).map((s) => <Field key={s.key} id={`fdd-sec-${s.key}`} label={`${s.label}${s.required ? t('admin:k5.funding.expected', ' (attendue)') : ''}`} rows={5} value={c.sections?.[s.key] || ''} onChange={(x) => setC({ sections: { ...c.sections, [s.key]: x } })} />)}
        </section>
        {/* R46 / P27: the funder's own headings prevail — added here beside the Cerfa sections; an « attendue » heading left empty blocks « prêt pour validation » */}
        <section className="space-y-3 rounded border p-3" aria-labelledby="fdd-rub" data-testid="funding-rubriques">
          <h2 id="fdd-rub" className="font-semibold">{t('admin:k5.funding.rubriques', 'Rubriques demandées par le financeur')}</h2>
          <p className="text-sm text-slate-700">{t('admin:k5.funding.rubriques_help', 'Recopiez les intitulés exacts du dossier du financeur : ils priment sur les sections du Cerfa.')}</p>
          {(c.rubriques || []).map((r, i) => {
            const upd = (patch) => setC({ rubriques: c.rubriques.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
            return (
              <div key={r.id || i} className="space-y-2 rounded border border-slate-200 p-2" data-testid="funding-rubrique">
                <Field id={`fdd-rub-${i}-titre`} label={t('admin:k5.funding.rubrique_title', 'Intitulé du financeur')} value={r.titre || ''} onChange={(x) => upd({ titre: x })} />
                <Field id={`fdd-rub-${i}-texte`} label={t('admin:k5.funding.rubrique_text', 'Texte')} rows={4} value={r.texte || ''} onChange={(x) => upd({ texte: x })} />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm" htmlFor={`fdd-rub-${i}-att`}>
                    <input id={`fdd-rub-${i}-att`} type="checkbox" checked={r.attendue === true} onChange={(e) => upd({ attendue: e.target.checked })} />
                    {t('admin:k5.funding.rubrique_required', 'Rubrique attendue par le financeur')}
                  </label>
                  <Button type="button" size="sm" variant="outline" onClick={() => setC({ rubriques: c.rubriques.filter((_, n) => n !== i) })}>{t('admin:k5.funding.remove', 'Retirer')}</Button>
                </div>
              </div>
            );
          })}
          <Button type="button" size="sm" variant="outline" onClick={() => setC({ rubriques: [...(c.rubriques || []), { id: Math.random().toString(36).slice(2, 10), titre: '', texte: '', attendue: true }] })}>{t('admin:k5.funding.rubrique_add', 'Ajouter une rubrique du financeur')}</Button>
        </section>
        <Rows title={t('admin:k5.funding.budget', 'Budget prévisionnel')} rows={c.budget || []} onChange={(budget) => setC({ budget })} add={blankLine}
          columns={[['poste', t('admin:k5.funding.col.poste', 'Poste'), 'wide'], ['nature', t('admin:k5.funding.col.nature', 'Nature'), 'select', { CHARGE: t('admin:k5.funding.col.charge', 'Charge'), PRODUIT: t('admin:k5.funding.col.produit', 'Produit') }], ['montant', t('admin:k5.funding.col.amount', 'Montant (€)'), 'amount'], ['statut', t('admin:k5.funding.col.status', 'Statut'), 'select', v.budgetStatuses || {}], ['justification', t('admin:k5.funding.col.justification', 'Justification (relevé, devis, facture)'), 'wide']]} />
        <p className="text-sm">{t('admin:k5.funding.totals', 'Charges : {{charges}} — produits : {{produits}} (chiffres du dernier enregistrement).', { charges: eur(t, d.totals.charges), produits: eur(t, d.totals.produits) })}</p>
        <Rows title={t('admin:k5.funding.plan', 'Plan de financement')} rows={c.financement || []} onChange={(financement) => setC({ financement })} add={() => ({ id: Math.random().toString(36).slice(2, 10), financeur: '', montant: '', statut: 'ENVISAGE', reference: '' })}
          columns={[['financeur', t('admin:k5.funding.funder', 'Financeur'), 'wide'], ['montant', t('admin:k5.funding.col.amount', 'Montant (€)'), 'amount'], ['statut', t('admin:k5.funding.col.status', 'Statut'), 'select', v.financingStatuses || {}], ['reference', t('admin:k5.funding.col.decision', 'Décision du financeur (référence, date)'), 'wide']]} />
        <Rows title={t('admin:k5.funding.calendar', 'Calendrier')} rows={c.jalons || []} onChange={(jalons) => setC({ jalons })} add={() => ({ id: Math.random().toString(36).slice(2, 10), libelle: '', date: '', statut: 'PREVU' })}
          columns={[['libelle', t('admin:k5.funding.col.step', 'Étape'), 'wide'], ['date', t('admin:k5.funding.col.date', 'Date'), 'date'], ['statut', t('admin:k5.funding.col.state', 'État'), 'select', { PREVU: t('admin:k5.funding.col.planned', 'Prévu'), FAIT: t('admin:k5.funding.col.done', 'Fait') }]]} />
        <Rows title={t('admin:k5.funding.pieces', 'Pièces justificatives')} rows={c.pieces || []} onChange={(pieces) => setC({ pieces })} add={() => ({ code: Math.random().toString(36).slice(2, 10), libelle: '', statut: 'MANQUANTE', reference: '' })}
          columns={[['libelle', t('admin:k5.funding.col.piece', 'Pièce'), 'wide'], ['statut', t('admin:k5.funding.col.state', 'État'), 'select', v.pieceStatuses || {}], ['reference', t('admin:k5.funding.col.where', 'Où se trouve le document'), 'wide']]} />
        <div className="flex flex-wrap items-end gap-2">
          <Field id="fdd-note" label={t('admin:k5.funding.version_note', 'Note de version (facultatif)')} value={note} onChange={setNote} />
          <Button disabled={k.busy} onClick={async () => { const out = await k.act({ action: 'save', id: d.id, version: d.version, note, ...draft }, (o) => t('admin:k5.funding.saved', 'Enregistré (version {{version}}).', { version: o?.dossier?.version }), 'funding'); if (out) setNote(''); }}>{t('admin:k5.funding.save', 'Enregistrer')}</Button>
        </div>
      </fieldset>

      <section className="space-y-2 rounded border p-3" aria-labelledby="fd-status">
        <h2 id="fd-status" className="font-semibold">{t('admin:k5.funding.status_heading', 'Statut')}</h2>
        {next.length ? (
          <div className="flex flex-wrap items-end gap-2">
            {next.some((s) => ['DEPOSE', 'ACCORDE', 'REFUSE'].includes(s)) ? <Field id="fdd-date" label={t('admin:k5.funding.decision_date', 'Date (dépôt ou décision)')} type="date" value={decision.date} onChange={(x) => setDecision({ ...decision, date: x })} /> : null}
            {next.some((s) => ['ACCORDE', 'REFUSE'].includes(s)) ? <Field id="fdd-ref" label={t('admin:k5.funding.decision_ref', 'Référence de la décision du financeur')} value={decision.reference} onChange={(x) => setDecision({ ...decision, reference: x })} /> : null}
            {next.map((s) => <Button key={s} size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'status', id: d.id, status: s, ...decision }, t('admin:k5.funding.status_set', 'Statut : {{status}}.', { status: v.statuses?.[s] || s }), 'funding')}>{v.statuses?.[s] || s}</Button>)}
          </div>
        ) : <p className="text-sm">{t('admin:k5.funding.closed', 'Dossier clos.')}</p>}
      </section>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportMd}>{t('admin:k5.funding.download', 'Télécharger le document de travail (Markdown)')}</Button>
        <Button variant="outline" onClick={() => window.print()}>{t('admin:k5.funding.print', 'Imprimer')}</Button>
      </div>
      <section className="rounded border p-3 text-sm" aria-labelledby="fd-versions">
        <h2 id="fd-versions" className="font-semibold">{t('admin:k5.funding.versions', 'Versions')}</h2>
        <ul>{(k.data?.versions || []).map((x) => <li key={x.version}>{t('admin:k5.funding.version_line', 'Version {{version}} — {{date}} — {{by}}', { version: x.version, date: day(x.savedAt), by: x.savedBy })}{x.note ? ` — ${x.note}` : ''}</li>)}</ul>
      </section>
    </div>
  );
}
