// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminClient as client, apiClient } from '@/api/client';

/**
 * /admin/sources — the official sources the system reads and may cite (owner decision 2026-10-25: a list of serious official sources that updates itself).
 *  - the starting list, by level (State and ministries, social security bodies, Région, Département/CeA, préfecture, communes, official registers), each with
 *    what makes it official (api/_services/verification/sources.js SEED_SOURCES);
 *  - the sites the Annuaire de l'administration attests for every public body of the département, refreshed every week by the automatic verification;
 *  - the product allow-list and the sites added for this server (ADA_VERIFICATION_EXTRA_DOMAINS), which stay valid.
 */
const LEVEL = { NATIONAL: 'État, ministères et opérateurs nationaux', EUROPEEN: 'Institutions européennes', OPERATEUR: 'Opérateurs de services publics cités par Service-Public (pour leurs démarches en ligne)', ORGANISME: 'Organismes de sécurité sociale', REGIONAL: 'Région Grand Est', DEPARTEMENTAL: 'Collectivité européenne d’Alsace (Département)',
  PREFECTURE: 'Préfecture et services de l’État', COMMUNAL: 'Communes, Ville et Eurométropole, CCAS', REGISTRE: 'Registres officiels', '—': 'Autres' };
const ORDER = ['NATIONAL', 'EUROPEEN', 'ORGANISME', 'OPERATEUR', 'REGIONAL', 'DEPARTEMENTAL', 'PREFECTURE', 'COMMUNAL', 'REGISTRE'];

export default function AdminSources() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => client.get('/api/admin/stats').then((r) => r.data) });
  const veille = useQuery({ queryKey: ['admin-veille'], queryFn: () => apiClient.admin.getVeille(7) });
  const src = (stats.data?.data || stats.data || {}).verificationSources || { builtIn: [], extra: [] };
  const seed = veille.data?.seed || [];
  const byLevel = Object.fromEntries((veille.data?.sourcesByLevel || []).map((l) => [l.level, l]));
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6" data-testid="admin-sources">
      <h1 className="text-2xl font-bold text-slate-900">Sources officielles</h1>
      <p className="text-slate-800">
        Le système lit ces sources chaque nuit pour vérifier les fiches. La liste se met à jour seule chaque semaine : tout service public du Bas-Rhin listé par
        l’Annuaire de l’administration y entre avec son site officiel, et en sort s’il n’est plus listé. Rien n’est à valider ici.
      </p>
      {veille.isLoading || stats.isLoading ? <p role="status">Chargement…</p> : veille.error && stats.error ? <p role="alert" className="text-rose-800">La liste n’a pas pu être lue.</p> : (
        <>
          <section aria-labelledby="src-levels" className="rounded border border-slate-300 bg-white p-4" data-testid="admin-sources-levels">
            <h2 id="src-levels" className="font-semibold">Par niveau</h2>
            <ul className="mt-2 grid gap-1 md:grid-cols-2">{ORDER.map((l) => <li key={l} className="text-slate-800"><strong>{byLevel[l]?.active ?? 0}</strong> — {LEVEL[l]}</li>)}</ul>
          </section>
          <section aria-labelledby="src-seed" className="rounded border border-slate-300 bg-white p-4" data-testid="admin-sources-seed">
            <h2 id="src-seed" className="font-semibold">Liste de départ</h2>
            <ul className="mt-2 space-y-3">
              {ORDER.flatMap((l) => seed.filter((s) => s.level === l)).map((s) => (
                <li key={s.sourceId}>
                  <p className="font-medium text-slate-900">{s.name}</p>
                  <p className="text-sm text-slate-700">{LEVEL[s.level]} · {s.domains.join(', ')} · mise à jour {s.frequency}</p>
                  <p className="text-sm text-slate-600">{s.attestation}</p>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="src-builtin" className="rounded border border-slate-300 bg-white p-4">
            <h2 id="src-builtin" className="font-semibold">Domaines toujours acceptés comme preuve</h2>
            <ul className="mt-2 list-disc pl-5" data-testid="admin-sources-builtin">{src.builtIn.map((d) => <li key={d}>{d}</li>)}</ul>
            {src.extra.length ? <><p className="mt-2 text-sm text-slate-700">Ajoutés pour ce serveur :</p><ul className="list-disc pl-5" data-testid="admin-sources-extra">{src.extra.map((d) => <li key={d}>{d}</li>)}</ul></> : null}
          </section>
        </>
      )}
      <p className="text-sm text-slate-700">Une association se vérifie sur un registre officiel (le répertoire SIRENE), pas sur son seul site. <Link to="/admin/veille" className="text-blue-700 underline underline-offset-2">Voir la veille automatique</Link></p>
    </div>
  );
}
