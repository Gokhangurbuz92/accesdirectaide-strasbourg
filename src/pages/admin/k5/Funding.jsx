// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { downloadText, explain, useK5 } from './helpers.js';
import { Field, Status } from './ui.jsx';

const day = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const eur = (n) => (n === null || n === undefined || n === '' ? 'à renseigner' : `${Number(n).toFixed(2).replace('.', ',')} €`);
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
  const k = useK5('funding'); const [f, setF] = useState({}); const set = (x, v) => setF((s) => ({ ...s, [x]: v }));
  return (
    <div className="space-y-6 p-4" data-testid="admin-funding">
      <h1 className="text-2xl font-bold">Dossiers de financement</h1>
      <p className="text-sm text-slate-700">Préparation des demandes de subvention et de financement de l’association. Les montants restent provisoires tant qu’un justificatif ne les confirme pas ; une décision d’un financeur ne s’enregistre qu’avec sa référence.</p>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-funding" />
      <section className="space-y-2 rounded border p-3" aria-labelledby="fd-new">
        <h2 id="fd-new" className="font-semibold">Nouveau dossier</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="fd-title" label="Titre du dossier" value={f.title || ''} onChange={(v) => set('title', v)} />
          <Field id="fd-funder" label="Financeur (s’il est connu)" value={f.funderName || ''} onChange={(v) => set('funderName', v)} />
          <Field id="fd-prog" label="Programme ou appel à projets" value={f.programmeName || ''} onChange={(v) => set('programmeName', v)} />
          <Field id="fd-url" label="Adresse officielle du programme" value={f.programmeUrl || ''} onChange={(v) => set('programmeUrl', v)} />
          <Field id="fd-deadline" label="Date limite" type="date" value={f.deadline || ''} onChange={(v) => set('deadline', v)} />
        </div>
        <Button size="sm" disabled={k.busy} onClick={async () => { const out = await k.act({ action: 'create', ...f }, 'Dossier créé et prérempli avec les informations validées du projet.'); if (out?.dossier) setF({}); }}>Créer le dossier</Button>
      </section>
      <ul className="space-y-2">
        {(k.data?.dossiers || []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm" data-testid="admin-funding-item">
            <span><strong>{d.title}</strong> — {d.funderName || 'financeur à préciser'} — {d.statusLabel} — date limite {day(d.deadline)} — version {d.version}{d.blocking ? ` — ${d.blocking} point(s) bloquant(s)` : ''}</span>
            <Link className="text-sky-800 underline" to={`/admin/financement/${encodeURIComponent(d.id)}`}>Ouvrir</Link>
          </li>
        ))}
        {k.data && !(k.data.dossiers || []).length ? <li className="text-sm text-slate-700">Aucun dossier pour le moment.</li> : null}
      </ul>
    </div>
  );
}

function Rows({ title, rows, onChange, columns, add }) {
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
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(rows.filter((_, n) => n !== i))}>Retirer</Button>
        </div>
      ))}
      {add ? <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, add()])}>Ajouter une ligne</Button> : null}
    </section>
  );
}

