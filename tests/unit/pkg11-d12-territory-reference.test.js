/**
 * PKG-11 / D12 · P07 — the committed territory reference is the INSEE data as published, internally consistent, with its provenance; the service territory
 * is derived from it and still awaits a human validation; the resolver, chat and UI keep the fail-safe states (real-database behaviour:
 * tests/integration/pkg11-d12-territory-reference-db.test.js).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, REFERENCE_PATH, SERVICE_TERRITORY_PATH, SERVICE_EPCI as BUILD_EPCI } from '../../scripts/geo-reference-build.mjs';
import { SERVICE_EPCI } from '../../api/lib/geography/serviceTerritory.js';
import { referenceItems } from '../../api/lib/geography/territoryReference.js';

const ref = JSON.parse(fs.readFileSync(REFERENCE_PATH, 'utf8'));
const svc = JSON.parse(fs.readFileSync(SERVICE_TERRITORY_PATH, 'utf8'));

describe('PKG-11 / D12 official territory reference', () => {
  it('names its official sources with the sha256 of every input file and states what it is not (no postal codes)', () => {
    expect(ref.schema).toBe('accesdirectaide.territory-reference.v1');
    expect(ref.cogVersion).toBe('2026');
    expect(ref.sources.map((s) => s.page)).toEqual(['https://www.insee.fr/fr/information/8740222', 'https://www.insee.fr/fr/information/2510634']);
    for (const s of ref.sources) {
      expect(s.producer).toBe('Insee');
      expect(s.url).toMatch(/^https:\/\/www\.insee\.fr\/fr\/statistiques\/fichier\//);
      for (const h of Object.values(s.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(ref.note).toMatch(/Aucun code postal/);
    expect(ref.counts).toEqual({ regions: 18, departements: 101, communes: 34875, arrondissementsMunicipaux: 45, epcis: 1253 });
    expect(ref.communes).toHaveLength(ref.counts.communes);
  });

  it('is internally consistent: every commune has a known département, every member a listed EPCI, codes are unique and sorted', () => {
    const deps = new Map(ref.departements.map(([code, reg]) => [code, reg]));
    const regions = new Set(ref.regions.map(([code]) => code));
    const epcis = new Set(ref.epcis.map(([code]) => code));
    for (const [, reg] of deps) expect(regions.has(reg)).toBe(true);
    for (const [code, dep, label, epci] of ref.communes) {
      expect(code).toMatch(/^(\d{5}|2[AB]\d{3})$/);
      expect(deps.has(dep), code).toBe(true);
      expect(label.length).toBeGreaterThan(0);
      if (epci) expect(epcis.has(epci), code).toBe(true);
    }
    for (const list of [ref.regions, ref.departements, ref.communes, ref.epcis]) {
      const codes = list.map((x) => x[0]);
      expect(new Set(codes).size).toBe(codes.length);
      expect([...codes].sort()).toEqual(codes);
    }
    expect(ref.communes.find((c) => c[0] === '67482')).toEqual(['67482', '67', 'Strasbourg', '246700488']);
    expect(ref.departements.find((d) => d[0] === '94')).toEqual(['94', '11', 'Val-de-Marne']);
  });

  it('the service territory is the Eurométropole de Strasbourg as listed by INSEE — 33 communes, PENDING a human validation', () => {
    expect(SERVICE_EPCI).toBe('246700488');
    expect(BUILD_EPCI).toBe(SERVICE_EPCI);
    expect(svc).toMatchObject({ epci: SERVICE_EPCI, libelle: 'Eurométropole de Strasbourg', nature: 'METRO' });
    expect(svc.communes).toEqual(ref.communes.filter((c) => c[3] === SERVICE_EPCI).map((c) => [c[0], c[2]]));
    expect(svc.communes).toHaveLength(33);
    expect(svc.validation).toEqual(expect.objectContaining({ status: 'PENDING_HUMAN_VALIDATION', by: null, at: null }));
    expect(svc.derivedFrom.sha256).toBe(ref.sources[1].files['Composition_communale.csv']);
  });

  it('a partial load never loads half an EPCI and keeps every région and département', () => {
    const p = referenceItems(ref, { departements: ['67'] });
    expect(p.regions).toHaveLength(18);
    expect(p.departments).toHaveLength(101);
    expect(p.communes.every((c) => c.codeDepartement === '67')).toBe(true);
    for (const e of p.epcis) expect(e.membres.every((m) => p.communes.some((c) => c.code === m))).toBe(true);
    expect(p.epcis.find((e) => e.code === SERVICE_EPCI).membres).toHaveLength(33);
  });

  it('reads RFC 4180 CSV (quotes, doubled quotes, CRLF, empty fields)', () => {
    expect(parseCsv('"A","B"\r\n"x, y","say ""hi"""\r\n1,\n')).toEqual([['A', 'B'], ['x, y', 'say "hi"'], ['1', '']]);
  });
});

describe('PKG-11 / P07 fail-safe states stay wired', () => {
  const resolver = fs.readFileSync('api/lib/geography/AssistantTerritoryResolver.js', 'utf8');
  const chat = fs.readFileSync('api/_handlers/assistant/chat.js', 'utf8');
  const ui = fs.readFileSync('src/components/chat/ChatAssistant.jsx', 'utf8');
  const ingestion = fs.readFileSync('api/lib/geography/COGIngestion.js', 'utf8');

  it('resolver: postal codes, outside / too broad, message names after « à » only, no network', () => {
    for (const s of ["status: 'POSTAL_CODE'", "'OUTSIDE_SERVICE_TERRITORY'", "'TOO_BROAD'", "' a ' ||", "IN ('PART_OF', 'MEMBER_OF')"]) expect(resolver).toContain(s);
    expect(resolver).not.toMatch(/fetch\s*\(|https?:\/\//i);
  });

  it('chat answers each new state in French without keeping a territory; the UI sends back the canonical id and shows the name', () => {
    for (const r of ['territory_outside_service', 'territory_too_broad', 'territory_postal_code']) {
      expect(chat).toContain(`${r}:`);
      expect(ui).toContain(`'${r}'`);
    }
    expect(chat).toContain("abstentionPayload(requestId, reason, 200, null, territoryResolution?.territory || null)");
    expect(ui).toContain('setTerritory(data.meta.territoryId)');
    expect(ui).toContain('territory={territoryLabel}');
  });

  it('ingestion registers a valid source type and never re-types a département by its code', () => {
    expect(ingestion).not.toMatch(/type: 'REFERENCE_DATASET'/);
    expect(ingestion).not.toMatch(/item\.code === '94'/);
    expect(ingestion).toContain("COMMUNE: { type: 'DEPARTEMENT', field: 'codeDepartement' }");
  });
});
