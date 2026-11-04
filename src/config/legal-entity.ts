/**
 * Who operates AccesDirectAide (R42 owner addendum R42-A01, 04/11/2026, STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/directives/R42_DIRECTIVE.md):
 * the AccesDirectAide association has NOT been created or registered. The project is carried by ONE NATURAL PERSON, the project carrier
 * (« Porteur du projet AccesDirectAide »). The intended future entity is a nonprofit association under Alsace-Moselle local law: it is never
 * presented as existing. The carrier's name is not written here: it is published through the build variable VITE_LEGAL_PUBLISHER_IDENTITY
 * (src/config/legal-documents.js, owner directive of 29/10/2026). No registration number, address, telephone or legal representative is invented.
 *
 * NOT_CREATED: no legal person exists (the present state). IN_FORMATION: a legal person is being constituted (statutes adopted, registration
 * pending) — not the case today. ACTIVE: a registered legal person with its identifiers.
 */
export type LegalEntityStatus = 'NOT_CREATED' | 'IN_FORMATION' | 'ACTIVE';

export type OperatorKind = 'NATURAL_PERSON' | 'LEGAL_PERSON';

export interface LegalEntityConfig {
  status: LegalEntityStatus;
  /** who edits the service and, for now, would act as data controller: a natural person until a legal person exists */
  operatorKind: OperatorKind;
  /** the operator's role as published (never the name: that comes from VITE_LEGAL_PUBLISHER_IDENTITY) */
  operatorRole: string | null;
  /** the intended legal form, stated as a plan only */
  plannedLegalForm: string | null;
  legalName: string | null;
  tradeName: string | null;
  legalForm: string | null;
  capital: number | null;
  siren: string | null;
  siret: string | null;
  rne: string | null;
  rcsCity: string | null;
  vatNumber: string | null;
  registeredOffice: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  publicationDirector: string | null;
  hostingProvider: string | null;
  consumerMediator: string | null;
  dpoContact: string | null;
}

export const CURRENT_LEGAL_ENTITY: LegalEntityConfig = {
  status: 'NOT_CREATED',
  operatorKind: 'NATURAL_PERSON',
  operatorRole: 'Porteur du projet AccesDirectAide (personne physique)',
  plannedLegalForm: 'Association à but non lucratif de droit local d’Alsace-Moselle — envisagée, non créée, non inscrite',
  legalName: null,
  tradeName: 'AccesDirectAide',
  legalForm: null,
  capital: null,
  siren: null,
  siret: null,
  rne: null,
  rcsCity: null,
  vatNumber: null,
  registeredOffice: null,
  contactEmail: 'contact@accesdirectaide.fr',
  contactPhone: null,
  publicationDirector: null,
  hostingProvider: 'Vercel Inc.',
  consumerMediator: null,
  dpoContact: null
};

export function validateLaunchReadiness(config: LegalEntityConfig): { ready: boolean; missingFields: string[]; pendingLegalReview: boolean } {
  const requiredForLaunch = [
    'legalName',
    'legalForm',
    'siren',
    'registeredOffice',
    'publicationDirector'
  ];
  
  const missingFields = requiredForLaunch.filter(field => !config[field as keyof LegalEntityConfig]);
  
  return {
    ready: config.status === 'ACTIVE' && missingFields.length === 0,
    missingFields,
    pendingLegalReview: true // PENDING_GATE_2_LEGAL_RESEARCH
  };
}
