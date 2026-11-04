// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import EntityHistory from '@/components/admin/EntityHistory';
import VerificationPanel from '@/components/admin/VerificationPanel';
import { explain } from '@/pages/admin/k5/helpers.js';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { chooseMessage, emailMessage, fieldA11y, httpsUrlMessage, looksLikeEmail, looksLikeHttpsUrl, requiredMessage } from '@/lib/fieldErrors';

/**
 * PKG-11 / A02 — administrator editor of one catalogue record through /api/admin/content (before: it wrote to read-only public endpoints and used field names
 * the table does not have, so nothing could be saved). Editorial fields only; verification and publication on the site stay with the verification register.
 * `fields`: [{ name, label, type: 'text' | 'textarea' | 'list' | 'boolean' | 'select' | 'steps' | 'links', options?, required? }]; « list » = one value per line;
 * « steps » = a guide's steps { titre, texte } (an existing image is kept); « links » = { nom, url } pairs (https). FALC texts and the restoration of a version have
 * their own governed screens (/admin/falc, /admin/versions).
 */
const toForm = (fields, item) => Object.fromEntries(fields.map((f) => [f.name,
  f.type === 'list' ? (item?.[f.name] || []).join('\n')
    : f.type === 'boolean' ? Boolean(item?.[f.name])
      : f.type === 'steps' || f.type === 'links' ? (Array.isArray(item?.[f.name]) ? item[f.name].map((x) => ({ ...x })) : [])
        : (item?.[f.name] ?? '')]));
const fromForm = (fields, form) => Object.fromEntries(fields.map((f) => [f.name,
  f.type === 'list' ? String(form[f.name] || '').split('\n').map((x) => x.trim()).filter(Boolean)
    : f.type === 'boolean' ? Boolean(form[f.name])
      : f.type === 'steps' ? form[f.name].filter((x) => String(x.titre || '').trim() || String(x.texte || '').trim()).map((x) => ({ titre: String(x.titre || ''), texte: String(x.texte || ''), ...(x.image ? { image: x.image } : {}) }))
        : f.type === 'links' ? form[f.name].filter((x) => String(x.nom || '').trim() || String(x.url || '').trim()).map((x) => ({ nom: String(x.nom || ''), url: String(x.url || '') }))
          : String(form[f.name] ?? '')]));

/**
 * R43 (A5) — what the server would refuse, said per field before anything is sent: a required field left empty, an e-mail that is not one, a link of a
 * dispositif whose address is not https (the server refuses the whole list) or that has no name. Returns field id → message, in the order of the form.
 */
function validate(fields, form, t) {
  const errs = {};
  for (const f of fields) {
    const v = form[f.name];
    if (f.type === 'links') {
      (v || []).forEach((x, i) => {
        const nom = String(x.nom || '').trim(); const url = String(x.url || '').trim();
        if (!nom && !url) return;
        if (!nom) errs[`f-${f.name}-${i}-nom`] = requiredMessage(t, `${t('admin:catalogue_editor.link_name', 'Nom du lien')} ${i + 1}`);
        if (!looksLikeHttpsUrl(url)) errs[`f-${f.name}-${i}-url`] = url ? httpsUrlMessage(t, `${t('admin:catalogue_editor.link_url', 'Adresse (https://…)')} ${i + 1}`) : requiredMessage(t, `${t('admin:catalogue_editor.link_url', 'Adresse (https://…)')} ${i + 1}`);
      });
      continue;
    }
    if (f.type === 'boolean' || f.type === 'steps') continue;
    const text = String(v ?? '').trim();
    if (f.required && !text) errs[`f-${f.name}`] = f.type === 'select' ? chooseMessage(t, f.label) : requiredMessage(t, f.label);
    else if (text && f.name === 'email' && !looksLikeEmail(text)) errs[`f-${f.name}`] = emailMessage(t, f.label);
  }
  return errs;
}
const errorOrder = (fields, form) => fields.flatMap((f) => (f.type === 'links' ? (form[f.name] || []).flatMap((_, i) => [`f-${f.name}-${i}-nom`, `f-${f.name}-${i}-url`]) : [`f-${f.name}`]));

