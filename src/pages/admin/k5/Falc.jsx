// @ts-nocheck
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useK5, explain } from './helpers.js';
import { Status, Field } from './ui.jsx';
import { useT, DATE_SHORT, formatDate } from '@/i18n';

/** ADM-11: the FALC fields of each kind (api/_services/falc-governance.js FALC_FIELDS) */
const FIELDS = { aide: ['summary_falc', 'conditions_falc', 'montant_falc'], demarche: ['summary_falc'], structure: ['summary_falc'] };

/**
 * PKG-6 / D19 D22 P18 — FALC review (/admin/falc). A draft (local model, or the automatic summary when the model is unavailable) is NEVER published by itself:
 * a named administrator with MFA compares it with the source text, edits it if needed and approves; the record then shows "Version simplifiée (relue)".
 * Owner LAB audit: a draft can be asked for each FALC field (conditions and amount too), and an existing text is marked « relu » only after being read here —
 * the mark is bound to the text read (its sha-256): a text changed in between is refused. ?type=&id= opens a record (link from the catalogue editor).
 */
export default function AdminFalc() {
  const { t } = useT('admin');
  const ORIGIN = { AI_LOCAL: t('admin:k5.falc.origin.ai_local', 'brouillon du modèle local (IA)'), DETERMINISTIC: t('admin:k5.falc.origin.deterministic', 'résumé automatique sans IA') };
  const FIELD_LABEL = { summary_falc: t('admin:k5.falc.field.summary', 'Résumé facile à lire'), conditions_falc: t('admin:k5.falc.field.conditions', 'Conditions faciles à lire'), montant_falc: t('admin:k5.falc.field.montant', 'Montant facile à lire') };
  const k = useK5('falc'); const [params] = useSearchParams();
  const [f, setF] = useState({ type: params.get('type') || 'aide', id: params.get('id') || '' }); const v = (x) => f[x] ?? ''; const set = (x, val) => setF((s) => ({ ...s, [x]: val }));
  const [rec, setRec] = useState(null); const [recProblem, setRecProblem] = useState(''); const [checked, setChecked] = useState({});
  const type = v('type') || 'aide'; const fields = FIELDS[type] || ['summary_falc'];
  const loadRecord = async () => {
    setRecProblem(''); setChecked({});
    try { setRec(await apiClient.admin.k5(`falc?entityType=${encodeURIComponent(type)}&entityId=${encodeURIComponent(v('id'))}`)); }
    catch (e) { setRec(null); setRecProblem(explain(e)); }
  };
  const mark = async () => {
    const chosen = (rec?.fields || []).filter((x) => checked[x.field] && x.sha256);
    const out = await k.act({ action: 'mark_reviewed', entityType: rec.entityType, entityId: rec.entityId, fields: chosen.map((x) => x.field), seen: Object.fromEntries(chosen.map((x) => [x.field, x.sha256])), note: v('markNote') },
      (o) => t('admin:k5.falc.marked', 'Relecture enregistrée : {{fields}}.', { fields: (o.fields || []).map((x) => FIELD_LABEL[x] || x).join(', ') }));
    if (out) await loadRecord();
  };
  return (
    <div className="space-y-4 p-4" data-testid="admin-falc">
      <h1 className="text-2xl font-bold">{t('admin:k5.falc.title', 'Textes faciles à lire (FALC)')}</h1>
      <p className="text-sm text-slate-700">{t('admin:k5.falc.intro', 'Les brouillons sont produits sur cet ordinateur (modèle local) ou par un résumé automatique. Ils ne sont jamais publiés sans votre relecture. Gardez exactement les montants, dates et conditions de la source.')}</p>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-falc" />
      <section className="space-y-2 rounded border p-3" aria-labelledby="falc-new">
        <h2 id="falc-new" className="font-semibold">{t('admin:k5.falc.choose', 'Choisir une fiche')}</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="space-y-1"><label htmlFor="falc-type" className="block text-sm">{t('admin:k5.falc.type', 'Type')}</label>
            <select id="falc-type" className="w-full rounded border p-2" value={type} onChange={(e) => { set('type', e.target.value); set('field', ''); setRec(null); }}><option value="aide">{t('admin:k5.falc.kind.aide', 'Aide')}</option><option value="demarche">{t('admin:k5.falc.kind.demarche', 'Démarche')}</option><option value="structure">{t('admin:k5.falc.kind.structure', 'Structure')}</option></select></div>
          <Field id="falc-id" label={t('admin:k5.falc.record_id', 'Identifiant de la fiche')} value={v('id')} onChange={(x) => { set('id', x); setRec(null); }} />
          <div className="space-y-1"><label htmlFor="falc-field" className="block text-sm">{t('admin:k5.falc.text', 'Texte')}</label>
            <select id="falc-field" className="w-full rounded border p-2" value={v('field') || fields[0]} onChange={(e) => set('field', e.target.value)}>{fields.map((x) => <option key={x} value={x}>{FIELD_LABEL[x]}</option>)}</select></div>
          <div className="flex items-end gap-2">
            <Button disabled={k.busy || !v('id')} onClick={() => k.act({ action: 'draft', entityType: type, entityId: v('id'), field: v('field') || fields[0] }, t('admin:k5.falc.draft_created', 'Brouillon créé : il attend votre relecture ci-dessous.'))}>{t('admin:k5.falc.create_draft', 'Créer le brouillon')}</Button>
          </div>
        </div>
        <Button variant="outline" disabled={!v('id')} onClick={loadRecord} data-testid="admin-falc-open">{t('admin:k5.falc.read_current', 'Lire les textes actuels de la fiche')}</Button>
        {recProblem ? <p role="alert" className="text-sm text-red-800">{recProblem}</p> : null}
        {rec ? (
          <div className="space-y-2" data-testid="admin-falc-record">
            <p className="font-medium">{rec.title || rec.entityId}</p>
            {rec.fields.map((x) => (
              <div key={x.field} className="rounded bg-slate-50 p-2 text-sm" data-testid="admin-falc-field">
                <p className="font-medium">{FIELD_LABEL[x.field]} — {!x.text ? t('admin:k5.falc.no_text', 'aucun texte') : x.review?.current ? t('admin:k5.falc.reviewed_by', 'relu par {{by}} le {{date}}', { by: x.review.by, date: formatDate(x.review.at, DATE_SHORT) }) : x.review ? t('admin:k5.falc.changed', 'relu, mais le texte a changé depuis : à relire') : t('admin:k5.falc.not_reviewed', 'non relu')}</p>
                {x.text ? <p className="whitespace-pre-wrap">{x.text}</p> : null}
                {x.source ? <details><summary className="cursor-pointer text-blue-800">{t('admin:k5.falc.source', 'Texte source')}</summary><p className="whitespace-pre-wrap">{x.source}</p></details> : null}
                {x.text ? <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={Boolean(checked[x.field])} onChange={(e) => setChecked((c) => ({ ...c, [x.field]: e.target.checked }))} /> {t('admin:k5.falc.read_all', 'J’ai relu ce texte en entier et l’ai comparé à la source')}</label> : null}
              </div>
            ))}
            <Field id="falc-mark-note" label={t('admin:k5.falc.mark_note', 'Ce qui a été relu (conservé dans le journal)')} value={v('markNote')} onChange={(x) => set('markNote', x)} />
            <Button size="sm" disabled={k.busy || !Object.values(checked).some(Boolean)} onClick={mark} data-testid="admin-falc-mark">{t('admin:k5.falc.mark', 'Marquer les textes cochés comme relus')}</Button>
          </div>
        ) : null}
      </section>
      <ul className="space-y-3">
        {(k.data?.drafts || []).map((d) => (
          <li key={d.id} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-falc-draft">
            <p className="font-semibold">{d.title || d.entityId} — {FIELD_LABEL[d.field] || d.field} — {ORIGIN[d.origin] || d.origin}</p>
            <details><summary className="cursor-pointer text-blue-800">{t('admin:k5.falc.source', 'Texte source')}</summary><p className="whitespace-pre-wrap">{d.source || '—'}</p></details>
            {d.current ? <details><summary className="cursor-pointer text-blue-800">{t('admin:k5.falc.current', 'Version FALC actuelle')}</summary><p className="whitespace-pre-wrap">{d.current}</p></details> : null}
            <Field id={`falc-text-${d.id}`} label={t('admin:k5.falc.draft_label', 'Brouillon (modifiable)')} value={f[`t-${d.id}`] ?? d.outputText} onChange={(x) => set(`t-${d.id}`, x)} rows={6} />
            <Field id={`falc-note-${d.id}`} label={t('admin:k5.falc.review_note', 'Note de relecture')} value={v(`n-${d.id}`)} onChange={(x) => set(`n-${d.id}`, x)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={k.busy} data-testid="admin-falc-approve" onClick={() => k.act({ action: 'approve', id: d.id, text: f[`t-${d.id}`] ?? d.outputText, note: v(`n-${d.id}`) }, t('admin:k5.falc.approved', 'Texte relu et publié sur la fiche.'))}>{t('admin:k5.falc.approve', 'Approuver')}</Button>
              <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'reject', id: d.id, note: v(`n-${d.id}`) }, t('admin:k5.falc.rejected', 'Brouillon refusé.'))}>{t('admin:k5.falc.reject', 'Refuser')}</Button>
            </div>
          </li>
        ))}
        {k.data && !k.data.drafts.length ? <li>{t('admin:k5.falc.none', 'Aucun brouillon en attente.')}</li> : null}
      </ul>
    </div>
  );
}
