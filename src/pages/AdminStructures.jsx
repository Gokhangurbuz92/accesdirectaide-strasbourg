// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';

/** PKG-11 / A02 — administration of the directory structures (drafts included) through /api/admin/content. */
export default function AdminStructures() {
  return <CatalogueList kind="structure" title="Gestion des structures" published="actif" newPath="/admin/structures/new" editPath={(id) => `/admin/structures/${id}`} createLabel="Créer une structure" />;
}