/** Repeated groups (steps, links): one fieldset, each item named by its position, add / remove buttons. */
function RepeatedField({ f, items, onChange, errors = {}, onFix = () => {} }) {
  const { t } = useT('admin');
  const parts = f.type === 'steps' ? [['titre', t('admin:catalogue_editor.step_title', 'Titre de l’étape'), 'input'], ['texte', t('admin:catalogue_editor.step_text', 'Texte de l’étape'), 'textarea']] : [['nom', t('admin:catalogue_editor.link_name', 'Nom du lien'), 'input'], ['url', t('admin:catalogue_editor.link_url', 'Adresse (https://…)'), 'input']];
  const set = (i, key, value) => { onChange(items.map((x, j) => (j === i ? { ...x, [key]: value } : x))); onFix(`f-${f.name}-${i}-${key}`); };
  return (
    <fieldset className="space-y-3 rounded border border-slate-300 p-3" data-testid={`admin-editor-${f.name}`}>
      <legend className="px-1 text-sm font-medium text-slate-900">{f.label}</legend>
      {items.length === 0 ? <p className="text-sm text-slate-700">{t('admin:catalogue_editor.no_item', 'Aucun élément.')}</p> : null}
      {items.map((x, i) => (
        <div key={i} className="space-y-2 rounded border border-slate-200 p-2" data-testid={`admin-editor-${f.name}-item`}>
          {parts.map(([key, label, kind]) => (
            <div key={key} className="space-y-1">
              <label htmlFor={`f-${f.name}-${i}-${key}`} className="block text-sm text-slate-900">{label} {i + 1}</label>
              {kind === 'textarea'
                ? <Textarea id={`f-${f.name}-${i}-${key}`} rows={4} value={x[key] || ''} {...fieldA11y(`f-${f.name}-${i}-${key}`, errors)} onChange={(e) => set(i, key, e.target.value)} />
                : <Input id={`f-${f.name}-${i}-${key}`} value={x[key] || ''} {...(key === 'url' ? { type: 'url', inputMode: 'url' } : {})} {...fieldA11y(`f-${f.name}-${i}-${key}`, errors)} onChange={(e) => set(i, key, e.target.value)} />}
              <FieldError field={`f-${f.name}-${i}-${key}`} errors={errors} />
            </div>
          ))}
          {x.image ? <p className="text-xs text-slate-700">{t('admin:catalogue_editor.image_kept', 'Image conservée : {{image}}', { image: x.image })}</p> : null}
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => onChange(items.filter((_, j) => j !== i))}>{f.type === 'steps' ? t('admin:catalogue_editor.remove_step', 'Retirer l’étape {{n}}', { n: i + 1 }) : t('admin:catalogue_editor.remove_link', 'Retirer le lien {{n}}', { n: i + 1 })}</Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => onChange([...items, f.type === 'steps' ? { titre: '', texte: '' } : { nom: '', url: '' }])}>
        {f.type === 'steps' ? t('admin:catalogue_editor.add_step', 'Ajouter une étape') : t('admin:catalogue_editor.add_link', 'Ajouter un lien')}
      </Button>
    </fieldset>
  );
}

export default function CatalogueEditor({ kind, title, fields, listPath }) {
  const { t } = useT('admin');
  const { id: routeId } = useParams(); const id = routeId && routeId !== 'new' ? routeId : null;
  const navigate = useNavigate();
  const [form, setForm] = useState(() => toForm(fields, null)); const [loaded, setLoaded] = useState(!id); const [meta, setMeta] = useState(null);
  const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false); const [saves, setSaves] = useState(0);
  const [loadFailure, setLoadFailure] = useState(/** @type {null | 'missing' | 'error'} */ (null)); const [attempt, setAttempt] = useState(0);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const fieldErr = useFormErrors();
  useEffect(() => {
    if (!id) return;
    setLoadFailure(null);
    apiClient.admin.content.get(kind, id).then((r) => { setForm(toForm(fields, r.item)); setMeta({ ...r.item, verifiable: r.verified !== false, editVersion: r.version || null }); setLoaded(true); })
      .catch((e) => { setProblem(explain(e)); setLoadFailure(e?.status === 404 ? 'missing' : 'error'); setLoaded(true); });   // Q10: never an empty editor for a record that did not load
  }, [kind, id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (e) => {
    e.preventDefault(); setMsg(''); setProblem('');
    if (!fieldErr.check(validate(fields, form, t))) return;
    setBusy(true);
    try {
      const body = fromForm(fields, form);
      if (id) {
        // owner LAB audit: the save carries the version loaded; a record changed by someone else in between is refused (409) instead of being overwritten
        const r = await apiClient.admin.content.update(kind, id, { ...body, ...(meta?.editVersion ? { expectedVersion: meta.editVersion } : {}) });
        setMsg(r.heldForReverification ? t('admin:catalogue_editor.saved_held', 'Enregistré. La fiche était vérifiée : elle est mise en attente de revérification.') : (r.changed || []).length ? t('admin:catalogue_editor.saved', 'Enregistré.') : t('admin:catalogue_editor.no_change', 'Aucun changement.'));
        setSaves((n) => n + 1); setAttempt((n) => n + 1);   // reload: the next save is bound to the new version
      } else {
        const r = await apiClient.admin.content.create(kind, body);
        navigate(`${listPath}/${r.item.id}`, { replace: true }); setMsg(t('admin:catalogue_editor.draft_created', 'Brouillon créé.'));
      }
    } catch (err) { setProblem(explain(err)); } finally { setBusy(false); }
  };
  if (!loaded) return <p role="status" className="p-6">{t('admin:catalogue_editor.loading', 'Chargement…')}</p>;
  if (id && loadFailure) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" data-testid={`admin-editor-${kind}-unavailable`}>
        <Link to={listPath} className="inline-flex min-h-11 items-center text-sm text-blue-800 underline">{t('admin:catalogue_editor.back', 'Retour à la liste')}</Link>
        <h1 className="text-2xl font-bold text-slate-900">{loadFailure === 'missing' ? t('admin:catalogue_editor.not_found', 'Fiche introuvable') : t('admin:catalogue_editor.load_failed', 'Impossible de charger la fiche')}</h1>
        <p role="alert" data-testid="admin-editor-problem" className="text-sm text-rose-800">{loadFailure === 'missing' ? t('admin:catalogue_editor.not_found_detail', 'Aucune fiche ne porte cet identifiant (elle a pu être supprimée ou l’adresse est incomplète).') : problem}</p>
        {loadFailure === 'error' ? <Button type="button" variant="outline" className="min-h-11" onClick={() => { setLoaded(false); setAttempt((n) => n + 1); }}>{t('admin:catalogue_editor.retry', 'Réessayer')}</Button> : null}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" data-testid={`admin-editor-${kind}`}>
      <Link to={listPath} className="inline-flex min-h-11 items-center text-sm text-blue-800 underline">{t('admin:catalogue_editor.back', 'Retour à la liste')}</Link>
      <h1 className="text-2xl font-bold text-slate-900">{id ? t('admin:catalogue_editor.edit_title', 'Modifier : {{name}}', { name: meta?.titre || meta?.nom || '' }) : t('admin:catalogue_editor.new_title', 'Nouvelle fiche — {{kind}}', { kind: title })}</h1>
      {meta ? <p className="text-sm text-slate-700" data-testid="admin-editor-meta">{t('admin:catalogue_editor.status', 'Statut : {{status}}', { status: meta.statut })}{meta.verifiable ? ` — ${meta.publication_hold ? t('admin:catalogue_editor.meta.hold', 'en attente de revérification') : meta.verification_status === 'VERIFIED' ? t('admin:catalogue_editor.meta.verified', 'vérifiée') : t('admin:catalogue_editor.meta.not_verified', 'non vérifiée')}` : t('admin:catalogue_editor.meta.editorial', ' — contenu éditorial (sans registre de vérification)')}</p> : null}
      <form onSubmit={save} className="space-y-4" noValidate aria-busy={busy || undefined}>
        <ErrorSummary ref={fieldErr.summaryRef} errors={fieldErr.errors} order={errorOrder(fields, form)} testid="admin-editor-errors" />
        {fields.map((f) => (
          <div key={f.name} className="space-y-1">
            {f.type === 'boolean' ? (
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-6 w-6" checked={Boolean(form[f.name])} onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} />{f.label}</label>
            ) : f.type === 'steps' || f.type === 'links' ? (
              <RepeatedField f={f} items={form[f.name]} errors={fieldErr.errors} onFix={fieldErr.clear} onChange={(items) => setForm({ ...form, [f.name]: items })} />
            ) : (
              <>
                <label htmlFor={`f-${f.name}`} className="block text-sm font-medium text-slate-900">{f.label}{f.required ? ' *' : ''}{f.type === 'list' ? t('admin:catalogue_editor.one_per_line', ' (une valeur par ligne)') : ''}</label>
                {f.type === 'select'
                  ? <select id={`f-${f.name}`} className="min-h-11 w-full rounded border border-slate-400 bg-white p-2" value={form[f.name]} {...(f.required ? { 'aria-required': 'true' } : {})} {...fieldA11y(`f-${f.name}`, fieldErr.errors)} onChange={(e) => { setForm({ ...form, [f.name]: e.target.value }); fieldErr.clear(`f-${f.name}`); }}>
                    <option value="">—</option>{[...new Set([...(f.options || []), form[f.name]].filter(Boolean))].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  : f.type === 'textarea' || f.type === 'list'
                  ? <Textarea id={`f-${f.name}`} rows={f.type === 'list' ? 3 : 4} value={form[f.name]} {...(f.required ? { 'aria-required': 'true' } : {})} {...fieldA11y(`f-${f.name}`, fieldErr.errors)} onChange={(e) => { setForm({ ...form, [f.name]: e.target.value }); fieldErr.clear(`f-${f.name}`); }} />
                  : <Input id={`f-${f.name}`} value={form[f.name]} required={Boolean(f.required)} {...fieldA11y(`f-${f.name}`, fieldErr.errors)} onChange={(e) => { setForm({ ...form, [f.name]: e.target.value }); fieldErr.clear(`f-${f.name}`); }} />}
                <FieldError field={`f-${f.name}`} errors={fieldErr.errors} />
              </>
            )}
          </div>
        ))}
        <Button type="submit" disabled={busy} className="min-h-11">{id ? t('admin:catalogue_editor.save', 'Enregistrer') : t('admin:catalogue_editor.create_draft', 'Créer le brouillon')}</Button>
      </form>
      <p role="status" aria-live="polite" data-testid="admin-editor-status" className="text-sm text-slate-900">{busy ? t('common:form.status.saving', 'Enregistrement en cours…') : msg}</p>
      {problem ? <p role="alert" data-testid="admin-editor-problem" className="text-sm text-rose-800">{problem}</p> : null}
      {id && ['aide', 'demarche', 'structure'].includes(kind) ? <p className="text-sm text-slate-700"><Trans i18n={i18n} i18nKey="admin:catalogue_editor.falc_hint" defaults="Les textes faciles à lire se relisent et se signent dans <0>Textes faciles à lire</0>." components={[<Link key="falc" className="text-blue-800 underline" to={`/admin/falc?type=${kind}&id=${encodeURIComponent(id)}`} />]} /></p> : null}
      {id && meta?.verifiable && ['aide', 'demarche', 'structure', 'dispositif'].includes(kind) ? (
        // owner LAB audit: any record can be verified (the WS2 page covers only the 49 launch records), with the same version-bound form
        <details className="rounded border p-3" data-testid="admin-editor-verification" onToggle={(e) => setVerifyOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer font-semibold text-blue-800">{t('admin:catalogue_editor.human_verification', 'Vérification par une personne (en plus de la vérification automatique D-5 v2)')}</summary>
          <p className="mt-1 text-sm text-slate-700">{t('admin:catalogue_editor.save_first', 'Enregistrez d’abord vos modifications : la vérification porte sur le contenu enregistré, lu ici en entier.')}</p>
          {verifyOpen ? <VerificationPanel key={saves} entityType={kind} entityId={id} testIdPrefix="admin-editor" onDone={(m) => { setProblem(''); setMsg(m); setSaves((n) => n + 1); setAttempt((n) => n + 1); }} onProblem={setProblem} /> : null}
        </details>
      ) : null}
      {id ? <EntityHistory entityType={kind} entityId={id} refreshKey={saves} /> : null}
    </div>
  );
}
