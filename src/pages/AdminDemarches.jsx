// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';

/** PKG-11 / A02 — administration of the démarches (drafts included) through /api/admin/content. */
export default function AdminDemarches() {
  return <CatalogueList kind="demarche" title="Gestion des démarches" published="publie" newPath="/admin/demarches/new" editPath={(id) => `/admin/demarches/${id}`} createLabel="Créer une démarche" />;
}
