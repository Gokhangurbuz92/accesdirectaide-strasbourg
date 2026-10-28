import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

/**
 * Environment configuration tests.
 */
describe('Environment configuration', () => {
  it('.env.example exists', () => {
    expect(existsSync('.env.example')).toBe(true);
  });

  it('.env.example has DATABASE_URL', () => {
    const content = readFileSync('.env.example', 'utf-8');
    expect(content).toContain('DATABASE_URL');
  });

  it('.env.example has JWT_SECRET', () => {
    const content = readFileSync('.env.example', 'utf-8');
    expect(content).toContain('JWT_SECRET');
  });

  it('.env.example has GEMINI_API_KEY', () => {
    const content = readFileSync('.env.example', 'utf-8');
    expect(content).toContain('GEMINI_API_KEY');
  });

  it('.gitignore excludes .env files', () => {
    const content = readFileSync('.gitignore', 'utf-8');
    expect(content).toMatch(/\.env\.local|\.env/);
  });

  it('.gitignore excludes node_modules', () => {
    const content = readFileSync('.gitignore', 'utf-8');
    expect(content).toContain('node_modules');
  });

  it('.gitignore excludes dist', () => {
    const content = readFileSync('.gitignore', 'utf-8');
    expect(content).toContain('dist');
  });
});
