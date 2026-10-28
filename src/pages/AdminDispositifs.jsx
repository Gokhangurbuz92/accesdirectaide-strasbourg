// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';

/** PKG-11 / A02 — administration of the dispositifs (drafts included) through /api/admin/content; publication on the site follows the D-5 verification. */
export default function AdminDispositifs() {
  return <CatalogueList kind="dispositif" title="Gestion des dispositifs" published="publie" newPath="/admin/dispositifs/new" editPath={(id) => `/admin/dispositifs/${id}`} createLabel="Créer un dispositif" />;
}
