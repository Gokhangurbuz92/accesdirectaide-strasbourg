/**
 * Core entities: Aide, Actualite, Demarche, Structure, Dispositif
 */
export {
  // Enums
  ContentType,
  AidCategoryCode,
  AidStatus,

  // Core tables
  Aide,
  AidCategory,
  LifeSituation,
  Situation,
  AidSituation,
  AidSource,
  Structure,
  Demarche,
  Actualite,
  Dispositif,
  Guide,
  ToolboxItem,
  ResourceAccessibility,
  ContentReport,

  // Relations
  AideRelations,
  AidSituationRelations,
  StructureRelations,
  DemarcheRelations,
  ActualiteRelations,
  DispositifRelations,
} from '../schema';
