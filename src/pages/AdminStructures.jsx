// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';
import { useT } from '@/i18n';

/** PKG-11 / A02 — administration of the directory structures (drafts included) through /api/admin/content. */
export default function AdminStructures() {
  const { t } = useT('admin');
  return <CatalogueList kind="structure" title={t('admin:catalogue.structures.title', 'Gestion des structures')} published="actif" newPath="/admin/structures/new" editPath={(id) => `/admin/structures/${id}`} createLabel={t('admin:catalogue.structures.create', 'Créer une structure')} />;
}
