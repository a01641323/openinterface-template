import { describe, it, expect } from 'vitest';
import config from '../../template.config.json';

// Shape-only assertions: renaming the template (editing template.config.json)
// must never break the test suite. scripts/verify-template.mjs proves the
// rename behavior end to end.
describe('template config', () => {
  it('has the four required fields with valid shapes', () => {
    expect(typeof config.commandName).toBe('string');
    expect(config.commandName).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(typeof config.brandName).toBe('string');
    expect(config.brandName.length).toBeGreaterThan(0);
    expect(Number.isInteger(config.port)).toBe(true);
    expect(config.port).toBeGreaterThan(0);
    expect(config.port).toBeLessThan(65536);
    expect(config.vercelUrl).toMatch(/^https:\/\//);
  });
});
