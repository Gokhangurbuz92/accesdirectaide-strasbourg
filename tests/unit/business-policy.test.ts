import { describe, it, expect } from 'vitest';
import { CURRENT_BUSINESS_POLICY } from '../../src/config/business-policy';

describe('Founder Business Policy', () => {
  it('enforces that citizen platform access is permanently free', () => {
    expect(CURRENT_BUSINESS_POLICY.citizenPlatformAccessFree).toBe(true);
    expect(CURRENT_BUSINESS_POLICY.citizenSubscriptionAllowed).toBe(false);
    expect(CURRENT_BUSINESS_POLICY.citizenPaywallAllowed).toBe(false);
  });

  it('enforces that optional third-party paid goods and services are allowed but not required for core platform access', () => {
    expect(CURRENT_BUSINESS_POLICY.optionalThirdPartyPaidProductsAllowed).toBe(true);
    expect(CURRENT_BUSINESS_POLICY.optionalThirdPartyPaidServicesAllowed).toBe(true);
    expect(CURRENT_BUSINESS_POLICY.thirdPartyPaymentRequiredForCoreAccess).toBe(false);
    expect(CURRENT_BUSINESS_POLICY.productPurchaseRequiredForCoreAccess).toBe(false);
  });

  it('enforces that advertising and sponsored ranking are disabled', () => {
    expect(CURRENT_BUSINESS_POLICY.advertisingAllowed).toBe(false);
    expect(CURRENT_BUSINESS_POLICY.sponsoredRankingAllowed).toBe(false);
  });

  it('enforces that institutional billing and automatic conversion are disabled', () => {
    expect(CURRENT_BUSINESS_POLICY.institutionalBillingEnabled).toBe(false);
    expect(CURRENT_BUSINESS_POLICY.automaticPaidConversion).toBe(false);
    expect(CURRENT_BUSINESS_POLICY.institutionalLaunchAccessFree).toBe(true);
  });

  it('enforces that institutional free period uses a global launch strategy without a contractual fixed duration', () => {
    expect(CURRENT_BUSINESS_POLICY.institutionalFreePeriodBasis).toBe('GLOBAL_FROM_PUBLIC_LAUNCH');
    expect(CURRENT_BUSINESS_POLICY.institutionalDurationContractuallyFixed).toBe(false);
  });

  it('ensures institutional pricing remains completely undecided', () => {
    expect(CURRENT_BUSINESS_POLICY.institutionalPricing).toBe('UNDECIDED');
    expect(CURRENT_BUSINESS_POLICY.pricingSegmentation).toBe('UNDECIDED');
  });
});
