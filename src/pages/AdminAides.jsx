// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';

/** PKG-11 / A02 — administration of the aides (drafts included) through /api/admin/content. */
export default function AdminAides() {
  return <CatalogueList kind="aide" title="Gestion des aides" published="publie" newPath="/admin/aides/new" editPath={(id) => `/admin/aides/${id}`} createLabel="Créer une aide" />;
}
