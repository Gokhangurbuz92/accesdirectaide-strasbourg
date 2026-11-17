// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { useT, formatDateTime } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * RA-07 — revue de la sensibilité des services réservables d'une structure (R45 ENG-LR-2, RGPD art. 9) : /admin/sensibilite-services?structure=<id>.
 * POST /api/admin/service-sensitivity { action: 'list' | 'review' } — opération de plateforme (MFA + élévation), motif obligatoire, journalisée par le serveur.
 * La suggestion (mots-clés) n'est qu'une aide : seule la valeur choisie par une personne compte. « Non revu » remet le service à l'état inconnu.
 */
const VALUES = ['sensitive', 'ordinary', 'unknown'];

export default function AdminServiceSensitivity() {
  const { t } = useT('admin');
  const fr = useFrAttrs();
  const VALUE = { sensitive: t('admin:k5.sensitivity.v_sensitive', 'Sensible (art. 9)'), ordinary: t('admin:k5.sensitivity.v_ordinary', 'Ordinaire'), unknown: t('admin:k5.sensitivity.v_unknown', 'Non revu') };
  const [structureId, setStructureId] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('structure') || '' : ''));
  const [data, setData] = useState(null); const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  const load = async (id = structureId, { keepMsg = false } = {}) => {
    setProblem(''); if (!keepMsg) setMsg('');
    if (!id.trim()) { setProblem(t('admin:k5.sensitivity.p_structure', 'Indiquez l’identifiant de la structure.')); return; }
    setBusy(true);
    try { setData(await apiClient.admin.k5('service-sensitivity', { action: 'list', structureId: id.trim() })); setDraft({}); }
    catch (e) { setData(null); setProblem(e?.status === 404 ? t('admin:k5.sensitivity.not_found', 'Structure introuvable.') : explain(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (structureId) load(structureId); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (item) => {
    const d = draft[item.id] || {}; const value = d.value || item.value; const reason = (d.reason || '').trim();
    setMsg(''); setProblem('');
    if (reason.length < 10 || reason.length > 500) { setProblem(t('admin:k5.sensitivity.p_reason', 'Indiquez la raison de la classification de « {{name}} » (10 à 500 caractères).', { name: item.name })); return; }
    setBusy(true);
    try {
      const out = await apiClient.admin.k5('service-sensitivity', { action: 'review', structureId: data.structure.id, serviceId: item.id, value, reason });
      await load(data.structure.id, { keepMsg: true });
      setMsg(t('admin:k5.sensitivity.saved', '« {{name}} » : {{previous}} → {{value}}. Revue journalisée.', { name: item.name, previous: VALUE[out.previous] || out.previous, value: VALUE[out.value] || out.value }));
    } catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 p-4" data-testid="admin-sensitivity">
      <h1 className="text-2xl font-bold">{t('admin:k5.sensitivity.title', 'Sensibilité des services réservables')}</h1>
      <p className="text-sm">{t('admin:k5.sensitivity.intro', 'Un service dont la prise de rendez-vous révèle une donnée de santé ou une autre donnée sensible (RGPD, article 9) doit être classé « sensible » par une personne. La suggestion par mots-clés n’est qu’une aide et ne fixe jamais la valeur. Opération de plateforme : session avec MFA et élévation temporaire ; chaque revue est journalisée avec son motif.')} <Link className="text-primary underline" to="/admin/operations">{t('admin:k5.mailsup.elevation_link', 'Demander une élévation (page Opérations)')}</Link></p>
      <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <div><label htmlFor="sens-structure" className="block">{t('admin:k5.sensitivity.structure', 'Identifiant de la structure')}</label>
          <input id="sens-structure" className="rounded border p-2" value={structureId} onChange={(e) => setStructureId(e.target.value)} /></div>
        <Button type="submit" size="sm" disabled={busy} data-testid="admin-sensitivity-load">{t('admin:k5.sensitivity.load', 'Afficher les services')}</Button>
      </form>
      {problem ? <p role="alert" className="text-sm text-destructive" data-testid="admin-sensitivity-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" className="text-sm" data-testid="admin-sensitivity-status">{msg}</div>
      {data ? (
        <section className="space-y-2" aria-labelledby="sens-structure-name">
          <h2 id="sens-structure-name" className="font-semibold"><span {...fr}>{data.structure.name}</span></h2>
          <p className="text-sm" data-testid="admin-sensitivity-summary">{data.reviewComplete ? t('admin:k5.sensitivity.complete', 'Tous les services réservables sont revus.') : t('admin:k5.sensitivity.incomplete', 'Au moins un service réservable n’est pas revu.')}
            {' '}{data.gate?.sensitiveBookingOpen ? t('admin:k5.sensitivity.gate_open', 'La réservation des services sensibles est ouverte par la configuration.') : t('admin:k5.sensitivity.gate_closed', 'La réservation des services sensibles reste fermée par la configuration, quelle que soit la revue.')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-sensitivity-table">
              <caption className="sr-only">{t('admin:k5.sensitivity.caption', 'Services de la structure : valeur revue, suggestion, nouvelle valeur et motif')}</caption>
              <thead><tr className="border-b">
                <th scope="col" className="p-1 text-start">{t('admin:k5.sensitivity.col_service', 'Service')}</th>
                <th scope="col" className="p-1 text-start">{t('admin:k5.sensitivity.col_value', 'Valeur revue')}</th>
                <th scope="col" className="p-1 text-start">{t('admin:k5.sensitivity.col_suggestion', 'Suggestion (aide)')}</th>
                <th scope="col" className="p-1 text-start">{t('admin:k5.sensitivity.col_review', 'Revue')}</th>
              </tr></thead>
              <tbody>
                {data.items.map((i) => {
                  const d = draft[i.id] || {};
                  return (
                    <tr key={i.id} className="border-b align-top" data-testid="admin-sensitivity-row">
                      <th scope="row" className="p-1 text-start font-normal"><span {...fr}>{i.name}</span>{i.active ? '' : t('admin:k5.sensitivity.inactive', ' (inactif)')}</th>
                      <td className="p-1">{VALUE[i.value] || i.value}{i.reviewedAt ? <p className="text-xs">{t('admin:k5.sensitivity.reviewed', '{{who}}, {{date}}', { who: i.reviewedBy, date: formatDateTime(i.reviewedAt) })}</p> : null}</td>
                      <td className="p-1">{i.suggestion === 'sensitive' ? t('admin:k5.sensitivity.sug_sensitive', 'Peut-être sensible ({{words}})', { words: (i.matched || []).join(', ') }) : t('admin:k5.sensitivity.sug_none', 'Aucun indice')}</td>
                      <td className="space-y-1 p-1">
                        <label htmlFor={`sens-v-${i.id}`} className="sr-only">{t('admin:k5.sensitivity.new_value', 'Nouvelle valeur pour {{name}}', { name: i.name })}</label>
                        <select id={`sens-v-${i.id}`} className="rounded border p-1" value={d.value || i.value} onChange={(e) => setDraft((x) => ({ ...x, [i.id]: { ...d, value: e.target.value } }))}>
                          {VALUES.map((v) => <option key={v} value={v}>{VALUE[v]}</option>)}
                        </select>
                        <label htmlFor={`sens-r-${i.id}`} className="block text-xs">{t('admin:k5.sensitivity.reason', 'Motif (10 à 500 caractères, journalisé)')}</label>
                        <textarea id={`sens-r-${i.id}`} rows={2} className="w-full rounded border p-1" value={d.reason || ''} onChange={(e) => setDraft((x) => ({ ...x, [i.id]: { ...d, reason: e.target.value } }))} />
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => save(i)} data-testid="admin-sensitivity-save">{t('admin:k5.sensitivity.save', 'Enregistrer la revue')}</Button>
                      </td>
                    </tr>
                  );
                })}
                {!data.items.length ? <tr><td colSpan={4} className="p-2">{t('admin:k5.sensitivity.none', 'Cette structure n’a aucun service réservable.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
