// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useK5 } from './helpers.js';
import { Status, Field } from './ui.jsx';

const CAT = { ACCOUNT: 'Compte', BOOKING: 'Rendez-vous', CONTENT: 'Contenu', PRIVACY: 'Données personnelles', ACCESSIBILITY: 'Accessibilité', OTHER: 'Autre' };
const ST = { OPEN: 'Nouvelle', IN_PROGRESS: 'En cours', ANSWERED: 'Répondue', CLOSED: 'Close' };

/** PKG-5 / A19 — support requests (/admin/support): read (MFA), take, answer, close with a note. No dossier, case or document is reachable from here. */
export default function AdminSupport() {
  const k = useK5('support'); const [note, setNote] = useState({});
  return (
    <div className="space-y-4 p-4" data-testid="admin-support">
      <h1 className="text-2xl font-bold">Demandes d’aide</h1>
      <p className="text-sm text-slate-700">Les demandes « données personnelles » sont à traiter dans la console de protection des données. Aucune information de dossier n’est accessible depuis le support.</p>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-support" />
      {k.error ? <button type="button" className="rounded border px-3 py-1 text-sm underline" data-testid="admin-support-retry" onClick={k.load}>Réessayer</button> : null}
      <ul className="space-y-3">
        {(k.data?.requests || []).map((r) => (
          <li key={r.id} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-support-request">
            <p className="font-semibold">{CAT[r.category] || r.category} — {ST[r.status] || r.status} — {new Date(r.createdAt).toLocaleString('fr-FR')}{r.assignedTo ? ` — suivie par ${r.assignedTo}` : ''}</p>
            {r.routedTo === 'PRIVACY_CONSOLE' ? <p className="text-amber-800">À traiter dans la console de protection des données.</p> : null}
            <p className="whitespace-pre-wrap">{r.message ?? '(illisible)'}</p>
            {r.contact ? <p>Contact : {r.contact}</p> : null}
            <Field id={`sup-${r.id}`} label="Réponse / traitement (note interne)" value={note[r.id] || ''} onChange={(v) => setNote((x) => ({ ...x, [r.id]: v }))} rows={2} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, status: 'IN_PROGRESS', assignToMe: true }, 'Demande prise en charge.')}>Prendre en charge</Button>
              <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, status: 'ANSWERED', resolutionNote: note[r.id] }, 'Réponse enregistrée.')}>Marquer répondue</Button>
              <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, status: 'CLOSED', resolutionNote: note[r.id] }, 'Demande close.')}>Clore</Button>
            </div>
          </li>
        ))}
        {k.data && !k.data.requests.length ? <li>Aucune demande ouverte.</li> : null}
      </ul>
    </div>
  );
}
