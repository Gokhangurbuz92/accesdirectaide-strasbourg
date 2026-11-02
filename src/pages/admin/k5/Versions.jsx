// @ts-nocheck
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { Status, Field } from './ui.jsx';
import { useT } from '@/i18n';

/** PKG-5 / A07 — versions of a published record and exact rollback (/admin/versions). The verification state is never rolled back (only the ledger writes it). */
export default function AdminVersions() {
  const { t } = useT('admin');
  const [params] = useSearchParams();   // PKG-11 / A02: opened from a catalogue editor with ?type=&id=
  const [type, setType] = useState(['aide', 'demarche', 'structure', 'dispositif', 'guide'].includes(params.get('type')) ? params.get('type') : 'structure'); const [id, setId] = useState(params.get('id') || ''); const [reason, setReason] = useState('');
  const [list, setList] = useState(null); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  const [preview, setPreview] = useState(null);   // owner LAB audit: what a rollback would change, shown before it is done
  const show = async (versionId) => { setProblem(''); try { setPreview(await apiClient.admin.k5(`content-versions?versionId=${encodeURIComponent(versionId)}`)); } catch (e) { setProblem(explain(e)); } };
  const fmt = (v) => (v === null || v === undefined ? t('admin:k5.versions.empty_value', '(vide)') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const load = async () => { setProblem(''); try { setList((await apiClient.admin.k5(`content-versions?entityType=${type}&entityId=${encodeURIComponent(id)}`)).versions); } catch (e) { setProblem(explain(e)); } };
  useEffect(() => { if (params.get('id')) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rollback = async (versionId) => { setMsg(''); setProblem(''); try { await apiClient.admin.k5('content-versions', { versionId, reason }); setMsg(t('admin:k5.versions.restored', 'Version restaurée (l’état précédent est conservé comme nouvelle version).')); await load(); return true; } catch (e) { setProblem(explain(e)); return false; } };
  return (
    <div className="space-y-4 p-4" data-testid="admin-versions">
      <h1 className="text-2xl font-bold">{t('admin:k5.versions.title', 'Versions des fiches')}</h1>
      <p className="text-sm text-slate-700">{t('admin:k5.versions.intro', 'Chaque modification (vérification, proposition acceptée, suspension) garde la version exacte d’avant. Un retour arrière restaure le contenu ; l’état de vérification n’est jamais restauré : il ne change que par une nouvelle vérification.')}</p>
      <Status msg={msg} problem={problem} id="admin-versions" />
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1"><label htmlFor="ver-type" className="block text-sm">{t('admin:k5.versions.type', 'Type')}</label>
          <select id="ver-type" className="w-full rounded border p-2" value={type} onChange={(e) => setType(e.target.value)}><option value="structure">{t('admin:k5.versions.kind.structure', 'Structure')}</option><option value="aide">{t('admin:k5.versions.kind.aide', 'Aide')}</option><option value="demarche">{t('admin:k5.versions.kind.demarche', 'Démarche')}</option><option value="dispositif">{t('admin:k5.versions.kind.dispositif', 'Dispositif')}</option><option value="guide">{t('admin:k5.versions.kind.guide', 'Guide')}</option></select></div>
        <Field id="ver-id" label={t('admin:k5.versions.id', 'Identifiant')} value={id} onChange={setId} />
        <div className="flex items-end"><Button onClick={load}>{t('admin:k5.versions.show', 'Afficher')}</Button></div>
      </div>
      <Field id="ver-reason" label={t('admin:k5.versions.reason', 'Motif du retour arrière')} value={reason} onChange={setReason} />
      {list ? <ul className="space-y-1 text-sm">{list.map((v) => <li key={v.id} className="flex items-center gap-2" data-testid="admin-version">{new Date(v.createdAt).toLocaleString('fr-FR')} — {v.reason} — {v.actor || '—'} <Button size="sm" variant="outline" onClick={() => show(v.id)}>{t('admin:k5.versions.preview', 'Voir ce que le retour changerait')}</Button></li>)}{!list.length ? <li>{t('admin:k5.versions.none', 'Aucune version.')}</li> : null}</ul> : null}
      {preview ? (
        <section className="space-y-2 rounded border p-3" aria-labelledby="ver-preview" data-testid="admin-version-preview">
          <h2 id="ver-preview" className="font-semibold">{t('admin:k5.versions.back_to', 'Retour à la version du {{date}}', { date: new Date(preview.versionAt).toLocaleString('fr-FR') })}</h2>
          {preview.changes.length ? (
            <table className="w-full text-sm"><thead><tr className="text-left"><th scope="col">{t('admin:k5.versions.field', 'Champ')}</th><th scope="col">{t('admin:k5.versions.today', 'Aujourd’hui')}</th><th scope="col">{t('admin:k5.versions.after', 'Après le retour')}</th></tr></thead>
              <tbody>{preview.changes.map((c) => <tr key={c.field} className="align-top"><td className="font-medium">{c.field}</td><td className="whitespace-pre-wrap">{fmt(c.current)}</td><td className="whitespace-pre-wrap">{fmt(c.restored)}</td></tr>)}</tbody></table>
          ) : <p>{t('admin:k5.versions.identical', 'Cette version est identique au contenu actuel : le retour ne changerait rien.')}</p>}
          <p className="text-xs text-slate-700">{t('admin:k5.versions.never_restored', 'L’état de vérification n’est jamais restauré ; une fiche vérifiée dont le contenu change est mise en attente de revérification.')}</p>
          <Button size="sm" disabled={!preview.changes.length} onClick={() => rollback(preview.versionId).then((ok) => { if (ok) setPreview(null); })}>{t('admin:k5.versions.restore', 'Restaurer cette version')}</Button>
        </section>
      ) : null}
    </div>
  );
}
