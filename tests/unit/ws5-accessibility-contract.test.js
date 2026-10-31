import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/Accessibilite.jsx'),
  'utf8'
);

describe('WS5 accessibility statement contract', () => {
  it('uses non-conformity status while no valid formal audit exists', () => {
    // owner directive 31/10/2026 (R26): no formal audit is under way or scheduled, so the statement no longer says one is « en cours de réalisation »
    expect(source).toContain(
      'Accessibilité : non conforme — aucun audit de conformité n’a encore été réalisé.'
    );
    expect(source).toContain('Aucun audit complet de conformité au RGAA n’a été réalisé ni programmé à ce jour');
    expect(source).not.toContain('en cours de réalisation');
    expect(source).not.toContain('Accessibilité : totalement conforme');
    expect(source).not.toContain('Accessibilité : partiellement conforme');
  });

  it('does not present automated checks as a formal RGAA audit', () => {
    expect(source).toContain(
      'Ils ne remplacent pas un audit RGAA complet ni les vérifications'
    );
  });

  it('publishes an accessibility feedback channel', () => {
    expect(source).toContain('Retour d’information et contact');
    expect(source).toContain('mailto:contact@accesdirectaide.fr');
  });

  it('publishes the Défenseur des droits recourse path', () => {
    expect(source).toContain('Voies de recours');
    expect(source).toContain('https://formulaire.defenseurdesdroits.fr/');
    expect(source).toContain('Saisir le Défenseur des droits');
  });

  it('keeps a clear FALC disclosure', () => {
    expect(source).toContain('Facile à lire et à comprendre (FALC)');
    expect(source).toMatch(/Le\s+FALC complète les informations de référence/);
  });

  it('uses semantic headings and page labelling', () => {
    // R26: the level-1 heading is drawn by the shared page header, with the id the article is labelled by
    expect(source).toMatch(/<PageHeader[^>]*titleId="accessibilite-title"/);
    expect(source).toContain('<h2');
    expect(source).toContain('aria-labelledby="accessibilite-title"');
  });
});
