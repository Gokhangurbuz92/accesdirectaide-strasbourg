export type LegalEntityStatus = 'IN_FORMATION' | 'ACTIVE';

export interface LegalEntityConfig {
  status: LegalEntityStatus;
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
  status: 'IN_FORMATION',
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
