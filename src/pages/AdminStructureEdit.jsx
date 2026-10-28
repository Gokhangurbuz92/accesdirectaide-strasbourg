// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { STRUCTURE_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit a directory structure (real columns; verification and FALC texts have their own governed screens). */
export default function AdminStructureEdit() {
  return <CatalogueEditor kind="structure" title="structure" fields={STRUCTURE_FIELDS} listPath="/admin/structures" />;
}
