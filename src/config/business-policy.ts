export interface BusinessPolicyConfig {
  citizenPlatformAccessFree: boolean;
  citizenSubscriptionAllowed: boolean;
  citizenPaywallAllowed: boolean;
  optionalThirdPartyPaidProductsAllowed: boolean;
  optionalThirdPartyPaidServicesAllowed: boolean;
  thirdPartyPaymentRequiredForCoreAccess: boolean;
  productPurchaseRequiredForCoreAccess: boolean;
  advertisingAllowed: boolean;
  sponsoredRankingAllowed: boolean;
  institutionalLaunchAccessFree: boolean;
  institutionalFreePeriodBasis: 'GLOBAL_FROM_PUBLIC_LAUNCH' | 'PER_ACCOUNT';
  institutionalFreePeriodTargetMinMonths: number;
  institutionalFreePeriodTargetMaxMonths: number;
  institutionalDurationContractuallyFixed: boolean;
  institutionalBillingEnabled: boolean;
  automaticPaidConversion: boolean;
  institutionalPricing: 'UNDECIDED' | 'FIXED' | 'TIERED';
  pricingSegmentation: 'UNDECIDED' | 'FIXED' | 'TIERED';
}

export const CURRENT_BUSINESS_POLICY: BusinessPolicyConfig = {
  citizenPlatformAccessFree: true,
  citizenSubscriptionAllowed: false,
  citizenPaywallAllowed: false,
  optionalThirdPartyPaidProductsAllowed: true,
  optionalThirdPartyPaidServicesAllowed: true,
  thirdPartyPaymentRequiredForCoreAccess: false,
  productPurchaseRequiredForCoreAccess: false,
  advertisingAllowed: false,
  sponsoredRankingAllowed: false,
  institutionalLaunchAccessFree: true,
  institutionalFreePeriodBasis: 'GLOBAL_FROM_PUBLIC_LAUNCH',
  institutionalFreePeriodTargetMinMonths: 6,
  institutionalFreePeriodTargetMaxMonths: 12,
  institutionalDurationContractuallyFixed: false,
  institutionalBillingEnabled: false,
  automaticPaidConversion: false,
  institutionalPricing: 'UNDECIDED',
  pricingSegmentation: 'UNDECIDED',
};
