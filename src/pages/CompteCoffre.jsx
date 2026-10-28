// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { COFFRE_CATEGORY_LABELS, COFFRE_UPLOAD_CATEGORIES, fileToBase64, formatBytes, formatDate } from '@/lib/monEspace';
import { MAX_SIZE } from '@/lib/fileVaultLimits';

const ACCEPT = 'application/pdf,image/png,image/jpeg';
const MAX = MAX_SIZE;   // PKG-11 audit: 3 Mo — the JSON upload (base64, +33 %) must fit the ~4.5 MB serverless body (10 Mo was offered and then failed)

/**
 * PKG-2 / C09 — Mon Coffre (/compte/coffre): the person keeps their own papers. The server encrypts each file before storing it, checks its type from its content and enforces
 * the limits; the screen says plainly that files are NOT scanned by an antivirus yet. Download and deletion are immediate; deletion also erases the stored file.
 */
export default function CompteCoffre() {
  const [state, setState] = useState({ loading: true, error: '', documents: [], quota: null });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [form, setForm] = useState({ category: 'identite', expiresAt: '' });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try { const out = await citizenApi.listCoffre(); setState({ loading: false, error: '', documents: out.documents || [], quota: out.quota }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? 'Connectez-vous pour accéder à Mon Coffre.' : err.message, auth: err.status === 401, documents: [], quota: null }); }   // R18: « Se connecter » only when the session is really missing (401); any other failure offers to try again (it read as « please sign in »)
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    e.preventDefault(); setMessage(''); setProblem('');
    const file = fileRef.current?.files?.[0];
    if (!file) { setProblem('Choisissez un fichier.'); return; }
    if (file.size > MAX) { setProblem('Fichier trop volumineux (3 Mo au plus).'); return; }
    setBusy(true);
    try {
      await citizenApi.uploadCoffre({ category: form.category, originalName: file.name, mimeType: file.type || undefined, fileBase64: await fileToBase64(file), expiresAt: form.expiresAt || undefined });
      setMessage('Document enregistré dans Mon Coffre.'); if (fileRef.current) fileRef.current.value = ''; await load();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const remove = async (d) => {
    setMessage(''); setProblem('');
    try { await citizenApi.deleteCoffre(d.id); setMessage('Document supprimé.'); await load(); } catch (err) { setProblem(err.message); }
  };

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">Chargement de Mon Coffre…</div>;
  if (state.error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8" data-testid="coffre-error">
        <SEO title="Mon Coffre" noindex />
        <h1 className="mb-3 text-2xl font-bold text-slate-900">Mon Coffre</h1>   {/* Q10 sweep: a heading in the failure state too */}
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>
        {state.auth ? <Button asChild className="mt-4" variant="outline"><Link to="/auth/login?next=/compte/coffre">Se connecter</Link></Button>
          : <Button type="button" className="mt-4" variant="outline" onClick={() => { setState((s) => ({ ...s, loading: true })); load(); }} data-testid="coffre-retry">Réessayer</Button>}
      </div>
    );
  }
  const q = state.quota;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-coffre">
      <SEO title="Mon Coffre" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Mon Coffre</h1>
      <p className="text-sm text-slate-700">Gardez ici vos papiers importants. Chaque fichier est chiffré sur le serveur avant d’être conservé ; vous seul y avez accès depuis votre compte.</p>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="coffre-health-notice">N’ajoutez pas de documents médicaux (certificat, compte rendu, ordonnance, dossier MDPH avec éléments médicaux) : leur hébergement demande un hébergeur agréé pour les données de santé, qui n’est pas encore en place.</p>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="coffre-scan-notice">Les fichiers ne sont pas encore analysés par un antivirus : n’ajoutez que des documents dont vous connaissez l’origine.</p>
      <div aria-live="polite" role="status" data-testid="coffre-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="coffre-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}

      <Card>
        <CardHeader><CardTitle className="text-lg">Ajouter un document</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={upload}>
            <div className="sm:col-span-2"><label htmlFor="cf-file" className="block text-sm font-medium text-slate-800">Fichier (PDF, PNG ou JPEG, 3 Mo au plus)</label><input id="cf-file" data-testid="coffre-file" ref={fileRef} type="file" accept={ACCEPT} className="mt-1 block w-full text-sm" /></div>
            <div><label htmlFor="cf-cat" className="block text-sm text-slate-800">Catégorie</label>
              <select id="cf-cat" data-testid="coffre-category" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{COFFRE_UPLOAD_CATEGORIES.map((v) => <option key={v} value={v}>{COFFRE_CATEGORY_LABELS[v]}</option>)}</select></div>
            <div><label htmlFor="cf-exp" className="block text-sm text-slate-800">Date de fin de validité (facultatif)</label><input id="cf-exp" data-testid="coffre-expires" type="date" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
            <div className="sm:col-span-2"><Button type="submit" data-testid="coffre-upload" disabled={busy}>{busy ? 'Envoi…' : 'Enregistrer le document'}</Button></div>
          </form>
          {q ? <p className="mt-3 text-xs text-slate-700" data-testid="coffre-quota">{q.files} / {q.maxFiles} documents — {formatBytes(q.bytes)} utilisés sur {formatBytes(q.maxBytes)}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Mes documents</CardTitle></CardHeader>
        <CardContent>
          {state.documents.length ? (
            <ul className="space-y-2" data-testid="coffre-list">
              {state.documents.map((d) => (
                <li key={d.id} data-testid="coffre-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-slate-900">{d.name}</span> — {COFFRE_CATEGORY_LABELS[d.category]} — {formatBytes(d.byteLength)}
                    {d.expiresAt ? <span className={d.expired ? 'text-red-800' : 'text-slate-700'}> — {d.expired ? 'expiré le' : 'valable jusqu’au'} {formatDate(d.expiresAt)}</span> : null}
                  </span>
                  <span className="flex gap-2">
                    <Button asChild size="sm" variant="outline"><a href={citizenApi.coffreDownloadUrl(d.id)} data-testid="coffre-download" aria-label={`Télécharger ${d.name}`}>Télécharger</a></Button>
                    <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" data-testid="coffre-delete" aria-label={`Supprimer ${d.name}`} onClick={() => remove(d)}>Supprimer</Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-700" data-testid="coffre-empty">Aucun document pour le moment.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
