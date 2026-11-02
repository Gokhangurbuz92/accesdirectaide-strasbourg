// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import i18n, { useT } from '@/i18n';
import { reviewValue } from './reviewValue.js';

const explain = (e) => {
  if (e?.status === 401 || e?.status === 403) return i18n.t('admin:verification.refused_mfa', 'Refusé : cette action demande une session administrateur nominative avec MFA.');
  const p = e?.payload || {}; return p.message || p.error || e?.message || i18n.t('admin:verification.action_impossible', 'Action impossible.');
};

/**
 * Owner LAB audit — the ONE human verification form (D-5): WS2 queue, Organisations, catalogue editors. The decision is bound to the exact content shown
 * (`version`, a sha-256 of every public field computed by the server): if the record changed since it was read, the server refuses (409) and the panel reloads
 * the content to be read again. The official source is typed (or explicitly copied from the research candidate, never pre-filled), the territory is confirmed
 * by an explicit tick, and the note says what was checked. Nothing here decides: the server enforces every rule (api/_services/content-verification.js).
 * @param {{ entityType: string, entityId: string, initial?: { content?: {field: string, value: string}[], version?: string, hold?: string | null }, candidateSource?: string | null,
 *   showContent?: boolean, testIdPrefix?: string, verifyLabel?: string, onDone?: (msg: string) => void, onProblem?: (msg: string) => void }} props
 */
export default function VerificationPanel({ entityType, entityId, initial, candidateSource = null, showContent = true, testIdPrefix = 'admin-verify', verifyLabel, onDone, onProblem }) {
  const { t } = useT('admin');
  const [data, setData] = useState(initial?.version ? { content: initial.content || [], version: initial.version, hold: initial.hold || null, editHold: initial.editHold === true } : null);
  const [sourceUrl, setSourceUrl] = useState(''); const [note, setNote] = useState(''); const [territory, setTerritory] = useState(false);
  const [busy, setBusy] = useState(false); const [local, setLocal] = useState('');
  const id = `${testIdPrefix}-${entityId}`;
  const reload = useCallback(async () => {
    try { const r = await apiClient.admin.getVerification(entityType, entityId); setData({ content: r.content || [], version: r.version, hold: r.hold || null, editHold: r.editHold === true }); }
    catch (e) { setLocal(explain(e)); }
  }, [entityType, entityId]);
  useEffect(() => { if (!initial?.version) reload(); }, [initial?.version, reload]);
  useEffect(() => { if (initial?.version) setData({ content: initial.content || [], version: initial.version, hold: initial.hold || null, editHold: initial.editHold === true }); }, [initial?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (action, okMsg) => {
    setBusy(true); setLocal('');
    try {
      await apiClient.admin.verifyContent({ entityType, entityId, action, sourceUrl, evidenceNote: note, territoryConfirmed: territory === true, holdReason: action === 'HOLD' ? note : undefined,
        ...(['VERIFY', 'RELEASE_HOLD'].includes(action) ? { expectedVersion: data?.version } : {}) });
      setNote(''); setTerritory(false); setSourceUrl('');
      onDone?.(okMsg);
    } catch (e) {
      const msg = explain(e); setLocal(msg); onProblem?.(msg);
      if (e?.payload?.error === 'STALE_REVIEW') await reload();   // the content changed: show the new one, to be read again
    } finally { setBusy(false); }
  };

  if (!data) return <p role="status" className="text-sm">{local || t('admin:verification.loading', 'Chargement de la fiche…')}</p>;
  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-panel`}>
      {showContent ? (
        <details data-testid={`${testIdPrefix}-content`}>
          <summary className="cursor-pointer text-blue-800">{t('admin:verification.public_content', 'Contenu public de la fiche, en entier (ce que vous vérifiez)')}</summary>
          {data.content.length ? <dl className="mt-1 space-y-1">{data.content.map((c) => <div key={c.field}><dt className="inline font-medium">{c.field} : </dt><dd className="inline whitespace-pre-wrap">{reviewValue(c.field, c.value)}</dd></div>)}</dl>
            : <p className="mt-1">{t('admin:verification.no_public_content', 'La fiche n’a aucun contenu public renseigné.')}</p>}
        </details>
      ) : null}
      <p className="text-xs text-slate-700">{t('admin:verification.bound_to_version', 'La décision porte sur cette version du contenu (empreinte {{fingerprint}}…) : si la fiche change avant votre décision, elle est refusée et la fiche est rechargée.', { fingerprint: String(data.version).slice(0, 12) })}</p>
      {data.hold ? <p className="text-sm" data-testid={`${testIdPrefix}-hold-reason`}>{t('admin:verification.on_hold', 'En attente : {{reason}}', { reason: data.hold })}</p> : null}
      <label className="block" htmlFor={`${id}-src`}>{t('admin:verification.source_label', 'Source officielle consultée')}</label>
      <input id={`${id}-src`} type="url" className="w-full rounded border p-2" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
      {candidateSource ? (
        <p className="text-xs text-slate-700">{t('admin:verification.candidate_source', 'Source proposée par la recherche automatique :')} <a className="text-blue-800 underline" href={candidateSource} target="_blank" rel="noreferrer noopener">{candidateSource}</a>{' '}
          <button type="button" className="text-blue-800 underline" onClick={() => setSourceUrl(candidateSource)}>{t('admin:verification.use_candidate', 'l’utiliser après l’avoir consultée')}</button></p>
      ) : null}
      <label className="block" htmlFor={`${id}-note`}>{t('admin:verification.note_label', 'Ce qui a été contrôlé (conservé dans le registre)')}</label>
      <textarea id={`${id}-note`} className="w-full rounded border p-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="flex items-center gap-2"><input type="checkbox" checked={territory} onChange={(e) => setTerritory(e.target.checked)} /> {t('admin:verification.territory_confirmed', 'Territoire (Strasbourg / Bas-Rhin) confirmé')}</label>
      {local ? <p role="alert" className="text-sm text-red-800" data-testid={`${testIdPrefix}-panel-problem`}>{local}</p> : null}
      <p className="text-xs text-slate-700" data-testid={`${testIdPrefix}-veille-note`}>{t('admin:verification.veille_note', 'La veille automatique respecte un refus ou une mise en attente enregistrés ici : elle ne republie pas la fiche tant qu’une personne ne les a pas levés (« Lever l’attente », ou une nouvelle vérification après un refus).')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} data-testid={`${testIdPrefix}-verify`} onClick={() => decide('VERIFY', t('admin:verification.done.verify', 'Vérification enregistrée.'))}>{verifyLabel || t('admin:verification.verify', 'Vérifié')}</Button>
        <Button size="sm" variant="outline" disabled={busy} data-testid={`${testIdPrefix}-hold`} onClick={() => decide('HOLD', t('admin:verification.done.hold', 'Mise en attente enregistrée.'))}>{t('admin:verification.hold', 'Mettre en attente')}</Button>
        {data.hold && !data.editHold ? <Button size="sm" variant="outline" disabled={busy} data-testid={`${testIdPrefix}-release`} onClick={() => decide('RELEASE_HOLD', t('admin:verification.done.release', 'Attente levée.'))}>{t('admin:verification.release', 'Lever l’attente')}</Button> : null}
        <Button size="sm" variant="outline" className="border-red-300 text-red-800" disabled={busy} data-testid={`${testIdPrefix}-reject`} onClick={() => decide('REJECT', t('admin:verification.done.reject', 'Refus enregistré.'))}>{t('admin:verification.reject', 'Refuser')}</Button>
      </div>
    </div>
  );
}
