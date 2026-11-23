// @ts-nocheck
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import { PARCOURS_DONE } from '@/lib/monEspace';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { PLAN_CLOSURES } from '@/lib/parcoursPlan';
import { formatDate, useT } from '@/i18n';
import {
  OFFLINE_PARCOURS_EVENT, clearOfflineParcours, enableOfflineParcours, offlineParcoursSupported, ownerFingerprint, readOfflineParcours, refreshOfflineParcours,
} from '@/lib/offlineParcours';

const FR = { lang: 'fr', dir: 'ltr' };

/** the signed-in account, shared with the header's own check (same query key: one request) */
function useSessionUser() {
  const q = useQuery({ queryKey: ['header-auth-check'], queryFn: () => rdvMessagingClient.authMe(), staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  return q.data?.session?.kind === 'user' ? q.data?.user || null : null;
}

/**
 * G14-LITE — « Garder Mon Parcours sur cet appareil » (default OFF). Shown under Mon Parcours when the browser can do it. Explained in plain French (FALC)
 * and in the six languages: what is kept (only what this screen shows), where (this device), that it is read-only without Internet, and when it is erased
 * (unticked, logout, another account). While it is on, every online visit refreshes the copy (only for the same account).
 * @param {{ data: any }} props the answer of GET /api/citizen/parcours that the screen shows
 */
export function OfflineParcoursSwitch({ data }) {
  const { t } = useT('compte');
  const user = useSessionUser();
  const id = useId();
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);   // the box follows the click at once; the stored state is read back once written
  const [problem, setProblem] = useState('');
  const supported = offlineParcoursSupported();

  // the kept copy, refreshed with what the screen shows now (same account only; another account's copy is erased)
  useEffect(() => {
    let live = true;
    const sync = async () => {
      if (!supported || !user?.id) { if (live) setRecord(null); return; }
      await refreshOfflineParcours(user.id, data);
      const r = await readOfflineParcours();
      const owner = await ownerFingerprint(user.id);
      if (live) setRecord(r && r.owner === owner ? r : null);
    };
    void sync();
    const onChange = () => { void readOfflineParcours().then(async (r) => { const owner = user?.id ? await ownerFingerprint(user.id) : null; if (live) setRecord(r && owner && r.owner === owner ? r : null); }); };
    window.addEventListener(OFFLINE_PARCOURS_EVENT, onChange);
    return () => { live = false; window.removeEventListener(OFFLINE_PARCOURS_EVENT, onChange); };
  }, [supported, user?.id, data]);

  if (!supported || !user?.id) return null;
  const on = Boolean(record?.enabled);
  const change = async (next) => {
    setBusy(true); setProblem(''); setPending(next);
    try {
      if (next) { if (!(await enableOfflineParcours(user.id, data))) setProblem(t('compte:parcours.offline.unsupported', 'Cet appareil ne permet pas de garder Mon Parcours.')); } else await clearOfflineParcours();
    } catch { setProblem(t('compte:parcours.offline.unsupported', 'Cet appareil ne permet pas de garder Mon Parcours.')); }
    const r = await readOfflineParcours(); const owner = await ownerFingerprint(user.id);
    setRecord(r && r.owner === owner ? r : null);
    setPending(null); setBusy(false);
  };
  return (
    <div className="container mx-auto max-w-3xl px-4 pb-8">
      <Card data-testid="parcours-offline-switch">
        <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.offline.title', 'Lire Mon Parcours sans Internet')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-800">
          <ul className="list-disc space-y-1 ps-5" id={`${id}-help`}>
            <li>{t('compte:parcours.offline.help_what', 'Si vous cochez la case, vos étapes sont gardées sur ce téléphone ou sur cet ordinateur.')}</li>
            <li>{t('compte:parcours.offline.help_read', 'Vous pourrez les lire sans Internet. Sans Internet, vous ne pourrez rien changer.')}</li>
            <li>{t('compte:parcours.offline.help_shared', 'Ne cochez pas la case sur un appareil que d’autres personnes utilisent (association, bibliothèque, ami).')}</li>
            <li>{t('compte:parcours.offline.help_erase', 'Les étapes sont effacées de l’appareil si vous enlevez la coche, si vous vous déconnectez ou si une autre personne se connecte.')}</li>
            <li>{t('compte:parcours.offline.help_never', 'Vos notes, vos documents et vos messages ne sont jamais gardés sur l’appareil.')}</li>
          </ul>
          <label className="flex items-start gap-2 font-medium text-slate-900">
            <input type="checkbox" className="mt-1 h-5 w-5" data-testid="parcours-offline-toggle" checked={pending ?? on} aria-busy={busy || undefined} aria-describedby={`${id}-help ${id}-state`}
              onChange={(e) => { void change(e.target.checked); }} />
            <span>{t('compte:parcours.offline.toggle', 'Garder Mon Parcours sur cet appareil')}</span>
          </label>
          <p id={`${id}-state`} role="status" className="text-slate-700" data-testid="parcours-offline-state">
            {on
              ? t('compte:parcours.offline.state_on', 'Mon Parcours est gardé sur cet appareil (copie du {{date}}).', { date: formatDate(record.savedAt) })
              : t('compte:parcours.offline.state_off', 'Mon Parcours n’est pas gardé sur cet appareil.')}
          </p>
          {problem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-red-900">{problem}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * G14-LITE — Mon Parcours without Internet: the copy kept on this device, READ-ONLY. There is no button that changes a step and nothing typed is queued:
 * a change made offline could be sent later by surprise (on a shared device, by someone else) or overwrite a newer change made elsewhere; reading is
 * what matters without network. The banner says it is a copy, from when, and that changes need the Internet.
 * @param {{ record: { savedAt: string, data: { items: any[], stepTypes: any[] } }, onRetry: () => void }} props
 */
export function OfflineParcoursView({ record, onRetry }) {
  const { t } = useT('compte');
  const { parcoursStatus: STATUS, parcoursClosure: CLOSURE } = useMonEspaceLabels();
  const items = record?.data?.items || [];
  const types = record?.data?.stepTypes || [];
  const typeOf = (code) => types.find((x) => x.code === code) || null;
  const stateLabel = (i) => CLOSURE[i.closure && PLAN_CLOSURES.includes(i.closure) ? i.closure : i.status] || STATUS[i.status] || '';
  const titleOf = (i) => { const ty = typeOf(i.stepType); return ty ? t(`compte:parcours.type.${i.stepType}`, ty.label) : i.title; };
  const newWindow = t('compte:parcours.link_new_window', ' (nouvelle fenêtre)');
  const active = items.filter((i) => !PARCOURS_DONE.includes(i.status));
  const done = items.filter((i) => PARCOURS_DONE.includes(i.status));
  const renderItem = (i) => {
    const ty = typeOf(i.stepType);
    return (
      <li key={i.id} data-testid="parcours-offline-item" className="rounded-md border border-slate-200 bg-white p-3">
        <p className="font-medium text-slate-900">{titleOf(i)}</p>
        {i.place ? (i.place.available && i.place.href
          ? <p className="text-sm text-slate-700">{t('compte:parcours.limited.place', 'Lieu :')} <Link to={i.place.href} className="text-blue-800 underline" {...FR}>{i.place.title}</Link></p>
          : <p className="text-sm text-slate-700">{t('compte:parcours.limited.place_gone', 'Le lieu choisi n’est plus publié.')}</p>) : null}
        <p className="text-sm text-slate-700">{stateLabel(i)}{i.dueDate ? ` — ${t('compte:parcours.due_on', 'échéance le {{date}}', { date: formatDate(i.dueDate) })}` : ''}</p>
        {ty && ty.sources.length ? (
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
            {ty.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-800 underline"><span {...FR}>{`${s.title} — Service-Public`}</span><span className="sr-only">{newWindow}</span></a></li>)}
          </ul>
        ) : null}
      </li>
    );
  };
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="parcours-offline">
      <SEO title={t('compte:parcours.mon_parcours', 'Mon Parcours')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:parcours.mon_parcours', 'Mon Parcours')}</h1>
      <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="parcours-offline-banner">
        <p className="font-semibold">{t('compte:parcours.offline.banner_title', 'Vous n’êtes pas connecté à Internet.')}</p>
        <p className="mt-1">{t('compte:parcours.offline.banner_body', 'Vous lisez la copie gardée sur cet appareil le {{date}}. Elle n’est peut-être plus à jour. Pour changer une étape, reconnectez-vous à Internet.', { date: formatDate(record.savedAt) })}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry} data-testid="parcours-offline-retry">{t('compte:parcours.reessayer', 'Réessayer')}</Button>
      </div>
      <Card>
        <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.etapes_cours', 'Étapes en cours')}</CardTitle></CardHeader>
        <CardContent>
          {active.length ? <ul className="space-y-3">{active.map(renderItem)}</ul> : <p className="text-sm text-slate-700">{t('compte:parcours.aucune_etape_cours', 'Aucune étape en cours.')}</p>}
        </CardContent>
      </Card>
      {done.length ? (
        <Card><CardHeader><CardTitle as="h2" className="text-lg">{t('compte:parcours.etapes_terminees', 'Étapes terminées')}</CardTitle></CardHeader><CardContent><ul className="space-y-3">{done.map(renderItem)}</ul></CardContent></Card>
      ) : null}
    </div>
  );
}
