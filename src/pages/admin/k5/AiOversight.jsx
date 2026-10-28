// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useK5 } from './helpers.js';
import { Status, Field } from './ui.jsx';

/**
 * PKG-6 / D22 — human oversight of AI outputs (/admin/ai-oversight). Every AI output waits here for a named person: FALC drafts (reviewed on /admin/falc) and
 * AI repair suggestions. A suggestion is shown as untrusted text; keeping it records the decision but never edits the record (apply changes through the
 * normal, versioned editing). Every decision needs MFA and a note, and is audited.
 */
export default function AdminAiOversight() {
  const k = useK5('ai-oversight'); const [notes, setNotes] = useState({});
  const items = k.data?.aiSuggestions || [];
  const decide = (it, decision) => k.act({ action: 'decide', id: it.id, suggestedAt: it.suggestedAt ?? null, decision, note: notes[it.id] || '' }, decision === 'keep' ? 'Suggestion gardée : décision enregistrée. La fiche n’a pas été modifiée.' : 'Suggestion écartée : décision enregistrée.');
  return (
    <div className="space-y-4 p-4" data-testid="admin-ai-oversight">
      <h1 className="text-2xl font-bold">Contrôle humain de l’IA</h1>
      <p className="text-sm text-slate-700">Aucune sortie d’IA ne s’applique seule. Chaque décision demande votre session avec MFA et une note ; elle est enregistrée au journal.</p>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-ai-oversight" />
      <section className="rounded border p-3" aria-labelledby="ov-falc">
        <h2 id="ov-falc" className="font-semibold">Textes faciles à lire (FALC)</h2>
        <p className="text-sm" data-testid="admin-ai-oversight-falc">Brouillons en attente de relecture : <strong>{k.data?.falcPending ?? '—'}</strong>. <Link className="text-blue-800 underline" to="/admin/falc">Les relire</Link></p>
      </section>
      <section className="space-y-3" aria-labelledby="ov-ai">
        <h2 id="ov-ai" className="font-semibold">Suggestions de correction proposées par l’IA ({items.length})</h2>
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-ai-suggestion">
              <p className="font-semibold">{it.title || it.entityId} — {it.reason} ({it.severity})</p>
              <p className="text-slate-700">Proposé par l’IA, non vérifié. À contrôler sur une source officielle avant toute modification de la fiche.</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-900">{JSON.stringify(it.suggestion, null, 2)}</pre>
              <Field id={`ov-note-${it.id}`} label="Note de décision (obligatoire)" value={notes[it.id] || ''} onChange={(x) => setNotes((s) => ({ ...s, [it.id]: x }))} />
              <div className="flex gap-2">
                <Button size="sm" disabled={k.busy} data-testid="admin-ai-keep" onClick={() => decide(it, 'keep')}>Garder (je corrige la fiche moi-même)</Button>
                <Button size="sm" variant="outline" disabled={k.busy} data-testid="admin-ai-dismiss" onClick={() => decide(it, 'dismiss')}>Écarter</Button>
              </div>
            </li>
          ))}
          {k.data && !items.length ? <li>Aucune suggestion en attente.</li> : null}
        </ul>
      </section>
    </div>
  );
}