function FundingDetail({ id }) {
  const k = useK5(`funding?id=${encodeURIComponent(id)}`);
  const [draft, setDraft] = useState(null); const [note, setNote] = useState(''); const [decision, setDecision] = useState({ date: '', reference: '' });
  const d = k.data?.dossier; const [exportProblem, setExportProblem] = useState('');
  const lists = useK5('funding');
  useEffect(() => { if (d) setDraft({ title: d.title, funderName: d.funderName || '', programmeName: d.programmeName || '', programmeUrl: d.programmeUrl || '', deadline: d.deadline ? String(d.deadline).slice(0, 10) : '', content: d.content }); }, [d]);
  if (k.error) return <div className="p-4"><Status problem={k.error} id="admin-funding-detail" /></div>;
  if (!d || !draft) return <p className="p-4" role="status">Chargement…</p>;
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
      <p><Link to="/admin/financement" className="text-sm text-sky-800 underline">← Tous les dossiers</Link></p>
      <h1 className="text-2xl font-bold">{d.title}</h1>
      <p className="text-sm">Statut : <strong>{d.statusLabel}</strong> — version {d.version}{d.decisionRef ? ` — décision ${d.decisionRef} du ${day(d.decisionAt)}` : ''}{d.submittedAt ? ` — déposé le ${day(d.submittedAt)}` : ''}</p>
      <Status msg={k.msg} problem={k.problem || exportProblem} id="admin-funding-detail" />
      {d.warnings.length ? (
        <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm" aria-labelledby="fd-warn" data-testid="funding-warnings">
          <h2 id="fd-warn" className="font-semibold">Points à compléter ({d.warnings.length})</h2>
          <ul className="list-disc pl-5">{d.warnings.map((w) => <li key={w.code + w.message}>{w.blocking ? <strong>Bloquant : </strong> : null}{w.message}</li>)}</ul>
        </section>
      ) : <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">Aucun point à compléter détecté. La relecture et la décision de déposer restent celles du porteur.</p>}

      <fieldset disabled={closed} className="space-y-4">
        <section className="grid gap-2 rounded border p-3 sm:grid-cols-2" aria-label="Identification du dossier">
          <Field id="fdd-title" label="Titre" value={draft.title} onChange={(x) => setDraft({ ...draft, title: x })} />
          <Field id="fdd-funder" label="Financeur" value={draft.funderName} onChange={(x) => setDraft({ ...draft, funderName: x })} />
          <Field id="fdd-prog" label="Programme" value={draft.programmeName} onChange={(x) => setDraft({ ...draft, programmeName: x })} />
          <Field id="fdd-url" label="Adresse officielle du programme" value={draft.programmeUrl} onChange={(x) => setDraft({ ...draft, programmeUrl: x })} />
          <Field id="fdd-deadline" label="Date limite" type="date" value={draft.deadline} onChange={(x) => setDraft({ ...draft, deadline: x })} />
        </section>
        <section className="space-y-3 rounded border p-3" aria-label="Sections">
          {(v.sections || []).map((s) => <Field key={s.key} id={`fdd-sec-${s.key}`} label={`${s.label}${s.required ? ' (attendue)' : ''}`} rows={5} value={c.sections?.[s.key] || ''} onChange={(x) => setC({ sections: { ...c.sections, [s.key]: x } })} />)}
        </section>
        <Rows title="Budget prévisionnel" rows={c.budget || []} onChange={(budget) => setC({ budget })} add={blankLine}
          columns={[['poste', 'Poste', 'wide'], ['nature', 'Nature', 'select', { CHARGE: 'Charge', PRODUIT: 'Produit' }], ['montant', 'Montant (€)', 'amount'], ['statut', 'Statut', 'select', v.budgetStatuses || {}], ['justification', 'Justification (relevé, devis, facture)', 'wide']]} />
        <p className="text-sm">Charges : {eur(d.totals.charges)} — produits : {eur(d.totals.produits)} (chiffres du dernier enregistrement).</p>
        <Rows title="Plan de financement" rows={c.financement || []} onChange={(financement) => setC({ financement })} add={() => ({ id: Math.random().toString(36).slice(2, 10), financeur: '', montant: '', statut: 'ENVISAGE', reference: '' })}
          columns={[['financeur', 'Financeur', 'wide'], ['montant', 'Montant (€)', 'amount'], ['statut', 'Statut', 'select', v.financingStatuses || {}], ['reference', 'Décision du financeur (référence, date)', 'wide']]} />
        <Rows title="Calendrier" rows={c.jalons || []} onChange={(jalons) => setC({ jalons })} add={() => ({ id: Math.random().toString(36).slice(2, 10), libelle: '', date: '', statut: 'PREVU' })}
          columns={[['libelle', 'Étape', 'wide'], ['date', 'Date', 'date'], ['statut', 'État', 'select', { PREVU: 'Prévu', FAIT: 'Fait' }]]} />
        <Rows title="Pièces justificatives" rows={c.pieces || []} onChange={(pieces) => setC({ pieces })} add={() => ({ code: Math.random().toString(36).slice(2, 10), libelle: '', statut: 'MANQUANTE', reference: '' })}
          columns={[['libelle', 'Pièce', 'wide'], ['statut', 'État', 'select', v.pieceStatuses || {}], ['reference', 'Où se trouve le document', 'wide']]} />
        <div className="flex flex-wrap items-end gap-2">
          <Field id="fdd-note" label="Note de version (facultatif)" value={note} onChange={setNote} />
          <Button disabled={k.busy} onClick={async () => { const out = await k.act({ action: 'save', id: d.id, version: d.version, note, ...draft }, (o) => `Enregistré (version ${o?.dossier?.version}).`, 'funding'); if (out) setNote(''); }}>Enregistrer</Button>
        </div>
      </fieldset>

      <section className="space-y-2 rounded border p-3" aria-labelledby="fd-status">
        <h2 id="fd-status" className="font-semibold">Statut</h2>
        {next.length ? (
          <div className="flex flex-wrap items-end gap-2">
            {next.some((s) => ['DEPOSE', 'ACCORDE', 'REFUSE'].includes(s)) ? <Field id="fdd-date" label="Date (dépôt ou décision)" type="date" value={decision.date} onChange={(x) => setDecision({ ...decision, date: x })} /> : null}
            {next.some((s) => ['ACCORDE', 'REFUSE'].includes(s)) ? <Field id="fdd-ref" label="Référence de la décision du financeur" value={decision.reference} onChange={(x) => setDecision({ ...decision, reference: x })} /> : null}
            {next.map((s) => <Button key={s} size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'status', id: d.id, status: s, ...decision }, `Statut : ${v.statuses?.[s] || s}.`, 'funding')}>{v.statuses?.[s] || s}</Button>)}
          </div>
        ) : <p className="text-sm">Dossier clos.</p>}
      </section>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportMd}>Télécharger le document de travail (Markdown)</Button>
        <Button variant="outline" onClick={() => window.print()}>Imprimer</Button>
      </div>
      <section className="rounded border p-3 text-sm" aria-labelledby="fd-versions">
        <h2 id="fd-versions" className="font-semibold">Versions</h2>
        <ul>{(k.data?.versions || []).map((x) => <li key={x.version}>Version {x.version} — {day(x.savedAt)} — {x.savedBy}{x.note ? ` — ${x.note}` : ''}</li>)}</ul>
      </section>
    </div>
  );
}
