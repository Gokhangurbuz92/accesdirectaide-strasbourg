// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useT, formatDate } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * M2 / G5 — the contact person of the person's path (« référent de parcours »), in Mon Espace. Declarative: a name the person can call. It is set only with
 * THEIR agreement, they end it at any time, it gives the professional no extra access and replaces no legal or contractual designation — the card says so.
 * Renders nothing when there is neither a contact person nor a proposal (or when the service does not offer it yet).
 * @param {{ shareId: string }} props
 */
export default function ReferentCard({ shareId }) {
  const { t } = useT('compte');
  const fr = useFrAttrs();   // names of people and organizations stay as written (lang="fr" outside French)
  const [view, setView] = useState(null);
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setView(await citizenApi.dossierReferent(shareId)); } catch { setView(null); } }, [shareId]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => {
    setBusy(true); setMessage(''); setProblem('');
    try { await fn(); setMessage(ok); await load(); }
    catch { setProblem(t('compte:referent.failed', 'L’action n’a pas pu être faite. Réessayez.')); await load(); } finally { setBusy(false); }
  };
  const shown = view && view.available !== false && (view.referent || view.proposal);
  if (!shown && !message) return null;
  const r = view?.referent; const p = view?.proposal;
  return (
    <Card data-testid="referent-card">
      <CardHeader><CardTitle className="text-lg">{t('compte:referent.title', 'Personne de contact pour votre parcours')}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-slate-700">{t('compte:referent.what_it_is', 'C’est une personne que vous pouvez contacter pour savoir où en est votre parcours. Elle est désignée avec votre accord. Ce rôle ne lui donne aucun accès supplémentaire à votre dossier, ne remplace aucune désignation légale ou contractuelle et ne crée aucune obligation de résultat. Vous pouvez y mettre fin à tout moment.')}</p>
        <div aria-live="polite" role="status" data-testid="referent-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
        {problem ? <p role="alert" data-testid="referent-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
        {r ? (
          <div className="space-y-2" data-testid="referent-current">
            <p><strong {...fr}>{r.displayName}</strong> — <span {...fr}>{r.organization}</span>{r.since ? ` — ${t('compte:referent.since', 'depuis le {{date}}', { date: formatDate(r.since) })}` : ''}</p>
            <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="referent-end" onClick={() => run(() => citizenApi.endReferent(shareId), t('compte:referent.ended', 'Vous n’avez plus de personne de contact. Les accès à votre dossier ne changent pas.'))}>{t('compte:referent.end', 'Mettre fin à ce rôle')}</Button>
          </div>
        ) : null}
        {p ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="referent-proposal">
            <p>{t('compte:referent.proposal_intro', 'Une structure qui vous accompagne propose une personne de contact :')} <strong {...fr}>{p.displayName}</strong> — <span {...fr}>{p.organization}</span>.</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} data-testid="referent-accept" onClick={() => run(() => citizenApi.decideReferent(shareId, true), t('compte:referent.accepted', 'Votre accord est enregistré : cette personne est votre personne de contact.'))}>{t('compte:referent.accept', 'J’accepte')}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} data-testid="referent-refuse" onClick={() => run(() => citizenApi.decideReferent(shareId, false), t('compte:referent.refused', 'Vous avez refusé : rien ne change.'))}>{t('compte:referent.refuse', 'Je refuse')}</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
