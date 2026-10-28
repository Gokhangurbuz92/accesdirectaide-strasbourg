import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/Accessibilite.jsx'),
  'utf8'
);

describe('WS5 accessibility statement contract', () => {
  it('uses non-conformity status while no valid formal audit exists', () => {
    expect(source).toContain(
      'Accessibilité : non conforme — audit d’évaluation en cours de réalisation.'
    );
    expect(source).toContain('Aucun audit complet de conformité au RGAA n’est encore disponible');
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
    expect(source).toContain('<h1');
    expect(source).toContain('<h2');
    expect(source).toContain('aria-labelledby="accessibilite-title"');
  });
});
