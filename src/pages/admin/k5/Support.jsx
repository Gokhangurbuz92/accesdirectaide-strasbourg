// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useK5 } from './helpers.js';
import { Status, Field } from './ui.jsx';
import { useT, formatDateTime } from '@/i18n';

/** PKG-5 / A19 — support requests (/admin/support): read (MFA), take, answer, close with a note. No dossier, case or document is reachable from here. */
export default function AdminSupport() {
  const { t } = useT('admin');
  const CAT = { ACCOUNT: t('admin:k5.support.cat.account', 'Compte'), BOOKING: t('admin:k5.support.cat.booking', 'Rendez-vous'), CONTENT: t('admin:k5.support.cat.content', 'Contenu'), PRIVACY: t('admin:k5.support.cat.privacy', 'Données personnelles'), ACCESSIBILITY: t('admin:k5.support.cat.accessibility', 'Accessibilité'), OTHER: t('admin:k5.support.cat.other', 'Autre') };
  const ST = { OPEN: t('admin:k5.support.status.open', 'Nouvelle'), IN_PROGRESS: t('admin:k5.support.status.in_progress', 'En cours'), ANSWERED: t('admin:k5.support.status.answered', 'Répondue'), CLOSED: t('admin:k5.support.status.closed', 'Close') };
  const k = useK5('support'); const [note, setNote] = useState({});
  return (
    <div className="space-y-4 p-4" data-testid="admin-support">
      <h1 className="text-2xl font-bold">{t('admin:k5.support.title', 'Demandes d’aide')}</h1>
      <p className="text-sm text-slate-700">{t('admin:k5.support.intro', 'Les demandes « données personnelles » sont à traiter dans la console de protection des données. Aucune information de dossier n’est accessible depuis le support.')}</p>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-support" />
      {k.error ? <button type="button" className="rounded border px-3 py-1 text-sm underline" data-testid="admin-support-retry" onClick={k.load}>{t('admin:k5.support.retry', 'Réessayer')}</button> : null}
      <ul className="space-y-3">
        {(k.data?.requests || []).map((r) => (
          <li key={r.id} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-support-request">
            <p className="font-semibold">{CAT[r.category] || r.category} — {ST[r.status] || r.status} — {formatDateTime(r.createdAt)}{r.assignedTo ? t('admin:k5.support.assigned', ' — suivie par {{who}}', { who: r.assignedTo }) : ''}</p>
            {r.routedTo === 'PRIVACY_CONSOLE' ? <p className="text-amber-800">{t('admin:k5.support.privacy_console', 'À traiter dans la console de protection des données.')}</p> : null}
            <p className="whitespace-pre-wrap">{r.message ?? t('admin:k5.support.unreadable', '(illisible)')}</p>
            {r.contact ? <p>{t('admin:k5.support.contact', 'Contact : {{contact}}', { contact: r.contact })}</p> : null}
            <Field id={`sup-${r.id}`} label={t('admin:k5.support.note_label', 'Réponse / traitement (note interne)')} value={note[r.id] || ''} onChange={(v) => setNote((x) => ({ ...x, [r.id]: v }))} rows={2} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, status: 'IN_PROGRESS', assignToMe: true }, t('admin:k5.support.taken', 'Demande prise en charge.'))}>{t('admin:k5.support.take', 'Prendre en charge')}</Button>
              <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ id: r.id, status: 'ANSWERED', resolutionNote: note[r.id] }, t('admin:k5.support.answered_ok', 'Réponse enregistrée.'))}>{t('admin:k5.support.mark_answered', 'Marquer répondue')}</Button>
              <Button size="sm" disabled={k.busy} onClick={() => k.act({ id: r.id, status: 'CLOSED', resolutionNote: note[r.id] }, t('admin:k5.support.closed_ok', 'Demande close.'))}>{t('admin:k5.support.close', 'Clore')}</Button>
            </div>
          </li>
        ))}
        {k.data && !k.data.requests.length ? <li>{t('admin:k5.support.none', 'Aucune demande ouverte.')}</li> : null}
      </ul>
    </div>
  );
}
