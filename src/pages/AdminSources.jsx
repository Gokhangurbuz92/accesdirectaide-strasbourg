// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminClient as client, apiClient } from '@/api/client';
import i18n, { useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * /admin/sources — the official sources the system reads and may cite (owner decision 2026-10-25: a list of serious official sources that updates itself).
 *  - the starting list, by level (State and ministries, social security bodies, Région, Département/CeA, préfecture, communes, official registers), each with
 *    what makes it official (api/_services/verification/sources.js SEED_SOURCES);
 *  - the sites the Annuaire de l'administration attests for every public body of the département, refreshed every week by the automatic verification;
 *  - the product allow-list and the sites added for this server (ADA_VERIFICATION_EXTRA_DOMAINS), which stay valid.
 */
const LEVEL = () => ({ NATIONAL: i18n.t('admin:sources.level.national', 'État, ministères et opérateurs nationaux'), EUROPEEN: i18n.t('admin:sources.level.european', 'Institutions européennes'), OPERATEUR: i18n.t('admin:sources.level.operator', 'Opérateurs de services publics cités par Service-Public (pour leurs démarches en ligne)'), ORGANISME: i18n.t('admin:sources.level.social_security', 'Organismes de sécurité sociale'), REGIONAL: i18n.t('admin:sources.level.regional', 'Région Grand Est'), DEPARTEMENTAL: i18n.t('admin:sources.level.departmental', 'Collectivité européenne d’Alsace (Département)'),
  PREFECTURE: i18n.t('admin:sources.level.prefecture', 'Préfecture et services de l’État'), COMMUNAL: i18n.t('admin:sources.level.communal', 'Communes, Ville et Eurométropole, CCAS'), REGISTRE: i18n.t('admin:sources.level.registers', 'Registres officiels'), '—': i18n.t('admin:sources.level.other', 'Autres') });
const ORDER = ['NATIONAL', 'EUROPEEN', 'ORGANISME', 'OPERATEUR', 'REGIONAL', 'DEPARTEMENTAL', 'PREFECTURE', 'COMMUNAL', 'REGISTRE'];

export default function AdminSources() {
  const { t } = useT('admin');
  const fr = useFrAttrs();   // R47: the registry's own names and descriptions of the sources are French (lang="fr" outside French)
  const levels = LEVEL();
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => client.get('/api/admin/stats').then((r) => r.data) });
  const veille = useQuery({ queryKey: ['admin-veille'], queryFn: () => apiClient.admin.getVeille(7) });
  const src = (stats.data?.data || stats.data || {}).verificationSources || { builtIn: [], extra: [] };
  const seed = veille.data?.seed || [];
  const byLevel = Object.fromEntries((veille.data?.sourcesByLevel || []).map((l) => [l.level, l]));
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6" data-testid="admin-sources">
      <h1 className="text-2xl font-bold text-slate-900">{t('admin:sources.title', 'Sources officielles')}</h1>
      <p className="text-slate-800">
        {t('admin:sources.intro', 'Le système lit ces sources chaque nuit pour vérifier les fiches. La liste se met à jour seule chaque semaine : tout service public du Bas-Rhin listé par l’Annuaire de l’administration y entre avec son site officiel, et en sort s’il n’est plus listé. Rien n’est à valider ici.')}
      </p>
      {veille.isLoading || stats.isLoading ? <p role="status">{t('admin:sources.loading', 'Chargement…')}</p> : veille.error && stats.error ? <p role="alert" className="text-rose-800">{t('admin:sources.load_error', 'La liste n’a pas pu être lue.')}</p> : (
        <>
          <section aria-labelledby="src-levels" className="rounded border border-slate-300 bg-white p-4" data-testid="admin-sources-levels">
            <h2 id="src-levels" className="font-semibold">{t('admin:sources.by_level', 'Par niveau')}</h2>
            <ul className="mt-2 grid gap-1 md:grid-cols-2">{ORDER.map((l) => <li key={l} className="text-slate-800"><strong>{byLevel[l]?.active ?? 0}</strong> — {levels[l]}</li>)}</ul>
          </section>
          <section aria-labelledby="src-seed" className="rounded border border-slate-300 bg-white p-4" data-testid="admin-sources-seed">
            <h2 id="src-seed" className="font-semibold">{t('admin:sources.seed', 'Liste de départ')}</h2>
            <ul className="mt-2 space-y-3">
              {ORDER.flatMap((l) => seed.filter((s) => s.level === l)).map((s) => (
                <li key={s.sourceId}>
                  <p className="font-medium text-slate-900" {...fr}>{s.name}</p>
                  <p className="text-sm text-slate-700">{levels[s.level]} · {s.domains.join(', ')} · {t('admin:sources.updated', 'mise à jour {{frequency}}', { frequency: s.frequency })}</p>
                  <p className="text-sm text-slate-600" {...fr}>{s.attestation}</p>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="src-builtin" className="rounded border border-slate-300 bg-white p-4">
            <h2 id="src-builtin" className="font-semibold">{t('admin:sources.builtin', 'Domaines toujours acceptés comme preuve')}</h2>
            <ul className="mt-2 list-disc pl-5" data-testid="admin-sources-builtin">{src.builtIn.map((d) => <li key={d}>{d}</li>)}</ul>
            {src.extra.length ? <><p className="mt-2 text-sm text-slate-700">{t('admin:sources.extra', 'Ajoutés pour ce serveur :')}</p><ul className="list-disc pl-5" data-testid="admin-sources-extra">{src.extra.map((d) => <li key={d}>{d}</li>)}</ul></> : null}
          </section>
        </>
      )}
      <p className="text-sm text-slate-700">{t('admin:sources.association_note', 'Une association se vérifie sur un registre officiel (le répertoire SIRENE), pas sur son seul site.')} <Link to="/admin/veille" className="text-blue-700 underline underline-offset-2">{t('admin:sources.see_veille', 'Voir la veille automatique')}</Link></p>
    </div>
  );
}
