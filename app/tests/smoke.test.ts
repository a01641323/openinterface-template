import { describe, it, expect } from 'vitest';
import config from '../../template.config.json';

describe('template config', () => {
  it('has the four required fields', () => {
    expect(config.commandName).toBe('openinterface');
    expect(config.brandName).toBe('Open Interface');
    expect(config.port).toBe(4321);
    expect(config.vercelUrl).toMatch(/^https:\/\//);
  });
});
