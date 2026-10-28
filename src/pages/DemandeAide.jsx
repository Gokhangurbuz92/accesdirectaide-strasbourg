// @ts-nocheck
import { useState } from 'react';
import SEO from '@/components/SEO';
import { csrfFetch } from '@/lib/csrf';
import { Button } from '@/components/ui/button';

const CATS = [['ACCOUNT', 'Mon compte'], ['BOOKING', 'Un rendez-vous'], ['CONTENT', 'Une information du site'], ['PRIVACY', 'Mes données personnelles'], ['ACCESSIBILITY', 'L’accessibilité du site'], ['OTHER', 'Autre chose']];

/** PKG-5 / A19 — public help request (/demande-aide). Stored for the ADA support team; no account needed; never asks for documents or dossier content. */
export default function DemandeAide() {
  const [cat, setCat] = useState(''); const [message, setMessage] = useState(''); const [contact, setContact] = useState(''); const [website, setWebsite] = useState('');
  const [done, setDone] = useState(null); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setProblem(''); setBusy(true);
    try {
      const r = await csrfFetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: cat, message, contact, website }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setProblem(body.message || 'Envoi impossible pour le moment. Réessayez plus tard.'); return; }
      setDone(body);
    } catch { setProblem('Envoi impossible pour le moment. Réessayez plus tard.'); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <SEO title="Demander de l’aide" description="Écrire à l’équipe d’Accès Direct Aide" path="/demande-aide" />
      <h1 className="text-2xl font-bold">Demander de l’aide</h1>
      <p>L’équipe d’Accès Direct Aide lit votre message. N’écrivez pas d’informations médicales et n’envoyez pas de documents : nous n’en avons pas besoin pour vous répondre.</p>
      {done ? (
        <div role="status" className="rounded border border-green-300 bg-green-50 p-3" data-testid="support-done">
          <p>Votre demande est enregistrée{done.reference ? ` (référence ${done.reference})` : ''}.</p>
          {done.privacy ? <p>Elle est transmise à la personne chargée de la protection des données.</p> : null}
          <p>Nous répondons seulement si vous avez laissé un moyen de vous joindre.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          {problem ? <p role="alert" data-testid="support-problem" className="text-red-800">{problem}</p> : null}
          <div className="space-y-1">
            <label htmlFor="sup-cat" className="block font-medium">C’est à propos de</label>
            <select id="sup-cat" required className="w-full rounded border p-2" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Choisir</option>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="sup-msg" className="block font-medium">Votre message</label>
            <textarea id="sup-msg" required rows={6} maxLength={4000} className="w-full rounded border p-2" value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby="sup-msg-help" />
            <p id="sup-msg-help" className="text-sm text-slate-700">Entre 10 et 4000 caractères.</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="sup-contact" className="block font-medium">Comment vous répondre (facultatif)</label>
            <input id="sup-contact" className="w-full rounded border p-2" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="adresse e-mail ou téléphone" />
          </div>
          <div aria-hidden="true" className="hidden"><label htmlFor="sup-website">Ne pas remplir</label><input id="sup-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
          <Button type="submit" disabled={busy || !cat || message.trim().length < 10}>Envoyer</Button>
        </form>
      )}
    </div>
  );
}
