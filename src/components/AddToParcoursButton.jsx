// @ts-nocheck
import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import { frontendEnv } from '@/config/env';
import { parcoursOpened } from '@/lib/publicBeta';
import { useT } from '@/i18n';
import { PARCOURS_RECORD_STEPS } from '@/lib/parcoursRecordSteps';

/**
 * VIS-R — may « Ajouter à mon parcours » be offered here: Mon Parcours is open in this build (src/lib/publicBeta.js) AND a citizen is signed in. It reuses
 * the header's session query (same key): no extra request, and none at all while the surface is closed. The server stays the only real protection.
 * @returns {boolean}
 */

function useParcoursAccess() {
  const open = parcoursOpened(frontendEnv.flags.publicBeta);
  const auth = useQuery({ queryKey: ['header-auth-check'], queryFn: () => rdvMessagingClient.authMe(), staleTime: 60_000, retry: false, refetchOnWindowFocus: false, enabled: open });
  return open && auth.data?.session?.kind === 'user';
}

function SignedInOnly({ children }) {
  return useParcoursAccess() ? children : null;
}

/**
 * Shows its children only when Mon Parcours is open in this build and a citizen is signed in; otherwise nothing is rendered and nothing is requested
 * (also outside a query client, where no session can be known).
 * @param {{ children: import('react').ReactNode }} props
 */
export function ParcoursAccessGate({ children }) {
  const client = useContext(QueryClientContext);
  // G14: the limited Mon Parcours accepts only a step type of its reviewed list — a catalogue record can no longer become a step (the server refuses
  // `records` with 400 FIELD_NOT_ALLOWED), so the button is not offered on record pages and orientations
  if (!PARCOURS_RECORD_STEPS.offered) return null;
  if (!client || !parcoursOpened(frontendEnv.flags.publicBeta)) return null;
  return <SignedInOnly>{children}</SignedInOnly>;
}

/**
 * The control itself (no session lookup: the caller decided it may be shown). One click sends the records to the server, which checks that each is public,
 * and answers « added » or « already there » — both are said in a polite live region with a link to Mon Parcours. Adding a step records nothing about a right.
 * M1: `planStep` (the need, official links, the next action — validated by the server) is sent with the step when the caller has it.
 * @param {{ records: { type: 'aide' | 'demarche' | 'dispositif' | 'guide' | 'structure', id: string }[], title?: string, className?: string, planStep?: Record<string, unknown> }} props
 */
export function AddToParcoursControl({ records, title, className = '', planStep = undefined }) {
  const { t } = useT('shared');
  const [state, setState] = useState({ busy: false, done: '', error: '', consent: false, ticked: false });
  if (!Array.isArray(records) || !records.length) return null;
  // G8: a step that reveals a sensitive fact is refused (default) or, where the deployment allows it, kept only after the person ticked and confirmed
  const add = async (sensitiveConsent = false) => {
    setState({ busy: true, done: '', error: '', consent: false, ticked: false });
    try {
      const out = await citizenApi.parcours({ action: 'add', records: records.slice(0, 5), ...(title ? { title: String(title).trim().slice(0, 200) } : {}), ...(planStep ? { planStep } : {}),
        ...(sensitiveConsent ? { sensitiveConsent: true } : {}) });
      setState({ busy: false, done: out && out.added === false ? 'already' : 'added', error: '', consent: false, ticked: false });
    } catch (err) {
      if (err.code === 'SENSITIVE_STEP_CONSENT_REQUIRED') { setState({ busy: false, done: '', error: '', consent: true, ticked: false }); return; }
      setState({ busy: false, done: '', error: err.message || t('shared:parcours_add.failed', 'L’étape n’a pas pu être ajoutée. Réessayez.'), consent: false, ticked: false });
    }
  };
  return (
    <div className={className} data-testid="parcours-add-record">
      <Button type="button" variant="outline" size="sm" className="min-h-11" data-testid="parcours-add-record-button" disabled={state.busy || Boolean(state.done)} onClick={() => add(false)}>
        <ListPlus className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('shared:parcours_add.add', 'Ajouter à mon parcours')}
      </Button>
      <p role="status" aria-live="polite" className="mt-1 text-sm text-slate-800" data-testid="parcours-add-record-status">
        {state.done ? (
          <>
            {state.done === 'already' ? t('shared:parcours_add.already', 'Cette étape est déjà dans Mon Parcours.') : t('shared:parcours_add.added', 'Étape ajoutée à Mon Parcours.')}{' '}
            <Link to="/compte/parcours" className="font-medium text-blue-800 underline">{t('shared:parcours_add.open', 'Ouvrir Mon Parcours')}</Link>
          </>
        ) : null}
      </p>
      {state.error ? <p role="alert" className="mt-1 text-sm text-red-800" data-testid="parcours-add-record-error">{state.error}</p> : null}
      {state.consent ? (
        <div role="group" aria-labelledby="parcours-add-consent-body" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950" data-testid="parcours-add-consent">
          <p id="parcours-add-consent-body">{t('shared:parcours_add.consent_body', 'Cette étape semble révéler une information sensible (santé, handicap, addiction, droit au séjour, justice…). Rien n’a été enregistré. Elle ne le sera qu’avec votre accord : visible par vous seul, jamais montrée à une personne de confiance, supprimable à tout moment.')}</p>
          <label className="mt-1 flex items-start gap-2">
            <input type="checkbox" className="mt-1" data-testid="parcours-add-consent-check" checked={state.ticked} onChange={(e) => setState({ ...state, ticked: e.target.checked })} />
            <span>{t('shared:parcours_add.consent_check', 'J’accepte que cette étape soit enregistrée dans Mon Parcours.')}</span>
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button type="button" size="sm" data-testid="parcours-add-consent-confirm" disabled={!state.ticked || state.busy} onClick={() => add(true)}>{t('shared:parcours_add.consent_confirm', 'Enregistrer avec mon accord')}</Button>
            <Button type="button" size="sm" variant="outline" data-testid="parcours-add-consent-cancel" onClick={() => setState({ busy: false, done: '', error: '', consent: false, ticked: false })}>{t('shared:parcours_add.consent_cancel', 'Ne pas enregistrer')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * « Ajouter à mon parcours » on a record page (aide, démarche, dispositif, guide, structure — A-10). Renders nothing — and asks the server nothing — unless Mon Parcours is open and
 * the person is signed in, so the public beta is unchanged.
 * @param {{ type: 'aide' | 'demarche' | 'dispositif' | 'guide' | 'structure', id: string, className?: string }} props
 */
export default function AddToParcoursButton({ type, id, className }) {
  if (!id) return null;
  return <ParcoursAccessGate><AddToParcoursControl records={[{ type, id }]} className={className} /></ParcoursAccessGate>;
}
