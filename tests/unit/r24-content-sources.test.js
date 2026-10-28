/**
 * R24 (owner decisions R20.2 / R20.3 / R20.5, 2026-10-28):
 *   - TER Grand Est (SNCF Voyageurs, the operator of the Région's TER Fluo network) is a seed source, an authority on ITS OWN regional offers only (« :local »:
 *     never on a national record);
 *   - a record's département codes are editable from the administration (a « Grand Est » aide listed 01..57) and must be real INSEE codes.
 */
import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '../../api/_services/verification/sources.js';
import { authorityFor } from '../../api/_services/verification/chain.js';
import { editorialValues } from '../../api/_services/admin-content.js';

const TER = 'https://www.ter.sncf.com/grand-est/tarifs-cartes/cartes-reduction/carte-solidaire';

describe('R24 TER Grand Est as the operator source of its own offers', () => {
  const ter = SEED_SOURCES.find((s) => s.sourceId === 'ter-grand-est');
  it('is seeded as an operator, local capabilities only', () => {
    expect(ter).toMatchObject({ level: 'OPERATEUR', domains: ['ter.sncf.com'], capabilities: ['aides:local', 'demarches:local'] });
    expect(ter.attestation).toContain('R20.2');
  });
  const ctx = { registry: [{ sourceId: ter.sourceId, level: ter.level, capabilities: ter.capabilities, trustedDomains: ter.domains }] };
  it('decides a regional aide and its démarche, never a national record', () => {
    expect(authorityFor(ctx, TER, 'aide', { territory_scope: 'REGIONAL' })).toMatchObject({ ok: true, sourceId: 'ter-grand-est' });
    expect(authorityFor(ctx, TER, 'demarche', { territory_scope: 'REGIONAL' })).toMatchObject({ ok: true, sourceId: 'ter-grand-est' });
    expect(authorityFor(ctx, TER, 'aide', { territory_scope: 'NATIONAL' })).toMatchObject({ ok: false });
    expect(authorityFor(ctx, 'https://www.sncf-connect.com/carte-solidaire', 'aide')).toMatchObject({ ok: false });
  });
});

describe('R24 département codes from the administration', () => {
  it('accepts the INSEE codes of the Grand Est, refuses anything else', () => {
    const ge = ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'];
    expect(editorialValues('aide', { departements: ge })).toEqual({ ok: true, values: { departements: ge } });
    expect(editorialValues('demarche', { departements: ['67', '67', '2A', '974'] })).toEqual({ ok: true, values: { departements: ['67', '2A', '974'] } });
    for (const bad of [['Grand Est'], ['00'], ['99'], ['6'], [67], ['977']]) expect(editorialValues('aide', { departements: bad }).code, JSON.stringify(bad)).toBe('INVALID_VALUE');
    expect(editorialValues('aide', { territoires: ['Grand Est'] })).toEqual({ ok: true, values: { territoires: ['Grand Est'] } });
  });
});
