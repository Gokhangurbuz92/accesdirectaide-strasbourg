/**
 * R37 — the owner's FINESS import (production 02/11/2026: 589 records, 1,032 labels) fills `services` with the activities the register AUTHORISES. They
 * were shown as « Services proposés » and in search as « indique proposer … »: an authorisation is not an offer, a place or an appointment.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isFinessRecord } from '../../src/lib/structureActivities.js';

describe('FINESS authorised activities', () => {
  it('a FINESS record is recognised by its number or its register source, nothing else', () => {
    expect(isFinessRecord({ numero_finess: '670799998' })).toBe(true);
    expect(isFinessRecord({ source_url: 'https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFinesset=670799998' })).toBe(true);
    expect(isFinessRecord({ source_url: 'https://lannuaire.service-public.gouv.fr/x' })).toBe(false);
    expect(isFinessRecord({ source_url: 'https://evil.example/https://finess.esante.gouv.fr/' })).toBe(false);
    expect(isFinessRecord(null)).toBe(false);
  });
  it('the detail page, the easy-to-read view and the search card name them as authorised activities with the no-guarantee notice', () => {
    const detail = readFileSync('src/pages/StructureDetail.jsx', 'utf8');
    expect(detail).toMatch(/finess \? \(<>\s*<h2[^>]*>\{t\('structures:detail\.finess_activities', 'Activités autorisées'\)\}/);
    expect(detail).toMatch(/data-testid="finess-activities-notice">\{t\('structures:detail\.finess_activities_notice', 'Selon le répertoire officiel FINESS[^']*ne garantit ni une place, ni un rendez-vous, ni une admission/);
    expect(detail).toMatch(/services, finess: isFinessRecord\(structure\) \}/);
    expect(readFileSync('src/components/FalcContent.jsx', 'utf8')).toMatch(/data\.finess \? t\('shared:falc\.finess_activities'/);
    expect(readFileSync('src/components/cards/StructureCard.jsx', 'utf8')).toMatch(/isFinessRecord\(structure\) \? \(\s*<Trans i18n=\{i18n\} i18nKey="structures:card\.why_shown_finess"/);
  });
});
