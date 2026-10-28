// @ts-nocheck
import { useState } from 'react';
import { Loader2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCsrfHeaders } from '@/lib/csrf';
import VisioWindow from '@/components/Visio/VisioWindow';

/**
 * PKG-3 / B07 — the structure's video controls for a VIDEO appointment: validate / withdraw video, and join (moderator) inside the time window.
 * Every rule is enforced by POST /api/pro/appointments/visio; this component only shows the server's answer. No link is ever shown, copied or e-mailed.
 * @param {{ appointment: any, onChange?: () => void }} props
 */
export default function VisioTrigger({ appointment, onChange }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [join, setJoin] = useState(null);
  const video = appointment?.video || {};
  const call = async (action) => {
    setBusy(true); setProblem(''); setMessage('');
    try {
      const token = localStorage.getItem('pro_token');
      const res = await fetch('/api/pro/appointments/visio', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...getCsrfHeaders() }, body: JSON.stringify({ appointmentId: appointment.id, action }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Erreur');
      if (action === 'join') setJoin(data.join);
      else { setMessage(action === 'approve' ? 'Visio validée. La personne est prévenue (sans lien) et rejoindra depuis son espace.' : 'Validation de la visio retirée. La personne est prévenue.'); if (onChange) onChange(); }
    } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  };
  if (appointment?.mode !== 'VIDEO') return <p className="text-sm text-slate-600" data-testid="pro-visio-in-person">Rendez-vous en présentiel : pas de visio.</p>;
  return (
    <div className="space-y-2" data-testid="pro-visio">
      {!video.service?.available ? <p className="text-sm text-amber-900" data-testid="pro-visio-disabled">La visio n’est pas activée sur ce service pour le moment.</p> : null}
      {video.service?.sandbox ? <p className="text-sm text-amber-900" data-testid="pro-visio-sandbox">Environnement de test : la connexion au fournisseur de visio n’est pas vérifiée ici.</p> : null}
      <p className="text-sm text-slate-700" data-testid="pro-visio-state">{video.approved ? 'Visio validée' : 'Visio à valider'} · {video.citizenConsent ? 'accord de la personne enregistré' : 'accord de la personne manquant'}{video.opensAt ? ` · salle ouverte à partir du ${new Date(video.opensAt).toLocaleString('fr-FR')}` : ''}</p>
      <div className="flex flex-wrap gap-2">
        {!video.approved ? <Button type="button" size="sm" disabled={busy || !video.service?.available} onClick={() => call('approve')} data-testid="pro-visio-approve">{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Video className="mr-1 h-4 w-4" />}Valider la visio</Button>
          : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => call('revoke')} data-testid="pro-visio-revoke">Retirer la validation</Button>}
        <Button type="button" size="sm" variant="outline" disabled={busy || !video.approved} onClick={() => call('join')} data-testid="pro-visio-join">Rejoindre la visio</Button>
      </div>
      {message ? <p role="status" className="text-sm text-emerald-800" data-testid="pro-visio-status">{message}</p> : null}
      {problem ? <p role="alert" className="text-sm text-red-800" data-testid="pro-visio-problem">{problem}</p> : null}
      {join ? <VisioWindow join={join} onClose={() => setJoin(null)} /> : null}
    </div>
  );
}
