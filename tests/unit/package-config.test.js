import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Package configuration tests.
 */
describe('Package configuration', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

  it('has version 1.0.0+', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).not.toBe('0.0.0');
  });

  it('has test script', () => {
    expect(pkg.scripts.test).toBeDefined();
  });

  it('has build script', () => {
    expect(pkg.scripts.build).toBeDefined();
  });

  it('has lint script', () => {
    expect(pkg.scripts.lint).toBeDefined();
  });

  it('has dev script', () => {
    expect(pkg.scripts.dev).toBeDefined();
  });

  it('has coverage script', () => {
    expect(pkg.scripts['test:coverage']).toBeDefined();
  });

  it('has drizzle-orm dependency', () => {
    expect(pkg.dependencies['drizzle-orm']).toBeDefined();
  });

  it('has react dependency', () => {
    expect(pkg.dependencies.react).toBeDefined();
  });

  it('has vitest devDependency', () => {
    expect(pkg.devDependencies.vitest).toBeDefined();
  });
});
