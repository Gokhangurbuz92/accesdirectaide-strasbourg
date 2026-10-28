// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';

/** PKG-5 batch 2 — shared state for the K5 administrator pages: load a resource, run an action, show the outcome in French (never a raw status code). */
export function explain(e) {
  if (e?.status === 401) return 'Session expirée : reconnectez-vous.';
  const p = e?.payload || {};
  if (p.error === 'ELEVATION_REQUIRED') return 'Opération de plateforme : demandez d’abord une élévation temporaire (page Opérations).';
  if (e?.status === 403 && !p.message) return 'Refusé : cette action demande une session administrateur nominative avec MFA.';
  return p.message || p.error || 'Action impossible.';
}

export function useK5(path) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', data: await apiClient.admin.k5(path) }); }
    catch (e) { setState({ loading: false, error: explain(e), data: null }); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  const act = async (body, ok, target = path) => {
    setBusy(true); setMsg(''); setProblem('');
    try { const out = await apiClient.admin.k5(target, body); setMsg(typeof ok === 'function' ? ok(out) : ok); await load(); return out; }   // ok may read the answer (PKG-11: say what really happened)
    catch (e) { setProblem(explain(e)); return null; }
    finally { setBusy(false); }
  };
  return { ...state, load, act, msg, problem, busy };
}

export function downloadText(text, name, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
