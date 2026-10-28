import { z } from 'zod';

export const SpecialistDefinition = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  responseSchema: z.any(), // Zod schema instance
  tools: z.array(z.any()).default([]),
  timeout: z.number().default(45_000),
  enabled: z.boolean().default(true),
  requiresModel: z.boolean().default(true) // false for deterministic services
});

const _registry = new Map();

export function registerComponent(/** @type {{ name: string | number | boolean | null | undefined }} */ definition) {
  // Validate with SpecialistDefinition schema (but allow Zod schemas as `any`)
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error(`Invalid component definition: name is required`);
  }
  if (_registry.has(definition.name)) {
    throw new Error(`Component '${definition.name}' is already registered`);
  }
  _registry.set(definition.name, { ...definition });
}

export function getComponent(/** @type {string | number | boolean | null | undefined} */ name) {
  const component = _registry.get(name);
  if (!component) {
    throw new Error(`Unknown component: '${name}'`);
  }
  return component;
}

export function listComponents() {
  return Array.from(_registry.values());
}

export function hasComponent(/** @type {string | number | boolean | null | undefined} */ name) {
  return _registry.has(name);
}

export function clearRegistry() {
  _registry.clear();
}
