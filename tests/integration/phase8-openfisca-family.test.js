import { describe, it } from 'vitest';

describe('OpenFisca Family Integration', () => {
  it.skip('calls real OpenFisca container with 2-person family scenario', () => {
    // REQUIRES: Running OpenFisca container
    // Run manually: docker compose up openfisca && npx vitest run tests/integration/phase8-openfisca-family.test.js
  });
});
